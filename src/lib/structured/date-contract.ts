import { formatDateQueryString } from "./time";
import type { SupportedStructuredType } from "./types";

/** Days of preceding calendar spelled out — enough for "<weekday> before last". */
const CALENDAR_DAYS = 14;

function buildRecentCalendar(now: Date): string {
  const entries: string[] = [];
  for (let daysAgo = 1; daysAgo <= CALENDAR_DAYS; daysAgo++) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
    entries.push(`${weekday} ${formatDateQueryString(date)}`);
  }
  return entries.join(", ");
}

/**
 * Shared date contract for speech-extracted date fields.
 *
 * LLMs cannot do calendar arithmetic blind: without today's date and weekday
 * they anchor relative phrases ("previous Sunday", "2 weeks ago") to a guessed
 * reference — often their training-cutoff era — and return confidently wrong
 * dates. Even when given the anchor they miscount weekdays, so the contract
 * spells out the preceding fortnight day by day: a weekday reference becomes a
 * lookup in that list rather than arithmetic the model has to perform.
 * Client-side phrase parsing is no answer either: it is brittle and
 * English-only, while transcripts may be in any language.
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
    `output it as YYYY-MM-DD. Do NOT compute weekday dates yourself; the ` +
    `preceding days are listed here, most recent first — read the answer ` +
    `off this list: ${buildRecentCalendar(now)}. "last <weekday>" / ` +
    `"previous <weekday>" / "on <weekday>" is the FIRST entry in that list ` +
    `with that weekday name; "<weekday> before last" / "<weekday> prior to ` +
    `the last one" is the SECOND such entry. Never output a date after ` +
    `today unless the speaker explicitly named a future date. If no timing ` +
    `was mentioned for a date field, use null — never invent a date. Copy ` +
    `the speaker's COMPLETE timing phrase verbatim into the "note" field ` +
    `(e.g. "Wednesday prior to the last one", never just "Wednesday").`
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
