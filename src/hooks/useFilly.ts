import { useCallback, useEffect, useRef, useState } from "react";

import { VadRecorder, encodeSilenceMarker } from "@/lib/filly-engine";
import {
  type MedispeakResult,
  type MedispeakSessionHandle,
  commitMedispeakSession,
  createMedispeakSession,
  pollMedispeakResult,
  uploadMedispeakChunk,
} from "@/lib/medispeak-api";
import { getFacilityIdFromUrl } from "@/lib/structured/care-api";
import {
  type FormField,
  buildFieldSpecs,
  extractFormFields,
} from "@/lib/template-builder";
import type { FillyResult, FillyStatus } from "@/lib/types/filly";

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
  const medispeakHandleRef = useRef<MedispeakSessionHandle | null>(null);
  const chunkSeqRef = useRef(0);
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  // ── chunk uploads ────────────────────────────────────────────────────────

  const enqueueChunk = useCallback((wav: Blob) => {
    const handle = medispeakHandleRef.current;
    if (!handle) return;
    const seq = chunkSeqRef.current++;
    const upload = uploadMedispeakChunk(handle, seq, wav).catch((err) => {
      // Non-fatal — a dropped utterance only loses a little transcript.
      if (DEBUG) console.warn("[Filly] chunk upload failed:", seq, err);
    });
    pendingUploadsRef.current.push(upload);
  }, []);

  /**
   * Session parameters: facility, the form fields shaped into Medispeak's
   * FieldSpec[], and the language hint.
   */
  const buildSessionExtras = useCallback(
    (options?: StartOptions) => {
      const facilityId = getFacilityIdFromUrl();
      const formFields: FormField[] = formStateProp
        ? extractFormFields(formStateProp)
        : [];
      const language = options?.language || FILLY_LANGUAGES;
      return { facilityId, formFields, language };
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

  /** Poll the Medispeak session until it reaches a terminal status. */
  const awaitMedispeakResult = useCallback(
    async (handle: MedispeakSessionHandle) => {
      const data = await pollMedispeakResult(handle);
      if (data.transcript) onTranscript?.(data.transcript);
      finishWithMedispeakResult(data);
    },
    [finishWithMedispeakResult, onTranscript],
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
        chunkSeqRef.current = 0;
        setDuration(0);

        const { facilityId, formFields, language } =
          buildSessionExtras(options);

        medispeakHandleRef.current = await createMedispeakSession({
          facilityId,
          fields: buildFieldSpecs(formFields),
          language,
        });

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

  const stopRecording = useCallback(async () => {
    const handle = medispeakHandleRef.current;
    try {
      const recorder = recorderRef.current;
      if (!recorder || !handle) return;

      stopTimer(true);
      updateStatus("processing");

      // Stop capture first so the last utterance's chunk is queued, then
      // wait for every in-flight upload before finalizing. `recorder.stop()`
      // is also the only thing that tears down the VAD and stops the
      // MediaStream tracks — never drop this call, or the mic stays live.
      await recorder.stop();
      recorderRef.current = null;
      // Must stay ordered before the `final` marker below, or Medispeak
      // commits before the last utterances land.
      await Promise.allSettled(pendingUploadsRef.current);
      pendingUploadsRef.current = [];

      // Mark the audio complete — Medispeak needs one chunk flagged `final`.
      await uploadMedispeakChunk(
        handle,
        chunkSeqRef.current++,
        encodeSilenceMarker(),
        true,
      );
      await commitMedispeakSession(handle);
      await awaitMedispeakResult(handle);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to process recording";
      setError(message);
      updateStatus("failed");
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [stopTimer, updateStatus, awaitMedispeakResult, onError]);

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
    chunkSeqRef.current = 0;
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
  };
}
