import {
  getStructuredFieldDescription,
  getStructuredFieldExample,
} from "@/lib/structured/fill";
import {
  type SupportedStructuredType,
  isSupportedStructuredType,
} from "@/lib/structured/types";

interface FormQuestion {
  id: string;
  text: string;
  type: string;
  structured_type?: string;
  questions?: FormQuestion[];
  answer_option?: Array<{ value: string; display?: string }>;
  max_length?: number;
}

export interface FormField {
  id: string;
  label: string;
  type: string;
  structuredType?: SupportedStructuredType;
  options?: string[];
}

/**
 * Extract all fillable fields from a CARE questionnaire,
 * flattening nested groups.
 */
export function extractFormFields(formState: unknown): FormField[] {
  if (!Array.isArray(formState)) return [];

  const fields: FormField[] = [];

  for (const group of formState) {
    const questionnaire = (group as Record<string, unknown>)?.questionnaire as
      | Record<string, unknown>
      | undefined;
    const questions = questionnaire?.questions;
    if (!Array.isArray(questions)) continue;

    collectFields(questions as FormQuestion[], fields);
  }

  return fields;
}

function collectFields(questions: FormQuestion[], out: FormField[]) {
  for (const q of questions) {
    // Skip groups — recurse into their children
    if (q.type === "group") {
      if (q.questions) collectFields(q.questions, out);
      continue;
    }

    if (
      q.type === "structured" &&
      isSupportedStructuredType(q.structured_type)
    ) {
      out.push({
        id: q.id,
        label: q.text,
        type: q.type,
        structuredType: q.structured_type,
      });
      continue;
    }

    if ((q as Record<string, unknown>).structured_type) {
      continue;
    }

    // Skip date fields — speech extraction doesn't reliably produce valid dates
    if (q.type === "date" || q.type === "dateTime") {
      continue;
    }

    const field: FormField = {
      id: q.id,
      label: q.text,
      type: q.type,
    };

    if (q.answer_option?.length) {
      field.options = q.answer_option.map((o) => o.display || String(o.value));
    }

    out.push(field);
  }
}

/** A Medispeak `outputs: [{type: "form", fields}]` field definition. */
export interface MedispeakFieldSpec {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "single_select" | "multi_select";
  enum?: string[];
  description?: string;
}

/**
 * Build Medispeak's typed field schema from CARE form fields.
 *
 * `key` is the field's LABEL, not its CARE question id: `structured/fill.ts`
 * matches extracted data back onto questions by fuzzy-matching question text
 * against these keys (`findMatchingLabel`), the same way the legacy
 * LLM-prompt pipeline's JSON keys work. An id-keyed result would never match.
 */
export function buildFieldSpecs(fields: FormField[]): MedispeakFieldSpec[] {
  const specs: MedispeakFieldSpec[] = [];
  for (const f of fields) {
    if (f.structuredType) {
      const description = `${getStructuredFieldDescription(f.structuredType, f.label)}; example: ${JSON.stringify(getStructuredFieldExample(f.structuredType))}`;
      specs.push({ key: f.label, label: f.label, type: "string", description });
      continue;
    }
    if (f.type === "boolean") {
      specs.push({ key: f.label, label: f.label, type: "boolean" });
    } else if (f.type === "decimal" || f.type === "integer") {
      specs.push({ key: f.label, label: f.label, type: "number" });
    } else if (f.type === "choice" && f.options?.length) {
      specs.push({
        key: f.label,
        label: f.label,
        type: "single_select",
        enum: f.options,
      });
    } else {
      specs.push({ key: f.label, label: f.label, type: "string" });
    }
  }
  return specs;
}
