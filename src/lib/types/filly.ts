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

export interface ScribeActionDescriptor {
  id: string;
  description: string;
  parameters: Record<
    string,
    { type: string; description: string; required?: boolean }
  >;
}

export type ScribeActionResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export type ScribeInvoke = (
  actionId: string,
  input: unknown,
) => Promise<ScribeActionResult>;

/** One `questionnaire.forms.list` question — already flattened (groups
 *  excluded) and pre-resolved for enable_when, so nothing on this side
 *  needs to re-walk the question tree or re-derive visibility. */
export interface ScribeQuestionSummary {
  link_id: string;
  text: string;
  type: string;
  required: boolean;
  options?: string[];
  /** The question's own help text, if the form author set one. */
  description?: string;
  /** Set for a structured question (medication_request, diagnosis, etc.) */
  structured_type?: string;
  values?: unknown[];
  answered: boolean;
  enabled: boolean;
}

export interface ScribeFormSummary {
  questionnaire_id: string;
  title: string;
  questions: ScribeQuestionSummary[];
}
