import type { Code } from "./types";

export const MEDICATION_REQUEST_INTENT = [
  "proposal",
  "plan",
  "order",
  "original_order",
  "reflex_order",
  "filler_order",
  "instance_order",
] as const;

export const MEDICATION_CATEGORIES = [
  "inpatient",
  "outpatient",
  "community",
  "discharge",
] as const;

export const MEDICATION_PRIORITIES = [
  "stat",
  "urgent",
  "asap",
  "routine",
] as const;

export const BOUNDS_DURATION_UNITS = ["h", "d", "wk", "mo", "a"] as const;

export const DOSAGE_UNITS_CODES: Code[] = [
  { code: "{tbl}", display: "tablets", system: "http://unitsofmeasure.org" },
  { code: "g", display: "gram", system: "http://unitsofmeasure.org" },
  { code: "mg", display: "milligram", system: "http://unitsofmeasure.org" },
  { code: "ug", display: "microgram", system: "http://unitsofmeasure.org" },
  { code: "mL", display: "milliliter", system: "http://unitsofmeasure.org" },
  { code: "[drp]", display: "drop", system: "http://unitsofmeasure.org" },
  {
    code: "[iU]",
    display: "international unit",
    system: "http://unitsofmeasure.org",
  },
  { code: "{count}", display: "count", system: "http://unitsofmeasure.org" },
  { code: "Tablet", display: "Tablet", system: "http://unitsofmeasure.org" },
];

export interface MedicationTimingOption {
  display: string;
  timing: {
    repeat: {
      frequency: number;
      period: string;
      period_unit: "d" | "h" | "wk" | "mo" | "a";
      bounds_duration: { value: string; unit: "d" | "h" | "wk" | "mo" | "a" };
    };
    code: Code;
  };
}

export const MEDICATION_REQUEST_TIMING_OPTIONS: Record<
  string,
  MedicationTimingOption
> = {
  QD: {
    display: "QD (Once a day)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "QD",
        display: "Once a day",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  BID: {
    display: "BID (1-0-1)",
    timing: {
      repeat: {
        frequency: 2,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "BID",
        display: "Two times a day",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  TID: {
    display: "TID (1-1-1)",
    timing: {
      repeat: {
        frequency: 3,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "TID",
        display: "Three times a day",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  QID: {
    display: "QID (1-1-1-1)",
    timing: {
      repeat: {
        frequency: 4,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "QID",
        display: "Four times a day",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  AM: {
    display: "AM (1-0-0)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "AM",
        display: "Every morning",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  PM: {
    display: "PM (0-0-1)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "PM",
        display: "Every afternoon",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
};

const MAN_FREQUENCY_MAP: Record<
  string,
  keyof typeof MEDICATION_REQUEST_TIMING_OPTIONS
> = {
  "1-0-1": "BID",
  "1-1-1": "TID",
  "1-0-0": "AM",
  "0-0-1": "PM",
  "1-1-1-1": "QID",
};

const MAN_PATTERN = /^[\d]+(?:\/[\d]+)?(-[\d]+(?:\/[\d]+)?){1,3}$/;

const FREQUENCY_ALIASES: Record<
  string,
  keyof typeof MEDICATION_REQUEST_TIMING_OPTIONS
> = {
  "once a day": "QD",
  "once daily": "QD",
  daily: "QD",
  od: "QD",
  qd: "QD",
  "twice a day": "BID",
  "twice daily": "BID",
  "two times a day": "BID",
  "two times daily": "BID",
  "2 times a day": "BID",
  "2 times daily": "BID",
  bid: "BID",
  "three times a day": "TID",
  "three times daily": "TID",
  "thrice a day": "TID",
  "thrice daily": "TID",
  "3 times a day": "TID",
  "3 times daily": "TID",
  tid: "TID",
  "four times a day": "QID",
  "four times daily": "QID",
  "4 times a day": "QID",
  "4 times daily": "QID",
  qid: "QID",
  morning: "AM",
  "in the morning": "AM",
  "every morning": "AM",
  night: "PM",
  "at night": "PM",
  nightly: "PM",
  "every night": "PM",
  bedtime: "PM",
  "at bedtime": "PM",
};

export interface ResolvedDosageFrequency {
  // `null` means the frequency could not be established — either it was not
  // mentioned at all, or the phrase we received maps to no known schedule.
  // Callers must not fabricate a default (e.g. QD) in that case; when the
  // phrase was non-empty it is preserved verbatim in `text`.
  timingOption: MedicationTimingOption | null;
  text?: string;
}

export function resolveDosageFrequency(
  frequency: unknown,
): ResolvedDosageFrequency {
  if (frequency == null || frequency === "") {
    return { timingOption: null };
  }

  const raw = String(frequency).trim();
  if (!raw) return { timingOption: null };

  const normalized = raw.toLowerCase();

  if (MAN_PATTERN.test(normalized)) {
    const timingKey = MAN_FREQUENCY_MAP[normalized];
    if (timingKey) {
      return {
        timingOption: MEDICATION_REQUEST_TIMING_OPTIONS[timingKey],
        text: normalized,
      };
    }
    // MAN-shaped but not a pattern we map (e.g. "1-1-0"). Keep the raw
    // pattern as free text rather than pinning it to a schedule that
    // contradicts it — QD used to be returned here, producing a row whose
    // text said "1-1-0" while its timing said once-a-day.
    return { timingOption: null, text: normalized };
  }

  const aliasKey = FREQUENCY_ALIASES[normalized];
  if (aliasKey) {
    return { timingOption: MEDICATION_REQUEST_TIMING_OPTIONS[aliasKey] };
  }

  const matched = Object.values(MEDICATION_REQUEST_TIMING_OPTIONS).find(
    (option) =>
      option.display.toLowerCase() === normalized ||
      option.display.toLowerCase().includes(normalized) ||
      normalized.includes(option.timing.code.display.toLowerCase()) ||
      option.timing.code.display.toLowerCase() === normalized ||
      option.timing.code.code.toLowerCase() === normalized,
  );

  if (matched) return { timingOption: matched };

  // Unrecognised phrasing (e.g. "every 6 hours", "as directed"). Defaulting
  // to QD here silently downgraded correctly-heard instructions — "every 6
  // hours" became once-a-day. Leave the schedule unset and surface what was
  // heard as free text so the clinician can complete it.
  return { timingOption: null, text: raw };
}

export function findTimingOption(
  frequency: string | null | undefined,
): MedicationTimingOption | null {
  return resolveDosageFrequency(frequency).timingOption;
}

export interface ParsedDosageDuration {
  value: number;
  unit: (typeof BOUNDS_DURATION_UNITS)[number];
  // `false` when no duration could be read and the default below was
  // substituted. Callers must not present a defaulted duration as if the
  // clinician had dictated it.
  stated: boolean;
}

export function parseDosageDuration(
  duration: { value?: number | string; unit?: string } | null | undefined,
  fallbackText?: string | null,
): ParsedDosageDuration {
  if (duration?.value != null) {
    const value = Number(duration.value);
    if (Number.isFinite(value) && value > 0) {
      return {
        value,
        unit: validateEnum(duration.unit, BOUNDS_DURATION_UNITS, "d") ?? "d",
        stated: true,
      };
    }
  }

  if (fallbackText) {
    const match = fallbackText.match(
      /(\d+)\s*(day|days|week|weeks|month|months|year|years|hour|hours)/i,
    );
    if (match) {
      const value = Number(match[1]);
      const unitWord = match[2].toLowerCase();
      const unitMap: Record<string, (typeof BOUNDS_DURATION_UNITS)[number]> = {
        day: "d",
        days: "d",
        hour: "h",
        hours: "h",
        week: "wk",
        weeks: "wk",
        month: "mo",
        months: "mo",
        year: "a",
        years: "a",
      };
      const unit = unitMap[unitWord] ?? "d";
      if (Number.isFinite(value) && value > 0)
        return { value, unit, stated: true };
    }
  }

  return { value: 5, unit: "d", stated: false };
}

export function inferDefaultDosageUnit(
  displayNames: string[],
  product?: { base_unit?: Code; product_type?: string; name?: string },
): Code {
  if (product?.base_unit) return product.base_unit;

  const text = [product?.name, ...displayNames]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    product?.product_type === "consumable" ||
    /\b(glove|gloves|syringe|bandage|mask|consumable|count)\b/.test(text)
  ) {
    return (
      DOSAGE_UNITS_CODES.find((unit) => unit.code === "{count}") ??
      DOSAGE_UNITS_CODES[0]
    );
  }
  if (/\b(capsule|cap|tablet|tab|chewable)\b/.test(text)) {
    return (
      DOSAGE_UNITS_CODES.find((unit) => unit.code === "{tbl}") ??
      findDosageUnit("tablets")
    );
  }
  if (/\b(solution|suspension|syrup|injection|milliliter|ml)\b/.test(text)) {
    return findDosageUnit("milliliter");
  }
  if (/\b(drop|drops)\b/.test(text)) {
    return findDosageUnit("drop");
  }

  return DOSAGE_UNITS_CODES[0];
}

export function findDosageUnit(display: string | undefined): Code {
  if (!display) return DOSAGE_UNITS_CODES[0];
  const normalized = display.trim().toLowerCase();
  return (
    DOSAGE_UNITS_CODES.find(
      (unit) =>
        unit.display.toLowerCase() === normalized ||
        unit.code.toLowerCase() === normalized,
    ) ?? {
      code: display,
      display,
      system: "http://unitsofmeasure.org",
    }
  );
}

export function validateEnum<T extends readonly string[]>(
  value: string | null | undefined,
  allowed: T,
  fallback?: T[number],
): T[number] | undefined {
  if (!value) return fallback;
  return allowed.includes(value as T[number]) ? (value as T[number]) : fallback;
}
