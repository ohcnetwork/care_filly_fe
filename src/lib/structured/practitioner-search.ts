import type { CareUserMinimal } from "./care-api";

const TITLE_WORDS = new Set([
  "dr",
  "dr.",
  "doctor",
  "mr",
  "mr.",
  "mrs",
  "mrs.",
  "ms",
  "ms.",
]);

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(text: string): string[] {
  return normalizeName(text)
    .split(" ")
    .filter((word) => word && !TITLE_WORDS.has(word));
}

/** Strips a leading "Dr."/"Doctor" honorific so the remaining name tokens
 *  can be matched against a practitioner's first/last name. */
export function buildPractitionerSearchQueries(names: string[]): string[] {
  const queries = new Set<string>();

  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    queries.add(name);

    const stripped = nameTokens(name).join(" ");
    if (stripped) queries.add(stripped);
  }

  return [...queries].filter((query) => query.length >= 2);
}

function candidateNames(user: CareUserMinimal): string[] {
  return [
    `${user.first_name ?? ""} ${user.last_name ?? ""}`,
    user.username ?? "",
  ].filter((name) => name.trim().length > 0);
}

export function scorePractitioner(
  user: CareUserMinimal,
  queries: string[],
): number {
  const names = candidateNames(user).map(normalizeName);
  const nameTokenSet = new Set(names.flatMap((name) => name.split(" ")));
  let best = 0;

  for (const query of queries) {
    const normalized = normalizeName(query);
    if (!normalized) continue;

    for (const name of names) {
      if (name === normalized) best = Math.max(best, 100);
      else if (name.startsWith(normalized) || normalized.startsWith(name)) {
        best = Math.max(best, 90);
      } else if (name.includes(normalized) || normalized.includes(name)) {
        best = Math.max(best, 80);
      }
    }

    const queryTokens = nameTokens(query);
    if (!queryTokens.length) continue;

    const matched = queryTokens.filter((token) =>
      nameTokenSet.has(token),
    ).length;
    if (matched === queryTokens.length) {
      best = Math.max(best, 85);
    } else if (matched > 0) {
      best = Math.max(best, Math.round((matched / queryTokens.length) * 75));
    }
  }

  return best;
}

/** Picks the practitioner best matching the spoken name, requiring a
 *  fairly confident score so an unrelated staff member never gets booked
 *  by mistake — ambiguous input should surface an error instead. */
export function pickBestPractitioner(
  users: CareUserMinimal[],
  queries: string[],
): CareUserMinimal | null {
  if (!users.length || !queries.length) return null;

  const ranked = users
    .map((user) => ({ user, score: scorePractitioner(user, queries) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 50) return null;

  // Reject an ambiguous tie between two different candidates.
  const runnerUp = ranked[1];
  if (runnerUp && runnerUp.score === best.score) return null;

  return best.user;
}
