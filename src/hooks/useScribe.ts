import { useCallback, useEffect, useRef, useState } from "react";

import {
  type GetSessionStatusResponse,
  ScribeClient,
  type ScribeSDKConfig,
} from "@/lib/scribe";
import { SCRIBE_BASE_URL } from "@/lib/scribe-be";
import { uploadHistoryAudio } from "@/lib/scribe-history";
import { getFacilityIdFromUrl } from "@/lib/structured/care-api";
import {
  buildTemplateDescription,
  extractFormFields,
} from "@/lib/template-builder";
import type { ScribeResult, ScribeStatus } from "@/lib/types/scribe";

const DEBUG = import.meta.env.DEV;

// Spoken language hint, comma-separated ISO codes (e.g. "ta" or "ta,en").
// Forcing the language avoids per-chunk auto-detection flip-flopping on
// code-switched speech (e.g. Tamil consultation with English drug names).
const SCRIBE_LANGUAGES: string[] = (
  import.meta.env.REACT_SCRIBE_LANGUAGES || "auto_detect"
)
  .split(",")
  .map((code: string) => code.trim())
  .filter(Boolean);

// Scribe backend resolution lives in @/lib/scribe-be (shared with the
// quota API).

/** CARE user JWT — same convention as care_scribe_fe. */
function getCareAccessToken(): string {
  try {
    return localStorage.getItem("care_access_token") || "";
  } catch {
    return "";
  }
}

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
 * session status can stay "processing" (FHIR docs, audio post-processing)
 * well after our template data is ready — no reason to keep waiting.
 */
function templatesReady(sessionData: GetSessionStatusResponse): boolean {
  const templates = sessionData.templates;
  if (!templates?.length) return false;
  return templates.every((entry) =>
    Object.values(entry).every(
      (templateData) =>
        templateData && TERMINAL_TEMPLATE_STATUSES.has(templateData.status),
    ),
  );
}

interface UseScribeOptions {
  accessToken?: string;
  formState?: unknown;
  onTokenRefresh?: () => Promise<string> | string;
  onStatusChange?: (status: ScribeStatus) => void;
  onTranscript?: (transcript: string) => void;
  onResult?: (result: ScribeResult) => void;
  onError?: (error: Error) => void;
}

interface UseScribeReturn {
  status: ScribeStatus;
  isStarting: boolean;
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  result: ScribeResult | null;
  error: string | null;
  startRecording: (options?: {
    encounterId?: string;
    templateIds?: string[];
    language?: string[];
  }) => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  /** Re-run transcription + extraction on a pre-recorded audio blob. */
  processAudioFile: (
    audio: Blob,
    options?: {
      durationSeconds?: number;
      encounterId?: string;
      templateIds?: string[];
      language?: string[];
    },
  ) => Promise<void>;
  reset: () => Promise<void>;
  updateAccessToken: (token: string) => void;
}

export function useScribe({
  accessToken,
  formState: formStateProp,
  onTokenRefresh,
  onStatusChange,
  onTranscript,
  onResult,
  onError,
}: UseScribeOptions = {}): UseScribeReturn {
  const [status, setStatus] = useState<ScribeStatus>("idle");
  const [isStarting, setIsStarting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<ScribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const instanceRef = useRef<ScribeClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0); // ms accumulated before the current segment
  const initPromiseRef = useRef<Promise<ScribeClient> | null>(null);
  const callbacksRegisteredRef = useRef(false);

  // Parallel local recording for the history panel. The SDK uploads
  // chunks internally and never exposes the audio, so we run our own
  // MediaRecorder and upload the blob to the history row afterwards.
  const localRecorderRef = useRef<MediaRecorder | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localChunksRef = useRef<Blob[]>([]);

  // Authenticate with the CARE user's JWT — same convention as care_scribe_fe.
  const defaultToken = getCareAccessToken();
  const tokenRef = useRef(accessToken || defaultToken);
  tokenRef.current = accessToken || defaultToken;

  const onTokenRefreshRef = useRef(onTokenRefresh);
  onTokenRefreshRef.current = onTokenRefresh;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const updateStatus = useCallback(
    (newStatus: ScribeStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange],
  );

  const registerSdkCallbacks = useCallback((client: ScribeClient) => {
    if (callbacksRegisteredRef.current) return;

    client.registerCallback("onTokenRequired", (event) => {
      void (async () => {
        const refreshed = await onTokenRefreshRef.current?.();
        if (refreshed) {
          tokenRef.current = refreshed;
        }
        event.resolve(tokenRef.current);
      })();
    });

    client.registerCallback("onError", (event) => {
      const message = event.error.message || "Scribe error";
      setError(message);
      onErrorRef.current?.(new Error(message));
    });

    client.registerCallback("onUploadEvent", (event) => {
      if (DEBUG && event.type === "progress") {
        console.log(
          `[Scribe] Upload ${event.data.successCount}/${event.data.totalCount}`,
        );
      }
    });

    client.registerCallback("onRecordingStateChange", (event) => {
      if (DEBUG) {
        console.log("[Scribe] Recording state:", event.type);
      }
    });

    callbacksRegisteredRef.current = true;
  }, []);

  const ensureInstance = useCallback(async () => {
    if (instanceRef.current) {
      registerSdkCallbacks(instanceRef.current);
      return instanceRef.current;
    }

    if (initPromiseRef.current) {
      return initPromiseRef.current;
    }

    initPromiseRef.current = (async () => {
      if (!SCRIBE_BASE_URL) {
        throw new Error(
          "No scribe backend configured — window.CARE_API_URL is not set (plugin must run inside CARE).",
        );
      }

      // MP3 encoding + chunk uploads run in a Vite-bundled worker (or on the
      // main thread if the worker can't start) — no CDN fetch, no fetch shim.
      const config: ScribeSDKConfig = {
        baseUrl: SCRIBE_BASE_URL,
        accessToken: tokenRef.current,
        useWorker: "auto",
        debug: DEBUG,
      };

      const client = new ScribeClient(config);
      registerSdkCallbacks(client);
      instanceRef.current = client;

      if (DEBUG) {
        console.info(
          "[Scribe] Plugin loaded in care_fe — API CORS uses the host page origin, not the plugin remote URL.",
          {
            pageOrigin: window.location.origin,
            apiBaseUrl: SCRIBE_BASE_URL,
            hasToken: Boolean(tokenRef.current),
          },
        );
      }

      return client;
    })();

    try {
      return await initPromiseRef.current;
    } finally {
      initPromiseRef.current = null;
    }
  }, [registerSdkCallbacks]);

  useEffect(() => {
    if (instanceRef.current && tokenRef.current) {
      instanceRef.current.setAccessToken(tokenRef.current);
    }
  }, [accessToken]);

  // Pre-warm the SDK (worker + discovery) while the form is idle, so
  // startRecording doesn't pay init latency on first click.
  const prewarmedRef = useRef(false);
  useEffect(() => {
    if (prewarmedRef.current || !formStateProp || !tokenRef.current) return;
    if (extractFormFields(formStateProp).length === 0) return;
    prewarmedRef.current = true;
    void (async () => {
      try {
        await ensureInstance();
      } catch {
        // Non-fatal — startRecording will retry.
        prewarmedRef.current = false;
      }
    })();
  }, [formStateProp, ensureInstance]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      void instanceRef.current?.reset();
      // Release any in-flight local capture so the mic indicator clears.
      if (
        localRecorderRef.current &&
        localRecorderRef.current.state !== "inactive"
      ) {
        localRecorderRef.current.onstop = null;
        localRecorderRef.current.stop();
      }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
      // Preserve elapsed time so resume continues from here
      accumulatedRef.current += Date.now() - startTimeRef.current;
    }
  }, []);

  // ── Local audio capture (uploaded to the server-side history) ──────────

  const startLocalCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      localChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) localChunksRef.current.push(event.data);
      };
      recorder.start(1000);
      localRecorderRef.current = recorder;
      localStreamRef.current = stream;
    } catch (err) {
      // Non-fatal — history entries are still recorded, just without audio.
      if (DEBUG) console.warn("[Scribe] Local audio capture failed:", err);
    }
  }, []);

  /** Stop the local recorder and return the captured audio, if any. */
  const stopLocalCapture = useCallback((): Promise<Blob | null> => {
    const recorder = localRecorderRef.current;
    const stream = localStreamRef.current;
    localRecorderRef.current = null;
    localStreamRef.current = null;

    if (!recorder || recorder.state === "inactive") {
      stream?.getTracks().forEach((t) => t.stop());
      localChunksRef.current = [];
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        const chunks = localChunksRef.current;
        localChunksRef.current = [];
        resolve(
          chunks.length
            ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
            : null,
        );
      };
      recorder.stop();
    });
  }, []);

  const discardLocalCapture = useCallback(() => {
    const recorder = localRecorderRef.current;
    localRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localChunksRef.current = [];
  }, []);

  /** Attach the captured recording to the server-written history row. */
  const uploadCapturedAudio = useCallback(
    async (sessionId: string | null) => {
      try {
        const audio = await stopLocalCapture();
        if (!audio || !sessionId) return;
        const durationSeconds = Math.round(accumulatedRef.current / 1000);
        await uploadHistoryAudio(sessionId, audio, durationSeconds);
      } catch (err) {
        // Non-fatal — the history entry itself is written by the backend.
        if (DEBUG) console.warn("[Scribe] History audio upload failed:", err);
      }
    },
    [stopLocalCapture],
  );

  /**
   * Session parameters shared by live recordings and re-runs of stored
   * audio: template ids, language hint, and the additional_data payload
   * (form schema, facility for quota enforcement, encounter).
   */
  const buildSessionExtras = useCallback(
    (options?: {
      encounterId?: string;
      templateIds?: string[];
      language?: string[];
    }) => {
      // Send the form schema with the session — the backend runs the
      // extraction directly, no pre-registered template needed.
      const templateIds = options?.templateIds || ["care_form"];
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

      const language = options?.language || SCRIBE_LANGUAGES;
      return { templateIds, additionalData, language };
    },
    [formStateProp],
  );

  const startRecording = useCallback(
    async (options?: {
      encounterId?: string;
      templateIds?: string[];
      language?: string[];
    }) => {
      setIsStarting(true);
      try {
        setError(null);
        setResult(null);

        const client = await ensureInstance();

        const { templateIds, additionalData, language } =
          buildSessionExtras(options);

        const recordResult = await client.startRecording({
          templates: templateIds,
          uploadType: "chunked",
          sessionMode: "consultation",
          languageHint: language,
          model: "pro",
          additionalData,
        });

        if (!recordResult.success) {
          throw new Error(
            recordResult.error.message || "Failed to start recording",
          );
        }

        sessionIdRef.current = recordResult.data.session_id || null;
        void startLocalCapture();
        updateStatus("recording");
        startTimer();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to start recording";
        setError(message);
        updateStatus("failed");
        onError?.(err instanceof Error ? err : new Error(message));
      } finally {
        setIsStarting(false);
      }
    },
    [
      ensureInstance,
      buildSessionExtras,
      updateStatus,
      startTimer,
      startLocalCapture,
      onError,
    ],
  );

  const pauseRecording = useCallback(() => {
    const client = instanceRef.current;
    if (client) {
      client.pauseRecording();
      if (localRecorderRef.current?.state === "recording") {
        localRecorderRef.current.pause();
      }
      stopTimer(true); // save accumulated time before pausing
      updateStatus("paused");
    }
  }, [stopTimer, updateStatus]);

  const resumeRecording = useCallback(() => {
    const client = instanceRef.current;
    if (client) {
      client.resumeRecording();
      if (localRecorderRef.current?.state === "paused") {
        localRecorderRef.current.resume();
      }
      startTimer();
      updateStatus("recording");
    }
  }, [startTimer, updateStatus]);

  /**
   * Poll the session until our template data is terminal, emit the
   * transcript/result callbacks, and flip status to "completed".
   * Shared by stopRecording (live mic session) and processAudioFile
   * (re-run of stored audio).
   */
  const awaitSessionResult = useCallback(
    async (client: ScribeClient, sessionId: string): Promise<void> => {
      const tStart = performance.now();
      let transcriptEmitted = false;
      let tTranscript = 0;

      // Stop polling as soon as our template data is terminal, instead of
      // waiting for the whole session to flip to "completed".
      const pollAbort = new AbortController();
      let earlySessionData: GetSessionStatusResponse | null = null;

      const statusResult = await client.getSessionStatus(sessionId, {
        poll: {
          maxAttempts: SESSION_POLL_MAX_ATTEMPTS,
          intervalMs: SESSION_POLL_INTERVAL_MS,
          signal: pollAbort.signal,
          onProgress: (sessionData) => {
            if (!transcriptEmitted && sessionData.transcript) {
              transcriptEmitted = true;
              tTranscript = performance.now();
              setResult({ transcript: sessionData.transcript });
              onTranscript?.(sessionData.transcript);
            }
            if (
              !earlySessionData &&
              sessionData.transcript &&
              templatesReady(sessionData)
            ) {
              earlySessionData = sessionData;
              pollAbort.abort();
            }
          },
        },
      });

      const sessionData =
        (earlySessionData as GetSessionStatusResponse | null) ??
        (statusResult.success ? statusResult.data : null);
      if (!sessionData) {
        throw new Error(
          (!statusResult.success && statusResult.error.message) ||
            "Failed to get results",
        );
      }

      const transcript = sessionData.transcript || "";
      const templates = sessionData.templates || [];
      const structuredData = extractStructuredData(templates);

      const tDone = performance.now();
      const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
      console.info(
        `[Scribe] timing — transcript: +${tTranscript ? secs(tTranscript - tStart) : "n/a"}, ` +
          `templates: +${secs(tDone - (tTranscript || tStart))}, ` +
          `total: ${secs(tDone - tStart)}` +
          (earlySessionData ? " (early-exit before session completed)" : ""),
      );

      if (DEBUG) {
        console.log("[Scribe] Result:", {
          transcript,
          templates,
          structuredData,
        });
      }

      if (transcript && !transcriptEmitted) {
        setResult({ transcript });
        onTranscript?.(transcript);
      }

      const scribeResult: ScribeResult = {
        transcript: transcript || undefined,
        templates: templates.length > 0 ? templates : undefined,
        structuredData:
          Object.keys(structuredData).length > 0 ? structuredData : undefined,
      };

      setResult(scribeResult);
      updateStatus("completed");
      onResult?.(scribeResult);
    },
    [updateStatus, onTranscript, onResult],
  );

  const stopRecording = useCallback(async () => {
    try {
      const client = instanceRef.current;
      if (!client) return;

      stopTimer(true); // save accumulated time for the history entry
      updateStatus("processing");

      const tStop = performance.now();

      const endResult = await client.endRecording();
      if (!endResult.success) {
        throw new Error(endResult.error.message || "Failed to end recording");
      }
      if (!endResult.data.sessionEnded) {
        // Some chunks failed to upload — retry once, then finalize.
        const retryResult = await client.retryFailedUploads();
        if (!retryResult.success || retryResult.data.stillFailed.length > 0) {
          throw new Error("Failed to upload recording audio");
        }
        const total = endResult.data.totalFiles;
        const endSessionResult = await client.endSession({
          audio_files_sent: total,
          audio_files_uploaded: total,
        });
        if (!endSessionResult.success) {
          throw new Error(
            endSessionResult.error.message || "Failed to end recording",
          );
        }
      }

      const tUploaded = performance.now();
      console.info(
        `[Scribe] upload flush: ${((tUploaded - tStop) / 1000).toFixed(1)}s`,
      );

      const sessionId = sessionIdRef.current;
      if (!sessionId) throw new Error("No session ID");

      await awaitSessionResult(client, sessionId);

      // The backend wrote the history row during finalize — attach the
      // locally captured audio to it now.
      void uploadCapturedAudio(sessionIdRef.current);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to process recording";
      setError(message);
      updateStatus("failed");
      onError?.(err instanceof Error ? err : new Error(message));

      // Best-effort: a failed row may still exist server-side.
      void uploadCapturedAudio(sessionIdRef.current);
    }
  }, [
    stopTimer,
    updateStatus,
    awaitSessionResult,
    onError,
    uploadCapturedAudio,
  ]);

  /**
   * Re-run the full scribe pipeline (transcription + extraction) on a
   * pre-recorded audio blob — e.g. a recording streamed back from the
   * server-side history. Creates a fresh session with `upload_type:
   * "single"`, uploads the blob in one shot, finalizes, and polls for
   * results exactly like a live recording.
   */
  const processAudioFile = useCallback(
    async (
      audio: Blob,
      options?: {
        durationSeconds?: number;
        encounterId?: string;
        templateIds?: string[];
        language?: string[];
      },
    ) => {
      setIsStarting(true);
      try {
        setError(null);
        setResult(null);

        // Surface the original recording length in the UI/history row.
        const durationSeconds = options?.durationSeconds ?? 0;
        accumulatedRef.current = durationSeconds * 1000;
        setDuration(durationSeconds);

        updateStatus("processing");

        const client = await ensureInstance();
        const { templateIds, additionalData, language } =
          buildSessionExtras(options);

        const createResult = await client.createSession({
          templates: templateIds,
          model: "pro",
          language_hint: language,
          upload_type: "single",
          communication_protocol: "http",
          session_mode: "consultation",
          additional_data: additionalData,
        });
        if (!createResult.success) {
          throw new Error(
            createResult.error.message || "Failed to create session",
          );
        }
        const session = createResult.data;
        sessionIdRef.current = session.session_id;

        const ext = audio.type.includes("mp4")
          ? "m4a"
          : audio.type.includes("wav")
            ? "wav"
            : audio.type.includes("mpeg") || audio.type.includes("mp3")
              ? "mp3"
              : "webm";
        const uploadResult = await client.uploadAudioFile(
          audio,
          `1.${ext}`,
          session.upload_url,
        );
        if (!uploadResult.success) {
          throw new Error(
            uploadResult.error.message || "Failed to upload audio",
          );
        }

        const endResult = await client.endSession(
          { audio_files_sent: 1, audio_files_uploaded: 1 },
          session.session_id,
        );
        if (!endResult.success) {
          throw new Error(endResult.error.message || "Failed to end session");
        }

        await awaitSessionResult(client, session.session_id);

        // The backend wrote a fresh history row — re-attach the recording
        // so the new entry can itself be replayed or re-run.
        try {
          await uploadHistoryAudio(
            session.session_id,
            audio,
            durationSeconds || undefined,
          );
        } catch (err) {
          if (DEBUG) console.warn("[Scribe] History audio upload failed:", err);
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
      ensureInstance,
      buildSessionExtras,
      awaitSessionResult,
      updateStatus,
      onError,
    ],
  );

  const cancelRecording = useCallback(async () => {
    discardLocalCapture();
    try {
      const client = instanceRef.current;
      if (client) await client.cancelSession();
      stopTimer();
      accumulatedRef.current = 0;
      setDuration(0);
      updateStatus("idle");
    } catch {
      stopTimer();
      accumulatedRef.current = 0;
      updateStatus("idle");
    }
  }, [discardLocalCapture, stopTimer, updateStatus]);

  const reset = useCallback(async () => {
    discardLocalCapture();
    try {
      const client = instanceRef.current;
      if (client) await client.reset();
      instanceRef.current = null;
      sessionIdRef.current = null;
      callbacksRegisteredRef.current = false;
      stopTimer();
      accumulatedRef.current = 0;
      setDuration(0);
      setResult(null);
      setError(null);
      updateStatus("idle");
    } catch {
      updateStatus("idle");
    }
  }, [discardLocalCapture, stopTimer, updateStatus]);

  const updateAccessToken = useCallback((newToken: string) => {
    tokenRef.current = newToken;
    const client = instanceRef.current;
    if (client) {
      client.setAccessToken(newToken);
    }
  }, []);

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
    updateAccessToken,
  };
}

/**
 * Extract structured data from scribe template results.
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
