import {
  getCurrentUser,
  getEncounterIdFromUrl,
  getFacilityIdFromUrl,
} from "./care-api";
import { type StructuredFillContext, deserializeStructuredData } from "./index";
import {
  type SupportedStructuredType,
  isSupportedStructuredType,
} from "./types";

export interface FieldFill {
  qId: string;
  questionType: string;
  structuredType?: SupportedStructuredType;
  matchedValue: string | null;
  matchedNote: string | null;
  structuredValue?: unknown;
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

  for (const label of Object.keys(data)) {
    if (!isValueDataKey(label)) continue;

    const raw = data[label];
    if (scalarOnly && raw != null && typeof raw === "object") continue;

    const normalizedLabel = normalizeLabel(label);

    if (
      normalizedQ.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedQ)
    ) {
      return label;
    }
  }

  if (normalizedQ.includes("systolic") || normalizedQ.includes("diastolic")) {
    for (const label of Object.keys(data)) {
      if (!isValueDataKey(label)) continue;
      const raw = data[label];
      if (scalarOnly && raw != null && typeof raw === "object") continue;
      if (normalizeLabel(label).includes("bloodpressure")) return label;
    }
  }

  return null;
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
  return text === "" ? null : text;
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
  if (note == null || String(note).trim() === "") return null;
  return String(note);
}

function parseStructuredRaw(raw: unknown): unknown[] | null {
  if (raw == null) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
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
): { qId: string; questionType: string } | null {
  let best: { qId: string; questionType: string; score: number } | null = null;

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

      const normalized = normalizeLabel((question.text as string) || "");
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
      }

      if (score > (best?.score ?? 0)) {
        best = { qId: question.id as string, questionType: type, score };
      }
    });
  }

  return best ? { qId: best.qId, questionType: best.questionType } : null;
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

      const questionText = (question.text as string) || "";
      const structuredType = (question.structured_type || r.structured_type) as
        | string
        | undefined;

      if (isSupportedStructuredType(structuredType)) {
        try {
          const label = findMatchingLabel(questionText, data);
          if (!label) continue;

          const raw = parseStructuredRaw(data[label]);
          if (!raw?.length) continue;

          const current = getCurrentResponseValue(formState, qId);
          const {
            data: structuredValue,
            errors,
            supplementalNote,
          } = await deserializeStructuredData(
            structuredType,
            raw,
            current,
            fillContext,
          );

          if (errors.length) {
            console.warn(
              `[Filly] Structured fill warnings for ${questionText}:`,
              errors,
            );
          }

          const currentArr = Array.isArray(current) ? current : [];
          const nextArr = Array.isArray(structuredValue) ? structuredValue : [];
          const hasNewItems = nextArr.length > currentArr.length;

          if (!hasNewItems && !supplementalNote) continue;

          fieldsToFill.push({
            qId,
            questionType: (question.type as string) || "structured",
            structuredType,
            matchedValue: null,
            matchedNote: supplementalNote
              ? `Also order: ${supplementalNote}`
              : null,
            structuredValue: hasNewItems ? nextArr : undefined,
          });

          if (structuredType === "service_request") {
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
                qId,
              );
              if (fallbackQuestion) {
                fieldsToFill.push({
                  qId: fallbackQuestion.qId,
                  questionType: fallbackQuestion.questionType,
                  matchedValue: otherInvestigationText,
                  matchedNote: null,
                });
              }
            }
          }
        } catch (err) {
          console.warn(
            `[Filly] Skipping structured field "${questionText}":`,
            err,
          );
        }
        continue;
      }

      const matchedValue = matchVitalToQuestion(questionText, data);
      const matchedNote = matchNoteToQuestion(questionText, data);
      if (matchedValue === null && matchedNote === null) continue;

      fieldsToFill.push({
        qId,
        questionType: (question.type as string) || "",
        matchedValue,
        matchedNote,
      });
    }
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

        if (field.structuredType && field.structuredValue !== undefined) {
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
