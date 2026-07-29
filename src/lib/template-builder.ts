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

interface FormField {
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

/**
 * Build a template description that instructs the filly backend to return
 * JSON with keys matching our form fields.
 */
export function buildTemplateDescription(fields: FormField[]): {
  title: string;
  desc: string;
  example: string;
} {
  const fieldDescriptions = fields.map((f) => {
    if (f.structuredType) {
      return getStructuredFieldDescription(f.structuredType, f.label);
    }

    let desc = `"${f.label}"`;
    if (f.type === "decimal" || f.type === "integer") {
      desc += " (numeric value only, no units)";
    } else if (f.type === "boolean") {
      desc += " (true or false)";
    } else if (f.type === "choice" && f.options?.length) {
      desc += ` (one of: ${f.options.join(", ")})`;
    } else if (f.type === "text" || f.type === "string") {
      desc += " (text)";
    }
    return `${desc}; optional "${f.label}_note" for any commentary about this field`;
  });

  const exampleObj: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.structuredType) {
      exampleObj[f.label] = getStructuredFieldExample(f.structuredType);
      continue;
    }

    if (f.type === "decimal") exampleObj[f.label] = 90;
    else if (f.type === "integer") exampleObj[f.label] = 5;
    else if (f.type === "boolean") exampleObj[f.label] = true;
    else if (f.type === "choice" && f.options?.length)
      exampleObj[f.label] = f.options[0];
    else exampleObj[f.label] = "relevant text from consultation";
    exampleObj[`${f.label}_note`] =
      "commentary if mentioned (e.g. normal, elevated)";
  }

  return {
    title: "CARE Form Auto-Fill",
    desc: [
      "Extract medical data from the consultation as a JSON object.",
      "Only include fields explicitly mentioned in the conversation.",
      "NEVER fabricate or assume values not stated.",
      "Always write all values in ENGLISH, translating from any other spoken language. Keep drug brand names, proper nouns, and medical codes as-is.",
      "Use exact key names as shown below.",
      "",
      "For each field, if the clinician adds commentary (e.g. 'heart rate is 99 which is normal'),",
      "put the measurement in the field key and the commentary in a separate key with '_note' suffix",
      '(e.g. "Heart Rate": 99, "Heart Rate_note": "normal").',
      "Only include _note keys when commentary was explicitly stated.",
      "",
      "For structured clinical fields (symptoms, diagnosis, allergies, medications, prescriptions),",
      "return a JSON array under the field label with SNOMED codes in snomed_info/medication/medicine objects.",
      "Use medication_request only for NEW prescriptions being ordered, not current medications.",
      "Only include entries explicitly mentioned in the conversation.",
      "",
      "Fields:",
      ...fieldDescriptions,
      "",
      "Output ONLY valid JSON, no markdown, no extra text.",
    ].join("\n"),
    example: JSON.stringify(exampleObj),
  };
}
