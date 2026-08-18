import type { ProductKnowledgeBase } from "./care-api";

/**
 * Build search query variants that include strength (mg, mcg, etc.)
 * so "Dolo 650" and "Pantoprazole 40mg" resolve to the right product.
 */
export function buildMedicationSearchQueries(names: string[]): string[] {
  const queries = new Set<string>();

  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;

    queries.add(name);

    const withMg = name.replace(
      /\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu|%)\b/gi,
      (_, num: string, unit: string) => `${num} ${unit.toLowerCase()}`,
    );
    if (withMg !== name) queries.add(withMg);

    const compactMg = name.replace(
      /\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu|%)\b/gi,
      (_, num: string, unit: string) => `${num}${unit.toLowerCase()}`,
    );
    if (compactMg !== name) queries.add(compactMg);

    const bareNumber = name.match(/\b(\d{2,4})\b/);
    if (bareNumber && !/\b(mg|mcg|g|iu|%)\b/i.test(name)) {
      const baseName = name.replace(bareNumber[0], "").trim();
      if (baseName) {
        queries.add(`${baseName} ${bareNumber[1]} mg`);
        queries.add(`${baseName} ${bareNumber[1]}mg`);
      }
    }

    const genericBase = name
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|%)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (genericBase && genericBase !== name) {
      queries.add(genericBase);
    }
  }

  return [...queries].filter((q) => q.length >= 2);
}

function productNames(product: ProductKnowledgeBase): string[] {
  return [
    product.name,
    ...(product.names?.map((n) => n.name) ?? []),
    product.code?.display ?? "",
  ].filter(Boolean);
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\bmg\b/g, "mg")
    .trim();
}

export function scoreProductMatch(
  product: ProductKnowledgeBase,
  queries: string[],
): number {
  const names = productNames(product).map(normalizeForMatch);
  let bestDoseAware = 0;
  let bestGeneric = 0;

  for (const query of queries) {
    const q = normalizeForMatch(query);
    if (!q) continue;
    const doseAware = /\d/.test(q);

    for (const name of names) {
      let score = 0;
      if (name === q) {
        score = 100;
      } else if (name.startsWith(q) || q.startsWith(name)) {
        score = 85;
      } else if (name.includes(q) || q.includes(name)) {
        score = 70;
      }

      if (doseAware) {
        bestDoseAware = Math.max(bestDoseAware, score);
      } else {
        bestGeneric = Math.max(bestGeneric, score);
      }
    }
  }

  let best = bestDoseAware > 0 ? bestDoseAware : bestGeneric;

  if (names.some((n) => n.includes("containing product"))) {
    best -= 25;
  }

  return best;
}

export function pickBestProduct(
  results: ProductKnowledgeBase[],
  queries: string[],
): ProductKnowledgeBase | null {
  if (!results.length) return null;

  const ranked = results
    .map((product) => ({
      product,
      score: scoreProductMatch(product, queries),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 40) return null;
  return best.product;
}
