import {
  type CareUserMinimal,
  type TokenSlotMinimal,
  getSlotsForDay,
  searchPractitioner,
} from "./care-api";
import { formatDateQueryString, noNullStrings } from "./time";

interface DeserializeResult<T> {
  data: T;
  errors: string[];
  supplementalNote?: string;
}

interface AppointmentRow {
  practitioner_name?: unknown;
  doctor_name?: unknown;
  date?: unknown;
  time?: unknown;
  reason?: unknown;
  note?: unknown;
}

const TIME_OF_DAY_MINUTES: Record<string, number> = {
  morning: 9 * 60,
  noon: 12 * 60,
  afternoon: 14 * 60,
  evening: 18 * 60,
  night: 20 * 60,
};

/** Parses a spoken time hint ("3 PM", "15:30", "afternoon") into minutes
 *  since midnight, so it can be matched against the closest open slot.
 *  Returns null when no preference was given — the earliest open slot
 *  is used in that case. */
export function parsePreferredMinutes(text: string | undefined): number | null {
  if (!text?.trim()) return null;
  const normalized = text.trim().toLowerCase();

  const explicit = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (explicit) {
    let hour = parseInt(explicit[1], 10);
    const minute = explicit[2] ? parseInt(explicit[2], 10) : 0;
    const meridiem = explicit[3];
    if (hour >= 1 && hour <= 12 && meridiem) {
      if (meridiem === "pm" && hour !== 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
      return hour * 60 + minute;
    }
    if (hour >= 0 && hour <= 23 && !meridiem) return hour * 60 + minute;
  }

  for (const [word, minutes] of Object.entries(TIME_OF_DAY_MINUTES)) {
    if (normalized.includes(word)) return minutes;
  }

  return null;
}

function slotMinutesOfDay(startDatetime: string): number | null {
  const date = new Date(startDatetime);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function formatLocalHHmm(startDatetime: string): string | undefined {
  const date = new Date(startDatetime);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Guards against a fabricated/anchored-wrong-year date — a booking date
 *  can never be in the past, and shouldn't be absurdly far in the future. */
function isPlausibleBookingDate(
  dateStr: string,
  referenceDate: Date = new Date(),
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = formatDateQueryString(referenceDate);
  if (dateStr < today) return false;

  const latest = new Date(referenceDate);
  latest.setFullYear(latest.getFullYear() + 1);
  return dateStr <= formatDateQueryString(latest);
}

function extractText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

const SELF_REFERENCE_NAMES = new Set([
  "me",
  "myself",
  "i",
  "you",
  "yourself",
  "same doctor",
  "the same doctor",
]);

/** Rejects a name that isn't actually a name — either a self-reference
 *  ("with me", "same doctor") or stray non-alphabetic junk (e.g. a `}`
 *  leaked from a malformed model response) — so both fall through to the
 *  "default to the current doctor" path below instead of being searched
 *  for or reported as an unmatched name. */
function isExplicitPractitionerName(text: string | undefined): text is string {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  if (SELF_REFERENCE_NAMES.has(normalized)) return false;
  return /[a-z]{2,}/.test(normalized);
}

export async function deserializeAppointments(
  data: unknown,
  currentData: unknown[] | null | undefined,
  context?: {
    facilityId?: string | null;
    currentUser?: CareUserMinimal | null;
  },
): Promise<DeserializeResult<unknown[]>> {
  const current = currentData ?? [];
  if (!Array.isArray(data) || !data.length)
    return { data: current, errors: [] };

  // The question only ever reads its first value — never clobber an
  // appointment the clinician already picked manually.
  if (current.length) return { data: current, errors: [] };

  const facilityId = context?.facilityId;
  if (!facilityId) {
    return {
      data: current,
      errors: ["Could not resolve facility for the appointment."],
    };
  }

  const row = (
    typeof data[0] === "string" ? { practitioner_name: data[0] } : data[0]
  ) as AppointmentRow;

  const spokenName =
    extractText(row.practitioner_name) ?? extractText(row.doctor_name);

  // A follow-up booked during a consult is, in the overwhelming majority of
  // cases, with the same doctor running today's encounter — so a
  // self-reference ("with me"), a missing name, or unparsable junk all
  // default to the current user rather than asking the clinician to repeat
  // themselves or select manually.
  let practitioner: CareUserMinimal | null = null;
  if (isExplicitPractitionerName(spokenName)) {
    practitioner = await searchPractitioner([spokenName], facilityId);
    if (!practitioner) {
      return {
        data: current,
        errors: [
          `Could not find a doctor matching "${spokenName}". Please select manually.`,
        ],
      };
    }
  } else {
    practitioner = context?.currentUser ?? null;
    if (!practitioner) {
      return {
        data: current,
        errors: [
          "Could not determine which doctor to book with. Please select manually.",
        ],
      };
    }
  }

  const dateText = extractText(row.date);
  if (!dateText || !isPlausibleBookingDate(dateText)) {
    return {
      data: current,
      errors: [
        `Could not resolve a valid appointment date for Dr. ${practitioner.first_name ?? practitioner.username}. Please select manually.`,
      ],
    };
  }

  const slots = await getSlotsForDay(facilityId, practitioner.id, dateText);
  const doctorLabel = practitioner.first_name ?? practitioner.username;
  if (slots.error) {
    return {
      data: current,
      errors: [
        `Could not check availability for Dr. ${doctorLabel} on ${dateText}: ${slots.error}. Please select manually.`,
      ],
    };
  }

  const openSlots = slots.slots.filter(
    (slot) => slot.allocated < slot.availability.tokens_per_slot,
  );
  if (!openSlots.length) {
    return {
      data: current,
      errors: [
        `No available slots for Dr. ${doctorLabel} on ${dateText}. Please pick another date manually.`,
      ],
    };
  }

  const preferredMinutes = parsePreferredMinutes(extractText(row.time));
  const bestSlot: TokenSlotMinimal =
    preferredMinutes == null
      ? openSlots[0]
      : openSlots.reduce(
          (closest: TokenSlotMinimal, slot: TokenSlotMinimal) => {
            const closestMinutes = slotMinutesOfDay(closest.start_datetime);
            const slotMinutes = slotMinutesOfDay(slot.start_datetime);
            if (slotMinutes == null) return closest;
            if (closestMinutes == null) return slot;
            return Math.abs(slotMinutes - preferredMinutes) <
              Math.abs(closestMinutes - preferredMinutes)
              ? slot
              : closest;
          },
          openSlots[0],
        );

  const note = noNullStrings(extractText(row.reason) ?? extractText(row.note));
  const entry = { slot_id: bestSlot.id, note: note ?? "", tags: [] };

  const practitionerLabel =
    `${practitioner.first_name ?? ""} ${practitioner.last_name ?? ""}`.trim() ||
    practitioner.username;
  const timeLabel = formatLocalHHmm(bestSlot.start_datetime);
  const supplementalNote = `Dr. ${practitionerLabel} — ${dateText}${timeLabel ? ` at ${timeLabel}` : ""}`;

  return { data: [entry], errors: [], supplementalNote };
}
