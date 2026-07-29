/**
 * Protocol + client types for the in-repo scribe client.
 *
 * This replaces `med-scribe-alliance-ts-sdk`. The wire shapes below mirror the
 * MedScribe Alliance protocol that the care_filly backend already speaks, so
 * the backend needs no changes. See src/lib/scribe/README notes in the client.
 */
import type { ScribeError } from "./errors";

// ── Session status ──────────────────────────────────────────────────────────

export type SessionStatus =
  | "created"
  | "recording"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | string;

export interface PatientDetails {
  oid?: string;
  name?: string;
  age?: string;
  gender?: string;
  mobile?: number;
}

/** Opaque provider-specific upload descriptor returned by create-session. */
export type SessionUploadInfo = {
  /** Present for the AWS S3 presigned-POST provider. */
  uploadData?: { url: string; fields: Record<string, string> };
  folderPath?: string;
  txn_id?: string;
} & Record<string, unknown>;

// ── Requests ────────────────────────────────────────────────────────────────

export interface CreateSessionRequest {
  templates: string[];
  upload_type: "chunked" | "single" | "stream" | string;
  communication_protocol: "http" | "websocket" | string;
  model?: string;
  language_hint?: string[];
  transcript_language?: string;
  additional_data?: Record<string, unknown>;
  session_mode?: "consultation" | "dictation" | string;
  patient_details?: PatientDetails;
  session_id?: string;
}

export interface EndSessionRequest {
  audio_files_sent: number;
  audio_files_uploaded: number;
}

export interface PatchSessionRequest {
  user_status?: string;
  processing_status?: string;
  patient_details?: PatientDetails;
  additional_data?: Record<string, unknown>;
  language_hint?: string[];
  transcript_language?: string;
  templates?: string[];
}

// ── Responses ───────────────────────────────────────────────────────────────

export interface CreateSessionResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  upload_url: SessionUploadInfo;
  patient_details?: PatientDetails;
}

export interface EndSessionResponse {
  session_id: string;
  status: SessionStatus;
  message: string;
  audio_files_received: number;
  audio_files: string[];
}

export interface PatchSessionResponse {
  session_id: string;
  status: string;
  message: string;
}

/** A single template's extraction result, keyed by template id. */
export type TemplateEntry = Record<
  string,
  {
    status: string;
    data?: unknown;
    fhir?: unknown;
    error?: unknown;
  } & Record<string, unknown>
>;

export interface GetSessionStatusResponse {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at?: string | null;
  expired_at?: string | null;
  completed_at?: string | null;
  model_used?: string | null;
  language_detected?: string | null;
  audio_files_received: number;
  audio_files: string[];
  audio_files_processed?: number;
  additional_data?: Record<string, unknown>;
  templates?: TemplateEntry[];
  transcript?: string;
  upload_url?: SessionUploadInfo;
  patient_details?: PatientDetails;
  message?: string;
}

// ── Discovery ───────────────────────────────────────────────────────────────

export interface DiscoveryDocument {
  protocol?: string;
  service?: { name?: string; version?: string };
  endpoints: { base_url: string; webhooks_url?: string };
  languages?: { supported?: string[]; auto_detection?: boolean };
  capabilities: {
    audio_formats?: string[];
    upload_methods?: string[];
    storage_provider?: string;
    max_chunk_duration_seconds?: number;
    webhook_delivery?: boolean;
    client_sdk_delivery?: boolean;
  };
  authentication?: { supported_methods?: string[] };
  models?: Array<{
    id: string;
    max_session_duration_seconds?: number;
    features?: Record<string, boolean>;
  }>;
}

export interface ResolvedConfig {
  baseUrl: string;
  supportedLanguages: string[];
  storageProvider: string;
  maxChunkDurationSeconds?: number;
}

// ── Client config + recording options ───────────────────────────────────────

export interface ScribeClientConfig {
  /** Base URL of the scribe backend, e.g. `${CARE_API_URL}/api/care_filly/v1`. */
  baseUrl: string;
  /** CARE user JWT (Bearer). */
  accessToken?: string;
  /** true | false | "auto" — offload MP3 encode + upload to a Web Worker. */
  useWorker?: boolean | "auto";
  /** Log SDK activity to the console. */
  debug?: boolean;
  /** Override VAD onnx asset locations (defaults to the vad-web CDN). */
  vadAssetBasePath?: string;
  vadOnnxWasmBasePath?: string;
}

export interface RecordingOptions {
  templates: string[];
  model?: string;
  languageHint?: string[];
  transcriptLanguage?: string;
  uploadType?: "chunked" | "single" | "stream";
  communicationProtocol?: "http" | "websocket";
  sessionMode?: "consultation" | "dictation";
  additionalData?: Record<string, unknown>;
  patientDetails?: PatientDetails;
  deviceId?: string;
}

export interface StopRecordingResult {
  failedUploads: string[];
  totalFiles: number;
  /** Whether the backend `end` call was made (all chunks uploaded). */
  sessionEnded: boolean;
}

export interface RetryUploadResult {
  retried: number;
  succeeded: number;
  stillFailed: string[];
}

export interface UploadAudioFileResult {
  fileName: string;
  status: number;
  headers: Record<string, string>;
}

export interface PollOptions {
  maxAttempts?: number;
  intervalMs?: number;
  onProgress?: (status: GetSessionStatusResponse) => void;
  signal?: AbortSignal;
}

// ── Callbacks ───────────────────────────────────────────────────────────────

export interface RecordingStateChangeEvent {
  type: "started" | "paused" | "resumed" | "ended";
  timestamp: string;
}

export type UploadEvent =
  | {
      type: "progress";
      timestamp: string;
      data: { successCount: number; totalCount: number };
    }
  | {
      type: "failed";
      timestamp: string;
      data: { fileName: string; error: string };
    }
  | {
      type: "retry";
      timestamp: string;
      data: { fileName: string; attempt: number };
    };

export interface ErrorEvent {
  type: "vad_error" | "worker_error" | "transport_error" | "validation_error";
  timestamp: string;
  error: { code: string; message: string; details?: unknown };
}

export interface TokenRequiredEvent {
  resolve: (newToken: string) => void;
}

export interface ScribeCallbackMap {
  onRecordingStateChange: RecordingStateChangeEvent;
  onUploadEvent: UploadEvent;
  onError: ErrorEvent;
  onTokenRequired: TokenRequiredEvent;
}

export type ScribeCallbackName = keyof ScribeCallbackMap;

// ── Result wrapper ──────────────────────────────────────────────────────────

export type SDKResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScribeError };
