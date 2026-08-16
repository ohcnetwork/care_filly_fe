import { useCallback, useEffect, useRef, useState } from "react";

import {
  type SessionStatusResponse,
  createSession,
  endSession,
  getSessionStatus,
  uploadChunk,
} from "@/lib/filly-api";
import {
  VadRecorder,
  encodeSilenceMarker,
  segmentAudioBlob,
} from "@/lib/filly-engine";
import { uploadHistoryAudio } from "@/lib/filly-history";
import {
  type MedispeakResult,
  type MedispeakSessionHandle,
  commitMedispeakSession,
  createMedispeakSession,
  finalizeMedispeakSession,
  isMedispeakConfigured,
  pollMedispeakResult,
  uploadMedispeakChunk,
} from "@/lib/medispeak-api";
import { getFacilityIdFromUrl } from "@/lib/structured/care-api";
import {
  type FormField,
  buildFieldSpecs,
  buildTemplateDescription,
  extractFormFields,
} from "@/lib/template-builder";
import type { FillyResult, FillyStatus } from "@/lib/types/filly";
import { sleep } from "@/lib/utils";

const DEBUG = import.meta.env.DEV;

// Spoken language hint, comma-separated ISO codes (e.g. "ta" or "ta,en").
// Forcing the language avoids per-chunk auto-detection flip-flopping on
// code-switched speech (e.g. Tamil consultation with English drug names).
const FILLY_LANGUAGES: string[] = (
  import.meta.env.REACT_FILLY_LANGUAGES || "auto_detect"
)
  .split(",")
  .map((code: string) => code.trim())
  .filter(Boolean);

// care_filly's own pipeline (used when Medispeak isn't configured).
const SESSION_POLL_INTERVAL_MS = 750;
const SESSION_POLL_MAX_ATTEMPTS = 160;

// Template result statuses that mean processing is finished for that template.
const TERMINAL_TEMPLATE_STATUSES = new Set([
  "success",
  "partial_success",
  "failure",
]);

/**
 * True once every requested template has finished processing. The overall
 * session status can stay "processing" (audio post-processing) well after
 * our template data is ready — no reason to keep polling.
 */
function templatesReady(data: SessionStatusResponse): boolean {
  const templates = data.templates;
  if (!templates?.length) return false;
  return templates.every((entry) =>
    Object.values(entry).every(
      (templateData) =>
        templateData && TERMINAL_TEMPLATE_STATUSES.has(templateData.status),
    ),
  );
}

/**
 * `getUserMedia` rejects with a raw DOMException whose message is either
 * unhelpful ("The request is not allowed by the user agent or the platform
 * in the current context.") or browser-specific jargon. Map the well-known
 * mic-access failure cases to a message a clinician can actually act on.
 */
function describeRecordingError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone access is blocked. Please allow microphone permissions for this site in your browser settings and try again.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No microphone was found. Please connect a microphone and try again.";
      case "NotReadableError":
        return "The microphone could not be accessed — it may be in use by another application.";
    }
  }
  return err instanceof Error ? err.message : "Failed to start recording";
}

interface StartOptions {
  encounterId?: string;
  templateIds?: string[];
  language?: string[];
}

interface UseFillyOptions {
  /** Reserved — the CARE JWT is read from localStorage by the request layer. */
  accessToken?: string;
  formState?: unknown;
  onStatusChange?: (status: FillyStatus) => void;
  onTranscript?: (transcript: string) => void;
  onResult?: (result: FillyResult) => void;
  onError?: (error: Error) => void;
}

interface UseFillyReturn {
  status: FillyStatus;
  isStarting: boolean;
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  result: FillyResult | null;
  error: string | null;
  startRecording: (options?: StartOptions) => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  /** Re-run transcription + extraction on a pre-recorded audio blob. */
  processAudioFile: (
    audio: Blob,
    options?: StartOptions & { durationSeconds?: number },
  ) => Promise<void>;
  reset: () => Promise<void>;
}

export function useFilly({
  formState: formStateProp,
  onStatusChange,
  onTranscript,
  onResult,
  onError,
}: UseFillyOptions = {}): UseFillyReturn {
  const [status, setStatus] = useState<FillyStatus>("idle");
  const [isStarting, setIsStarting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<FillyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<VadRecorder | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const medispeakHandleRef = useRef<MedispeakSessionHandle | null>(null);
  const chunkSeqRef = useRef(0);
  const pendingUploadsRef = useRef<Promise<void>[]>([]);
  const capturedAudioRef = useRef<Blob | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0); // ms accumulated before current segment

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const updateStatus = useCallback(
    (newStatus: FillyStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange],
  );

  // ── timers ─────────────────────────────────────────────────────────────

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setDuration(
        Math.floor(
          (accumulatedRef.current + Date.now() - startTimeRef.current) / 1000,
        ),
      );
    }, 1000);
  }, []);

  const stopTimer = useCallback((save = false) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (save) {
      accumulatedRef.current += Date.now() - startTimeRef.current;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  // ── chunk uploads ────────────────────────────────────────────────────────

  const enqueueChunk = useCallback((wav: Blob, index: number) => {
    const handle = medispeakHandleRef.current;
    if (handle) {
      const seq = chunkSeqRef.current++;
      const upload = uploadMedispeakChunk(handle, seq, wav).catch((err) => {
        // Non-fatal — a dropped utterance only loses a little transcript.
        if (DEBUG) console.warn("[Filly] chunk upload failed:", seq, err);
      });
      pendingUploadsRef.current.push(upload);
      return;
    }

    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const upload = uploadChunk(sessionId, index, wav).catch((err) => {
      if (DEBUG) console.warn("[Filly] chunk upload failed:", index, err);
    });
    pendingUploadsRef.current.push(upload);
  }, []);

  /**
   * Session parameters shared by live recordings and re-runs of stored
   * audio: facility (for quota enforcement), the form fields (shaped into
   * Medispeak's FieldSpec[] or care_filly's desc/example template
   * depending on which pipeline is active), and the language hint.
   */
  const buildSessionExtras = useCallback(
    (options?: StartOptions) => {
      const facilityId = getFacilityIdFromUrl();
      const formFields: FormField[] = formStateProp
        ? extractFormFields(formStateProp)
        : [];
      const language = options?.language || FILLY_LANGUAGES;
      return {
        facilityId,
        formFields,
        language,
        templates: options?.templateIds || ["care_form"],
        encounterId: options?.encounterId,
      };
    },
    [formStateProp],
  );

  // ── result polling ───────────────────────────────────────────────────────

  const finishWithMedispeakResult = useCallback(
    (data: MedispeakResult) => {
      if (DEBUG) console.log("[Filly] Result:", data);

      const fillyResult: FillyResult = {
        transcript: data.transcript || undefined,
        structuredData:
          Object.keys(data.structuredData).length > 0
            ? data.structuredData
            : undefined,
      };

      setResult(fillyResult);
      if (data.status === "failed" && !data.transcript) {
        updateStatus("failed");
        onError?.(new Error(data.errors[0] || "Filly processing failed"));
        return;
      }
      updateStatus("completed");
      onResult?.(fillyResult);
    },
    [updateStatus, onResult, onError],
  );

  /**
   * Poll the Medispeak session until it reaches a terminal status, then
   * record quota usage (best-effort). Shared by stopRecording (live mic
   * session) and processAudioFile (re-run of stored audio).
   */
  const awaitMedispeakResult = useCallback(
    async (handle: MedispeakSessionHandle) => {
      const data = await pollMedispeakResult(handle);
      if (data.transcript) onTranscript?.(data.transcript);
      finishWithMedispeakResult(data);
      try {
        await finalizeMedispeakSession(handle.sessionId);
      } catch (err) {
        // Non-fatal — the result already reached the clinician; a missed
        // usage record only affects quota accounting.
        if (DEBUG) console.warn("[Filly] usage finalize failed:", err);
      }
    },
    [finishWithMedispeakResult, onTranscript],
  );

  // care_filly's own pipeline (used when Medispeak isn't configured).
  const finishWithData = useCallback(
    (data: SessionStatusResponse) => {
      const transcript = data.transcript || "";
      const templates = data.templates || [];
      const structuredData = extractStructuredData(templates);

      if (DEBUG) {
        console.log("[Filly] Result:", {
          transcript,
          templates,
          structuredData,
        });
      }

      const fillyResult: FillyResult = {
        transcript: transcript || undefined,
        templates: templates.length > 0 ? templates : undefined,
        structuredData:
          Object.keys(structuredData).length > 0 ? structuredData : undefined,
      };

      setResult(fillyResult);
      updateStatus("completed");
      onResult?.(fillyResult);
    },
    [updateStatus, onResult],
  );

  /**
   * Poll the care_filly session until our template data is terminal,
   * emitting the transcript as soon as it is available.
   */
  const awaitSessionResult = useCallback(
    async (sessionId: string) => {
      let transcriptEmitted = false;

      for (let attempt = 0; attempt < SESSION_POLL_MAX_ATTEMPTS; attempt++) {
        const data = await getSessionStatus(sessionId);

        if (!transcriptEmitted && data.transcript) {
          transcriptEmitted = true;
          setResult({ transcript: data.transcript });
          onTranscript?.(data.transcript);
        }

        const templatesDone = Boolean(data.transcript) && templatesReady(data);
        if (
          templatesDone ||
          data.status === "completed" ||
          data.status === "partial" ||
          data.status === "failed"
        ) {
          if (data.status === "failed" && !data.transcript) {
            throw new Error(
              (data.processing_errors?.[0] as string) ||
                "Filly processing failed",
            );
          }
          finishWithData(data);
          return;
        }

        await sleep(SESSION_POLL_INTERVAL_MS);
      }

      // Timed out — surface whatever the backend has so far.
      finishWithData(await getSessionStatus(sessionId));
    },
    [finishWithData, onTranscript],
  );

  // ── recording lifecycle ──────────────────────────────────────────────────

  const startRecording = useCallback(
    async (options?: StartOptions) => {
      setIsStarting(true);
      try {
        setError(null);
        setResult(null);
        capturedAudioRef.current = null;
        pendingUploadsRef.current = [];
        accumulatedRef.current = 0;
        chunkSeqRef.current = 0;
        setDuration(0);

        const { facilityId, formFields, language, templates, encounterId } =
          buildSessionExtras(options);

        if (isMedispeakConfigured()) {
          const handle = await createMedispeakSession({
            facilityId,
            fields: buildFieldSpecs(formFields),
            language,
          });
          medispeakHandleRef.current = handle;
          sessionIdRef.current = handle.sessionId;
        } else {
          medispeakHandleRef.current = null;
          let additionalData: Record<string, unknown> | undefined = encounterId
            ? { encounter_id: encounterId }
            : undefined;
          if (facilityId) {
            additionalData = { ...additionalData, facility_id: facilityId };
          }
          if (formFields.length > 0) {
            const { desc, example } = buildTemplateDescription(formFields);
            additionalData = {
              ...additionalData,
              care_template: { desc, example },
            };
          }
          const session = await createSession({
            templates,
            language_hint: language,
            additional_data: additionalData,
          });
          sessionIdRef.current = session.session_id;
        }

        const recorder = new VadRecorder({
          onSpeechChunk: enqueueChunk,
          onError: (err) => {
            setError(describeRecordingError(err));
            onErrorRef.current?.(err);
          },
        });
        recorderRef.current = recorder;
        await recorder.start();

        updateStatus("recording");
        startTimer();
      } catch (err) {
        recorderRef.current?.cancel();
        recorderRef.current = null;
        const message = describeRecordingError(err);
        setError(message);
        updateStatus("failed");
        onError?.(err instanceof Error ? err : new Error(message));
      } finally {
        setIsStarting(false);
      }
    },
    [buildSessionExtras, enqueueChunk, updateStatus, startTimer, onError],
  );

  const pauseRecording = useCallback(() => {
    if (!recorderRef.current) return;
    recorderRef.current.pause();
    stopTimer(true);
    updateStatus("paused");
  }, [stopTimer, updateStatus]);

  const resumeRecording = useCallback(() => {
    if (!recorderRef.current) return;
    recorderRef.current.resume();
    startTimer();
    updateStatus("recording");
  }, [startTimer, updateStatus]);

  /** Attach the captured recording to the server-written history row. */
  const flushHistoryAudio = useCallback(async (sessionId: string | null) => {
    const audio = capturedAudioRef.current;
    capturedAudioRef.current = null;
    if (!audio || !sessionId) return;
    try {
      const durationSeconds = Math.round(accumulatedRef.current / 1000);
      await uploadHistoryAudio(sessionId, audio, durationSeconds || undefined);
    } catch (err) {
      // Non-fatal — the history entry itself is written by the backend.
      if (DEBUG) console.warn("[Filly] History audio upload failed:", err);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const handle = medispeakHandleRef.current;
    try {
      const recorder = recorderRef.current;
      if (!recorder || !sessionId) return;

      stopTimer(true);
      updateStatus("processing");

      // Stop capture first so the last utterance's chunk is queued, then
      // wait for every in-flight upload before finalizing.
      capturedAudioRef.current = await recorder.stop();
      recorderRef.current = null;
      await Promise.allSettled(pendingUploadsRef.current);
      pendingUploadsRef.current = [];

      if (handle) {
        // Mark the audio complete — Medispeak needs one chunk flagged `final`.
        await uploadMedispeakChunk(
          handle,
          chunkSeqRef.current++,
          encodeSilenceMarker(),
          true,
        );
        await commitMedispeakSession(handle);
        await awaitMedispeakResult(handle);
      } else {
        await endSession(sessionId);
        await awaitSessionResult(sessionId);
      }

      // The backend wrote the history row during finalize — attach the
      // locally captured recording to it now.
      void flushHistoryAudio(sessionId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to process recording";
      setError(message);
      updateStatus("failed");
      onError?.(err instanceof Error ? err : new Error(message));
      // Best-effort: a failed row may still exist server-side.
      void flushHistoryAudio(sessionId);
    }
  }, [
    stopTimer,
    updateStatus,
    awaitMedispeakResult,
    awaitSessionResult,
    flushHistoryAudio,
    onError,
  ]);

  /**
   * Re-run the full filly pipeline (transcription + extraction) on a
   * pre-recorded audio blob — e.g. a recording streamed back from the
   * server-side history. Creates a fresh session, uploads the blob as a
   * single chunk, finalizes, and polls for results like a live recording.
   */
  const processAudioFile = useCallback(
    async (
      audio: Blob,
      options?: StartOptions & { durationSeconds?: number },
    ) => {
      setIsStarting(true);
      try {
        setError(null);
        setResult(null);

        const durationSeconds = options?.durationSeconds ?? 0;
        accumulatedRef.current = durationSeconds * 1000;
        setDuration(durationSeconds);
        updateStatus("processing");

        const { facilityId, formFields, language, templates, encounterId } =
          buildSessionExtras(options);

        if (isMedispeakConfigured()) {
          const handle = await createMedispeakSession({
            facilityId,
            fields: buildFieldSpecs(formFields),
            language,
          });
          medispeakHandleRef.current = handle;
          sessionIdRef.current = handle.sessionId;

          const chunks = await segmentAudioBlob(audio);
          if (chunks.length === 0) {
            await uploadMedispeakChunk(handle, 0, encodeSilenceMarker(), true);
          } else {
            for (let index = 0; index < chunks.length; index++) {
              await uploadMedispeakChunk(
                handle,
                index,
                chunks[index],
                index === chunks.length - 1,
              );
            }
          }
          await commitMedispeakSession(handle);
          await awaitMedispeakResult(handle);
        } else {
          medispeakHandleRef.current = null;
          let additionalData: Record<string, unknown> | undefined = encounterId
            ? { encounter_id: encounterId }
            : undefined;
          if (facilityId) {
            additionalData = { ...additionalData, facility_id: facilityId };
          }
          if (formFields.length > 0) {
            const { desc, example } = buildTemplateDescription(formFields);
            additionalData = {
              ...additionalData,
              care_template: { desc, example },
            };
          }
          const session = await createSession({
            templates,
            language_hint: language,
            additional_data: additionalData,
          });
          sessionIdRef.current = session.session_id;

          const chunks = await segmentAudioBlob(audio);
          for (let index = 0; index < chunks.length; index++) {
            await uploadChunk(session.session_id, index, chunks[index]);
          }
          await endSession(session.session_id);
          await awaitSessionResult(session.session_id);
        }

        // The backend wrote a fresh history row — re-attach the recording
        // so the new entry can itself be replayed or re-run.
        try {
          await uploadHistoryAudio(
            sessionIdRef.current!,
            audio,
            durationSeconds || undefined,
          );
        } catch (err) {
          if (DEBUG) console.warn("[Filly] History audio upload failed:", err);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to process audio";
        setError(message);
        updateStatus("failed");
        onError?.(err instanceof Error ? err : new Error(message));
      } finally {
        setIsStarting(false);
      }
    },
    [
      buildSessionExtras,
      awaitMedispeakResult,
      awaitSessionResult,
      updateStatus,
      onError,
    ],
  );

  const cancelRecording = useCallback(async () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    medispeakHandleRef.current = null;
    pendingUploadsRef.current = [];
    capturedAudioRef.current = null;
    stopTimer();
    accumulatedRef.current = 0;
    setDuration(0);
    updateStatus("idle");
  }, [stopTimer, updateStatus]);

  const reset = useCallback(async () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    sessionIdRef.current = null;
    medispeakHandleRef.current = null;
    chunkSeqRef.current = 0;
    pendingUploadsRef.current = [];
    capturedAudioRef.current = null;
    stopTimer();
    accumulatedRef.current = 0;
    setDuration(0);
    setResult(null);
    setError(null);
    updateStatus("idle");
  }, [stopTimer, updateStatus]);

  return {
    status,
    isStarting,
    isRecording: status === "recording",
    isPaused: status === "paused",
    duration,
    result,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
    processAudioFile,
    reset,
  };
}

/**
 * Extract structured data from care_filly template results (the pipeline
 * used when Medispeak isn't configured). Our dynamic templates return JSON
 * with keys matching form field labels.
 */
function extractStructuredData(templates: unknown[]): Record<string, unknown> {
  const structuredData: Record<string, unknown> = {};

  for (const tmpl of templates) {
    const entry = tmpl as Record<string, Record<string, unknown>>;

    for (const [_templateId, templateData] of Object.entries(entry)) {
      if (!templateData || typeof templateData !== "object") continue;
      if (templateData.status !== "success") continue;

      let data = templateData.data;

      if (typeof data === "string") {
        try {
          const jsonMatch = data.match(/\{[\s\S]*\}/);
          if (jsonMatch) data = JSON.parse(jsonMatch[0]);
          else {
            structuredData["clinical_notes"] = data;
            continue;
          }
        } catch {
          structuredData["clinical_notes"] = String(data);
          continue;
        }
      }

      if (typeof data === "object" && data !== null) {
        const obj = data as Record<string, unknown>;

        if (obj.prescription) {
          extractEmrVitals(obj, structuredData);
        }

        for (const [key, value] of Object.entries(obj)) {
          if (key === "prescription") continue;
          mergeExtractedField(structuredData, key, value);
        }
      }
    }
  }

  return structuredData;
}

function mergeExtractedField(
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null || value === "") return;

  if (typeof value === "object" && !Array.isArray(value) && "value" in value) {
    const wrapped = value as { value: unknown; note?: unknown };
    mergeExtractedField(out, key, wrapped.value);
    if (wrapped.note != null && wrapped.note !== "") {
      out[`${key}_note`] = String(wrapped.note);
    }
    return;
  }

  out[key] = value;
}

function extractEmrVitals(
  emrData: Record<string, unknown>,
  out: Record<string, unknown>,
) {
  const prescription = emrData?.prescription as
    | Record<string, unknown>
    | undefined;
  const medHistory = prescription?.medicalHistory as
    | Record<string, unknown>
    | undefined;
  const vitalsList = (medHistory?.vitals || []) as Array<{
    name: string;
    dis_name?: string;
    value: { qt: string; unit: string };
  }>;

  for (const vital of vitalsList) {
    const key = vital.dis_name || vital.name;
    out[key] = vital.value.qt;
  }
}
