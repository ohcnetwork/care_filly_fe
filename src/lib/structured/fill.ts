import {
  getCurrentUser,
  getEncounterIdFromUrl,
  getFacilityIdFromUrl,
} from "./care-api";
import {
  DATE_BEARING_STRUCTURED_TYPES,
  buildDateContext,
} from "./date-contract";
import { formatDisplayNames, normalizeSnomedInfo } from "./deserializers";
import {
  STRUCTURED_TEMPLATE_DESCRIPTIONS,
  STRUCTURED_TEMPLATE_EXAMPLES,
  type StructuredFillContext,
  deserializeStructuredData,
} from "./index";
import {
  BOOLEAN_NOT_MENTIONED,
  type Code,
  type SupportedStructuredType,
  isSupportedStructuredType,
} from "./types";
import { lookupCode } from "./valueset";

export interface FieldFill {
  qId: string;
  questionType: string;
  label: string;
  structuredType?: SupportedStructuredType;
  matchedValue: string | null;
  matchedNote: string | null;
  structuredValue?: unknown;
  coding?: Code;
  /** Set when extraction found a value but couldn't use it (e.g. an
   * unparseable date) — shown in place of a value so it's not silently
   * dropped with no explanation. */
  error?: string;
}

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function withUnitSuffix(label: string, unit: unknown): string {
  const u = unit as { code?: string; display?: string } | undefined;
  const code = u?.code || u?.display;
  return code ? `${label} (${code})` : label;
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

// CARE stores a choice response as the option's `value`, not its display
// label (see ChoiceQuestion.tsx) — Medispeak is prompted with display labels,
// so its answer must be resolved back to the real stored value. Returns null
// if it doesn't match any real option (a hallucinated/paraphrased answer),
// so an invalid choice is never inserted.
function resolveChoiceValue(
  question: Record<string, unknown>,
  matchedValue: string,
): string | null {
  const options = question.answer_option as
    | Array<{ value: unknown; display?: string }>
    | undefined;
  if (!options?.length) return matchedValue;

  const normalized = normalizeLabel(matchedValue);
  const match = options.find((o) => {
    const display = o.display || String(o.value);
    return (
      normalizeLabel(display) === normalized ||
      normalizeLabel(String(o.value)) === normalized
    );
  });

  return match ? String(match.value) : null;
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

function getCurrentResponseValue(
  formState: unknown,
  qId: string,
): unknown | null {
  if (!Array.isArray(formState)) return null;

  for (const group of formState) {
    const responses = (group as Record<string, unknown>).responses;
    if (!Array.isArray(responses)) continue;

    const response = responses.find(
      (r) => (r as Record<string, unknown>).question_id === qId,
    ) as Record<string, unknown> | undefined;

    const values = response?.values;
    if (!Array.isArray(values) || !values.length) return null;
    return (values[0] as Record<string, unknown>).value ?? null;
  }

  return null;
}

// Like getCurrentResponseValue, but keeps every value — needed for
// enable_when, since CARE checks a multi-select trigger's full value set.
function getCurrentResponseValues(formState: unknown, qId: string): unknown[] {
  if (!Array.isArray(formState)) return [];

  for (const group of formState) {
    const responses = (group as Record<string, unknown>).responses;
    if (!Array.isArray(responses)) continue;

    const response = responses.find(
      (r) => (r as Record<string, unknown>).question_id === qId,
    ) as Record<string, unknown> | undefined;
    if (!response) continue;

    const values = response.values;
    if (!Array.isArray(values)) return [];
    return values
      .map((v) => (v as Record<string, unknown>).value)
      .filter((v) => v != null);
  }

  return [];
}

function findQuestionById(
  questions: unknown[],
  id: string,
): Record<string, unknown> | null {
  for (const q of questions) {
    const question = q as Record<string, unknown>;
    if (question.id === id) return question;
    if (Array.isArray(question.questions)) {
      const found = findQuestionById(question.questions, id);
      if (found) return found;
    }
  }
  return null;
}

function walkQuestions(
  questions: unknown[],
  visitor: (question: Record<string, unknown>) => void,
): void {
  for (const q of questions) {
    const question = q as Record<string, unknown>;
    if (question.type === "group" && Array.isArray(question.questions)) {
      walkQuestions(question.questions, visitor);
      continue;
    }
    visitor(question);
  }
}

function findOtherInvestigationQuestion(
  formState: unknown,
  excludeQId: string,
): { qId: string; questionType: string; text: string } | null {
  let best: {
    qId: string;
    questionType: string;
    text: string;
    score: number;
  } | null = null;

  if (!Array.isArray(formState)) return null;

  for (const group of formState) {
    const questionnaire = (group as Record<string, unknown>).questionnaire as
      | Record<string, unknown>
      | undefined;
    const questions = questionnaire?.questions;
    if (!Array.isArray(questions)) continue;

    walkQuestions(questions, (question) => {
      if (question.id === excludeQId) return;

      const type = (question.type as string) || "";
      if (type !== "text" && type !== "string") return;

      const text = (question.text as string) || "";
      const normalized = normalizeLabel(text);
      let score = 0;
      if (
        normalized.includes("other") &&
        normalized.includes("investigation")
      ) {
        score = 100;
      } else if (normalized.includes("otherinvestigation")) {
        score = 95;
      } else if (normalized.includes("other")) {
        score = 90;
      } else if (normalized.includes("note")) {
        score = 50;
      }

      if (score > (best?.score ?? 0)) {
        best = { qId: question.id as string, questionType: type, text, score };
      }
    });
  }

  return best
    ? { qId: best.qId, questionType: best.questionType, text: best.text }
    : null;
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

function extractExistingStringValue(response: Record<string, unknown>): string {
  const values = response.values;
  if (!Array.isArray(values) || !values.length) return "";
  const raw = (values[0] as Record<string, unknown>)?.value;
  return raw == null ? "" : String(raw).trim();
}

function shouldSkipQuestion(
  question: Record<string, unknown>,
  response: Record<string, unknown>,
): boolean {
  const questionType = (question.type as string) || "";
  const structuredType = (question.structured_type ||
    response.structured_type) as string | undefined;

  if (structuredType && isSupportedStructuredType(structuredType)) {
    return false;
  }

  if (response.structured_type || question.structured_type) return true;
  if (questionType === "structured" || questionType === "group") return true;
  if (questionType === "date" || questionType === "dateTime") return true;
  return false;
}

function buildLinkIdMap(questions: unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  walkQuestions(questions, (question) => {
    if (question.link_id)
      map.set(question.link_id as string, question.id as string);
  });
  return map;
}

const ENABLE_WHEN_TRUE_STRINGS = new Set(["true", "on", "ok", "y", "yes", "1"]);
const ENABLE_WHEN_FALSE_STRINGS = new Set(["false", "off", "no", "n", "0"]);

function normalizeEnableWhenValue(value: unknown): unknown {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (ENABLE_WHEN_TRUE_STRINGS.has(v)) return true;
    if (ENABLE_WHEN_FALSE_STRINGS.has(v)) return false;
  }
  return value;
}

function toDecimalOrNull(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** This pass's freshly extracted value for the trigger question takes
 * priority, falling back to its existing saved response (all values, so
 * multi-select triggers are checked in full like CARE's backend does). */
function resolveTriggerValues(
  triggerQuestion: Record<string, unknown> | null,
  triggerQId: string,
  formState: unknown,
  data: Record<string, unknown>,
): unknown[] {
  if (triggerQuestion) {
    const extracted = matchVitalToQuestion(
      (triggerQuestion.text as string) || "",
      data,
    );
    if (
      extracted !== null &&
      extracted.toLowerCase() !== BOOLEAN_NOT_MENTIONED
    ) {
      // A choice trigger's freshly extracted text is a display label —
      // enable_when.answer is written against the stored answer_option
      // value, same reason the main fill path resolves choices too.
      const resolved =
        triggerQuestion.type === "choice"
          ? resolveChoiceValue(triggerQuestion, extracted)
          : extracted;
      if (resolved !== null) return [resolved];
    }
  }
  return getCurrentResponseValues(formState, triggerQId);
}

/** Mirrors CARE's `is_question_enabled` so a question is never filled with a
 * value its `enable_when` conditions would reject on submit. */
function isQuestionEnabled(
  question: Record<string, unknown>,
  qList: unknown[],
  formState: unknown,
  data: Record<string, unknown>,
): boolean {
  const conditions = question.enable_when as
    | { question: string; operator: string; answer: unknown }[]
    | undefined;
  if (!conditions?.length) return true;

  const linkIdToId = buildLinkIdMap(qList);
  const behavior = (question.enable_behavior as string) || "all";

  const results = conditions.map((condition) => {
    const triggerQId = linkIdToId.get(condition.question);
    if (!triggerQId) return false;

    const triggerQuestion = findQuestionById(qList, triggerQId);
    const values = resolveTriggerValues(
      triggerQuestion,
      triggerQId,
      formState,
      data,
    ).map(normalizeEnableWhenValue);
    const expected = normalizeEnableWhenValue(condition.answer);

    switch (condition.operator) {
      case "exists":
        return expected ? values.length > 0 : values.length === 0;
      case "equals":
        return values.includes(expected);
      case "not_equals":
        return values.length > 0 && values.every((v) => v !== expected);
      case "greater":
      case "less":
      case "greater_or_equals":
      case "less_or_equals": {
        const expectedNum = toDecimalOrNull(expected);
        if (expectedNum === null) return false;
        return values.some((v) => {
          const num = toDecimalOrNull(v);
          if (num === null) return false;
          if (condition.operator === "greater") return num > expectedNum;
          if (condition.operator === "less") return num < expectedNum;
          if (condition.operator === "greater_or_equals")
            return num >= expectedNum;
          return num <= expectedNum;
        });
      }
      default:
        return false;
    }
  });

  return behavior === "all" ? results.every(Boolean) : results.some(Boolean);
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

interface StructuredCandidate {
  qId: string;
  questionText: string;
  questionType: string;
  structuredType: SupportedStructuredType;
  raw: unknown[];
  current: unknown;
}

interface ChoiceCodingCandidate {
  qId: string;
  questionType: string;
  questionText: string;
  code: string;
  displayNames: string[];
  valueSetSlug: string;
  matchedNote: string | null;
}

export async function collectFieldsToFill(
  formState: unknown,
  data: Record<string, unknown>,
): Promise<FieldFill[]> {
  const fieldsToFill: FieldFill[] = [];
  if (!Array.isArray(formState)) return fieldsToFill;

  const fillContext: StructuredFillContext = {
    currentUser: await getCurrentUser(),
    facilityId: getFacilityIdFromUrl(),
    encounterId: getEncounterIdFromUrl(),
    complaintText: extractComplaintText(data),
  };

  // Collect structured questions (Diagnosis, Medication, Investigation, …)
  // here instead of resolving them inline, so their SNOMED/valueset lookups
  // can run concurrently below rather than stacking one question's network
  // round-trips behind another's.
  const structuredCandidates: StructuredCandidate[] = [];
  // Same reasoning for a "choice" question backed by an open terminology
  // (answer_value_set) instead of a fixed answer_option list.
  const choiceCodingCandidates: ChoiceCodingCandidate[] = [];

  for (const group of formState) {
    const questions = (group as Record<string, unknown>).questionnaire as
      | Record<string, unknown>
      | undefined;
    const qList = questions?.questions;
    if (!Array.isArray(qList)) continue;
    const responses = (group as Record<string, unknown>).responses;
    if (!Array.isArray(responses)) continue;

    for (const resp of responses) {
      const r = resp as Record<string, unknown>;
      const qId = r.question_id as string;
      const question = findQuestionById(qList, qId);
      if (!question || shouldSkipQuestion(question, r)) continue;

      const enabled = isQuestionEnabled(question, qList, formState, data);
      if (
        import.meta.env.DEV &&
        Array.isArray(question.enable_when) &&
        question.enable_when.length
      ) {
        console.log(
          `[Filly] enable_when("${question.text}") -> ${enabled ? "enabled" : "disabled"}`,
          question.enable_when,
        );
      }
      if (!enabled) continue;

      const questionText = (question.text as string) || "";
      const structuredType = (question.structured_type || r.structured_type) as
        | string
        | undefined;

      if (isSupportedStructuredType(structuredType)) {
        const label = findMatchingLabel(questionText, data);
        if (!label) continue;

        const raw = parseStructuredRaw(data[label]);
        if (!raw?.length) continue;

        structuredCandidates.push({
          qId,
          questionText,
          questionType: (question.type as string) || "structured",
          structuredType,
          raw,
          current: getCurrentResponseValue(formState, qId),
        });
        continue;
      }

      const questionType = (question.type as string) || "";
      const matchingText =
        questionType === "decimal" || questionType === "integer"
          ? withUnitSuffix(questionText, question.unit)
          : questionText;
      const rawValue = matchVitalToQuestion(matchingText, data);
      const matchedNote = matchNoteToQuestion(matchingText, data);

      // "not_mentioned" is a sentinel meaning "no answer was given" — for
      // any question type (a stray fuzzy-match can surface it outside
      // boolean fields too), never insert it as if it were real data.
      const matchedValue =
        rawValue?.toLowerCase() === BOOLEAN_NOT_MENTIONED ? null : rawValue;

      // A choice backed by an open terminology (no fixed answer_option list)
      // needs an async valueset lookup to resolve to a real coding — collect
      // it for the concurrent pass below, same as structured candidates.
      const answerValueSet = question.answer_value_set as string | undefined;
      const hasFixedOptions =
        Array.isArray(question.answer_option) &&
        (question.answer_option as unknown[]).length > 0;

      if (questionType === "choice" && answerValueSet && !hasFixedOptions) {
        // The answer is a {code, display_names} object, not a plain scalar
        // (matchVitalToQuestion would reject it as JSON-looking text) — same
        // shape resolveOptionalCode expects for medication/diagnosis/etc.
        const label = findMatchingLabel(questionText, data);
        const parsed = label ? parseStructuredRaw(data[label]) : null;
        const info = parsed?.[0]
          ? normalizeSnomedInfo(parsed[0] as Record<string, unknown>)
          : null;

        if (info && (info.code || info.display_names.length)) {
          choiceCodingCandidates.push({
            qId,
            questionType,
            questionText,
            code: info.code,
            displayNames: info.display_names,
            valueSetSlug: answerValueSet,
            matchedNote,
          });
        } else if (matchedNote !== null) {
          fieldsToFill.push({
            qId,
            questionType,
            label: questionText,
            matchedValue: null,
            matchedNote,
          });
        }
        continue;
      }

      // An unrecognized choice label is a hallucination, not a valid
      // selection — never insert it, but a note (if any) can still land.
      const resolvedValue =
        questionType === "choice" && matchedValue !== null
          ? resolveChoiceValue(question, matchedValue)
          : matchedValue;

      if (resolvedValue === null && matchedNote === null) continue;

      fieldsToFill.push({
        qId,
        questionType,
        label: questionText,
        matchedValue: resolvedValue,
        matchedNote,
      });
    }
  }

  const structuredResults = await Promise.all(
    structuredCandidates.map(async (candidate) => {
      try {
        const {
          data: structuredValue,
          errors,
          supplementalNote,
        } = await deserializeStructuredData(
          candidate.structuredType,
          candidate.raw,
          candidate.current,
          fillContext,
        );

        if (errors.length) {
          console.warn(
            `[Filly] Structured fill warnings for ${candidate.questionText}:`,
            errors,
          );
        }

        return { candidate, structuredValue, supplementalNote, errors };
      } catch (err) {
        console.warn(
          `[Filly] Skipping structured field "${candidate.questionText}":`,
          err,
        );
        return null;
      }
    }),
  );

  for (const result of structuredResults) {
    if (!result) continue;
    const { candidate, structuredValue, supplementalNote, errors } = result;

    const currentArr = Array.isArray(candidate.current)
      ? candidate.current
      : [];
    const nextArr = Array.isArray(structuredValue) ? structuredValue : [];
    const hasNewItems = nextArr.length > currentArr.length;

    if (!hasNewItems && !supplementalNote) {
      if (errors.length) {
        fieldsToFill.push({
          qId: candidate.qId,
          questionType: candidate.questionType,
          label: candidate.questionText,
          structuredType: candidate.structuredType,
          matchedValue: null,
          matchedNote: null,
          error: errors.join("; "),
        });
      }
      continue;
    }

    fieldsToFill.push({
      qId: candidate.qId,
      questionType: candidate.questionType,
      label: candidate.questionText,
      structuredType: candidate.structuredType,
      matchedValue: null,
      matchedNote: supplementalNote ? `Also order: ${supplementalNote}` : null,
      structuredValue: hasNewItems ? nextArr : undefined,
    });

    if (errors.length) {
      fieldsToFill.push({
        qId: candidate.qId,
        questionType: candidate.questionType,
        label: candidate.questionText,
        structuredType: candidate.structuredType,
        matchedValue: null,
        matchedNote: null,
        error: errors.join("; "),
      });
    }

    if (candidate.structuredType === "service_request") {
      const otherLabel = findOtherInvestigationLabel(data);
      const directOtherValue = otherLabel
        ? extractScalarValue(data[otherLabel])
        : null;
      const otherInvestigationText = [supplementalNote, directOtherValue]
        .filter((value): value is string => !!value?.trim())
        .join("\n");

      if (otherInvestigationText) {
        const fallbackQuestion = findOtherInvestigationQuestion(
          formState,
          candidate.qId,
        );
        if (fallbackQuestion) {
          fieldsToFill.push({
            qId: fallbackQuestion.qId,
            questionType: fallbackQuestion.questionType,
            label: fallbackQuestion.text,
            matchedValue: otherInvestigationText,
            matchedNote: null,
          });
        }
      }
    }
  }

  const choiceCodingResults = await Promise.all(
    choiceCodingCandidates.map(async (candidate) => {
      try {
        const code = await lookupCode(
          candidate.code,
          candidate.displayNames,
          candidate.valueSetSlug,
        );
        return { candidate, code };
      } catch (err) {
        console.warn(
          `[Filly] Skipping valueset choice for "${candidate.qId}":`,
          err,
        );
        return null;
      }
    }),
  );

  for (const result of choiceCodingResults) {
    if (!result) continue;
    if (!result.code) {
      fieldsToFill.push({
        qId: result.candidate.qId,
        questionType: result.candidate.questionType,
        label: result.candidate.questionText,
        matchedValue: null,
        matchedNote: result.candidate.matchedNote,
        error: `Could not find a "${result.candidate.questionText}" matching "${formatDisplayNames(result.candidate.displayNames)}". Please enter manually.`,
      });
      continue;
    }
    fieldsToFill.push({
      qId: result.candidate.qId,
      questionType: result.candidate.questionType,
      label: result.candidate.questionText,
      matchedValue: null,
      matchedNote: result.candidate.matchedNote,
      coding: result.code,
    });
  }

  return fieldsToFill;
}

export function applyFieldToState(
  currentState: unknown,
  field: FieldFill,
): unknown {
  if (!Array.isArray(currentState)) return currentState;

  return currentState.map((group: Record<string, unknown>) => {
    const responses = group.responses;
    if (!Array.isArray(responses)) return group;

    return {
      ...group,
      responses: responses.map((resp: Record<string, unknown>) => {
        if ((resp.question_id as string) !== field.qId) return resp;

        const updated: Record<string, unknown> = { ...resp };

        if (field.coding) {
          updated.values = [{ type: "quantity", coding: field.coding }];
        } else if (
          field.structuredType &&
          field.structuredValue !== undefined
        ) {
          updated.values = [
            {
              type: field.structuredType,
              value: field.structuredValue,
            },
          ];
        } else if (field.matchedValue !== null) {
          const existingValue = extractExistingStringValue(resp);
          const nextValue = existingValue
            ? `${existingValue}\n${field.matchedValue}`
            : field.matchedValue;
          updated.values = toResponseValue(nextValue, field.questionType);
        }

        if (field.matchedNote !== null) {
          const existing =
            typeof resp.note === "string" ? resp.note.trim() : "";
          updated.note = existing
            ? `${existing}\n${field.matchedNote}`
            : field.matchedNote;
        }

        return updated;
      }),
    };
  });
}

export function toResponseValue(
  value: string,
  questionType: string,
): Array<{ type: string; value: unknown }> {
  if (questionType === "decimal") {
    const num = Number(value);
    if (Number.isFinite(num)) return [{ type: "number", value: num }];
  }
  if (questionType === "integer") {
    const num = parseInt(value, 10);
    if (Number.isFinite(num)) return [{ type: "number", value: num }];
  }
  if (questionType === "boolean") {
    const bool = ["true", "yes", "1"].includes(value.toLowerCase());
    return [{ type: "boolean", value: bool }];
  }
  if (questionType === "date" || questionType === "dateTime") {
    return [{ type: questionType, value }];
  }
  return [{ type: "string", value }];
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
