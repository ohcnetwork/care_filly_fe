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
      if (!results.length) continue;

      const normalized = display.toLowerCase();
      let best = results[0];
      let bestScore = bestResultScore(results[0], normalized);
      for (const result of results.slice(1)) {
        const resultScore = bestResultScore(result, normalized);
        if (resultScore > bestScore) {
          best = result;
          bestScore = resultScore;
        }
      }

      return {
        system: best.system,
        code: best.code,
        display: best.display,
      };
    } catch (err) {
      console.warn("[Filly] searchByDisplay failed:", err);
    }
  }
  return null;
}

// Ported from care_fe's ValueSetSearchContent (ENG-268)
const EXCLUDED_DESIGNATION_USE_CODES = new Set([
  "900000000000003001", // SNOMED Fully specified name
  "FullySpecifiedName", // LOINC Fully specified name
]);

function getSynonyms(
  result: ValueSetExpandResult["results"][number],
): string[] {
  if (!result.designation?.length) return [];
  return result.designation
    .filter(
      (d) =>
        d.value &&
        d.value !== result.display &&
        (!d.language || d.language.startsWith("en")) &&
        (!d.use?.code || !EXCLUDED_DESIGNATION_USE_CODES.has(d.use.code)),
    )
    .map((d) => d.value);
}

// 3 = starts with, 2 = word-boundary match, 1 = substring, 0 = no match.
function scoreMatch(text: string, search: string): number {
  const t = text.toLowerCase();
  if (t.startsWith(search)) return 3;
  if (t.split(/\s+/).some((word) => word.startsWith(search))) return 2;
  if (t.includes(search)) return 1;
  return 0;
}

function bestResultScore(
  result: ValueSetExpandResult["results"][number],
  search: string,
): number {
  let best = scoreMatch(result.display, search);
  for (const synonym of getSynonyms(result)) {
    best = Math.max(best, scoreMatch(synonym, search));
  }
  return best;
}
