import {
  type CareUserMinimal,
  type ProductKnowledgeBase,
  getCurrentUser,
  getFacilityIdFromUrl,
  searchProductKnowledge,
} from "./care-api";
import { normalizeDisplayNames, normalizeSnomedInfo } from "./deserializers";
import {
  MEDICATION_CATEGORIES,
  MEDICATION_PRIORITIES,
  MEDICATION_REQUEST_INTENT,
  findDosageUnit,
  inferDefaultDosageUnit,
  parseDosageDuration,
  resolveDosageFrequency,
  validateEnum,
} from "./medication-constants";
import { noNullStrings, shiftUTCToLocalClockTime, validateTime } from "./time";
import type { Code } from "./types";
import { lookupCode } from "./valueset";

interface DeserializeResult<T> {
  data: T;
  errors: string[];
}

interface DosagePhase {
  dosage_duration?: { value?: number; unit?: string } | null;
  dosage_frequency?: string | null;
  dosage_dose_and_rate?: {
    type?: "ordered" | "calculated";
    dose_quantity?: { value?: number | string; unit?: string };
    dose_range?: {
      low?: { value?: number | string; unit?: string };
      high?: { value?: number | string; unit?: string };
    };
  } | null;
}

interface MedicationRequestRow extends DosagePhase {
  medicine?: unknown;
  medication?: unknown;
  intent?: string | null;
  category?: string | null;
  priority?: string | null;
  authored_on?: string | null;
  dosage_instructions?: unknown;
  dosage_as_needed_for?: unknown;
  dosage_site?: unknown;
  dosage_route?: unknown;
  dosage_method?: unknown;
  dosage_phases?: DosagePhase[] | null;
  note?: string | null;
}

function normalizeCodeField(
  raw: unknown,
): { code: string; display_names: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const code = obj.code != null ? String(obj.code) : "";
  const displayNames = normalizeDisplayNames(
    obj.display_names ?? obj.display ?? obj.name,
  );
  if (!code && !displayNames.length) return null;
  return { code, display_names: displayNames };
}

async function resolveOptionalCode(
  raw: unknown,
  valueSetSlug: string,
): Promise<Code | undefined> {
  const info = normalizeCodeField(raw);
  if (!info) return undefined;
  const code = await lookupCode(info.code, info.display_names, valueSetSlug);
  return code ?? undefined;
}

async function resolveMedicine(
  row: MedicationRequestRow,
  facilityId: string | null,
): Promise<{
  medication?: Code;
  requested_product?: string;
  requested_product_internal?: ProductKnowledgeBase;
  defaultUnit?: Code;
} | null> {
  const medicineRaw = row.medicine ?? row.medication ?? row;
  const medicine =
    normalizeSnomedInfo({ snomed_info: medicineRaw }) ??
    (normalizeCodeField(medicineRaw)
      ? {
          code: normalizeCodeField(medicineRaw)!.code,
          display_names: normalizeCodeField(medicineRaw)!.display_names,
        }
      : null);

  if (!medicine) return null;

  const names = normalizeDisplayNames(medicine.display_names);

  if (facilityId && names.length) {
    const product = await searchProductKnowledge(names, facilityId);
    if (product) {
      return {
        requested_product: product.id,
        requested_product_internal: product,
        defaultUnit: product.base_unit,
      };
    }
  }

  const code = await lookupCode(medicine.code, names, "system-medication");
  if (!code) return null;
  return { medication: code };
}

function parseDoseValue(
  row: MedicationRequestRow,
  raw?: MedicationRequestRow["dosage_dose_and_rate"],
): string {
  const fromQuantity = raw?.dose_quantity?.value;
  if (fromQuantity != null && String(fromQuantity).trim() !== "") {
    return String(fromQuantity);
  }

  const instructionText =
    typeof row.dosage_instructions === "string" ? row.dosage_instructions : "";
  const noteText = typeof row.note === "string" ? row.note : "";
  const combined = `${instructionText} ${noteText}`.trim();
  const match = combined.match(
    /\b(\d+(?:\.\d+)?)\s*(?:tablet|tablets|capsule|capsules|drop|drops|ml|count)?\b/i,
  );
  if (match) return match[1];

  return "1";
}

function buildDoseAndRate(
  row: MedicationRequestRow,
  phase: DosagePhase,
  options: {
    defaultUnit?: Code;
    displayNames: string[];
    product?: ProductKnowledgeBase;
  },
) {
  const unit =
    options.defaultUnit ??
    inferDefaultDosageUnit(options.displayNames, options.product);
  const raw = phase.dosage_dose_and_rate;

  if (!raw) {
    return {
      type: "ordered" as const,
      dose_quantity: { value: parseDoseValue(row), unit },
    };
  }

  if (raw.type === "calculated" && raw.dose_range) {
    return {
      type: "calculated" as const,
      dose_range: {
        low: {
          value: String(raw.dose_range.low?.value ?? "1"),
          unit: findDosageUnit(raw.dose_range.low?.unit) ?? unit,
        },
        high: {
          value: String(raw.dose_range.high?.value ?? "1"),
          unit: findDosageUnit(raw.dose_range.high?.unit) ?? unit,
        },
      },
    };
  }

  const quantity = raw.dose_quantity;
  if (!quantity) {
    return {
      type: "ordered" as const,
      dose_quantity: { value: parseDoseValue(row), unit },
    };
  }

  return {
    type: "ordered" as const,
    dose_quantity: {
      value: parseDoseValue(row, raw),
      unit: findDosageUnit(quantity.unit) ?? unit,
    },
  };
}

function buildDosageInstruction(
  row: MedicationRequestRow,
  phase: DosagePhase,
  shared: {
    additionalInstruction?: Code;
    asNeededFor?: Code;
    site?: Code;
    route?: Code;
    method?: Code;
    defaultUnit?: Code;
    displayNames: string[];
    product?: ProductKnowledgeBase;
  },
) {
  const frequency = resolveDosageFrequency(phase.dosage_frequency);
  const instructionText =
    typeof row.dosage_instructions === "string"
      ? row.dosage_instructions
      : null;
  const duration = parseDosageDuration(
    phase.dosage_duration,
    instructionText ?? row.note,
  );

  return {
    additional_instruction: shared.additionalInstruction
      ? [shared.additionalInstruction]
      : [],
    text: frequency.text,
    timing: !shared.asNeededFor
      ? {
          ...frequency.timingOption?.timing,
          repeat: {
            ...frequency.timingOption?.timing.repeat,
            bounds_duration: {
              value: String(duration.value),
              unit: duration.unit,
            },
          },
        }
      : undefined,
    as_needed_boolean: !!shared.asNeededFor,
    as_needed_for: shared.asNeededFor,
    site: shared.site,
    route: shared.route,
    method: shared.method,
    dose_and_rate: buildDoseAndRate(row, phase, {
      defaultUnit: shared.defaultUnit,
      displayNames: shared.displayNames,
      product: shared.product,
    }),
  };
}

export async function deserializeMedicationRequests(
  data: unknown,
  currentData: unknown[] | null | undefined,
  context?: {
    currentUser?: CareUserMinimal | null;
    facilityId?: string | null;
  },
): Promise<DeserializeResult<unknown[]>> {
  if (!Array.isArray(data)) return { data: currentData ?? [], errors: [] };

  const errors: string[] = [];
  const current = (currentData ?? []) as Array<{
    medication?: Code;
    requested_product?: string;
  }>;
  const currentKeys = new Set(
    current.map(
      (item) => item.medication?.code || item.requested_product || "",
    ),
  );

  const currentUser = context?.currentUser ?? (await getCurrentUser());
  const facilityId = context?.facilityId ?? getFacilityIdFromUrl();

  if (!currentUser) {
    errors.push("Could not resolve current user for medication prescriptions.");
    return { data: current, errors };
  }

  const seenKeys = new Set(currentKeys);

  const parsed = await Promise.all(
    data.map(async (item) => {
      try {
        const row = item as MedicationRequestRow;
        const resolved = await resolveMedicine(row, facilityId);
        if (!resolved) {
          const names = normalizeDisplayNames(
            normalizeCodeField(row.medicine ?? row.medication)?.display_names,
          );
          errors.push(
            `Could not find a prescribed medication matching "${names[0] ?? "unknown"}". Please enter manually.`,
          );
          return undefined;
        }

        const dedupeKey =
          resolved.medication?.code || resolved.requested_product || "";
        if (dedupeKey) {
          if (seenKeys.has(dedupeKey)) return undefined;
          seenKeys.add(dedupeKey);
        }

        const additionalInstruction = await resolveOptionalCode(
          row.dosage_instructions,
          "system-additional-instruction",
        );
        const asNeededFor = await resolveOptionalCode(
          row.dosage_as_needed_for,
          "system-as-needed-reason",
        );
        const site = await resolveOptionalCode(
          row.dosage_site,
          "system-body-site",
        );
        const route = await resolveOptionalCode(
          row.dosage_route,
          "system-route",
        );
        const method = await resolveOptionalCode(
          row.dosage_method,
          "system-administration-method",
        );

        const authoredOn = validateTime(row.authored_on)
          ? shiftUTCToLocalClockTime(row.authored_on as string)
          : new Date().toISOString();

        const names = normalizeDisplayNames(
          normalizeCodeField(row.medicine ?? row.medication)?.display_names ??
            (resolved.medication ? [resolved.medication.display] : []),
        );

        const phases = row.dosage_phases?.length ? row.dosage_phases : [row];
        const shared = {
          additionalInstruction,
          asNeededFor,
          site,
          route,
          method,
          defaultUnit: resolved.defaultUnit,
          displayNames: names,
          product: resolved.requested_product_internal,
        };
        const dosageInstructions = phases.map((phase) =>
          buildDosageInstruction(row, phase, shared),
        );

        return {
          status: "active",
          intent:
            validateEnum(row.intent, MEDICATION_REQUEST_INTENT, "order") ??
            "order",
          category:
            validateEnum(row.category, MEDICATION_CATEGORIES, "outpatient") ??
            "outpatient",
          priority:
            validateEnum(row.priority, MEDICATION_PRIORITIES, "routine") ??
            "routine",
          do_not_perform: false,
          ...(resolved.requested_product
            ? {}
            : { medication: resolved.medication }),
          requested_product: resolved.requested_product,
          requested_product_internal: resolved.requested_product_internal,
          authored_on: authoredOn,
          dirty: true,
          requester: currentUser,
          note: noNullStrings(row.note as string),
          dosage_instruction: dosageInstructions,
        };
      } catch (err) {
        console.error("Error deserializing medication request row:", err);
        return undefined;
      }
    }),
  );

  const merged = [
    ...current,
    ...parsed.filter((item): item is NonNullable<typeof item> => !!item),
  ];

  return { data: merged, errors };
}
