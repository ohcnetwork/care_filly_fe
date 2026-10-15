import { CARE_API_URL } from "@/lib/care-api-url";
import { getHeaders } from "@/lib/request";

import {
  buildActivityDefinitionSearchQueries,
  pickBestActivityDefinition,
} from "./activity-definition-search";
import {
  buildMedicationSearchQueries,
  pickBestProduct,
} from "./medication-search";
import type { Code } from "./types";

export interface CareUserMinimal {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface ProductKnowledgeBase {
  id: string;
  slug: string;
  name: string;
  code?: Code;
  base_unit?: Code;
  names?: Array<{ name: string; name_type?: string }>;
  product_type?: string;
  status?: string;
}

interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

export function getFacilityIdFromUrl(): string | null {
  const match = window.location.pathname.match(
    /\/facility\/([0-9a-f-]{36})\//i,
  );
  return match?.[1] ?? null;
}

export function getEncounterIdFromUrl(): string | null {
  const match = window.location.pathname.match(
    /\/encounter\/([0-9a-f-]{36})\//i,
  );
  return match?.[1] ?? null;
}

export interface ActivityDefinitionRead {
  id: string;
  slug: string;
  title: string;
  status?: string;
  classification?: string;
  code?: Code;
  body_site?: Code | null;
  locations?: Array<{ id: string }>;
  diagnostic_report_codes?: Code[];
}

export interface TokenSlotRead {
  id: string;
  start_datetime: string;
  end_datetime: string;
  allocated: number;
  availability: { tokens_per_slot: number };
}

export type SchedulableResourceType =
  "practitioner" | "location" | "healthcare_service";

export interface LocationMinimal {
  id: string;
  name: string;
}

export interface HealthcareServiceMinimal {
  id: string;
  name: string;
}

export async function getCurrentUser(): Promise<CareUserMinimal | null> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl) return null;

  try {
    const res = await fetch(`${baseUrl}/api/v1/users/getcurrentuser/`, {
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CareUserMinimal;
    return {
      id: data.id,
      username: data.username,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
    };
  } catch {
    return null;
  }
}

async function fetchProductKnowledge(
  name: string,
  facilityId: string,
): Promise<ProductKnowledgeBase[]> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl || !name.trim()) return [];

  const url = new URL(`${baseUrl}/api/v1/product_knowledge/`);
  url.searchParams.set("include_instance", "true");
  url.searchParams.set("facility", facilityId);
  url.searchParams.set("limit", "20");
  url.searchParams.set("offset", "0");
  url.searchParams.set("name", name.trim());
  url.searchParams.set("status", "active");

  try {
    const res = await fetch(url.toString(), { headers: getHeaders() });
    if (!res.ok) return [];

    const data = (await res.json()) as PaginatedResponse<ProductKnowledgeBase>;
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function searchProductKnowledge(
  names: string | string[],
  facilityId: string,
): Promise<ProductKnowledgeBase | null> {
  const displayNames = Array.isArray(names) ? names : [names];
  const queries = buildMedicationSearchQueries(displayNames);
  if (!queries.length) return null;

  const seen = new Map<string, ProductKnowledgeBase>();

  for (const query of queries) {
    const results = await fetchProductKnowledge(query, facilityId);
    for (const product of results) {
      if (!seen.has(product.id)) seen.set(product.id, product);
    }
  }

  return pickBestProduct([...seen.values()], queries);
}

async function fetchActivityDefinitions(
  facilityId: string,
  queryParams: Record<string, string>,
): Promise<ActivityDefinitionRead[]> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl) return [];

  const url = new URL(
    `${baseUrl}/api/v1/facility/${facilityId}/activity_definition/`,
  );
  url.searchParams.set("limit", "20");
  url.searchParams.set("offset", "0");
  url.searchParams.set("status", "active");

  for (const [key, value] of Object.entries(queryParams)) {
    if (value.trim()) url.searchParams.set(key, value.trim());
  }

  try {
    const res = await fetch(url.toString(), { headers: getHeaders() });
    if (!res.ok) return [];
    const data =
      (await res.json()) as PaginatedResponse<ActivityDefinitionRead>;
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function retrieveActivityDefinition(
  facilityId: string,
  slug: string,
): Promise<ActivityDefinitionRead | null> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl || !slug.trim()) return null;

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/facility/${facilityId}/activity_definition/${encodeURIComponent(slug)}/`,
      { headers: getHeaders() },
    );
    if (!res.ok) return null;
    return (await res.json()) as ActivityDefinitionRead;
  } catch {
    return null;
  }
}

export async function searchActivityDefinition(
  slug: string | undefined,
  names: string[],
  facilityId: string,
): Promise<ActivityDefinitionRead | null> {
  if (slug?.trim()) {
    const bySlug = await retrieveActivityDefinition(facilityId, slug);
    if (bySlug?.code) return bySlug;
  }

  const queries = buildActivityDefinitionSearchQueries(names);
  if (!queries.length) return null;

  const seen = new Map<string, ActivityDefinitionRead>();

  for (const query of queries) {
    const results = await fetchActivityDefinitions(facilityId, {
      title: query,
    });
    for (const definition of results) {
      if (!seen.has(definition.slug)) seen.set(definition.slug, definition);
    }
  }

  return pickBestActivityDefinition([...seen.values()], queries);
}

export async function getSchedulableUsers(
  facilityId: string,
): Promise<CareUserMinimal[]> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl) return [];

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/facility/${facilityId}/appointments/available_users/`,
      { headers: getHeaders() },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { users: CareUserMinimal[] };
    return data.users ?? [];
  } catch {
    return [];
  }
}

export async function getSlotsForDay(
  facilityId: string,
  resourceType: SchedulableResourceType,
  resourceId: string,
  day: string,
): Promise<TokenSlotRead[]> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl) return [];

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/facility/${facilityId}/slots/get_slots_for_day/`,
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          resource_type: resourceType,
          resource_id: resourceId,
          day,
        }),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results: TokenSlotRead[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function getLocations(
  facilityId: string,
  name?: string,
): Promise<LocationMinimal[]> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl) return [];

  const url = new URL(`${baseUrl}/api/v1/facility/${facilityId}/location/`);
  url.searchParams.set("mode", "kind");
  if (name?.trim()) url.searchParams.set("name", name.trim());

  try {
    const res = await fetch(url.toString(), { headers: getHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as PaginatedResponse<LocationMinimal>;
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function getHealthcareServices(
  facilityId: string,
  name?: string,
): Promise<HealthcareServiceMinimal[]> {
  const baseUrl = CARE_API_URL;
  if (!baseUrl) return [];

  const url = new URL(
    `${baseUrl}/api/v1/facility/${facilityId}/healthcare_service/`,
  );
  url.searchParams.set("internal_type", "scheduling");
  url.searchParams.set("limit", "50");
  if (name?.trim()) url.searchParams.set("name", name.trim());

  try {
    const res = await fetch(url.toString(), { headers: getHeaders() });
    if (!res.ok) return [];
    const data =
      (await res.json()) as PaginatedResponse<HealthcareServiceMinimal>;
    return data.results ?? [];
  } catch {
    return [];
  }
}
