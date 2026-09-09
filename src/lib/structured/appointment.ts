import {
  type CareUserMinimal,
  type HealthcareServiceMinimal,
  type LocationMinimal,
  type SchedulableResourceType,
  type TokenSlotRead,
  getCurrentUser,
  getFacilityIdFromUrl,
  getHealthcareServices,
  getLocations,
  getSchedulableUsers,
  getSlotsForDay,
} from "./care-api";
import { validateDate } from "./time";

interface DeserializeResult<T> {
  data: T;
  errors: string[];
}

interface AppointmentRow {
  resource_type?: SchedulableResourceType;
  resource_name?: string;
  date?: string;
  time?: string;
  note?: string;
}

type ResolvableResource =
  | CareUserMinimal
  | LocationMinimal
  | HealthcareServiceMinimal;

interface ResolvedResource {
  resource: ResolvableResource;
  resource_type: SchedulableResourceType;
}

const RESOURCE_TYPE_LABEL: Record<SchedulableResourceType, string> = {
  practitioner: "practitioner",
  location: "location",
  healthcare_service: "healthcare service",
};

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fullName(user: CareUserMinimal): string {
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
  );
}

function resourceLabel(resolved: ResolvedResource): string {
  return resolved.resource_type === "practitioner"
    ? fullName(resolved.resource as CareUserMinimal)
    : (resolved.resource as LocationMinimal | HealthcareServiceMinimal).name;
}

/** No server-side search for practitioners (locations/services do have one,
 *  but results still need scoring — a substring server match isn't
 *  necessarily the best one), so this scores every candidate against the
 *  spoken name and takes the best match — same shape as the other lookups
 *  (SNOMED, product knowledge, activity definitions), just with a simpler
 *  token-overlap score since these names don't carry the
 *  parenthetical/acronym noise medical terms do. */
function findBestMatch<T>(
  items: T[],
  name: string,
  getLabel: (item: T) => string,
): T | null {
  const target = normalizeName(name);
  if (!target) return null;
  const targetWords = target.split(" ");

  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const candidate = normalizeName(getLabel(item));
    if (!candidate) continue;

    let score = 0;
    if (candidate === target) score = 100;
    else if (candidate.includes(target) || target.includes(candidate)) {
      score = 80;
    } else {
      const candidateWords = new Set(candidate.split(" "));
      const matched = targetWords.filter((word) =>
        candidateWords.has(word),
      ).length;
      if (matched) score = Math.round((matched / targetWords.length) * 70);
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore >= 40 ? best : null;
}

async function resolvePractitioner(
  facilityId: string,
  name: string | undefined,
): Promise<ResolvedResource | null> {
  if (!name) {
    const current = await getCurrentUser();
    return current
      ? { resource: current, resource_type: "practitioner" }
      : null;
  }
  const users = await getSchedulableUsers(facilityId);
  const match = findBestMatch(users, name, fullName);
  return match ? { resource: match, resource_type: "practitioner" } : null;
}

async function resolveLocation(
  facilityId: string,
  name: string,
): Promise<ResolvedResource | null> {
  const locations = await getLocations(facilityId, name);
  const match = findBestMatch(locations, name, (l) => l.name);
  return match ? { resource: match, resource_type: "location" } : null;
}

async function resolveHealthcareService(
  facilityId: string,
  name: string,
): Promise<ResolvedResource | null> {
  const services = await getHealthcareServices(facilityId, name);
  const match = findBestMatch(services, name, (s) => s.name);
  return match
    ? { resource: match, resource_type: "healthcare_service" }
    : null;
}

/** A named resource with no resource_type hint (e.g. "book with Radiology")
 *  could be any of the three kinds — try each in turn and take the first
 *  match. When resource_type IS given, only that kind is attempted so a
 *  wrong-kind name (e.g. a location name mistagged as practitioner) fails
 *  rather than silently booking the wrong kind of resource. */
async function resolveResource(
  facilityId: string,
  row: AppointmentRow,
): Promise<ResolvedResource | null> {
  if (!row.resource_type && !row.resource_name) {
    return resolvePractitioner(facilityId, undefined);
  }
  if (row.resource_type === "practitioner") {
    return resolvePractitioner(facilityId, row.resource_name);
  }
  if (row.resource_type === "location") {
    return row.resource_name
      ? resolveLocation(facilityId, row.resource_name)
      : null;
  }
  if (row.resource_type === "healthcare_service") {
    return row.resource_name
      ? resolveHealthcareService(facilityId, row.resource_name)
      : null;
  }
  if (!row.resource_name) return null;
  return (
    (await resolvePractitioner(facilityId, row.resource_name)) ??
    (await resolveLocation(facilityId, row.resource_name)) ??
    (await resolveHealthcareService(facilityId, row.resource_name))
  );
}

/** "3:30 PM" / "15:30" / a rough time-of-day word → minutes since midnight,
 *  for picking the closest available slot. Anything else is unparseable. */
function parseRequestedMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const trimmed = time.trim().toLowerCase();

  const twelveHour = /^(\d{1,2}):([0-5]\d)\s*(am|pm)$/.exec(trimmed);
  if (twelveHour) {
    let hours = Number(twelveHour[1]);
    if (hours === 12) hours = 0;
    if (twelveHour[3] === "pm") hours += 12;
    return hours * 60 + Number(twelveHour[2]);
  }

  const twentyFourHour = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (twentyFourHour) {
    return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]);
  }

  if (trimmed.includes("morning")) return 9 * 60;
  if (trimmed.includes("afternoon")) return 14 * 60;
  if (trimmed.includes("evening")) return 17 * 60;
  return null;
}

function slotMinutes(slot: TokenSlotRead): number {
  const date = new Date(slot.start_datetime);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Resolves a spoken "book a follow-up" request to a real `slot_id` —
 * unlike every other structured type, this needs a live lookup (a resource —
 * practitioner, location, or healthcare service — then that resource's
 * actual open slots for the day) rather than just parsing the extracted
 * text, so a resolution failure at any step falls back to "please enter
 * manually" instead of a partial record — there is no meaningful partial
 * appointment.
 */
export async function deserializeAppointment(
  data: unknown,
  currentData: unknown[] | null | undefined,
): Promise<DeserializeResult<unknown[]>> {
  if (!Array.isArray(data) || !data.length) {
    return { data: currentData ?? [], errors: [] };
  }

  const row = (data[0] ?? {}) as AppointmentRow;
  const facilityId = getFacilityIdFromUrl();
  if (!facilityId) {
    return {
      data: currentData ?? [],
      errors: ["Could not resolve the facility for the appointment."],
    };
  }

  const date = row.date ? validateDate(row.date) : null;
  if (!date) {
    return {
      data: currentData ?? [],
      errors: [
        "Could not determine the appointment date. Please enter manually.",
      ],
    };
  }

  // No resource named — default to whoever is filling the form, the
  // common case for "book them a follow-up" during their own consultation.
  const resolved = await resolveResource(facilityId, row);
  if (!resolved) {
    const label = row.resource_type
      ? RESOURCE_TYPE_LABEL[row.resource_type]
      : null;
    return {
      data: currentData ?? [],
      errors: [
        row.resource_name
          ? `Could not find a ${label ?? "practitioner, location, or healthcare service"} matching "${row.resource_name}". Please enter manually.`
          : "Could not determine which practitioner to book with. Please enter manually.",
      ],
    };
  }

  const slots = await getSlotsForDay(
    facilityId,
    resolved.resource_type,
    resolved.resource.id,
    date,
  );
  const available = slots.filter(
    (slot) => slot.allocated < slot.availability.tokens_per_slot,
  );
  if (!available.length) {
    return {
      data: currentData ?? [],
      errors: [
        `No available slots for ${resourceLabel(resolved)} on ${date}. Please enter manually.`,
      ],
    };
  }

  const requestedMinutes = parseRequestedMinutes(row.time);
  const slot =
    requestedMinutes === null
      ? available[0]
      : available.reduce((closest, candidate) =>
          Math.abs(slotMinutes(candidate) - requestedMinutes) <
          Math.abs(slotMinutes(closest) - requestedMinutes)
            ? candidate
            : closest,
        );

  // AppointmentQuestion only renders a slot as "selected" once it has
  // resource_object/slot_object to display — without them it silently
  // falls back to the default practitioner and shows the empty picker
  // until the user manually reselects, discarding this slot_id.
  return {
    data: [
      {
        slot_id: slot.id,
        note: row.note ?? "",
        tags: [],
        resource_object: {
          resource: resolved.resource,
          resource_type: resolved.resource_type,
        },
        slot_object: slot,
      },
    ],
    errors: [],
  };
}
