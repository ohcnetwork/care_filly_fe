import { DiscoveryManager } from "./discovery";
import { ScribeError, toScribeError } from "./errors";
import { VadChunker } from "./recorder";
import { SessionManager } from "./session";
import { uploadToStorage } from "./storage";
import { Transport } from "./transport";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  EndSessionRequest,
  EndSessionResponse,
  GetSessionStatusResponse,
  PatchSessionResponse,
  PollOptions,
  RecordingOptions,
  RetryUploadResult,
  SDKResult,
  ScribeCallbackMap,
  ScribeCallbackName,
  ScribeClientConfig,
  SessionUploadInfo,
  StopRecordingResult,
  UploadAudioFileResult,
} from "./types";
import { UploadQueue } from "./upload-queue";

type CallbackHandler<K extends ScribeCallbackName> = (
  event: ScribeCallbackMap[K],
) => void;

function ok<T>(data: T): SDKResult<T> {
  return { success: true, data };
}

function fail<T>(error: ScribeError): SDKResult<T> {
  return { success: false, error };
}

/**
 * In-repo replacement for the MedScribe Alliance SDK's `ScribeClient`.
 *
 * Owns discovery, session lifecycle, microphone capture + VAD chunking, MP3
 * encoding, and chunked/single presigned uploads — with no `credentials:
 * "include"` and no CDN-loaded worker. Async methods return `SDKResult<T>`
 * and never throw.
 */
export class ScribeClient {
  private readonly transport: Transport;
  private readonly discovery: DiscoveryManager;
  private readonly sessions: SessionManager;
  private readonly baseUrl: string;
  private readonly config: ScribeClientConfig;

  private recorder: VadChunker | null = null;
  private uploadQueue: UploadQueue | null = null;
  private activeSession: CreateSessionResponse | null = null;
  private recording = false;
  private paused = false;
  private initialized = false;

  private readonly callbacks = new Map<
    ScribeCallbackName,
    Set<CallbackHandler<ScribeCallbackName>>
  >();

  constructor(config: ScribeClientConfig) {
    if (!config.baseUrl) throw new Error("ScribeClient requires a baseUrl");
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.transport = new Transport(config.accessToken ?? "", config.debug);
    this.transport.onUnauthorized = () => this.requestFreshToken();
    this.discovery = new DiscoveryManager(this.transport, config.debug);
    this.sessions = new SessionManager(this.transport, config.debug);
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────

  registerCallback<K extends ScribeCallbackName>(
    name: K,
    handler: CallbackHandler<K>,
  ): void {
    let set = this.callbacks.get(name);
    if (!set) {
      set = new Set();
      this.callbacks.set(name, set);
    }
    set.add(handler as CallbackHandler<ScribeCallbackName>);
  }

  removeCallback<K extends ScribeCallbackName>(
    name: K,
    handler: CallbackHandler<K>,
  ): void {
    this.callbacks
      .get(name)
      ?.delete(handler as CallbackHandler<ScribeCallbackName>);
  }

  private dispatch<K extends ScribeCallbackName>(
    name: K,
    event: ScribeCallbackMap[K],
  ): void {
    const set = this.callbacks.get(name);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as CallbackHandler<K>)(event);
      } catch (err) {
        if (this.config.debug) {
          console.error(`[Scribe] callback ${name} threw`, err);
        }
      }
    }
  }

  private requestFreshToken(): Promise<string | null> {
    const set = this.callbacks.get("onTokenRequired");
    if (!set || set.size === 0) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (token: string) => {
        if (settled) return;
        settled = true;
        resolve(token || null);
      };
      this.dispatch("onTokenRequired", { resolve: done });
      // Guard against a handler that never resolves.
      setTimeout(() => done(""), 10000);
    });
  }

  private dispatchError(
    type: "vad_error" | "worker_error" | "transport_error" | "validation_error",
    code: string,
    message: string,
  ): void {
    this.dispatch("onError", {
      type,
      timestamp: new Date().toISOString(),
      error: { code, message },
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  setAccessToken(token: string): void {
    this.transport.setAccessToken(token);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async init(): Promise<SDKResult<void>> {
    try {
      await this.discovery.fetch(this.baseUrl);
      this.initialized = true;
      return ok(undefined);
    } catch (err) {
      return fail(toScribeError(err, "Failed to initialize"));
    }
  }

  isRecording(): boolean {
    return this.recording;
  }

  isRecordingPaused(): boolean {
    return this.paused;
  }

  getCurrentSession(): CreateSessionResponse | null {
    return this.activeSession ?? this.sessions.getCurrent();
  }

  // ── Recording ───────────────────────────────────────────────────────────────

  async startRecording(
    options: RecordingOptions,
  ): Promise<SDKResult<CreateSessionResponse>> {
    try {
      if (!this.initialized) await this.discovery.fetch(this.baseUrl);

      const request: CreateSessionRequest = {
        templates: options.templates,
        upload_type: options.uploadType ?? "chunked",
        communication_protocol: options.communicationProtocol ?? "http",
        model: options.model,
        language_hint: options.languageHint,
        transcript_language: options.transcriptLanguage,
        session_mode: options.sessionMode,
        additional_data: options.additionalData,
        patient_details: options.patientDetails,
      };

      const session = await this.sessions.createSession(this.baseUrl, request);
      this.activeSession = session;

      const queue = new UploadQueue({
        useWorker: this.config.useWorker ?? "auto",
        debug: this.config.debug,
        onUploadEvent: (event) => this.dispatch("onUploadEvent", event),
      });
      queue.setUpload(session.upload_url);
      this.uploadQueue = queue;

      const maxChunkSeconds =
        this.discovery.getResolved()?.maxChunkDurationSeconds;
      const recorder = new VadChunker(
        {
          deviceId: options.deviceId,
          maxChunkSeconds,
          vadAssetBasePath: this.config.vadAssetBasePath,
          vadOnnxWasmBasePath: this.config.vadOnnxWasmBasePath,
        },
        {
          onChunk: (samples, fileName) => queue.enqueue(samples, fileName),
          onError: (error) =>
            this.dispatchError("vad_error", "vad_error", error.message),
        },
      );

      await recorder.start();
      this.recorder = recorder;
      this.recording = true;
      this.paused = false;

      this.dispatch("onRecordingStateChange", {
        type: "started",
        timestamp: new Date().toISOString(),
      });

      return ok(session);
    } catch (err) {
      this.cleanupRecording();
      const error = toScribeError(err, "Failed to start recording");
      this.dispatchError("vad_error", error.code, error.message);
      return fail(error);
    }
  }

  pauseRecording(): void {
    if (!this.recorder || this.paused) return;
    this.recorder.pause();
    this.paused = true;
    this.dispatch("onRecordingStateChange", {
      type: "paused",
      timestamp: new Date().toISOString(),
    });
  }

  resumeRecording(): void {
    if (!this.recorder || !this.paused) return;
    this.recorder.resume();
    this.paused = false;
    this.dispatch("onRecordingStateChange", {
      type: "resumed",
      timestamp: new Date().toISOString(),
    });
  }

  async endRecording(): Promise<SDKResult<StopRecordingResult>> {
    try {
      const recorder = this.recorder;
      const queue = this.uploadQueue;
      if (!recorder || !queue) {
        throw new ScribeError("No active recording to end");
      }

      // Flush the tail chunk before tearing down the VAD.
      recorder.flush();
      await recorder.destroy();
      this.recording = false;
      this.paused = false;

      await queue.waitForAll();

      const failedUploads = queue.getFailedFileNames();
      const totalFiles = queue.getTotalCount();
      let sessionEnded = false;

      if (failedUploads.length === 0 && this.activeSession) {
        await this.sessions.endSession(this.baseUrl, {
          audio_files_sent: totalFiles,
          audio_files_uploaded: totalFiles,
        });
        sessionEnded = true;
      }

      this.dispatch("onRecordingStateChange", {
        type: "ended",
        timestamp: new Date().toISOString(),
      });

      return ok({ failedUploads, totalFiles, sessionEnded });
    } catch (err) {
      return fail(toScribeError(err, "Failed to end recording"));
    }
  }

  hasFailedUploads(): boolean {
    return this.uploadQueue?.hasFailed() ?? false;
  }

  async retryFailedUploads(): Promise<SDKResult<RetryUploadResult>> {
    try {
      const queue = this.uploadQueue;
      if (!queue) throw new ScribeError("No upload queue to retry");

      // Refresh the presigned upload target — the original may have expired.
      let upload: SessionUploadInfo | undefined;
      const sessionId = this.activeSession?.session_id;
      if (sessionId) {
        try {
          const status = await this.sessions.getSessionStatus(
            this.baseUrl,
            sessionId,
          );
          upload = status.upload_url ?? undefined;
        } catch {
          // Keep the existing upload target.
        }
      }

      const result = await queue.retryFailed(upload);
      return ok(result);
    } catch (err) {
      return fail(toScribeError(err, "Failed to retry uploads"));
    }
  }

  // ── Session ─────────────────────────────────────────────────────────────────

  async createSession(
    request: CreateSessionRequest,
    version?: string,
  ): Promise<SDKResult<CreateSessionResponse>> {
    try {
      const session = await this.sessions.createSession(
        this.baseUrl,
        request,
        version,
      );
      this.activeSession = session;
      return ok(session);
    } catch (err) {
      return fail(toScribeError(err, "Failed to create session"));
    }
  }

  async endSession(
    request: EndSessionRequest,
    sessionId?: string,
  ): Promise<SDKResult<EndSessionResponse>> {
    try {
      const data = await this.sessions.endSession(
        this.baseUrl,
        request,
        sessionId,
      );
      return ok(data);
    } catch (err) {
      return fail(toScribeError(err, "Failed to end session"));
    }
  }

  async getSessionStatus(
    sessionId?: string,
    options?: { poll?: PollOptions; templateId?: string; version?: string },
  ): Promise<SDKResult<GetSessionStatusResponse>> {
    try {
      const id = sessionId ?? this.activeSession?.session_id;
      if (!id) throw new ScribeError("No active session for status lookup");

      const data = options?.poll
        ? await this.sessions.pollSessionStatus(
            this.baseUrl,
            id,
            options.poll,
            options.templateId,
            options.version,
          )
        : await this.sessions.getSessionStatus(
            this.baseUrl,
            id,
            options?.templateId,
            options?.version,
          );
      return ok(data);
    } catch (err) {
      return fail(toScribeError(err, "Failed to get session status"));
    }
  }

  async cancelSession(
    sessionId?: string,
  ): Promise<SDKResult<PatchSessionResponse>> {
    try {
      // Stop the recorder locally without triggering server processing.
      if (this.recorder) {
        await this.recorder.destroy();
        this.recorder = null;
      }
      this.uploadQueue?.destroy();
      this.uploadQueue = null;
      this.recording = false;
      this.paused = false;

      const data = await this.sessions.cancelSession(this.baseUrl, sessionId);
      this.activeSession = null;
      return ok(data);
    } catch (err) {
      return fail(toScribeError(err, "Failed to cancel session"));
    }
  }

  // ── Pre-recorded upload ──────────────────────────────────────────────────────

  async uploadAudioFile(
    file: Blob,
    fileName: string,
    upload: SessionUploadInfo,
  ): Promise<SDKResult<UploadAudioFileResult>> {
    try {
      const result = await uploadToStorage(fileName, file, upload);
      return ok(result);
    } catch (err) {
      return fail(toScribeError(err, "Failed to upload audio file"));
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  private cleanupRecording(): void {
    try {
      void this.recorder?.destroy();
    } catch {
      // ignore
    }
    this.recorder = null;
    this.uploadQueue?.destroy();
    this.uploadQueue = null;
    this.recording = false;
    this.paused = false;
  }

  async reset(): Promise<void> {
    if (this.recorder) {
      try {
        await this.recorder.destroy();
      } catch {
        // ignore
      }
    }
    this.recorder = null;
    this.uploadQueue?.destroy();
    this.uploadQueue = null;
    this.activeSession = null;
    this.recording = false;
    this.paused = false;
    this.initialized = false;
    this.sessions.clear();
    this.discovery.clear();
    this.callbacks.clear();
  }
}
