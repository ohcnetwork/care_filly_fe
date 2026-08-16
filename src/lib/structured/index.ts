import type { CareUserMinimal } from "./care-api";
import {
  deserializeAllergies,
  deserializeDiagnosis,
  deserializeMedicationStatements,
  deserializeSymptoms,
} from "./deserializers";
import { deserializeMedicationRequests } from "./medication-request";
import { deserializeServiceRequests } from "./service-request";
import type { SupportedStructuredType } from "./types";

export interface StructuredFillContext {
  currentUser?: CareUserMinimal | null;
  facilityId?: string | null;
  encounterId?: string | null;
  complaintText?: string;
}

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
