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
  // CARE's Question.unit / Question.answer_unit — a Code ({system, code,
  // display}) distinguishing unit variants of the same question text (e.g.
  // Temperature in °C vs °F).
  unit?: { code?: string; display?: string };
  answer_unit?: { code?: string; display?: string };
}

export interface FormField {
  id: string;
  label: string;
  description?: string;
  type: string;
  structuredType?: SupportedStructuredType;
  options?: string[];
  answerValueSet?: string;
  /** Human-readable unit (e.g. "°C"), when the question carries one. */
  unit?: string;
}

// Prefer `unit` (what CARE actually renders next to the question label) and
// fall back to `answer_unit`, then to the unit's code if it has no display.
function questionUnitText(q: FormQuestion): string | undefined {
  const unit = q.unit ?? q.answer_unit;
  return unit?.display || unit?.code || undefined;
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
        unit: questionUnitText(q),
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
      unit: questionUnitText(q),
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
 *
 * A field's unit (if any) is appended to its label — e.g. two "Temperature"
 * questions in °C and °F both become distinct keys ("Temperature (°C)" /
 * "Temperature (°F)") instead of colliding, mirroring how CARE itself shows
 * the unit next to the question label on screen.
 */
export function buildFieldSpecs(fields: FormField[]): MedispeakFieldSpec[] {
  const specs: MedispeakFieldSpec[] = [];
  for (const f of fields) {
    const label = f.unit ? `${f.label} (${f.unit})` : f.label;
    if (f.structuredType) {
      const description = withHelpText(
        f,
        `${getStructuredFieldDescription(f.structuredType, label)}; example: ${JSON.stringify(getStructuredFieldExample(f.structuredType))}`,
      );
      specs.push({ key: label, label, type: "string", description });
      continue;
    }
    if (f.type === "boolean") {
      specs.push({
        key: label,
        label,
        type: "single_select",
        enum: ["true", "false", BOOLEAN_NOT_MENTIONED],
        description: withHelpText(
          f,
          `Whether the clinician explicitly stated this. Use "${BOOLEAN_NOT_MENTIONED}" if not mentioned — never guess "false".`,
        ),
      });
      specs.push(
        noteSpec(
          label,
          `Additional commentary about "${label}" beyond yes/no yes/not (e.g. ` +
            "timing, severity, context) if explicitly mentioned.",
        ),
      );
    } else if (f.type === "decimal" || f.type === "integer") {
      specs.push({
        key: label,
        label,
        type: "number",
        description: withHelpText(
          f,
          "Numeric value only. If the clinician only gave a descriptive " +
            `term (e.g. "normal", "elevated") with no number, leave this out ` +
            `and use "${label}_note" instead.`,
        ),
      });
      specs.push(
        noteSpec(
          label,
          `Descriptive/qualitative commentary for "${label}" (e.g. "normal", ` +
            `"very high", "borderline") if the clinician gave any — whether or ` +
            'not they also gave a number (e.g. "120, very high" -> number 120, ' +
            `note "very high"). Only include if explicitly mentioned.`,
        ),
      );
    } else if (f.type === "choice" && f.options?.length) {
      specs.push({
        key: label,
        label,
        type: "single_select",
        enum: f.options,
        description: withHelpText(f),
      });
      specs.push(
        noteSpec(
          label,
          `Additional commentary about "${label}" beyond the selected ` +
            "option, if explicitly mentioned.",
        ),
      );
    } else if (f.type === "choice" && f.answerValueSet) {
      // Open-ended terminology (SNOMED, etc.) — too large to enumerate, so
      // ask for a code/display_names object and resolve it via the same
      // search-and-select valueset lookup used for medication/diagnosis/etc.
      specs.push({
        key: label,
        label,
        type: "string",
        description: withHelpText(
          f,
          `The clinical term the clinician used for "${label}", as JSON: ` +
            '{"code": "<code if known, else empty string>", "display_names": ' +
            '["<exact term used>", "<a close synonym, if any>"]}. Only ' +
            "include if explicitly mentioned.",
        ),
      });
    } else {
      specs.push({
        key: label,
        label,
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
