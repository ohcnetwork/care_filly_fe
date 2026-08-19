import {
  type OnsetResolveOptions,
  noNullStrings,
  resolveLastOccurrence,
  resolveOnsetDatetime,
  shiftUTCToLocalClockTime,
  validateTime,
} from "./time";
import type { Code } from "./types";
import { lookupCode } from "./valueset";

interface SnomedInfo {
  code: string;
  display_names: string[];
}

interface DeserializeResult<T> {
  data: T;
  errors: string[];
}

/** Drops items already in `existingCodes` and duplicates within `parsed`
 * itself — a single extraction can return the same finding twice. */
function dedupeByCode<T>(
  parsed: (T | undefined)[],
  existingCodes: Set<string>,
  codeOf: (item: T) => string,
): T[] {
  const seen = new Set(existingCodes);
  const result: T[] = [];
  for (const item of parsed) {
    if (!item) continue;
    const code = codeOf(item);
    if (seen.has(code)) continue;
    seen.add(code);
    result.push(item);
  }
  return result;
}

export function normalizeDisplayNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

export function normalizeSnomedInfo(
  row: Record<string, unknown>,
): SnomedInfo | null {
  const raw = row.snomed_info;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const snomed = raw as Record<string, unknown>;
    const code = snomed.code != null ? String(snomed.code) : "";
    const displayNames = normalizeDisplayNames(
      snomed.display_names ?? snomed.display ?? snomed.name,
    );
    if (code || displayNames.length) {
      return { code, display_names: displayNames };
    }
  }

  const fallbackCode = row.code != null ? String(row.code) : "";
  const fallbackNames = normalizeDisplayNames(
    row.display_names ?? row.display ?? row.name ?? row.text,
  );
  if (fallbackCode || fallbackNames.length) {
    return { code: fallbackCode, display_names: fallbackNames };
  }

  return null;
}

export function formatDisplayNames(names: string[]): string {
  return names.length ? names.join(", ") : "unknown term";
}

const ALLERGY_CRITICALITY_SYNONYMS: Record<string, "low" | "high"> = {
  mild: "low",
  moderate: "low",
  severe: "high",
  anaphylaxis: "high",
  anaphylactic: "high",
};

function normalizeCriticality(
  value: unknown,
): "low" | "high" | "unable_to_assess" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "low" || normalized === "high") return normalized;
  return ALLERGY_CRITICALITY_SYNONYMS[normalized] ?? "unable_to_assess";
}

async function resolveFindingCode(
  snomed: SnomedInfo,
  valueSetSlug: string,
  label: string,
): Promise<{ code: Code | null; error?: string }> {
  const displayNames = normalizeDisplayNames(snomed.display_names);
  const code = await lookupCode(snomed.code, displayNames, valueSetSlug);
  if (!code) {
    return {
      code: null,
      error: `Could not find a ${label} matching "${formatDisplayNames(displayNames)}". Please enter manually.`,
    };
  }
  return { code };
}

export async function deserializeSymptoms(
  data: unknown,
  currentData: unknown[] | null | undefined,
  onsetOptions?: OnsetResolveOptions,
): Promise<DeserializeResult<unknown[]>> {
  if (!Array.isArray(data)) return { data: currentData ?? [], errors: [] };

  const errors: string[] = [];
  const current = (currentData ?? []) as Array<{ code: Code }>;
  const currentCodes = new Set(current.map((s) => s.code.code));
  const parsed = await Promise.all(
    data.map(async (item) => {
      try {
        const row = item as Record<string, unknown>;
        const snomed = normalizeSnomedInfo(row);
        if (!snomed) return undefined;

        const { code, error } = await resolveFindingCode(
          snomed,
          "system-condition-code",
          "symptom",
        );
        if (error) errors.push(error);
        if (!code) return undefined;

        const displayNames = normalizeDisplayNames(snomed.display_names);
        const onsetDatetime = resolveOnsetDatetime(row, {
          ...onsetOptions,
          findingNames: displayNames,
        });
        return {
          code,
          clinical_status: (row.clinical_status as string) || "active",
          verification_status:
            (row.verification_status as string) || "confirmed",
          severity: (row.severity as string) || "moderate",
          onset: {
            onset_datetime: onsetDatetime,
          },
          category: "problem_list_item",
          note: noNullStrings(row.note as string),
        };
      } catch (err) {
        errors.push(
          `Failed to parse symptom: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        return undefined;
      }
    }),
  );

  const merged = [
    ...current,
    ...dedupeByCode(parsed, currentCodes, (s) => s.code.code),
  ];

  return { data: merged, errors };
}

export async function deserializeDiagnosis(
  data: unknown,
  currentData: unknown[] | null | undefined,
  onsetOptions?: OnsetResolveOptions,
): Promise<DeserializeResult<unknown[]>> {
  if (!Array.isArray(data)) return { data: currentData ?? [], errors: [] };

  const errors: string[] = [];
  const current = (currentData ?? []) as Array<{ code: Code }>;
  const currentCodes = new Set(current.map((s) => s.code.code));
  const parsed = await Promise.all(
    data.map(async (item) => {
      try {
        const row = item as Record<string, unknown>;
        const snomed = normalizeSnomedInfo(row);
        if (!snomed) return undefined;

        const { code, error } = await resolveFindingCode(
          snomed,
          "system-condition-code",
          "diagnosis",
        );
        if (error) errors.push(error);
        if (!code) return undefined;

        const displayNames = normalizeDisplayNames(snomed.display_names);
        const onsetDatetime = resolveOnsetDatetime(row, {
          ...onsetOptions,
          findingNames: displayNames,
        });
        return {
          code,
          clinical_status: (row.clinical_status as string) || "active",
          verification_status:
            (row.verification_status as string) || "confirmed",
          severity: (row.severity as string) || null,
          onset: {
            onset_datetime: onsetDatetime,
          },
          recorded_date: new Date().toISOString(),
          note: noNullStrings(row.note as string),
          category: "encounter_diagnosis",
          dirty: true,
        };
      } catch (err) {
        errors.push(
          `Failed to parse diagnosis: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        return undefined;
      }
    }),
  );

  const merged = [
    ...current,
    ...dedupeByCode(parsed, currentCodes, (s) => s.code.code),
  ];

  return { data: merged, errors };
}

export async function deserializeAllergies(
  data: unknown,
  currentData: unknown[] | null | undefined,
): Promise<DeserializeResult<unknown[]>> {
  if (!Array.isArray(data)) return { data: currentData ?? [], errors: [] };

  const errors: string[] = [];
  const current = (currentData ?? []) as Array<{ code: Code }>;
  const currentCodes = new Set(current.map((s) => s.code.code));
  const parsed = await Promise.all(
    data.map(async (item) => {
      try {
        const row = item as Record<string, unknown>;
        const snomed = normalizeSnomedInfo(row);
        if (!snomed) return undefined;

        const displayNames = normalizeDisplayNames(snomed.display_names);
        const cleanedNames = displayNames.map((d) =>
          d.replace(/^allergy to\s*/i, "").replace(/\s*allergy$/i, ""),
        );

        const code = await lookupCode(
          snomed.code,
          cleanedNames,
          "system-allergy-code",
        );
        if (!code) {
          errors.push(
            `Could not find an allergy matching "${formatDisplayNames(displayNames)}". Please enter manually.`,
          );
          return undefined;
        }

        const lastOccurrence = resolveLastOccurrence(row);
        if (!lastOccurrence) {
          errors.push(
            `Last occurrence date not filled. Please enter manually if known.`,
          );
        }

        return {
          code,
          clinical_status: (row.clinical_status as string) || "active",
          category: (row.category as string) || "environment",
          criticality: normalizeCriticality(row.criticality),
          verification_status:
            (row.verification_status as string) || "confirmed",
          last_occurrence: lastOccurrence,
          note: noNullStrings(row.note as string),
        };
      } catch (err) {
        errors.push(
          `Failed to parse allergy: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        return undefined;
      }
    }),
  );

  const merged = [
    ...current,
    ...dedupeByCode(parsed, currentCodes, (s) => s.code.code),
  ];

  return { data: merged, errors };
}

export async function deserializeMedicationStatements(
  data: unknown,
  currentData: unknown[] | null | undefined,
): Promise<DeserializeResult<unknown[]>> {
  if (!Array.isArray(data)) return { data: currentData ?? [], errors: [] };

  const errors: string[] = [];
  const current = (currentData ?? []) as Array<{ medication: Code }>;
  const currentCodes = new Set(current.map((s) => s.medication.code));
  const parsed = await Promise.all(
    data.map(async (item) => {
      try {
        const row = item as Record<string, unknown>;
        const medicationRaw = row.medication ?? row.snomed_info;
        const medication =
          medicationRaw && typeof medicationRaw === "object"
            ? normalizeSnomedInfo({ snomed_info: medicationRaw })
            : normalizeSnomedInfo(row);
        if (!medication) return undefined;

        const displayNames = normalizeDisplayNames(medication.display_names);
        const code = await lookupCode(
          medication.code,
          displayNames,
          "system-medication",
        );
        if (!code) {
          errors.push(
            `Could not find a medication matching "${formatDisplayNames(displayNames)}". Please enter manually.`,
          );
          return undefined;
        }

        const takeFrom = validateTime(row.take_from as string);
        const takeUntil = validateTime(row.take_until as string);

        return {
          medication: code,
          status: "active",
          dosage_text: (row.dosage_instructions as string) || undefined,
          information_source: (row.information_source as string) || "patient",
          note: noNullStrings(row.note as string),
          reason: (row.reason as string) || undefined,
          effective_period: takeFrom
            ? {
                start: shiftUTCToLocalClockTime(takeFrom),
                end: takeUntil
                  ? shiftUTCToLocalClockTime(takeUntil)
                  : undefined,
              }
            : undefined,
        };
      } catch (err) {
        errors.push(
          `Failed to parse medication: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        return undefined;
      }
    }),
  );

  const merged = [
    ...current,
    ...dedupeByCode(parsed, currentCodes, (s) => s.medication.code),
  ];

  return { data: merged, errors };
}

export function deserializeTimeOfDeath(
  data: unknown,
  currentData: unknown[] | null | undefined,
): DeserializeResult<unknown[]> {
  if (!Array.isArray(data) || !data.length) {
    return { data: currentData ?? [], errors: [] };
  }

  const first = data[0];
  const candidate =
    typeof first === "string"
      ? first
      : ((first as Record<string, unknown>)?.deceased_datetime as
          | string
          | undefined);

  const local = candidate?.trim().replace(/Z$|[+-]\d{2}:?\d{2}$/i, "");
  const validated = validateTime(local);
  if (!validated) {
    return {
      data: currentData ?? [],
      errors: [`Could not parse a valid time of death. Please enter manually.`],
    };
  }

  if (validated > new Date().toISOString()) {
    return {
      data: currentData ?? [],
      errors: ["Time of death cannot be in the future. Please enter manually."],
    };
  }

  return { data: [validated], errors: [] };
}
