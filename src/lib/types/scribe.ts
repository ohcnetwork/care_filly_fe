export type ScribeStatus =
  | "idle"
  | "recording"
  | "paused"
  | "processing"
  | "completed"
  | "failed";

export interface ScribeResult {
  transcript?: string;
  templates?: Record<string, unknown>[];
  structuredData?: Record<string, unknown>;
}

/** A past scribe session, persisted server-side per CARE user. */
export interface ScribeHistoryEntry {
  id: string;
  sessionId: string | null;
  /** Epoch ms when the recording started. */
  startedAt: number;
  /** Recording length in seconds. */
  duration: number;
  status: "completed" | "failed";
  transcript?: string;
  structuredData?: Record<string, unknown>;
  error?: string;
  /** Whether a recording is stored server-side for this entry. */
  hasAudio: boolean;
  audioMimeType?: string;
}
