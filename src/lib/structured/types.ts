export interface Code {
  system: string;
  code: string;
  display: string;
}

export type SupportedStructuredType =
  | "symptom"
  | "diagnosis"
  | "allergy_intolerance"
  | "medication_statement"
  | "medication_request"
  | "service_request";

export const SUPPORTED_STRUCTURED_TYPES: SupportedStructuredType[] = [
  "symptom",
  "diagnosis",
  "allergy_intolerance",
  "medication_statement",
  "medication_request",
  "service_request",
];

export function isSupportedStructuredType(
  type: string | undefined | null,
): type is SupportedStructuredType {
  return (
    !!type &&
    SUPPORTED_STRUCTURED_TYPES.includes(type as SupportedStructuredType)
  );
}

export const BOOLEAN_NOT_MENTIONED = "not_mentioned";
