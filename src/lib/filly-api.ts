import { FILLY_BASE_URL } from "@/lib/filly-be";
import { getHeaders } from "@/lib/request";

/**
 * In-house filly API client.
 *
 * Talks directly to the care_filly CARE backend plugin (mounted at
 * `/api/care_filly/v1`) using the logged-in CARE user's JWT. This replaces
 * the med-filly-alliance SDK entirely — there is no worker, no discovery
 * document, and no presigned/HMAC upload dance, so the credentials/CORS
 * fetch shim is gone too. Every request (including chunk uploads) carries
 * the Bearer token in the `Authorization` header.
 */

export interface CreateSessionParams {
  templates: string[];
  language_hint?: string[];
  patient_details?: Record<string, unknown> | null;
  additional_data?: Record<string, unknown>;
}

export interface CreateSessionResponse {
  session_id: string;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  patient_details: Record<string, unknown> | null;
}

export interface TemplateResult {
  status: string;
  data?: unknown;
  error?: string;
}

export interface SessionStatusResponse {
  session_id: string;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  model_used: string | null;
  language_detected: string | null;
  audio_files_received: number;
  audio_files: string[];
  audio_files_processed: number;
  additional_data: Record<string, unknown> | null;
  /** `[{ [templateId]: TemplateResult }]` — same shape the UI expects. */
  templates: Record<string, TemplateResult>[];
  transcript: string | null;
  processing_errors: unknown[];
  patient_details: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

function requireBase(): string {
  if (!FILLY_BASE_URL) {
    throw new Error(
      "No filly backend configured — window.CARE_API_URL is not set (plugin must run inside CARE).",
    );
  }
  return FILLY_BASE_URL;
}

async function parseError(response: Response): Promise<never> {
  const data = (await response.json().catch(() => ({}))) as ErrorEnvelope;
  throw new Error(
    data.error?.message ?? `Request failed with status ${response.status}`,
  );
}

/** Create a filly session and return its server-assigned id. */
export async function createSession(
  params: CreateSessionParams,
): Promise<CreateSessionResponse> {
  const response = await fetch(`${requireBase()}/sessions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(params),
  });
  if (!response.ok) return parseError(response);
  return response.json();
}

/**
 * Upload one recorded audio chunk. Transcription of the chunk starts
 * server-side immediately, while the doctor keeps talking.
 */
export async function uploadChunk(
  sessionId: string,
  index: number,
  audio: Blob,
  filename?: string,
): Promise<void> {
  const headers = getHeaders();
  headers.delete("Content-Type"); // let the browser set the multipart boundary
  const form = new FormData();
  const ext = audio.type.includes("mp4")
    ? "m4a"
    : audio.type.includes("wav")
      ? "wav"
      : audio.type.includes("mpeg") || audio.type.includes("mp3")
        ? "mp3"
        : "webm";
  form.append("file", audio, filename ?? `${index}.${ext}`);
  form.append("index", String(index));
  const response = await fetch(
    `${requireBase()}/sessions/${sessionId}/chunks`,
    { method: "POST", headers, body: form },
  );
  if (!response.ok) return parseError(response);
}

/** Signal that recording is done — kicks off finalization/extraction. */
export async function endSession(sessionId: string): Promise<void> {
  const response = await fetch(`${requireBase()}/sessions/${sessionId}/end`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!response.ok) return parseError(response);
}

/** Fetch the current session state (status, transcript, template results). */
export async function getSessionStatus(
  sessionId: string,
): Promise<SessionStatusResponse> {
  const response = await fetch(`${requireBase()}/sessions/${sessionId}`, {
    headers: getHeaders(),
  });
  if (!response.ok) return parseError(response);
  return response.json();
}

/** Re-run extraction for a single template on an existing session. */
export async function processTemplate(
  sessionId: string,
  templateId: string,
): Promise<void> {
  const response = await fetch(
    `${requireBase()}/sessions/${sessionId}/process/template/${templateId}`,
    { method: "POST", headers: getHeaders() },
  );
  if (!response.ok) return parseError(response);
}
