import { useCallback, useEffect, useRef, useState } from "react";

import {
  type SessionStatusResponse,
  createSession,
  endSession,
  getSessionStatus,
  uploadChunk,
} from "@/lib/filly-api";
import { VadRecorder } from "@/lib/filly-engine";
import { uploadHistoryAudio } from "@/lib/filly-history";
import { getFacilityIdFromUrl } from "@/lib/structured/care-api";
import {
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
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const upload = uploadChunk(sessionId, index, wav).catch((err) => {
      // Non-fatal — a dropped utterance only loses a little transcript.
      if (DEBUG) console.warn("[Filly] chunk upload failed:", index, err);
    });
    pendingUploadsRef.current.push(upload);
  }, []);

  /**
   * Session parameters shared by live recordings and re-runs of stored
   * audio: template ids, language hint, and the additional_data payload
   * (form schema, facility for quota enforcement, encounter).
   */
  const buildSessionExtras = useCallback(
    (options?: StartOptions) => {
      const templates = options?.templateIds || ["care_form"];
      const facilityId = getFacilityIdFromUrl();
      let additionalData: Record<string, unknown> | undefined =
        options?.encounterId
          ? { encounter_id: options.encounterId }
          : undefined;
      if (facilityId) {
        // Used by the backend for per-user/facility quota enforcement.
        additionalData = { ...additionalData, facility_id: facilityId };
      }
      const fields = formStateProp ? extractFormFields(formStateProp) : [];
      if (fields.length > 0) {
        const { desc, example } = buildTemplateDescription(fields);
        additionalData = {
          ...additionalData,
          care_template: { desc, example },
        };
      }
      const language = options?.language || FILLY_LANGUAGES;
      return { templates, additionalData, language };
    },
    [formStateProp],
  );

  // ── result polling ───────────────────────────────────────────────────────

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
   * Poll the session until our template data is terminal, emitting the
   * transcript as soon as it is available. Shared by stopRecording (live
   * mic session) and processAudioFile (re-run of stored audio).
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
        setDuration(0);

        const { templates, additionalData, language } =
          buildSessionExtras(options);

        const session = await createSession({
          templates,
          language_hint: language,
          additional_data: additionalData,
        });
        sessionIdRef.current = session.session_id;

        const recorder = new VadRecorder({
          onSpeechChunk: enqueueChunk,
          onError: (err) => {
            setError(err.message);
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
        const message =
          err instanceof Error ? err.message : "Failed to start recording";
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

      await endSession(sessionId);
      await awaitSessionResult(sessionId);

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
  }, [stopTimer, updateStatus, awaitSessionResult, flushHistoryAudio, onError]);

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

        const { templates, additionalData, language } =
          buildSessionExtras(options);

        const session = await createSession({
          templates,
          language_hint: language,
          additional_data: additionalData,
        });
        sessionIdRef.current = session.session_id;

        await uploadChunk(session.session_id, 0, audio);
        await endSession(session.session_id);
        await awaitSessionResult(session.session_id);

        // The backend wrote a fresh history row — re-attach the recording
        // so the new entry can itself be replayed or re-run.
        try {
          await uploadHistoryAudio(
            session.session_id,
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
    [buildSessionExtras, awaitSessionResult, updateStatus, onError],
  );

  const cancelRecording = useCallback(async () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
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
 * Extract structured data from filly template results.
 * Our dynamic templates return JSON with keys matching form field labels.
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
