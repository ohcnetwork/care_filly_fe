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
 * date-bearing field description embeds this contract and the model resolves
 * phrases against the real clock.
 *
 * Always build it when the extraction session is created (recording start),
 * never at module import, so "today" is fresh.
 */
export function buildDateContext(now: Date = new Date()): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const today = formatDateQueryString(now);
  return (
    `IMPORTANT — today is ${weekday}, ${today}. Resolve every relative time ` +
    `expression ("last Sunday", "2 weeks ago", "yesterday" — in any ` +
    `language) against this date, minding the weekday, and output the ` +
    `result as YYYY-MM-DD. Never output a date after today unless the ` +
    `speaker explicitly named a future date. If no timing was mentioned ` +
    `for a date field, use null — never invent a date. Preserve the ` +
    `speaker's original timing phrase in the "note" field.`
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
