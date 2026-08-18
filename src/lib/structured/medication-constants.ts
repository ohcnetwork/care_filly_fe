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
  "two times a day": "BID",
  bid: "BID",
  "three times a day": "TID",
  tid: "TID",
  "four times a day": "QID",
  qid: "QID",
  morning: "AM",
  night: "PM",
  bedtime: "PM",
};

export interface ResolvedDosageFrequency {
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
    return { timingOption: null };
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

  return { timingOption: matched ?? null };
}

export function findTimingOption(
  frequency: string | null | undefined,
): MedicationTimingOption | null {
  return resolveDosageFrequency(frequency).timingOption;
}

export function parseDosageDuration(
  duration: { value?: number | string; unit?: string } | null | undefined,
  fallbackText?: string | null,
): { value: number; unit: (typeof BOUNDS_DURATION_UNITS)[number] } {
  if (duration?.value != null) {
    const value = Number(duration.value);
    if (Number.isFinite(value) && value > 0) {
      return {
        value,
        unit: validateEnum(duration.unit, BOUNDS_DURATION_UNITS, "d") ?? "d",
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
      if (Number.isFinite(value) && value > 0) return { value, unit };
    }
  }

  return { value: 5, unit: "d" };
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
      findDosageUnit("tablets") ??
      DOSAGE_UNITS_CODES[0]
    );
  }
  if (/\b(solution|suspension|syrup|injection|milliliter|ml)\b/.test(text)) {
    return findDosageUnit("milliliter") ?? DOSAGE_UNITS_CODES[0];
  }
  if (/\b(drop|drops)\b/.test(text)) {
    return findDosageUnit("drop") ?? DOSAGE_UNITS_CODES[0];
  }

  return DOSAGE_UNITS_CODES[0];
}

export function findDosageUnit(display: string | undefined): Code | null {
  if (!display) return null;
  const normalized = display.trim().toLowerCase();
  return (
    DOSAGE_UNITS_CODES.find(
      (unit) =>
        unit.display.toLowerCase() === normalized ||
        unit.code.toLowerCase() === normalized,
    ) ?? null
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
