export type FillyStatus =
  "idle" | "recording" | "paused" | "processing" | "completed" | "failed";

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
  { ok: true; data?: unknown } | { ok: false; error: string };

export type ScribeInvoke = (
  actionId: string,
  input: unknown,
) => Promise<ScribeActionResult>;

export interface EnableWhenCondition {
  question: string;
  operator:
    | "exists"
    | "equals"
    | "not_equals"
    | "greater"
    | "less"
    | "greater_or_equals"
    | "less_or_equals";
  answer: string | number | boolean;
}

/** One `questionnaire.forms.list` question — already flattened (groups
 *  excluded) and pre-resolved for enable_when, so nothing on this side
 *  needs to re-walk the question tree or re-derive visibility. `enabled`
 *  reflects only already-saved answers though — `enable_when` is exposed
 *  too so a dependent field can still be filled when its trigger was just
 *  extracted in this same pass, not yet written. */
export interface ScribeQuestionSummary {
  link_id: string;
  text: string;
  type: string;
  required: boolean;
  options?: string[];
  /** True for a choice question that accepts more than one selection
   *  (care_fe's `Question.repeats`) — extracted as a list and written as
   *  a `values` array in one `questionnaire.response.set` call. */
  repeats?: boolean;
  /** The question's own help text, if the form author set one. */
  description?: string;
  /** Set for a structured question (medication_request, diagnosis, etc.) */
  structured_type?: string;
  values?: unknown[];
  answered: boolean;
  enabled: boolean;
  enable_when?: EnableWhenCondition[];
  enable_behavior?: "all" | "any";
  ancestors_enabled?: boolean;
}

export interface ScribeFormSummary {
  questionnaire_id: string;
  title: string;
  questions: ScribeQuestionSummary[];
}
