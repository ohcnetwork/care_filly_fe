// Filly backend: window.CARE_API_URL + /api/care_filly — the care_filly
// CARE backend plugin, same origin/auth as the rest of the CARE API.
export function resolveFillyBackend(): string | null {
  const careApiUrl =
    typeof window !== "undefined" ? window.CARE_API_URL : undefined;
  if (careApiUrl) {
    const base = careApiUrl.replace(/\/$/, "");
    return `${base}/api/care_filly/v1`;
  }
  return null;
}

/** Base URL of the filly backend, ending in /v1 (or null when unresolvable). */
export const FILLY_BASE_URL = resolveFillyBackend();
