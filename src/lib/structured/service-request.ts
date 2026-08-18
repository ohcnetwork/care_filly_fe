import {
  type ActivityDefinitionRead,
  type CareUserMinimal,
  getCurrentUser,
  getEncounterIdFromUrl,
  getFacilityIdFromUrl,
  searchActivityDefinition,
} from "./care-api";
import { normalizeDisplayNames } from "./deserializers";
import {
  SERVICE_REQUEST_CLASSIFICATIONS,
  SERVICE_REQUEST_INTENTS,
  SERVICE_REQUEST_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
  validateEnum,
} from "./service-request-constants";
import { noNullStrings } from "./time";
import type { Code } from "./types";
import { lookupCode } from "./valueset";

interface DeserializeResult<T> {
  data: T;
  errors: string[];
  supplementalNote?: string;
}

interface ServiceRequestRow {
  activity_definition?: unknown;
  investigation?: unknown;
  service?: unknown;
  title?: string | null;
  display_names?: unknown;
  priority?: string | null;
  intent?: string | null;
  status?: string | null;
  note?: string | null;
  patient_instruction?: string | null;
  body_site?: unknown;
}

function normalizeActivityField(raw: unknown): {
  slug?: string;
  title?: string;
  display_names: string[];
} | null {
  if (typeof raw === "string" && raw.trim()) {
    return { display_names: [raw.trim()] };
  }

  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;
  const slug = obj.slug != null ? String(obj.slug) : undefined;
  const title = obj.title != null ? String(obj.title) : undefined;
  const displayNames = normalizeDisplayNames(
    obj.display_names ?? obj.display ?? obj.name ?? title,
  );

  if (!slug && !title && !displayNames.length) return null;

  return {
    slug,
    title,
    display_names: displayNames.length ? displayNames : title ? [title] : [],
  };
}

function extractActivityInfo(row: ServiceRequestRow): {
  slug?: string;
  title?: string;
  display_names: string[];
} | null {
  return (
    normalizeActivityField(row.activity_definition) ??
    normalizeActivityField(row.investigation) ??
    normalizeActivityField(row.service) ??
    (row.title || row.display_names
      ? {
          title: row.title ?? undefined,
          display_names: normalizeDisplayNames(row.display_names ?? row.title),
        }
      : null)
  );
}

async function resolveOptionalCode(
  raw: unknown,
  valueSetSlug: string,
): Promise<Code | undefined> {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const code = obj.code != null ? String(obj.code) : "";
  const displayNames = normalizeDisplayNames(
    obj.display_names ?? obj.display ?? obj.name,
  );
  if (!code && !displayNames.length) return undefined;
  const resolved = await lookupCode(code, displayNames, valueSetSlug);
  return resolved ?? undefined;
}

function buildServiceRequestEntry(
  activityDefinition: ActivityDefinitionRead,
  row: ServiceRequestRow,
  currentUser: CareUserMinimal,
  encounterId: string,
  bodySite?: Code,
) {
  return {
    encounter: encounterId,
    activity_definition: activityDefinition.slug,
    service_request: {
      title: activityDefinition.title,
      status:
        validateEnum(row.status, SERVICE_REQUEST_STATUSES, "active") ??
        "active",
      intent:
        validateEnum(row.intent, SERVICE_REQUEST_INTENTS, "order") ?? "order",
      priority:
        validateEnum(row.priority, SERVICE_REQUEST_PRIORITIES, "routine") ??
        "routine",
      category:
        validateEnum(
          activityDefinition.classification,
          SERVICE_REQUEST_CLASSIFICATIONS,
          "laboratory",
        ) ?? "laboratory",
      do_not_perform: false,
      note: noNullStrings(row.note as string),
      code: activityDefinition.code!,
      body_site: bodySite ?? activityDefinition.body_site ?? null,
      occurance: null,
      patient_instruction: noNullStrings(row.patient_instruction as string),
      requester: currentUser,
      locations:
        activityDefinition.locations?.map((location) => location.id) ?? [],
    },
  };
}

export async function deserializeServiceRequests(
  data: unknown,
  currentData: unknown[] | null | undefined,
  context?: {
    currentUser?: CareUserMinimal | null;
    facilityId?: string | null;
    encounterId?: string | null;
  },
): Promise<DeserializeResult<unknown[]>> {
  if (!Array.isArray(data)) return { data: currentData ?? [], errors: [] };

  const errors: string[] = [];
  const current = (currentData ?? []) as Array<{
    activity_definition?: string;
  }>;
  const currentSlugs = new Set(
    current.map((item) => item.activity_definition).filter(Boolean),
  );

  const currentUser = context?.currentUser ?? (await getCurrentUser());
  const facilityId = context?.facilityId ?? getFacilityIdFromUrl();
  const encounterId = context?.encounterId ?? getEncounterIdFromUrl();

  if (!currentUser) {
    errors.push("Could not resolve current user for service requests.");
    return { data: current, errors };
  }

  if (!facilityId) {
    errors.push("Could not resolve facility for service requests.");
    return { data: current, errors };
  }

  if (!encounterId) {
    return { data: current, errors };
  }

  const seenSlugs = new Set(currentSlugs);
  const unmatched: string[] = [];

  const parsed = await Promise.all(
    data.map(async (item) => {
      try {
        const row: ServiceRequestRow =
          typeof item === "string"
            ? { activity_definition: { display_names: [item.trim()] } }
            : (item as ServiceRequestRow);
        const activityInfo = extractActivityInfo(row);
        if (!activityInfo) {
          errors.push("Investigation entry is missing a name or title.");
          return undefined;
        }

        const searchNames = [
          ...activityInfo.display_names,
          ...(activityInfo.title ? [activityInfo.title] : []),
        ];

        const activityDefinition = await searchActivityDefinition(
          activityInfo.slug,
          searchNames,
          facilityId,
        );

        if (!activityDefinition?.code) {
          const label = searchNames[0] ?? "unknown investigation";
          unmatched.push(label);
          errors.push(
            `Could not find an activity definition matching "${label}". Add manually or see question note.`,
          );
          return undefined;
        }

        if (seenSlugs.has(activityDefinition.slug)) return undefined;
        seenSlugs.add(activityDefinition.slug);

        const bodySite = await resolveOptionalCode(
          row.body_site,
          "system-body-site",
        );

        return buildServiceRequestEntry(
          activityDefinition,
          row,
          currentUser,
          encounterId,
          bodySite,
        );
      } catch (err) {
        return undefined;
      }
    }),
  );

  const merged = [
    ...current,
    ...parsed.filter((item): item is NonNullable<typeof item> => !!item),
  ];

  const supplementalNote = unmatched.length ? unmatched.join(", ") : undefined;

  return { data: merged, errors, supplementalNote };
}
