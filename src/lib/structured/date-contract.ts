import { formatDateQueryString } from "./time";
import type { SupportedStructuredType } from "./types";

/* giving the today context to get the correct date */
export function buildDateContext(now: Date = new Date()): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const today = formatDateQueryString(now);
  return (
    `Date rules — today is ${weekday}, ${today}. Resolve every relative ` +
    `time expression (in any language) against this anchor and output it ` +
    `as YYYY-MM-DD. For "last <weekday>": count back to the most recent ` +
    `occurrence of that weekday before today — if that weekday is today's ` +
    `own weekday, it means 7 days ago, not today. If only a year is ` +
    `mentioned (no month/day, e.g. "since 2020"), use YYYY-01-01 — never ` +
    `reuse today's month/day. Never output a future date unless one was ` +
    `explicitly stated. Use null if no timing was mentioned. ALWAYS copy ` +
    `the speaker's exact timing phrase into "note" so it can be double-` +
    `checked, even if you're confident in your own date.`
  );
}

/** Structured types whose extracted payload contains date fields. */
export const DATE_BEARING_STRUCTURED_TYPES: ReadonlySet<SupportedStructuredType> =
  new Set(["symptom", "diagnosis", "allergy_intolerance", "medication_statement"]);
