import { getHeaders } from "@/lib/request";
import { SCRIBE_BASE_URL } from "@/lib/scribe-be";
import type { ScribeHistoryEntry } from "@/lib/types/scribe";

/**
 * Server-side scribe history client.
 *
 * History rows are written by the scribe backend when a session
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
  if (!SCRIBE_BASE_URL) {
    throw new Error("No scribe backend configured");
  }
  const response = await fetch(`${SCRIBE_BASE_URL}/history${path}`, {
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

function toEntry(dto: HistoryEntryDto): ScribeHistoryEntry {
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
export async function listHistoryEntries(): Promise<ScribeHistoryEntry[]> {
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
): Promise<void> {
  if (!SCRIBE_BASE_URL) return;
  const headers = getHeaders();
  headers.delete("Content-Type"); // let the browser set the multipart boundary
  const form = new FormData();
  form.append(
    "file",
    audio,
    `recording.${audio.type.includes("mp4") ? "m4a" : "webm"}`,
  );
  const response = await fetch(
    `${SCRIBE_BASE_URL}/history/session/${sessionId}/audio`,
    { method: "POST", headers, body: form },
  );
  if (!response.ok) {
    throw new Error(`Audio upload failed with status ${response.status}`);
  }
}

/** Download an entry's recording as a Blob (null when none is stored). */
export async function fetchHistoryAudio(id: string): Promise<Blob | null> {
  if (!SCRIBE_BASE_URL) return null;
  const headers = getHeaders();
  headers.delete("Content-Type");
  headers.delete("Accept");
  const response = await fetch(`${SCRIBE_BASE_URL}/history/${id}/audio`, {
    headers,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Audio download failed with status ${response.status}`);
  }
  return response.blob();
}
