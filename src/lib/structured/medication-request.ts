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

interface MedicationRequestRow {
  medicine?: unknown;
  medication?: unknown;
  intent?: string | null;
  category?: string | null;
  priority?: string | null;
  authored_on?: string | null;
  dosage_instructions?: unknown;
  dosage_duration?: { value?: number; unit?: string } | null;
  dosage_frequency?: string | null;
  dosage_as_needed_for?: unknown;
  dosage_site?: unknown;
  dosage_route?: unknown;
  dosage_method?: unknown;
  dosage_dose_and_rate?: {
    type?: "ordered" | "calculated";
    dose_quantity?: { value?: number | string; unit?: string };
    dose_range?: {
      low?: { value?: number | string; unit?: string };
      high?: { value?: number | string; unit?: string };
    };
  } | null;
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
  // Strip sequence markers ("phase 2 of 3", "step 1") before scanning for a
  // dose: they are positional metadata, not a quantity, and the leading digit
  // would otherwise be read as the dose of a tapering phase.
  const combined = `${instructionText} ${noteText}`
    .replace(/\b(?:phase|step|stage)\s*(?:no\.?\s*)?\d+(?:\s*of\s*\d+)?/gi, " ")
    .trim();
  const match = combined.match(
    /\b(\d+(?:\.\d+)?)\s*(?:tablet|tablets|capsule|capsules|drop|drops|ml|count)?\b/i,
  );
  if (match) return match[1];

  return "1";
}

/**
 * `findDosageUnit` never returns null — it falls back to
 * `DOSAGE_UNITS_CODES[0]` ("tablets") for empty input — so a missing unit must
 * be routed to the form-inferred default explicitly rather than via `??`.
 */
function resolveUnit(raw: string | undefined, inferred: Code): Code {
  return raw?.trim() ? findDosageUnit(raw) : inferred;
}

function buildDoseAndRate(
  row: MedicationRequestRow,
  options: {
    defaultUnit?: Code;
    displayNames: string[];
    product?: ProductKnowledgeBase;
  },
) {
  const unit =
    options.defaultUnit ??
    inferDefaultDosageUnit(options.displayNames, options.product);
  const raw = row.dosage_dose_and_rate;

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
          unit: resolveUnit(raw.dose_range.low?.unit, unit),
        },
        high: {
          value: String(raw.dose_range.high?.value ?? "1"),
          unit: resolveUnit(raw.dose_range.high?.unit, unit),
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
      unit: resolveUnit(quantity.unit, unit),
    },
  };
}

interface DosagePhase {
  text?: string;
  timing?: {
    code?: Code;
    repeat?: {
      bounds_duration?: { value: string; unit: string };
    };
  };
  as_needed_boolean?: boolean;
  dose_and_rate?: unknown;
}

/**
 * Identity of a single dosage phase: two rows that produce the same signature
 * describe the same regimen, so the second is a restatement rather than a new
 * step of a taper. A duration that was never stated (`durationDefaulted`) is
 * excluded so an invented default cannot make two identical rows look distinct.
 */
function dosagePhaseSignature(
  phase: DosagePhase | undefined,
  durationDefaulted: boolean,
): string {
  return JSON.stringify([
    phase?.timing?.code?.code ?? null,
    phase?.text ?? null,
    durationDefaulted ? null : (phase?.timing?.repeat?.bounds_duration ?? null),
    !!phase?.as_needed_boolean,
    phase?.dose_and_rate ?? null,
  ]);
}

/** Blank an invented course length ("0" reads as "no bound set" in CARE). */
function withoutInventedDuration<T extends DosagePhase>(phase: T): T {
  if (!phase.timing?.repeat?.bounds_duration) return phase;
  return {
    ...phase,
    timing: {
      ...phase.timing,
      repeat: {
        ...phase.timing.repeat,
        bounds_duration: { ...phase.timing.repeat.bounds_duration, value: "0" },
      },
    },
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

        const frequency = resolveDosageFrequency(row.dosage_frequency);
        const instructionText =
          typeof row.dosage_instructions === "string"
            ? row.dosage_instructions
            : null;
        const duration = parseDosageDuration(
          row.dosage_duration,
          instructionText ?? row.note,
        );

        const names = normalizeDisplayNames(
          normalizeCodeField(row.medicine ?? row.medication)?.display_names ??
            (resolved.medication ? [resolved.medication.display] : []),
        );

        const dosageInstruction = {
          additional_instruction: additionalInstruction
            ? [additionalInstruction]
            : [],
          text: frequency.text,
          timing: !asNeededFor
            ? {
                ...frequency.timingOption.timing,
                repeat: {
                  ...frequency.timingOption.timing.repeat,
                  bounds_duration: {
                    value: String(duration.value),
                    unit: duration.unit,
                  },
                },
              }
            : undefined,
          as_needed_boolean: !!asNeededFor,
          as_needed_for: asNeededFor,
          site,
          route,
          method,
          dose_and_rate: buildDoseAndRate(row, {
            defaultUnit: resolved.defaultUnit,
            displayNames: names,
            product: resolved.requested_product_internal,
          }),
        };

        return {
          dedupeKey,
          durationDefaulted: duration.defaulted === true,
          entry: {
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
            dosage_instruction: [dosageInstruction],
          },
        };
      } catch (err) {
        console.error("Error deserializing medication request row:", err);
        return undefined;
      }
    }),
  );

  // Merge (rather than drop) additional rows for a medicine already added in
  // this same batch: a clinician describing a tapering/stepped dose (e.g.
  // "2 sprays daily for 2 weeks, then 1 spray daily for 4 weeks") produces
  // multiple array rows for the same medicine, one per phase. FHIR models
  // this as multiple `dosage_instruction` entries on a single
  // MedicationRequest, so phases are appended to one entry instead of being
  // deduped away or turned into duplicate MedicationRequest entries.
  // A medicine already present from a previous fill pass (`currentKeys`) is
  // still skipped, preserving the existing cross-call dedup behavior.
  type ParsedEntry = NonNullable<(typeof parsed)[number]>["entry"];
  const newEntries: ParsedEntry[] = [];
  const dedupeKeyToIndex = new Map<string, number>();
  const phaseSignatures = new Map<number, Set<string>>();

  for (const parsedItem of parsed) {
    if (!parsedItem) continue;
    const { dedupeKey, durationDefaulted, entry } = parsedItem;

    if (dedupeKey && currentKeys.has(dedupeKey)) continue;

    const [phase] = entry.dosage_instruction;
    const signature = dosagePhaseSignature(phase, durationDefaulted);

    const existingIndex = dedupeKey
      ? dedupeKeyToIndex.get(dedupeKey)
      : undefined;
    if (dedupeKey && existingIndex != null) {
      const signatures = phaseSignatures.get(existingIndex);
      // A restated row (clinician repeating the same drug/dose/frequency) is
      // not a new taper phase — appending it would read as a second course of
      // the same regimen. Drop it, matching the pre-merge dedup behaviour.
      if (signatures?.has(signature)) continue;
      signatures?.add(signature);

      const existing = newEntries[existingIndex];
      // A duration nobody stated must not ride along on a follow-up phase: it
      // silently extends the total course length. "0" is how CARE core encodes
      // "no bound set" (getTimingBounds skips it), so the field renders empty
      // for the clinician to fill instead of showing an invented one.
      existing.dosage_instruction.push(
        durationDefaulted ? withoutInventedDuration(phase) : phase,
      );
      if (entry.note && !existing.note?.includes(entry.note)) {
        existing.note = existing.note
          ? `${existing.note}\n${entry.note}`
          : entry.note;
      }
      continue;
    }

    if (dedupeKey) dedupeKeyToIndex.set(dedupeKey, newEntries.length);
    phaseSignatures.set(newEntries.length, new Set([signature]));
    newEntries.push(entry);
  }

  const merged = [...current, ...newEntries];

  return { data: merged, errors };
}
