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
