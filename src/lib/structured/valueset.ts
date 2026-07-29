import { getHeaders } from "@/lib/request";

import { buildMedicationSearchQueries } from "./medication-search";
import type { Code } from "./types";

interface ValueSetExpandResult {
  results: Array<
    Code & {
      designation?: Array<{
        language: string;
        use?: Code;
        value: string;
      }>;
    }
  >;
}

export async function expandValueSet(
  system: string,
  search: string,
  count = 10,
): Promise<ValueSetExpandResult["results"]> {
  const baseUrl = window.CARE_API_URL;
  if (!baseUrl) {
    console.warn("[Filly] CARE_API_URL not set; cannot resolve SNOMED codes");
    return [];
  }

  const res = await fetch(`${baseUrl}/api/v1/valueset/${system}/expand/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ search, count }),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as ValueSetExpandResult;
  return data.results ?? [];
}

export async function lookupCode(
  code: string,
  displays: string[],
  valueSetSlug: string,
): Promise<Code | null> {
  if (!code) return searchByDisplay(valueSetSlug, displays);

  try {
    const results = await expandValueSet(valueSetSlug, code, 10);
    const match = results.find((r) => r.code === code) ?? results[0];
    if (!match) return searchByDisplay(valueSetSlug, displays);

    const displayLower = displays.map((d) => d.toLowerCase());
    const names = [
      match.display,
      ...(match.designation?.map((d) => d.value) ?? []),
    ].map((n) => n.toLowerCase());

    const hasDisplayMatch = displayLower.some((d) =>
      names.some((n) => n.includes(d) || d.includes(n)),
    );

    if (hasDisplayMatch || results.length === 1) {
      return {
        system: match.system,
        code: match.code,
        display: match.display,
      };
    }
  } catch (err) {
    console.warn("[Filly] lookupCode failed:", err);
  }

  return searchByDisplay(valueSetSlug, displays);
}

export async function searchByDisplay(
  valueSetSlug: string,
  displays: string[],
): Promise<Code | null> {
  const queries =
    valueSetSlug === "system-medication"
      ? buildMedicationSearchQueries(displays)
      : displays.filter((d) => d?.trim());

  for (const display of queries) {
    if (!display?.trim()) continue;
    try {
      const results = await expandValueSet(valueSetSlug, display, 15);
      const normalized = display.toLowerCase();
      const best =
        results.find((r) => r.display.toLowerCase() === normalized) ??
        results.find((r) => {
          const d = r.display.toLowerCase();
          return d.includes(normalized) || normalized.includes(d);
        }) ??
        results[0];
      if (best) {
        return {
          system: best.system,
          code: best.code,
          display: best.display,
        };
      }
    } catch (err) {
      console.warn("[Filly] searchByDisplay failed:", err);
    }
  }
  return null;
}
