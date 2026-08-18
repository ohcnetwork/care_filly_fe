import {
  getStructuredFieldDescription,
  getStructuredFieldExample,
} from "@/lib/structured/fill";
import {
  BOOLEAN_NOT_MENTIONED,
  type SupportedStructuredType,
  isSupportedStructuredType,
} from "@/lib/structured/types";

interface FormQuestion {
  id: string;
  text: string;
  description?: string;
  type: string;
  structured_type?: string;
  questions?: FormQuestion[];
  answer_option?: Array<{ value: string; display?: string }>;
  answer_value_set?: string;
  max_length?: number;
}

export interface FormField {
  id: string;
  label: string;
  description?: string;
  type: string;
  structuredType?: SupportedStructuredType;
  options?: string[];
  answerValueSet?: string;
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
        description: q.description,
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
      description: q.description,
      type: q.type,
    };

    if (q.answer_option?.length) {
      field.options = q.answer_option.map((o) => o.display || String(o.value));
    } else if (q.type === "choice" && q.answer_value_set) {
      // No fixed option list — the valid answers come from an external
      // terminology (e.g. SNOMED), resolved later against answer_value_set.
      field.answerValueSet = q.answer_value_set;
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
      const description = withHelpText(
        f,
        `${getStructuredFieldDescription(f.structuredType, f.label)}; example: ${JSON.stringify(getStructuredFieldExample(f.structuredType))}`,
      );
      specs.push({ key: f.label, label: f.label, type: "string", description });
      continue;
    }
    if (f.type === "boolean") {
      specs.push({
        key: f.label,
        label: f.label,
        type: "single_select",
        enum: ["true", "false", BOOLEAN_NOT_MENTIONED],
        description: withHelpText(
          f,
          `Use "${BOOLEAN_NOT_MENTIONED}" whenever the clinician never addressed ` +
            `this question's subject, or when you cannot tell which way their ` +
            `statement answers it — never guess. When they did address it, judge ` +
            `the answer against how THIS question is worded, including questions ` +
            `that are themselves phrased negatively: answer "true" if their ` +
            `statement answers this question affirmatively, "false" if it answers ` +
            `it in the negative (e.g. "not an emergency" for "Is this an ` +
            `emergency?"). A denial that answers this question is a "false" answer ` +
            `— do not leave it unanswered just because it was phrased as a denial. ` +
            `You may still record qualifying detail in the companion note field, ` +
            `but give the yes/no answer here as well.`,
        ),
      });
      specs.push(
        noteSpec(
          f.label,
          `Additional commentary about "${f.label}" beyond yes/no yes/not (e.g. ` +
            "timing, severity, context) if explicitly mentioned.",
        ),
      );
    } else if (f.type === "decimal" || f.type === "integer") {
      specs.push({
        key: f.label,
        label: f.label,
        type: "number",
        description: withHelpText(
          f,
          "Numeric value only. If the clinician only gave a descriptive " +
            `term (e.g. "normal", "elevated") with no number, leave this out ` +
            `and use "${f.label}_note" instead.`,
        ),
      });
      specs.push(
        noteSpec(
          f.label,
          `Descriptive/qualitative commentary for "${f.label}" (e.g. "normal", ` +
            `"very high", "borderline") if the clinician gave any — whether or ` +
            'not they also gave a number (e.g. "120, very high" -> number 120, ' +
            `note "very high"). Only include if explicitly mentioned.`,
        ),
      );
    } else if (f.type === "choice" && f.options?.length) {
      specs.push({
        key: f.label,
        label: f.label,
        type: "single_select",
        enum: f.options,
        description: withHelpText(f),
      });
      specs.push(
        noteSpec(
          f.label,
          `Additional commentary about "${f.label}" beyond the selected ` +
            "option, if explicitly mentioned.",
        ),
      );
    } else if (f.type === "choice" && f.answerValueSet) {
      // Open-ended terminology (SNOMED, etc.) — too large to enumerate, so
      // ask for a code/display_names object and resolve it via the same
      // search-and-select valueset lookup used for medication/diagnosis/etc.
      specs.push({
        key: f.label,
        label: f.label,
        type: "string",
        description: withHelpText(
          f,
          `The clinical term the clinician used for "${f.label}", as JSON: ` +
            '{"code": "<code if known, else empty string>", "display_names": ' +
            '["<exact term used>", "<a close synonym, if any>"]}. Only ' +
            "include if explicitly mentioned.",
        ),
      });
    } else {
      specs.push({
        key: f.label,
        label: f.label,
        type: "string",
        description: withHelpText(f),
      });
    }
  }
  return specs;
}

// The CARE question's own help text/description
function withHelpText(f: FormField, generated?: string): string | undefined {
  if (!f.description) return generated;
  return generated ? `${f.description} ${generated}` : f.description;
}

// Free text fields already hold arbitrary commentary in their own value, so
// only discrete-answer fields (boolean/number/choice) get a note companion.
function noteSpec(label: string, description: string): MedispeakFieldSpec {
  return {
    key: `${label}_note`,
    label: `${label} note`,
    type: "string",
    description,
  };
}
