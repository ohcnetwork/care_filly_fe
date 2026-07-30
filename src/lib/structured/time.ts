const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseAmount(raw: string): number | null {
  const amount = Number(raw);
  if (Number.isFinite(amount) && amount > 0) return amount;
  return NUMBER_WORDS[raw.toLowerCase()] ?? null;
}

function subtractDuration(base: Date, amount: number, unit: string): Date {
  const result = new Date(base);
  const normalized = unit.toLowerCase().replace(/s$/, "");

  switch (normalized) {
    case "day":
    case "d":
      result.setDate(result.getDate() - amount);
      break;
    case "week":
    case "wk":
      result.setDate(result.getDate() - amount * 7);
      break;
    case "month":
    case "mo":
      result.setMonth(result.getMonth() - amount);
      break;
    case "year":
    case "a":
      result.setFullYear(result.getFullYear() - amount);
      break;
    default:
      return result;
  }

  return result;
}

function extractRelativeDuration(
  text: string,
): { amount: number; unit: string } | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const patterns = [
    /(?:for\s+(?:the\s+)?(?:past|last)|since)\s+([a-z]+|\d+)\s*(day|days|week|weeks|month|months|year|years)\b/i,
    /\b([a-z]+|\d+)\s*(day|days|week|weeks|month|months|year|years)\s+ago\b/i,
    /\b([a-z]+|\d+)\s*(day|days|week|weeks|month|months|year|years)\s+(?:back|duration)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const amount = parseAmount(match[1]);
    if (!amount) continue;

    return { amount, unit: match[2] };
  }

  return null;
}

export function formatDateQueryString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validateDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateQueryString(date);
}

export function parseRelativeOnset(
  input: string,
  referenceDate: Date = new Date(),
): string | null {
  const duration = extractRelativeDuration(input);
  if (!duration) return null;

  return formatDateQueryString(
    subtractDuration(referenceDate, duration.amount, duration.unit),
  );
}

export interface OnsetResolveOptions {
  referenceDate?: Date;
  complaintText?: string;
  findingNames?: string[];
}

function complaintMentionsFinding(
  complaint: string,
  findingNames: string[],
): boolean {
  const normalizedComplaint = complaint.toLowerCase();
  return findingNames.some((name) => {
    const tokens = name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3);
    return tokens.some((token) => normalizedComplaint.includes(token));
  });
}

/**
 * Guard against absolute dates the LLM anchored to the wrong reference (it
 * often assumes its training-cutoff year, e.g. 2023). An onset can never be in
 * the future, and should not predate a reasonable clinical bound.
 */
function isPlausibleOnset(dateStr: string, referenceDate: Date): boolean {
  const today = formatDateQueryString(referenceDate);
  if (dateStr > today) return false;

  const earliest = new Date(referenceDate);
  earliest.setFullYear(earliest.getFullYear() - 120);
  return dateStr >= formatDateQueryString(earliest);
}

export function resolveOnsetDatetime(
  row: Record<string, unknown>,
  options: OnsetResolveOptions = {},
): string {
  const referenceDate = options.referenceDate ?? new Date();
  const candidates: string[] = [];

  if (typeof row.onset_datetime === "string") {
    candidates.push(row.onset_datetime);
  }

  const nestedOnset = row.onset;
  if (
    nestedOnset &&
    typeof nestedOnset === "object" &&
    typeof (nestedOnset as Record<string, unknown>).onset_datetime === "string"
  ) {
    candidates.push(
      (nestedOnset as Record<string, unknown>).onset_datetime as string,
    );
  }

  if (typeof row.note === "string") {
    candidates.push(row.note);
  }

  for (const candidate of candidates) {
    const relative = parseRelativeOnset(candidate, referenceDate);
    if (relative) return relative;
  }

  // Fall back to explicit absolute dates, ignoring implausible values.
  for (const candidate of candidates) {
    const dateOnly = validateDate(candidate);
    if (dateOnly && isPlausibleOnset(dateOnly, referenceDate)) return dateOnly;
  }

  const duration = row.onset_duration as
    | { value?: number | string; unit?: string }
    | undefined;
  const durationValue = Number(duration?.value);
  if (Number.isFinite(durationValue) && durationValue > 0 && duration?.unit) {
    return formatDateQueryString(
      subtractDuration(referenceDate, durationValue, duration.unit),
    );
  }

  if (
    options.complaintText &&
    options.findingNames?.length &&
    complaintMentionsFinding(options.complaintText, options.findingNames)
  ) {
    const relative = parseRelativeOnset(options.complaintText, referenceDate);
    if (relative) return relative;
  }

  return formatDateQueryString(referenceDate);
}

export function validateTime(input: string | null | undefined): string | null {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function shiftUTCToLocalClockTime(inputISOString: string): string {
  try {
    const inputDate = new Date(inputISOString);
    const tzOffsetMinutes = inputDate.getTimezoneOffset();
    return new Date(
      inputDate.getTime() + tzOffsetMinutes * 60 * 1000,
    ).toISOString();
  } catch {
    return inputISOString;
  }
}

export function noNullStrings(
  value: string | null | undefined,
): string | undefined {
  if (
    !value ||
    value.toLowerCase() === "null" ||
    value.toLowerCase() === "undefined" ||
    value.toLowerCase() === "none"
  ) {
    return undefined;
  }
  return value;
}
