import { FILLY_BASE_URL } from "@/lib/filly-be";
import { getHeaders } from "@/lib/request";
import type { FillyHistoryEntry } from "@/lib/types/filly";
import { patchWebmDuration } from "@/lib/utils";

/**
 * Server-side filly history client.
 *
 * History rows are written by the filly backend when a session
 * finalizes and are scoped to the logged-in CARE user, so past sessions
 * follow the user across browsers/devices and are never visible to
 * anyone else. The locally captured recording is uploaded right after
 * the session completes and streamed back on demand.
 */

interface HistoryEntryDto {
  id: string;
  session_id: string | null;
  facility_external_id: string | null;
  started_at: string;
  duration_seconds: number;
  status: "completed" | "failed";
  transcript: string | null;
  structured_data: Record<string, unknown> | null;
  error: string | null;
  has_audio: boolean;
  audio_mime_type: string | null;
}

async function historyFetch<T>(path: string, method = "GET"): Promise<T> {
  if (!FILLY_BASE_URL) {
    throw new Error("No filly backend configured");
  }
  const response = await fetch(`${FILLY_BASE_URL}/history${path}`, {
    method,
    headers: getHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (data as { error?: { message?: string } }).error;
    throw new Error(
      error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return data as T;
}

function toEntry(dto: HistoryEntryDto): FillyHistoryEntry {
  return {
    id: dto.id,
    sessionId: dto.session_id,
    startedAt: new Date(dto.started_at).getTime(),
    duration: dto.duration_seconds,
    status: dto.status,
    transcript: dto.transcript ?? undefined,
    structuredData: dto.structured_data ?? undefined,
    error: dto.error ?? undefined,
    hasAudio: dto.has_audio,
    audioMimeType: dto.audio_mime_type ?? undefined,
  };
}

/** The logged-in user's entries, newest first. */
export async function listHistoryEntries(): Promise<FillyHistoryEntry[]> {
  const data = await historyFetch<{ results: HistoryEntryDto[] }>("");
  return (data.results ?? []).map(toEntry);
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await historyFetch(`/${id}`, "DELETE");
}

export async function clearHistory(): Promise<void> {
  await historyFetch("", "DELETE");
}

/** Attach the locally captured recording to its history row (by session). */
export async function uploadHistoryAudio(
  sessionId: string,
  audio: Blob,
  durationSeconds?: number,
): Promise<void> {
  if (!FILLY_BASE_URL) return;
  const headers = getHeaders();
  headers.delete("Content-Type"); // let the browser set the multipart boundary
  const form = new FormData();
  const durationMs = (durationSeconds ?? 0) * 1000;
  const patched =
    durationMs > 0 ? await patchWebmDuration(audio, durationMs) : audio;
  form.append(
    "file",
    patched,
    `recording.${audio.type.includes("mp4") ? "m4a" : "webm"}`,
  );
  if (durationSeconds && durationSeconds > 0) {
    form.append("duration", String(Math.round(durationSeconds)));
  }
  const response = await fetch(
    `${FILLY_BASE_URL}/history/session/${sessionId}/audio`,
    { method: "POST", headers, body: form },
  );
  if (!response.ok) {
    throw new Error(`Audio upload failed with status ${response.status}`);
  }
}

/** Short-lived signed URL for the recording (null when none is stored). */
export async function getHistoryAudioUrl(id: string): Promise<string | null> {
  if (!FILLY_BASE_URL) return null;
  const headers = getHeaders();
  headers.delete("Content-Type");
  const response = await fetch(`${FILLY_BASE_URL}/history/${id}/audio`, {
    headers,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Audio URL fetch failed with status ${response.status}`);
  }
  const data = (await response.json().catch(() => ({}))) as { url?: string };
  return data.url ?? null;
}

/**
 * Raw recording bytes as a Blob (null when none is stored).
 *
 * Streamed through CARE (same-origin) rather than fetched from object
 * storage directly, so it stays a CORS-enabled request. Only needed when
 * the browser must read the bytes (e.g. re-running the pipeline); plain
 * playback should use {@link getHistoryAudioUrl} + `<audio src>`.
 */
export async function fetchHistoryAudio(id: string): Promise<Blob | null> {
  if (!FILLY_BASE_URL) return null;
  const headers = getHeaders();
  headers.delete("Content-Type");
  headers.delete("Accept");
  const response = await fetch(`${FILLY_BASE_URL}/history/${id}/audio/raw`, {
    headers,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Audio download failed with status ${response.status}`);
  }
  return response.blob();
}
