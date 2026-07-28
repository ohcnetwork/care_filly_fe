import { getHeaders } from "@/lib/request";
import { SCRIBE_BASE_URL } from "@/lib/scribe-be";

export interface QuotaUser {
  username: string;
  first_name: string;
  last_name: string;
}

export interface ScribeQuota {
  external_id: string;
  /** Null for the facility-level quota row. */
  user: QuotaUser | null;
  facility_external_id: string;
  facility_name: string | null;
  /** Monthly token pool (facility row) or allowance (user row). */
  tokens: number;
  tokens_per_user: number;
  /** Tokens consumed in the current calendar month. */
  used: number;
  allow_scribe: boolean;
  tnc_accepted_date: string | null;
  created_by: QuotaUser | null;
  created_date: string | null;
  modified_date: string | null;
}

export interface MyQuotaResponse {
  quotas: ScribeQuota[];
  tnc: string;
  tnc_accepted: boolean;
}

export interface QuotaListResponse {
  count: number;
  results: ScribeQuota[];
}

export interface QuotaListFilters {
  facility_id?: string;
  facility?: string;
  username?: string;
  ordering?: string;
  limit?: number;
  offset?: number;
}

export interface QuotaCreateRequest {
  facility_external_id: string;
  tokens: number;
  tokens_per_user: number;
  allow_scribe: boolean;
}

export class QuotaApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function quotaFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): Promise<T> {
  return scribeApiFetch<T>(`/quota${path}`, options);
}

/** Authenticated fetch against the scribe backend's v1 base. */
async function scribeApiFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): Promise<T> {
  if (!SCRIBE_BASE_URL) {
    throw new QuotaApiError(0, "no_backend", "No scribe backend configured");
  }
  const url = new URL(`${SCRIBE_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: getHeaders(),
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } })
      .error;
    throw new QuotaApiError(
      response.status,
      error?.code ?? `http_${response.status}`,
      error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return data as T;
}

function toQuery(filters: QuotaListFilters): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
}

export const quotaApi = {
  myQuota: (facilityId: string) =>
    quotaFetch<MyQuotaResponse>("/my", { query: { facility_id: facilityId } }),
  acceptTnc: (facilityId: string) =>
    quotaFetch<{ detail: string }>("/accept-tnc", {
      method: "POST",
      body: { facility_id: facilityId },
    }),
  list: (filters: QuotaListFilters = {}) =>
    quotaFetch<QuotaListResponse>("", { query: toQuery(filters) }),
  get: (externalId: string) => quotaFetch<ScribeQuota>(`/${externalId}`),
  create: (data: QuotaCreateRequest) =>
    quotaFetch<ScribeQuota>("", { method: "POST", body: data }),
  update: (externalId: string, data: Partial<QuotaCreateRequest>) =>
    quotaFetch<ScribeQuota>(`/${externalId}`, { method: "PATCH", body: data }),
  delete: (externalId: string) =>
    quotaFetch<{ detail: string }>(`/${externalId}`, { method: "DELETE" }),
};

export interface ScribePreference {
  /** Whether the user has switched scribe on in their profile. */
  enabled: boolean;
  /** Current terms & conditions text. */
  tnc: string;
  /** Whether the recorded consent matches the current TnC. */
  tnc_accepted: boolean;
  tnc_accepted_date: string | null;
  /** Whether any of the user's facilities has scribe enabled. */
  facility_available: boolean;
}

/** Per-user scribe opt-in, managed from the profile page. */
export const scribePreferenceApi = {
  get: () => scribeApiFetch<ScribePreference>("/preferences/scribe"),
  set: (enabled: boolean) =>
    scribeApiFetch<ScribePreference>("/preferences/scribe", {
      method: "PUT",
      body: { enabled },
    }),
};

export interface FacilityOption {
  id: string;
  name: string;
}

/** Superadmin facility search on the CARE API (for quota creation). */
export async function searchFacilities(
  searchText: string,
): Promise<FacilityOption[]> {
  const baseUrl = window.CARE_API_URL;
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/getallfacilities/`);
  url.searchParams.set("limit", "20");
  if (searchText.trim()) url.searchParams.set("search_text", searchText.trim());
  const response = await fetch(url.toString(), { headers: getHeaders() });
  if (!response.ok) return [];
  const data = (await response.json()) as { results?: FacilityOption[] };
  return data.results ?? [];
}
