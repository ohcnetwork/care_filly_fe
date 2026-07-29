/**
 * In-repo scribe client — a self-contained replacement for
 * `med-scribe-alliance-ts-sdk`, speaking the same MedScribe Alliance protocol
 * to the care_filly backend.
 *
 * Highlights vs. the old SDK:
 * - No `credentials: "include"` — the CORS/credentials fetch shim is gone.
 * - The upload worker is bundled locally by Vite (no CDN fetch/patching).
 * - Full ownership of discovery, sessions, VAD chunking, MP3 encoding, uploads.
 */
export { ScribeClient } from "./client";
export {
  ScribeError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  SessionNotFoundError,
  SessionExpiredError,
  RateLimitError,
  DiscoveryError,
  TransportError,
  UploadError,
} from "./errors";
export type {
  ScribeClientConfig,
  ScribeClientConfig as ScribeSDKConfig,
  RecordingOptions,
  CreateSessionRequest,
  CreateSessionResponse,
  EndSessionRequest,
  EndSessionResponse,
  PatchSessionRequest,
  PatchSessionResponse,
  GetSessionStatusResponse,
  TemplateEntry,
  PatientDetails,
  SessionUploadInfo,
  StopRecordingResult,
  RetryUploadResult,
  UploadAudioFileResult,
  PollOptions,
  SDKResult,
  ScribeCallbackMap,
  ScribeCallbackName,
  RecordingStateChangeEvent,
  UploadEvent,
  ErrorEvent,
  TokenRequiredEvent,
} from "./types";
