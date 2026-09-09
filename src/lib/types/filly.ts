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

/**
 * The Scribe plugin contract care_fe's fill page hands us — see
 * `PLUGIN_Component __name="Scribe" actions={descriptors} invoke={invoke}`
 * in `care_fe/src/components/QuestionnaireV2/fill/FillPageBody.tsx` and
 * the descriptors themselves in `useFillActions.ts`. Kept structurally
 * identical here rather than shared, the same way `FillyStatus` is —
 * plugin and host build separately, so there's no shared type import.
 */
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
  /** Set for a structured question (medication_request, diagnosis, etc.) —
   *  its existing rows (below) and any write both go through
   *  `questionnaire.response.set`, one request object per row. */
  structured_type?: string;
  /** The question's current rows (a deep clone), present for every
   *  structured question except "files". `questionnaire.response.set`
   *  replaces a structured answer wholesale, so writing a new row without
   *  losing these means resending them alongside it. */
  values?: unknown[];
  answered: boolean;
  enabled: boolean;
}

export interface ScribeFormSummary {
  questionnaire_id: string;
  title: string;
  questions: ScribeQuestionSummary[];
}
