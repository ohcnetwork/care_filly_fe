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
  NOON: {
    display: "NOON (0-1-0)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "NOON",
        display: "At noon",
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
  BID_MORNING_NOON: {
    display: "BID (1-1-0)",
    timing: {
      repeat: {
        frequency: 2,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "BID",
        display: "Morning and noon",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  BID_NOON_NIGHT: {
    display: "BID (0-1-1)",
    timing: {
      repeat: {
        frequency: 2,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "BID",
        display: "Noon and night",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  TID_MORNING_NOON_NIGHT: {
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
        display: "Morning, noon and night",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  QOD: {
    display: "QOD (Alternate days)",
    timing: {
      repeat: {
        frequency: 1,
        period: "2",
        period_unit: "d",
        bounds_duration: { value: "2", unit: "d" },
      },
      code: {
        code: "QOD",
        display: "Alternate days",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  Q1H: {
    display: "Q1H (Every 1 hour)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "h",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "Q1H",
        display: "Every 1 hour",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  Q2H: {
    display: "Q2H (Every 2 hours)",
    timing: {
      repeat: {
        frequency: 1,
        period: "2",
        period_unit: "h",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "Q2H",
        display: "Every 2 hours",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  Q3H: {
    display: "Q3H (Every 3 hours)",
    timing: {
      repeat: {
        frequency: 1,
        period: "3",
        period_unit: "h",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "Q3H",
        display: "Every 3 hours",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  Q4H: {
    display: "Q4H (Every 4 hours)",
    timing: {
      repeat: {
        frequency: 1,
        period: "4",
        period_unit: "h",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "Q4H",
        display: "Every 4 hours",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  Q6H: {
    display: "Q6H (Every 6 hours)",
    timing: {
      repeat: {
        frequency: 1,
        period: "6",
        period_unit: "h",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "Q6H",
        display: "Every 6 hours",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  Q8H: {
    display: "Q8H (Every 8 hours)",
    timing: {
      repeat: {
        frequency: 1,
        period: "8",
        period_unit: "h",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "Q8H",
        display: "Every 8 hours",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  Q12H: {
    display: "Q12H (Every 12 hours)",
    timing: {
      repeat: {
        frequency: 1,
        period: "12",
        period_unit: "h",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "Q12H",
        display: "Every 12 hours",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  BED: {
    display: "BED (0-0-1)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "BED",
        display: "Bedtime",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  WK: {
    display: "WK (Weekly)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "wk",
        bounds_duration: { value: "1", unit: "wk" },
      },
      code: {
        code: "WK",
        display: "Weekly",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  MO: {
    display: "MO (Monthly)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "mo",
        bounds_duration: { value: "1", unit: "mo" },
      },
      code: {
        code: "MO",
        display: "Monthly",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  HS: {
    display: "HS (At bedtime)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "HS",
        display: "At bedtime",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  AC: {
    display: "AC (Before meals)",
    timing: {
      repeat: {
        frequency: 3,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "AC",
        display: "Before meals",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  PC: {
    display: "PC (After meals)",
    timing: {
      repeat: {
        frequency: 3,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "PC",
        display: "After meals",
        system: "http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation",
      },
    },
  },
  STAT: {
    display: "STAT (Immediately)",
    timing: {
      repeat: {
        frequency: 1,
        period: "1",
        period_unit: "d",
        bounds_duration: { value: "1", unit: "d" },
      },
      code: {
        code: "STAT",
        display: "Immediately",
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
  "1-1-0": "BID_MORNING_NOON",
  "0-1-1": "BID_NOON_NIGHT",
  "0-1-0": "NOON",
};

// Reverse of MAN_FREQUENCY_MAP — the M-A-N pattern for a timing key, used to
// disambiguate variants that share a FHIR code (e.g. BID vs BID_MORNING_NOON).
const TIMING_KEY_TO_MAN: Record<string, string> = Object.fromEntries(
  Object.entries(MAN_FREQUENCY_MAP).map(([pattern, key]) => [key, pattern]),
);

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
  noon: "NOON",
  "at noon": "NOON",
  midday: "NOON",
  night: "PM",
  "at night": "PM",
  nightly: "PM",
  "every night": "PM",
  "every evening": "PM",
  evening: "PM",
  "in the evening": "PM",
  bedtime: "HS",
  "at bedtime": "HS",
  hs: "HS",
  hd: "HS",
  "alternate days": "QOD",
  "alternate day": "QOD",
  "every other day": "QOD",
  qod: "QOD",
  hourly: "Q1H",
  "every hour": "Q1H",
  "every 1 hour": "Q1H",
  q1h: "Q1H",
  "every 2 hours": "Q2H",
  "every two hours": "Q2H",
  q2h: "Q2H",
  "every 3 hours": "Q3H",
  "every three hours": "Q3H",
  q3h: "Q3H",
  "every 4 hours": "Q4H",
  "every four hours": "Q4H",
  q4h: "Q4H",
  "every 6 hours": "Q6H",
  "every six hours": "Q6H",
  q6h: "Q6H",
  "every 8 hours": "Q8H",
  "every eight hours": "Q8H",
  q8h: "Q8H",
  "every 12 hours": "Q12H",
  "every twelve hours": "Q12H",
  q12h: "Q12H",
  weekly: "WK",
  "once a week": "WK",
  "every week": "WK",
  wk: "WK",
  monthly: "MO",
  "once a month": "MO",
  "every month": "MO",
  mo: "MO",
  "before meals": "AC",
  "before food": "AC",
  ac: "AC",
  "after meals": "PC",
  "after food": "PC",
  pc: "PC",
  stat: "STAT",
  immediately: "STAT",
  now: "STAT",
};

export interface ResolvedDosageFrequency {
  timingOption: MedicationTimingOption | null;
  text?: string;
}

// Resolves a phrase to its timing-option key so the caller can also look up TIMING_KEY_TO_MAN.
function resolveTimingKey(normalized: string): string | null {
  const aliasKey = FREQUENCY_ALIASES[normalized];
  if (aliasKey) return aliasKey;

  const entry = Object.entries(MEDICATION_REQUEST_TIMING_OPTIONS).find(
    ([, option]) =>
      option.display.toLowerCase() === normalized ||
      option.display.toLowerCase().includes(normalized) ||
      normalized.includes(option.timing.code.display.toLowerCase()) ||
      option.timing.code.display.toLowerCase() === normalized ||
      option.timing.code.code.toLowerCase() === normalized,
  );

  return entry?.[0] ?? null;
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

  const key = resolveTimingKey(normalized);
  if (!key) return { timingOption: null };

  // `text` disambiguates code collisions like BID vs BID_MORNING_NOON downstream.
  return {
    timingOption: MEDICATION_REQUEST_TIMING_OPTIONS[key],
    text: TIMING_KEY_TO_MAN[key],
  };
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
