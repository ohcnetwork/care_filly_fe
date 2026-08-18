import { formatDateQueryString } from "./time";
import type { SupportedStructuredType } from "./types";

/**
 * Shared date contract for speech-extracted date fields.
 *
 * LLMs cannot do calendar arithmetic blind: without today's date and weekday
 * they anchor relative phrases ("previous Sunday", "2 weeks ago") to a guessed
 * reference — often their training-cutoff era — and return confidently wrong
 * dates. Client-side phrase parsing is no answer either: it is brittle and
 * English-only, while transcripts may be in any language. So every
 * date-bearing field description embeds this contract — the real date and
 * weekday plus precise resolution instructions — and the model does the
 * resolving.
 *
 * Always build it when the extraction session is created (recording start),
 * never at module import, so "today" is fresh.
 */
export function buildDateContext(now: Date = new Date()): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const today = formatDateQueryString(now);
  return (
    `IMPORTANT date rules — today is ${weekday}, ${today}. Resolve every ` +
    `relative time expression (in any language) against this anchor and ` +
    `output it as YYYY-MM-DD. Weekday references are where mistakes ` +
    `happen, so work them out step by step from the anchor, one day at a ` +
    `time, before answering: "last <weekday>" / "previous <weekday>" / ` +
    `"on <weekday>" means the most recent such weekday STRICTLY BEFORE ` +
    `today; "<weekday> before last" / "<weekday> prior to the last one" ` +
    `means 7 days earlier than that. Before using any resolved date, ` +
    `verify it actually falls on the spoken weekday — if it does not, ` +
    `redo the count. Never output a date after today unless the speaker ` +
    `explicitly named a future date. If no timing was mentioned for a ` +
    `date field, use null — never invent a date. Copy the speaker's ` +
    `COMPLETE timing phrase verbatim into the "note" field (e.g. ` +
    `"Wednesday prior to the last one", never just "Wednesday").`
  );
}

/** Structured types whose extracted payload contains date fields. */
export const DATE_BEARING_STRUCTURED_TYPES: ReadonlySet<SupportedStructuredType> =
  new Set([
    "symptom",
    "diagnosis",
    "allergy_intolerance",
    "medication_statement",
  ]);
