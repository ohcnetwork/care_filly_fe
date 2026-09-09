import type {
  ScribeFormSummary,
  ScribeQuestionSummary,
} from "@/lib/types/filly";

import {
  getCurrentUser,
  getEncounterIdFromUrl,
  getFacilityIdFromUrl,
} from "./care-api";
import {
  DATE_BEARING_STRUCTURED_TYPES,
  buildDateContext,
} from "./date-contract";
import {
  STRUCTURED_TEMPLATE_DESCRIPTIONS,
  STRUCTURED_TEMPLATE_EXAMPLES,
  type StructuredFillContext,
  deserializeStructuredData,
} from "./index";
import { validateDate } from "./time";
import {
  BOOLEAN_NOT_MENTIONED,
  type SupportedStructuredType,
  isSupportedStructuredType,
} from "./types";

/** A question type the `questionnaire.response.set` Scribe action can
 *  write with a plain scalar — see `coerceResponseValue` in care_fe's
 *  `useFillActions.ts`. A value-set-coded choice has no action to write
 *  through yet, and `questionnaire.forms.list` doesn't expose enough to
 *  tell one apart from a plain fixed-option choice, so an unmatchable
 *  write is left to the host to reject rather than guessed at here.
 *  Structured questions go through the same action too, but with one
 *  request-object entry per row instead of a scalar — see FieldFill. */
const WRITABLE_TYPES = new Set([
  "string",
  "text",
  "url",
  "choice",
  "integer",
  "decimal",
  "boolean",
  "time",
  "date",
  "dateTime",
]);

/** 24-hour "HH:mm", optionally with seconds — what care_fe's own
 *  `TIME_PATTERN` requires; matches `<input type="time">`. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** "3:30 PM"/"3:30pm" — the shape a spoken answer is likeliest to come
 *  back as even when the field spec asks for 24-hour time. */
const TIME_12H_PATTERN = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(am|pm)$/i;

/** care_fe's `date` coercion requires an exact "YYYY-MM-DD" (`z.iso.date()`)
 *  — reuses the same relative/absolute date parsing the structured onset
 *  fields already trust, so a plain date question gets the same leniency. */
function normalizeDateAnswer(raw: string): string | null {
  return validateDate(raw);
}

/** care_fe's `dateTime` coercion accepts any ISO datetime, with or without
 *  an offset — `Date#toISOString()` (always "Z"-suffixed) satisfies that
 *  directly, so this only needs to confirm `raw` parses to a real instant. */
function normalizeDateTimeAnswer(raw: string): string | null {
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** care_fe's `time` coercion is a strict 24-hour regex with no AM/PM
 *  leniency — normalize the common 12-hour form here so a well-formed
 *  spoken answer isn't rejected on a formatting technicality alone. */
function normalizeTimeAnswer(raw: string): string | null {
  const trimmed = raw.trim();
  if (TIME_PATTERN.test(trimmed)) return trimmed;

  const match = TIME_12H_PATTERN.exec(trimmed);
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[3].toLowerCase();
  if (hours === 12) hours = 0;
  if (meridiem === "pm") hours += 12;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/** Normalizes a matched date/dateTime/time answer into what care_fe's
 *  `coerceResponseValue` requires; unparseable input is passed through
 *  as-is so the host still gets a chance to reject it with its own
 *  specific error instead of the match silently disappearing here. */
function normalizeTemporalAnswer(questionType: string, raw: string): string {
  const normalized =
    questionType === "date"
      ? normalizeDateAnswer(raw)
      : questionType === "dateTime"
        ? normalizeDateTimeAnswer(raw)
        : questionType === "time"
          ? normalizeTimeAnswer(raw)
          : null;
  return normalized ?? raw;
}

export interface FieldFill {
  questionnaireId: string;
  /** The only stable identifier the Scribe action contract exposes — no
   *  question id or DOM anchor reaches this side of the plugin boundary. */
  linkId: string;
  questionType: string;
  label: string;
  /** Set for a structured question — mutually exclusive with matchedValue.
   *  `questionnaire.response.set` replaces a structured question's answer
   *  wholesale, so `structuredEntries` always carries the FULL desired
   *  list (the question's existing rows, from `forms.list`, plus the
   *  newly extracted ones) rather than just what's new. */
  structuredType?: SupportedStructuredType;
  structuredEntries?: unknown[];
  /** How many of `structuredEntries` are new this session — for display
   *  only; the write always carries the full list above. */
  structuredNewCount?: number;
  matchedValue: string | number | boolean | null;
  matchedNote: string | null;
  /** Set once the write has been attempted and the host rejected it, or
   *  when extraction itself found a value but couldn't use it (e.g. an
   *  unresolvable structured lookup) — shown instead of a value so it's
   *  never silently dropped with no explanation. */
  error?: string;
}

export interface SetResponseInput {
  questionnaire_id: string;
  link_id: string;
  values: Array<string | number | boolean | Record<string, unknown>>;
  note?: string;
}

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isValueDataKey(key: string): boolean {
  return key !== "clinical_notes" && !key.endsWith("_note");
}

export function findMatchingLabel(
  questionText: string,
  data: Record<string, unknown>,
  scalarOnly = false,
): string | null {
  const normalizedQ = normalizeLabel(questionText);
  const candidateKeys = Object.keys(data).filter((label) => {
    if (!isValueDataKey(label)) return false;
    const raw = data[label];
    return !(scalarOnly && raw != null && typeof raw === "object");
  });

  // Prefer an exact match over a loose substring one, so a stray key like
  // "additional_symptoms" can't win over the real "symptom" key.
  const exact = candidateKeys.find(
    (label) => normalizeLabel(label) === normalizedQ,
  );
  if (exact) return exact;

  for (const label of candidateKeys) {
    const normalizedLabel = normalizeLabel(label);
    if (
      normalizedQ.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedQ)
    ) {
      return label;
    }
  }

  if (normalizedQ.includes("systolic") || normalizedQ.includes("diastolic")) {
    for (const label of candidateKeys) {
      if (normalizeLabel(label).includes("bloodpressure")) return label;
    }
  }

  return null;
}

// Rejects a value that's itself serialized structured-data JSON (a stray
// fuzzy-match leak), so it never gets written into a plain text/note field.
function looksLikeSerializedStructuredData(text: string): boolean {
  return /^[[{]/.test(text) && parseStructuredRaw(text) !== null;
}

function extractScalarValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if ("value" in obj) return extractScalarValue(obj.value);
    return null;
  }
  if (Array.isArray(raw)) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  if (looksLikeSerializedStructuredData(text)) return null;
  return text;
}

export function matchVitalToQuestion(
  questionText: string,
  data: Record<string, unknown>,
): string | null {
  const label = findMatchingLabel(questionText, data, true);
  if (!label) return null;

  const value = extractScalarValue(data[label]);
  if (value === null) return null;

  const normalizedQ = normalizeLabel(questionText);

  if (normalizeLabel(label).includes("bloodpressure") && value.includes("/")) {
    if (normalizedQ.includes("systolic")) return value.split("/")[0];
    if (normalizedQ.includes("diastolic")) return value.split("/")[1];
  }

  return value;
}

export function matchNoteToQuestion(
  questionText: string,
  data: Record<string, unknown>,
): string | null {
  const label = findMatchingLabel(questionText, data, true);
  if (!label) return null;

  const wrappedNote =
    typeof data[label] === "object" &&
    data[label] !== null &&
    !Array.isArray(data[label]) &&
    "note" in (data[label] as Record<string, unknown>)
      ? (data[label] as Record<string, unknown>).note
      : undefined;

  const note = wrappedNote ?? data[`${label}_note`];
  if (note == null) return null;
  const text = String(note).trim();
  if (text === "" || looksLikeSerializedStructuredData(text)) return null;
  return text;
}

function tryParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseStructuredRaw(raw: unknown): unknown[] | null {
  if (raw == null) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (!/^[[{]/.test(trimmed)) return [trimmed];

    let result = tryParseJSON(trimmed);
    if (result === undefined) {
      // Some models over-escape a JSON-string field, embedding literal
      // backslash-quotes in the value itself (e.g. `[{\"code\":...}]`)
      // instead of returning plain JSON text. Unescaping once recovers it;
      // if that still doesn't parse, this really isn't structured data.
      result = tryParseJSON(trimmed.replace(/\\"/g, '"'));
    }
    if (result === undefined) return null;
    parsed = result;
  }

  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null) return [parsed];
  return null;
}

/**
 * Match extracted `data` onto the open session's writable questions.
 * `forms` is `questionnaire.forms.list`'s result — its `enabled` flag
 * already accounts for every ancestor group's enable_when, so this never
 * needs to re-walk the question tree itself.
 */
export async function collectFieldsToFill(
  forms: ScribeFormSummary[],
  data: Record<string, unknown>,
): Promise<FieldFill[]> {
  const fieldsToFill: FieldFill[] = [];

  const fillContext: StructuredFillContext = {
    currentUser: await getCurrentUser(),
    facilityId: getFacilityIdFromUrl(),
    encounterId: getEncounterIdFromUrl(),
    complaintText: extractComplaintText(data),
  };

  // Collected here instead of resolved inline so their SNOMED/valueset/user
  // lookups can run concurrently below rather than stacking one question's
  // network round-trips behind another's.
  const structuredCandidates: StructuredCandidate[] = [];

  for (const form of forms) {
    for (const question of form.questions) {
      if (!question.enabled) continue;

      if (isSupportedStructuredType(question.structured_type)) {
        const label = findMatchingLabel(question.text, data);
        if (!label) continue;
        const raw = parseStructuredRaw(data[label]);
        if (!raw?.length) continue;

        structuredCandidates.push({
          questionnaireId: form.questionnaire_id,
          linkId: question.link_id,
          label: question.text,
          structuredType: question.structured_type,
          raw,
          existingEntries: Array.isArray(question.values)
            ? question.values
            : [],
        });
        continue;
      }

      if (!WRITABLE_TYPES.has(question.type)) continue;

      const rawValue = matchVitalToQuestion(question.text, data);
      const matchedNote = matchNoteToQuestion(question.text, data);
      // "not_mentioned" is a sentinel meaning "no answer was given" — never
      // insert it as if it were real data.
      const matchedValue =
        rawValue?.toLowerCase() === BOOLEAN_NOT_MENTIONED
          ? null
          : rawValue && ["date", "dateTime", "time"].includes(question.type)
            ? normalizeTemporalAnswer(question.type, rawValue)
            : rawValue;

      if (matchedValue === null) {
        // A note-only match would otherwise ask the host to overwrite an
        // already-answered question's values with an empty array just to
        // carry the note — skip rather than risk clobbering a real answer
        // this action contract gives no way to read back and preserve.
        if (matchedNote === null || question.answered) continue;
      }

      fieldsToFill.push({
        questionnaireId: form.questionnaire_id,
        linkId: question.link_id,
        questionType: question.type,
        label: question.text,
        matchedValue,
        matchedNote,
      });
    }
  }

  const structuredResults = await Promise.all(
    structuredCandidates.map(async (candidate) => {
      try {
        // The merge/dedupe-by-code logic already lives in each deserializer
        // (`[...current, ...dedupeByCode(parsed, currentCodes, ...)]`) — now
        // that `forms.list` exposes existing rows, passing them as `current`
        // makes that return value the exact full list this write needs.
        const {
          data: entries,
          errors,
          supplementalNote,
        } = await deserializeStructuredData(
          candidate.structuredType,
          candidate.raw,
          candidate.existingEntries,
          fillContext,
        );
        if (errors.length) {
          console.warn(
            `[Filly] Structured fill warnings for ${candidate.label}:`,
            errors,
          );
        }
        return { candidate, entries, errors, supplementalNote };
      } catch (err) {
        console.warn(
          `[Filly] Skipping structured field "${candidate.label}":`,
          err,
        );
        return null;
      }
    }),
  );

  for (const result of structuredResults) {
    if (!result) continue;
    const { candidate, entries, errors, supplementalNote } = result;
    const mergedEntries = Array.isArray(entries) ? entries : [];
    const lengthDiff = mergedEntries.length - candidate.existingEntries.length;
    // Most types append (the merged list only ever grows), but a
    // single-value type like time_of_death REPLACES its one entry in
    // place — same length, different content — so a length-only check
    // would miss a corrected value and silently drop the write.
    const contentChanged =
      lengthDiff !== 0 ||
      JSON.stringify(mergedEntries) !==
        JSON.stringify(candidate.existingEntries);

    if (!contentChanged && !supplementalNote) {
      // Extraction matched this question but every parsed row deduped away
      // against what's already recorded — say so instead of vanishing, or
      // the clinician has no way to tell Filly heard it at all. Still tags
      // `structuredType` (with no `structuredEntries`) so the apply loop's
      // own skip check recognizes this as a display-only row and never
      // sends an empty `values` that would wipe the question's answer.
      fieldsToFill.push({
        questionnaireId: candidate.questionnaireId,
        linkId: candidate.linkId,
        questionType: "structured",
        structuredType: candidate.structuredType,
        label: candidate.label,
        matchedValue: null,
        matchedNote: null,
        error: errors.length ? errors.join("; ") : "Already recorded/exist",
      });
      continue;
    }

    fieldsToFill.push({
      questionnaireId: candidate.questionnaireId,
      linkId: candidate.linkId,
      questionType: "structured",
      label: candidate.label,
      structuredType: candidate.structuredType,
      structuredEntries: mergedEntries,
      structuredNewCount: lengthDiff > 0 ? lengthDiff : contentChanged ? 1 : 0,
      matchedValue: null,
      matchedNote: supplementalNote ? `Also order: ${supplementalNote}` : null,
    });

    if (errors.length) {
      fieldsToFill.push({
        questionnaireId: candidate.questionnaireId,
        linkId: candidate.linkId,
        questionType: "structured",
        structuredType: candidate.structuredType,
        label: candidate.label,
        matchedValue: null,
        matchedNote: null,
        error: errors.join("; "),
      });
    }

    // A service_request's leftover free-text ("Also order: physio referral")
    // has nowhere structured to go — best-effort route it onto whichever
    // open text question looks like the form's "Other investigation" field.
    if (candidate.structuredType === "service_request") {
      const otherLabel = findOtherInvestigationLabel(data);
      const directOtherValue = otherLabel
        ? extractScalarValue(data[otherLabel])
        : null;
      const otherInvestigationText = [supplementalNote, directOtherValue]
        .filter((value): value is string => !!value?.trim())
        .join("\n");

      if (otherInvestigationText) {
        const fallback = findOtherInvestigationQuestion(
          forms,
          candidate.linkId,
        );
        if (fallback) {
          fieldsToFill.push({
            questionnaireId: fallback.questionnaireId,
            linkId: fallback.linkId,
            questionType: fallback.questionType,
            label: fallback.text,
            matchedValue: otherInvestigationText,
            matchedNote: null,
          });
        }
      }
    }
  }

  return fieldsToFill;
}

/** The `questionnaire.response.set` action's input for one matched
 *  field — scalar or structured. A structured `values` array is the FULL
 *  desired list (`field.structuredEntries` already carries existing rows
 *  merged with the new ones): the action replaces the answer wholesale,
 *  it never appends. */
export function buildSetResponseInput(field: FieldFill): SetResponseInput {
  return {
    questionnaire_id: field.questionnaireId,
    link_id: field.linkId,
    values: field.structuredType
      ? sanitizeStructuredEntries(field.structuredEntries ?? [])
      : field.matchedValue !== null
        ? [field.matchedValue]
        : [],
    ...(field.matchedNote !== null && { note: field.matchedNote }),
  };
}

// The host's `values` schema validates each structured entry with
// `z.record(z.string(), z.json())` — a key present with value `undefined`
// (e.g. an optional `note` a deserializer left unset, or an unresolved
// `code.system` from a locally-defined valueset concept) fails that check
// for the WHOLE entry, not just the one key. A JSON round-trip drops any
// such key exactly the way `JSON.stringify` already treats it everywhere
// else in the app, so the entry matches what the host will accept.
function sanitizeStructuredEntries(
  entries: unknown[],
): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(entries));
}

interface StructuredCandidate {
  questionnaireId: string;
  linkId: string;
  label: string;
  structuredType: SupportedStructuredType;
  raw: unknown[];
  existingEntries: unknown[];
}

function extractComplaintText(
  data: Record<string, unknown>,
): string | undefined {
  for (const label of Object.keys(data)) {
    if (!isValueDataKey(label)) continue;
    const normalized = normalizeLabel(label);
    if (
      normalized.includes("presentingcomplaint") ||
      normalized.includes("chiefcomplaint") ||
      normalized.includes("complaint")
    ) {
      const value = extractScalarValue(data[label]);
      if (value) return value;
    }
  }
  return undefined;
}

function findOtherInvestigationLabel(
  data: Record<string, unknown>,
): string | null {
  for (const label of Object.keys(data)) {
    if (!isValueDataKey(label)) continue;
    const normalized = normalizeLabel(label);
    if (
      normalized.includes("other") &&
      (normalized.includes("investigation") || normalized.includes("lab"))
    ) {
      return label;
    }
  }
  return null;
}

interface OtherInvestigationQuestion {
  questionnaireId: string;
  linkId: string;
  questionType: string;
  text: string;
}

/** Best free-text question to carry an investigation's leftover note,
 *  scored by how strongly its own label reads as an "other" catch-all —
 *  `forms.list` is already flat, so no tree-walk is needed here. */
function findOtherInvestigationQuestion(
  forms: ScribeFormSummary[],
  excludeLinkId: string,
): OtherInvestigationQuestion | null {
  let best: (OtherInvestigationQuestion & { score: number }) | null = null;

  const score = (question: ScribeQuestionSummary): number => {
    const normalized = normalizeLabel(question.text);
    if (normalized.includes("other") && normalized.includes("investigation"))
      return 100;
    if (normalized.includes("otherinvestigation")) return 95;
    if (normalized.includes("other")) return 90;
    if (normalized.includes("note")) return 50;
    return 0;
  };

  for (const form of forms) {
    for (const question of form.questions) {
      if (question.link_id === excludeLinkId) continue;
      if (question.type !== "text" && question.type !== "string") continue;

      const candidateScore = score(question);
      if (candidateScore > (best?.score ?? 0)) {
        best = {
          questionnaireId: form.questionnaire_id,
          linkId: question.link_id,
          questionType: question.type,
          text: question.text,
          score: candidateScore,
        };
      }
    }
  }

  return best
    ? {
        questionnaireId: best.questionnaireId,
        linkId: best.linkId,
        questionType: best.questionType,
        text: best.text,
      }
    : null;
}

export function getStructuredFieldDescription(
  structuredType: SupportedStructuredType,
  label: string,
): string {
  const base = `"${label}" (${STRUCTURED_TEMPLATE_DESCRIPTIONS[structuredType]})`;
  if (!DATE_BEARING_STRUCTURED_TYPES.has(structuredType)) return base;
  return `${base}. ${buildDateContext()}`;
}

export function getStructuredFieldExample(
  structuredType: SupportedStructuredType,
): unknown {
  return STRUCTURED_TEMPLATE_EXAMPLES[structuredType];
}
