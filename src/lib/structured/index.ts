import type { CareUserMinimal } from "./care-api";
import {
  deserializeAllergies,
  deserializeDiagnosis,
  deserializeMedicationStatements,
  deserializeSymptoms,
  deserializeTimeOfDeath,
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

      dosage_additional_instruction: {
        code: "",
        display_names: ["Take with food"],
      },
      dosage_as_needed_for: null,
      dosage_route: { code: "", display_names: ["Oral"] },
      dosage_site: null,
      dosage_method: null,
      authored_on: null,
      note: null,
    },
    {
      // Time-of-day frequency: "one in the morning and one at noon" is a
      // single prescription with the morning-noon-night pattern 1-1-0 — not
      // two rows, and not a plain BID (1-0-1).
      medicine: {
        code: "",
        display_names: ["Pantoprazole 40mg", "Pantoprazole 40 mg oral tablet"],
      },
      intent: "order",
      category: "outpatient",
      priority: "routine",
      dosage_frequency: "1-1-0",
      dosage_duration: { value: 7, unit: "d" },
      dosage_dose_and_rate: {
        type: "ordered",
        dose_quantity: { value: 1, unit: "Tablet" },
      },
      dosage_additional_instruction: null,
      dosage_as_needed_for: { code: "", display_names: ["Nausea"] },
      dosage_route: { code: "", display_names: ["Oral"] },
      dosage_site: null,
      dosage_method: null,
      authored_on: null,
      note: null,
    },
    {
      // Route/site/method example: "Give ceftriaxone 1 gram IM into the
      // left gluteal region, once daily for 5 days".
      medicine: {
        code: "",
        display_names: ["Ceftriaxone 1g injection"],
      },
      intent: "order",
      category: "inpatient",
      priority: "routine",
      dosage_frequency: "QD",
      dosage_duration: { value: 5, unit: "d" },
      dosage_dose_and_rate: {
        type: "ordered",
        dose_quantity: { value: 1, unit: "g" },
      },
      dosage_additional_instruction: null,
      dosage_as_needed_for: null,
      dosage_route: { code: "", display_names: ["Intramuscular"] },
      dosage_site: { code: "", display_names: ["Gluteal region"] },
      dosage_method: { code: "", display_names: ["Injection"] },
      authored_on: null,
      note: null,
    },
    {
      // Taper/step regimen example: "1 tablet daily for 2 weeks, then 2
      // tablets daily for 4 weeks" — use dosage_phases instead of the flat
      // dosage_frequency/dosage_duration/dosage_dose_and_rate fields.
      medicine: {
        code: "",
        display_names: ["Dolo 650", "Paracetamol 650 mg oral tablet"],
      },
      intent: "order",
      category: "outpatient",
      priority: "routine",
      dosage_phases: [
        {
          dosage_frequency: "QD",
          dosage_duration: { value: 2, unit: "wk" },
          dosage_dose_and_rate: {
            type: "ordered",
            dose_quantity: { value: 1, unit: "Tablet" },
          },
        },
        {
          dosage_frequency: "QD",
          dosage_duration: { value: 4, unit: "wk" },
          dosage_dose_and_rate: {
            type: "ordered",
            dose_quantity: { value: 2, unit: "Tablet" },
          },
        },
      ],
      dosage_additional_instruction: null,
      dosage_as_needed_for: null,
      dosage_route: null,
      dosage_site: null,
      dosage_method: null,
      authored_on: null,
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
      body_site: null,
      patient_instruction: null,
      note: null,
    },
    {
      activity_definition: {
        title: "Complete Blood Count",
        display_names: ["CBC", "Complete Blood Count"],
      },
      intent: "order",
      priority: "asap",
      body_site: null,
      patient_instruction:
        "Fast (no food or drink) for 12 hours before the test",
      note: null,
    },
  ],
  time_of_death: "2026-08-18T15:45:00.000Z",
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
    "array of NEW prescriptions; ONLY include a medicine if the clinician explicitly said they are prescribing/starting it by name — never invent, infer, suggest, or auto-prescribe a medication that was not explicitly stated, even if it would be a routine/likely choice for the diagnosis; if no medication was explicitly prescribed, return an empty array []; medicine.display_names must include brand + strength (e.g. Dolo 650, Pantoprazole 40mg); always include dosage_frequency (QD, BID, 1-0-1, etc.) and dosage_duration when stated — keep the specific time of day when spoken (see the examples: 'morning and noon' → 1-1-0, 'every morning' → 1-0-0), and use one entry per medicine, never a separate row per time of day; for a taper/step regimen where the dose or frequency explicitly changes partway through (e.g. '1 tablet daily for 2 weeks, then 2 tablets daily for 4 weeks'), use dosage_phases (an array of {dosage_frequency, dosage_duration, dosage_dose_and_rate}) instead of the flat fields — one entry per phase, in the order stated; omit dosage_phases entirely for an ordinary single-phase prescription. ALWAYS include these six keys on every item, set to null when not mentioned — never just drop the key: dosage_additional_instruction ({code: '', display_names: [...]}) — capture this whenever the clinician gives an instruction like 'take with food', 'avoid alcohol', 'on an empty stomach', it's easy to miss but very common, do not leave it null when one was said; dosage_as_needed_for ({code: '', display_names: [...]}) for a PRN reason like 'as needed for pain'; dosage_route ({code: '', display_names: [...]}) e.g. oral/IV/IM/topical, whenever the route is stated (even just 'by mouth' or 'IM'); dosage_site ({code: '', display_names: [...]}) body site, e.g. for injections ('into the left arm', 'gluteal region'); dosage_method ({code: '', display_names: [...]}) e.g. swallow/inject/apply/inhale; authored_on (ISO datetime, only if the clinician gave an explicit prescribing date/time, e.g. 'starting Monday' — never fabricate, null defaults to now)",
  service_request:
    "array of investigations/lab tests/imaging ordered; each needs activity_definition with title or display_names (e.g. Lipid Panel, CBC, Chest X-Ray); put catalog items here; put anything NOT in the facility catalog under the separate 'Other Investigation' field key or in the free-text note; priority is exactly one of routine | urgent | asap | stat — 'as soon as possible'/'ASAP' maps to asap (NOT urgent), 'urgent' is for urgent-but-not-immediate, 'stat' is for immediate/emergency, default routine when unstated; patient_instruction is any instruction spoken TO THE PATIENT about that specific test (fasting/food restriction, hydration, stopping a medication beforehand, etc.) — capture it whenever mentioned, even briefly, it is a very common field, do not leave it null when the clinician gives such an instruction; body_site is only for a test/imaging targeting a specific anatomical location (e.g. chest X-ray, knee MRI), as snomed_info { code, display_names }, omit if not mentioned",
  time_of_death:
    "the exact date/time the clinician pronounced death, as a plain ISO datetime string (e.g. '2026-05-02T02:00:00'); only include if a death pronouncement was explicitly stated (e.g. 'died around 2 AM', 'time of death 14:20', 'died/dead on 24 may 2025'); leave this out entirely otherwise — never infer or guess a time",
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
    case "time_of_death":
      return deserializeTimeOfDeath(raw, current as unknown[] | null);
    default:
      return { data: current, errors: [] };
  }
}
