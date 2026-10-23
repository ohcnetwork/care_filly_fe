import { useCallback, useEffect, useRef, useState } from "react";

import { VadRecorder, preloadVad } from "@/lib/filly-engine";
import {
  MedispeakApiError,
  type MedispeakResult,
  type MedispeakSessionHandle,
  type RetryParams,
  commitMedispeakSession,
  createMedispeakSession,
  ensureFillyBackendAvailable,
  pollMedispeakResult,
  retryMedispeakSession,
  uploadMedispeakSegment,
} from "@/lib/medispeak-api";
import { resolvePreferredMicDeviceId } from "@/lib/mic-preference";
import { getFacilityIdFromUrl } from "@/lib/structured/care-api";
import {
  type FormField,
  buildFieldSpecs,
  extractFormFields,
} from "@/lib/template-builder";
import type {
  FillyResult,
  FillyStatus,
  ScribeFormSummary,
  ScribeInvoke,
} from "@/lib/types/filly";

const DEBUG = import.meta.env.DEV;

// Spoken language hint, comma-separated ISO codes (e.g. "ta" or "ta,en").
// Forcing the language avoids per-chunk auto-detection flip-flopping on
// code-switched speech (e.g. Tamil consultation with English drug names).
// "auto" is Medispeak's own no-hint sentinel (Scribe::AsrStage::AUTO_DETECT) —
// anything else reaches the ASR provider as a literal (invalid) language code.
const FILLY_LANGUAGES: string[] = (
  import.meta.env.REACT_FILLY_LANGUAGES || "auto"
)
  .split(",")
  .map((code: string) => code.trim())
  .filter(Boolean);

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

function describeStopError(err: unknown): string {
  if (err instanceof MedispeakApiError && err.code === "audio_upload_failed") {
    return "No speech was detected in that recording. Please try again.";
  }
  return err instanceof Error ? err.message : "Failed to process recording";
}

function describeRetryError(err: unknown): string {
  return err instanceof Error ? err.message : "Failed to retry";
}

/** Segment transcription runs async server-side; re-committing retries
 * exactly the still-pending segments, so this failure alone is recoverable. */
function isRecommittableFailure(data: MedispeakResult): boolean {
  return (
    data.status === "failed" &&
    data.errors.some((e) => e.includes("re-commit to retry"))
  );
}

const COMMIT_RETRY_ATTEMPTS = 3;
const COMMIT_RETRY_DELAY_MS = 1500;

interface StartOptions {
  encounterId?: string;
  templateIds?: string[];
  language?: string[];
}

interface UseFillyOptions {
  /** Reserved — the CARE JWT is read from localStorage by the request layer. */
  accessToken?: string;
  invoke?: ScribeInvoke;
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
  reset: () => Promise<void>;
  retryStructuring: (transcript: string) => Promise<void>;
  retryTranscription: () => Promise<void>;
}

export function useFilly({
  invoke,
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
  const medispeakHandleRef = useRef<MedispeakSessionHandle | null>(null);
  const segmentSeqRef = useRef(0);
  const pendingUploadsRef = useRef<Promise<void>[]>([]);

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

  // Warm the VAD (no mic involved) once the widget is mounted and idle, so
  // starting a recording only has to attach the microphone.
  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(preloadVad, { timeout: 5000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(preloadVad, 2000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  // ── chunk uploads ────────────────────────────────────────────────────────

  const enqueueSegment = useCallback((wav: Blob) => {
    const handle = medispeakHandleRef.current;
    if (!handle) return;
    const seq = segmentSeqRef.current++;
    const upload = uploadMedispeakSegment(handle, seq, wav).catch((err) => {
      // Non-fatal — a dropped utterance only loses a little transcript.
      if (DEBUG) console.warn("[Filly] segment upload failed:", seq, err);
    });
    pendingUploadsRef.current.push(upload);
  }, []);

  /**
   * Session parameters: facility, the form fields shaped into Medispeak's
   * FieldSpec[], and the language hint. The field list comes from the
   * Scribe action registry (`questionnaire.forms.list`), not a prop, so
   * this reads whatever form is open right now rather than a snapshot.
   */
  const buildSessionExtras = useCallback(
    async (options?: StartOptions) => {
      const facilityId = getFacilityIdFromUrl();
      let formFields: FormField[] = [];
      if (invoke) {
        const formsResult = await invoke("questionnaire.forms.list", {});
        if (formsResult.ok) {
          formFields = extractFormFields(
            (formsResult.data ?? []) as ScribeFormSummary[],
          );
        } else if (DEBUG) {
          console.warn(
            "[Filly] Could not read the open form:",
            formsResult.error,
          );
        }
      }
      const language = options?.language || FILLY_LANGUAGES;
      return { facilityId, formFields, language };
    },
    [invoke],
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

  /** Poll the Medispeak session until it reaches a terminal status. */
  const awaitMedispeakResult = useCallback(
    async (handle: MedispeakSessionHandle) => {
      const data = await pollMedispeakResult(handle, {
        onTranscript: (transcript) => onTranscript?.(transcript),
      });
      if (data.transcript) onTranscript?.(data.transcript);
      return data;
    },
    [onTranscript],
  );

  // ── recording lifecycle ──────────────────────────────────────────────────

  const startRecording = useCallback(
    async (options?: StartOptions) => {
      setIsStarting(true);
      try {
        setError(null);
        setResult(null);
        pendingUploadsRef.current = [];
        accumulatedRef.current = 0;
        segmentSeqRef.current = 0;
        setDuration(0);

        await ensureFillyBackendAvailable();

        const { facilityId, formFields, language } =
          await buildSessionExtras(options);

        medispeakHandleRef.current = await createMedispeakSession({
          facilityId,
          fields: buildFieldSpecs(formFields),
          language,
        });

        const recorder = new VadRecorder({
          onSpeechChunk: enqueueSegment,
          onError: (err) => {
            setError(describeRecordingError(err));
            onErrorRef.current?.(err);
          },
        });
        recorderRef.current = recorder;
        await recorder.start(
          (await resolvePreferredMicDeviceId()) ?? undefined,
        );
        // Cancelled/reset while the mic was starting — don't flip to recording.
        if (recorderRef.current !== recorder) return;

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
    [buildSessionExtras, enqueueSegment, updateStatus, startTimer, onError],
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

  const stopRecording = useCallback(async () => {
    const handle = medispeakHandleRef.current;
    try {
      const recorder = recorderRef.current;
      if (!recorder || !handle) return;

      stopTimer(true);
      updateStatus("processing");

      // Stop capture first so the last utterance's segment is queued, then
      // wait for every in-flight upload before committing — `/audio/segments`
      // has no `final` marker, so commit must not race the last uploads.
      // `recorder.stop()` is also the only thing that tears down the VAD and
      // stops the MediaStream tracks — never drop this call, or the mic
      // stays live.
      await recorder.stop();
      recorderRef.current = null;
      await Promise.allSettled(pendingUploadsRef.current);
      pendingUploadsRef.current = [];

      await commitMedispeakSession(handle);
      let data = await awaitMedispeakResult(handle);
      for (
        let attempt = 0;
        isRecommittableFailure(data) && attempt < COMMIT_RETRY_ATTEMPTS;
        attempt++
      ) {
        await new Promise((r) => setTimeout(r, COMMIT_RETRY_DELAY_MS));
        await commitMedispeakSession(handle);
        data = await awaitMedispeakResult(handle);
      }
      finishWithMedispeakResult(data);
    } catch (err) {
      const message = describeStopError(err);
      setError(message);
      updateStatus("failed");
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [
    stopTimer,
    updateStatus,
    awaitMedispeakResult,
    finishWithMedispeakResult,
    onError,
  ]);

  const runRetry = useCallback(
    async (params: RetryParams) => {
      const handle = medispeakHandleRef.current;
      if (!handle) return;
      try {
        setError(null);
        updateStatus("processing");
        await retryMedispeakSession(handle, params);
        const data = await awaitMedispeakResult(handle);
        finishWithMedispeakResult(data);
      } catch (err) {
        const message = describeRetryError(err);
        setError(message);
        updateStatus("failed");
        onError?.(err instanceof Error ? err : new Error(message));
      }
    },
    [updateStatus, awaitMedispeakResult, finishWithMedispeakResult, onError],
  );

  const retryStructuring = useCallback(
    (transcript: string) => runRetry({ scope: "structuring", transcript }),
    [runRetry],
  );

  const retryTranscription = useCallback(
    () => runRetry({ scope: "transcription" }),
    [runRetry],
  );

  const cancelRecording = useCallback(async () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    medispeakHandleRef.current = null;
    pendingUploadsRef.current = [];
    stopTimer();
    accumulatedRef.current = 0;
    setDuration(0);
    updateStatus("idle");
  }, [stopTimer, updateStatus]);

  const reset = useCallback(async () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    medispeakHandleRef.current = null;
    segmentSeqRef.current = 0;
    pendingUploadsRef.current = [];
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
    reset,
    retryStructuring,
    retryTranscription,
  };
}
