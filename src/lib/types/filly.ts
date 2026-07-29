export type FillyStatus =
  | "idle"
  | "recording"
  | "paused"
  | "processing"
  | "completed"
  | "failed";

export interface FillyResult {
  transcript?: string;
  templates?: Record<string, unknown>[];
  structuredData?: Record<string, unknown>;
}

/** A past filly session, persisted server-side per CARE user. */
export interface FillyHistoryEntry {
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
