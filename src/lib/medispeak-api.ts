import { FILLY_BASE_URL } from "@/lib/filly-be";
import { getHeaders } from "@/lib/request";
import type { MedispeakFieldSpec } from "@/lib/template-builder";

/**
 * Talks directly to Medispeak — the browser never holds the account
 * secret. Sessions are created and scoped tokens minted by our own
 * care_filly backend (the only two routes that hold `MEDISPEAK_API_KEY`);
 * everything else (chunk upload, commit, polling) goes straight to
 * Medispeak using that short-lived, session-scoped token.
 */

const MEDISPEAK_BASE_URL = (import.meta.env.REACT_MEDISPEAK_API_URL || "")
  .toString()
  .replace(/\/$/, "");

/** True when REACT_MEDISPEAK_API_URL is set — callers use this to choose
 * between the Medispeak pipeline and care_filly's own ASR/LLM pipeline. */
export function isMedispeakConfigured(): boolean {
  return Boolean(MEDISPEAK_BASE_URL);
}

export interface MedispeakSessionHandle {
  /** Our backend's MedispeakSession row id (for history/token-refresh). */
  sessionId: string;
  medispeakSessionId: string;
  token: string;
}

export interface MedispeakResult {
  status: string;
  transcript: string;
  structuredData: Record<string, unknown>;
  errors: string[];
}

interface CreateParams {
  facilityId?: string | null;
  fields?: MedispeakFieldSpec[];
  language?: string[];
  mode?: string;
}

class MedispeakAuthError extends Error {}

function requireMedispeakBase(): string {
  if (!MEDISPEAK_BASE_URL) {
    throw new Error("REACT_MEDISPEAK_API_URL is not configured.");
  }
  return MEDISPEAK_BASE_URL;
}

function requireFillyBase(): string {
  if (!FILLY_BASE_URL) {
    throw new Error(
      "No filly backend configured — window.CARE_API_URL is not set (plugin must run inside CARE).",
    );
  }
  return FILLY_BASE_URL;
}

async function parseError(response: Response): Promise<never> {
  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  throw new Error(
    data.error?.message ?? `Request failed with status ${response.status}`,
  );
}

/** Create a Medispeak session + scoped token via our backend seam. */
export async function createMedispeakSession(
  params: CreateParams,
): Promise<MedispeakSessionHandle> {
  const response = await fetch(`${requireFillyBase()}/medispeak/sessions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      facility_id: params.facilityId,
      fields: params.fields,
      language: params.language,
      mode: params.mode,
    }),
  });
  if (!response.ok) return parseError(response);
  const data = await response.json();
  return {
    sessionId: data.session_id,
    medispeakSessionId: data.medispeak_session_id,
    token: data.token,
  };
}

async function refreshToken(sessionId: string): Promise<string> {
  const response = await fetch(
    `${requireFillyBase()}/medispeak/sessions/${sessionId}/token`,
    { method: "POST", headers: getHeaders() },
  );
  if (!response.ok) return parseError(response);
  const data = await response.json();
  return data.token;
}

/**
 * Record quota usage for a finished session. Our backend re-fetches the
 * authoritative usage from Medispeak itself (not trusted from the
 * browser) and writes it once — safe to call more than once.
 */
export async function finalizeMedispeakSession(
  sessionId: string,
): Promise<void> {
  const response = await fetch(
    `${requireFillyBase()}/medispeak/sessions/${sessionId}/finalize`,
    { method: "POST", headers: getHeaders() },
  );
  if (!response.ok) return parseError(response);
}

async function medispeakFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${requireMedispeakBase()}${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new MedispeakAuthError("token expired");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Medispeak request failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return response;
}

/** Retries once with a freshly-minted token if the current one has expired. */
async function withTokenRefresh<T>(
  handle: MedispeakSessionHandle,
  call: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await call(handle.token);
  } catch (err) {
    if (!(err instanceof MedispeakAuthError)) throw err;
    handle.token = await refreshToken(handle.sessionId);
    return call(handle.token);
  }
}

/** Upload one audio chunk directly to Medispeak. */
export async function uploadMedispeakChunk(
  handle: MedispeakSessionHandle,
  seq: number,
  audio: Blob,
  final = false,
): Promise<void> {
  await withTokenRefresh(handle, async (token) => {
    const form = new FormData();
    form.append("seq", String(seq));
    form.append("final", String(final));
    form.append("chunk", audio, `${seq}.wav`);
    await medispeakFetch(
      `/scribe_sessions/${handle.medispeakSessionId}/audio/chunks`,
      token,
      { method: "POST", body: form },
    );
  });
}

/** Mark the session's audio complete and kick off processing. */
export async function commitMedispeakSession(
  handle: MedispeakSessionHandle,
): Promise<void> {
  await withTokenRefresh(handle, async (token) => {
    await medispeakFetch(
      `/scribe_sessions/${handle.medispeakSessionId}/commit`,
      token,
      { method: "POST" },
    );
  });
}

const TERMINAL_STATUSES = new Set(["completed", "partial", "failed"]);

/** Poll until the session reaches a terminal status, mapping the result. */
export async function pollMedispeakResult(
  handle: MedispeakSessionHandle,
  { intervalMs = 750, maxAttempts = 160 } = {},
): Promise<MedispeakResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const payload = await withTokenRefresh(handle, async (token) => {
      const response = await medispeakFetch(
        `/scribe_sessions/${handle.medispeakSessionId}`,
        token,
      );
      return response.json();
    });

    if (TERMINAL_STATUSES.has(payload.status)) {
      return mapResult(payload);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Medispeak session timed out waiting for a result");
}

/** `transcript` on both the session and each output can be either a plain
 * string or `{text, language}` — normalize either shape to a string. */
function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text ?? "");
  }
  return "";
}

function mapResult(payload: Record<string, unknown>): MedispeakResult {
  const outputs = (payload.outputs as Array<Record<string, unknown>>) || [];
  const transcriptOutput = outputs.find((o) => o.type === "transcript");
  const transcript =
    extractText(payload.transcript) || extractText(transcriptOutput?.result);

  const structuredData: Record<string, unknown> = {};
  for (const output of outputs) {
    if (output.type !== "form") continue;
    Object.assign(structuredData, output.result || {});
  }

  const errors = outputs.flatMap(
    (o) => (o.errors as string[] | undefined) || [],
  );

  return {
    status: payload.status as string,
    transcript,
    structuredData,
    errors,
  };
}
