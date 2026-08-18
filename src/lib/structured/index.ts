import type { CareUserMinimal } from "./care-api";
import {
  deserializeAllergies,
  deserializeDiagnosis,
  deserializeMedicationStatements,
  deserializeSymptoms,
} from "./deserializers";
import { deserializeMedicationRequests } from "./medication-request";
import { deserializeServiceRequests } from "./service-request";
import { formatDateQueryString } from "./time";
import type { SupportedStructuredType } from "./types";

export interface StructuredFillContext {
  currentUser?: CareUserMinimal | null;
  facilityId?: string | null;
  encounterId?: string | null;
  complaintText?: string;
}

function onsetExampleDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return formatDateQueryString(date);
}

const SNOMED_INFO_EXAMPLE = {
  code: "386661006",
  display_names: ["Fever", "Fever (finding)"],
};

export const STRUCTURED_TEMPLATE_EXAMPLES: Record<
  SupportedStructuredType,
  unknown
> = {
  symptom: [
    {
      snomed_info: SNOMED_INFO_EXAMPLE,
      clinical_status: "active",
      verification_status: "confirmed",
      severity: "moderate",
      onset_datetime: onsetExampleDate(14),
      note: "for the past two weeks",
    },
  ],
  diagnosis: [
    {
      snomed_info: SNOMED_INFO_EXAMPLE,
      clinical_status: "active",
      verification_status: "confirmed",
      severity: "moderate",
      onset_datetime: onsetExampleDate(14),
      note: "for the past two weeks",
    },
  ],
  allergy_intolerance: [
    {
      snomed_info: {
        code: "418085001",
        display_names: ["citrus fruit", "bitter orange"],
      },
      clinical_status: "active",
      category: "food",
      criticality: "low",
      verification_status: "confirmed",
      last_occurrence: null,
      note: null,
    },
  ],
  medication_statement: [
    {
      medication: {
        code: "376771007",
        display_names: ["Zinc 25 mg oral capsule"],
      },
      dosage_instructions: "Take 1 tablet daily",
      information_source: "patient",
      take_from: null,
      take_until: null,
      reason: null,
      note: null,
    },
  ],
  medication_request: [
    {
      medicine: {
        code: "",
        display_names: ["Dolo 650", "Paracetamol 650 mg oral tablet"],
      },
      intent: "order",
      category: "outpatient",
      priority: "routine",
      dosage_frequency: "QD",
      dosage_duration: { value: 5, unit: "d" },
      dosage_dose_and_rate: {
        type: "ordered",
        dose_quantity: { value: 1, unit: "Tablet" },
      },
      note: null,
    },
    {
      medicine: {
        code: "",
        display_names: ["Pantoprazole 40mg", "Pantoprazole 40 mg oral tablet"],
      },
      intent: "order",
      category: "outpatient",
      priority: "routine",
      dosage_frequency: "1-0-0",
      dosage_duration: { value: 7, unit: "d" },
      dosage_dose_and_rate: {
        type: "ordered",
        dose_quantity: { value: 1, unit: "Tablet" },
      },
      note: null,
    },
    // "Start azithromycin 500, one tablet." — no frequency and no duration
    // were spoken, so both stay null instead of being copied from the rows
    // above. Keep this exemplar: without it the model tends to emit a
    // plausible-looking "QD"/5-day course that the clinician never said.
    {
      medicine: {
        code: "",
        display_names: ["Azithromycin 500", "Azithromycin 500 mg oral tablet"],
      },
      intent: "order",
      category: "outpatient",
      priority: "routine",
      dosage_frequency: null,
      dosage_duration: null,
      dosage_dose_and_rate: {
        type: "ordered",
        dose_quantity: { value: 1, unit: "Tablet" },
      },
      note: null,
    },
  ],
  service_request: [
    {
      activity_definition: {
        title: "Lipid Panel",
        display_names: ["Lipid Panel", "lipid profile"],
      },
      intent: "order",
      priority: "routine",
      note: null,
    },
    {
      activity_definition: {
        title: "Complete Blood Count",
        display_names: ["CBC", "Complete Blood Count"],
      },
      intent: "order",
      priority: "routine",
      note: null,
    },
  ],
};

export const STRUCTURED_TEMPLATE_DESCRIPTIONS: Record<
  SupportedStructuredType,
  string
> = {
  symptom:
    "array of symptoms; snomed_info required; onset_datetime as date only YYYY-MM-DD (if patient says '2 weeks ago', subtract from today; if no onset timing is mentioned at all, use today's date — the date of examination — do NOT guess or fabricate a date)",
  diagnosis:
    "array of diagnoses; snomed_info required; onset_datetime as date only YYYY-MM-DD (compute from relative phrases like '3 days ago'; if no onset timing is mentioned at all, use today's date — the date of examination — do NOT guess or fabricate a date)",
  allergy_intolerance:
    "array of allergies/intolerances; snomed_info from substance hierarchy",
  medication_statement:
    "array of medications the patient is currently taking (not new prescriptions)",
  medication_request:
    "array of NEW prescriptions; ONLY include a medicine if the clinician explicitly said they are prescribing/starting it by name — never invent, infer, suggest, or auto-prescribe a medication that was not explicitly stated, even if it would be a routine/likely choice for the diagnosis; if no medication was explicitly prescribed, return an empty array []; medicine.display_names must include brand + strength (e.g. Dolo 650, Pantoprazole 40mg); include dosage_frequency (QD, BID, 1-0-1, etc.) ONLY if the clinician explicitly said how often to take the medicine, and dosage_duration ONLY if they explicitly said for how long — if either was not spoken, set that field to null; never guess, infer or default a frequency or a duration, and never copy one from the examples",
  service_request:
    "array of investigations/lab tests/imaging ordered; each needs activity_definition with title or display_names (e.g. Lipid Panel, CBC, Chest X-Ray); put catalog items here; put anything NOT in the facility catalog under the separate 'Other Investigation' field key or in the free-text note",
};

export async function deserializeStructuredData(
  structuredType: SupportedStructuredType,
  raw: unknown,
  current: unknown,
  context?: StructuredFillContext,
): Promise<{ data: unknown; errors: string[]; supplementalNote?: string }> {
  const onsetOptions = context?.complaintText
    ? { complaintText: context.complaintText }
    : undefined;

  switch (structuredType) {
    case "symptom":
      return deserializeSymptoms(
        raw,
        current as unknown[] | null,
        onsetOptions,
      );
    case "diagnosis":
      return deserializeDiagnosis(
        raw,
        current as unknown[] | null,
        onsetOptions,
      );
    case "allergy_intolerance":
      return deserializeAllergies(raw, current as unknown[] | null);
    case "medication_statement":
      return deserializeMedicationStatements(raw, current as unknown[] | null);
    case "medication_request":
      return deserializeMedicationRequests(
        raw,
        current as unknown[] | null,
        context,
      );
    case "service_request": {
      const result = await deserializeServiceRequests(
        raw,
        current as unknown[] | null,
        context,
      );
      return {
        data: result.data,
        errors: result.errors,
        supplementalNote: result.supplementalNote,
      };
    }
    default:
      return { data: current, errors: [] };
  }
}
