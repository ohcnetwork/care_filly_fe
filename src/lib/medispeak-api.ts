import { FILLY_BASE_URL } from "@/lib/filly-be";
import { readPluginConfig } from "@/lib/plugin-config";
import { getHeaders } from "@/lib/request";
import type { MedispeakFieldSpec } from "@/lib/template-builder";

/**
 * Talks directly to Medispeak — the browser never holds the account
 * secret. Sessions are created and scoped tokens minted by our own
 * care_filly backend (the only two routes that hold `MEDISPEAK_API_KEY`);
 * everything else (chunk upload, commit, polling) goes straight to
 * Medispeak using that short-lived, session-scoped token.
 */

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

/** A Medispeak error envelope's `code`, e.g. `"audio_upload_failed"`. */
export class MedispeakApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * The Medispeak API root. Resolved at call time, in order:
 *
 *   1. `MEDISPEAK_API_URL` in the plugin's config, set when the plugin is
 *      registered in CARE — changing it needs no rebuild.
 *   2. `REACT_MEDISPEAK_API_URL`, baked in at build time. Kept as a local
 *      dev convenience.
 *
 * Never cache this at module scope: care_fe publishes the plugin config
 * from an effect after the configs load, so an import-time read is empty.
 */
function requireMedispeakBase(): string {
  const configured =
    readPluginConfig("MEDISPEAK_API_URL") ??
    readPluginConfig("REACT_MEDISPEAK_API_URL") ??
    (import.meta.env.REACT_MEDISPEAK_API_URL || "").toString();

  const baseUrl = configured.trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      'Medispeak API URL is not configured. Set "MEDISPEAK_API_URL" in this ' +
        "plugin's config in CARE (Admin → plugins), or REACT_MEDISPEAK_API_URL " +
        "in .env for local development (requires a rebuild).",
    );
  }
  return baseUrl;
}

function requireFillyBase(): string {
  if (!FILLY_BASE_URL) {
    throw new Error(
      "No filly backend configured — window.CARE_API_URL is not set (plugin must run inside CARE).",
    );
  }
  return FILLY_BASE_URL;
}

/** Verify that CARE has the care_filly backend plugin mounted. */
export async function ensureFillyBackendAvailable(): Promise<{ ok: true }> {
  const response = await fetch(`${requireFillyBase()}/../healthz`);
  const data = (await response.json().catch(() => null)) as { ok?: boolean } | null;

  if (!response.ok || data?.ok !== true) {
    throw new MedispeakApiError(
      "The Filly service is not available. Verify that the care_filly BE plugin is enabled in CARE and try again.",
    );
  }

  return { ok: true };
}

async function parseError(response: Response): Promise<never> {
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  throw new MedispeakApiError(
    data.error?.message ?? `Request failed with status ${response.status}`,
    data.error?.code,
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
  if (!response.ok) return parseError(response);
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

/**
 * Upload one standalone, independently-decodable VAD utterance.
 * Medispeak's `/audio/chunks` stitches raw parts into ONE
 */
export async function uploadMedispeakSegment(
  handle: MedispeakSessionHandle,
  seq: number,
  audio: Blob,
): Promise<void> {
  await withTokenRefresh(handle, async (token) => {
    const form = new FormData();
    form.append("seq", String(seq));
    form.append("segment", audio, `${seq}.wav`);
    await medispeakFetch(
      `/scribe_sessions/${handle.medispeakSessionId}/audio/segments`,
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

export interface RetryParams {
  scope: "structuring" | "transcription";
  /** structuring scope only — replaces the transcript and fills from it. */
  transcript?: string;
}

/**
 * Re-runs a finished session (POST .../retry). `scope: "structuring"` keeps
 * (or replaces, via `transcript`) the existing transcript and only re-fills
 * the form; `scope: "transcription"` re-derives the transcript from the
 * audio already stored on Medispeak — no re-upload needed either way.
 */
export async function retryMedispeakSession(
  handle: MedispeakSessionHandle,
  params: RetryParams,
): Promise<void> {
  await withTokenRefresh(handle, async (token) => {
    await medispeakFetch(
      `/scribe_sessions/${handle.medispeakSessionId}/retry`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      },
    );
  });
}

const TERMINAL_STATUSES = new Set(["completed", "partial", "failed"]);

/** Poll until the session reaches a terminal status, mapping the result. But show transcript updates as they arrive. */
export async function pollMedispeakResult(
  handle: MedispeakSessionHandle,
  {
    intervalMs = 750,
    maxAttempts = 240,
    onTranscript,
  }: {
    intervalMs?: number;
    maxAttempts?: number;
    onTranscript?: (transcript: string) => void;
  } = {},
): Promise<MedispeakResult> {
  let announcedTranscript = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const payload = await withTokenRefresh(handle, async (token) => {
      const response = await medispeakFetch(
        `/scribe_sessions/${handle.medispeakSessionId}`,
        token,
      );
      return response.json();
    });

    const transcriptSoFar = extractText(payload.transcript);
    if (transcriptSoFar && transcriptSoFar !== announcedTranscript) {
      announcedTranscript = transcriptSoFar;
      onTranscript?.(transcriptSoFar);
    }

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
