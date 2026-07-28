// Scribe backend resolution (in priority order):
// 1. REACT_SCRIBE_BE_URL env — explicit override (standalone FastAPI server)
// 2. window.CARE_API_URL + /api/care_filly — CARE backend plugin, same
//    origin/auth as the rest of the CARE API (care_filly_fe convention)
const SCRIBE_BE_OVERRIDE = (import.meta.env.REACT_SCRIBE_BE_URL || "").replace(
  /\/$/,
  "",
);

/** True when an explicit standalone backend override is configured. */
export const SCRIBE_BE_IS_OVERRIDE = Boolean(SCRIBE_BE_OVERRIDE);

export function resolveScribeBackend(): string | null {
  if (SCRIBE_BE_OVERRIDE) {
    return `${SCRIBE_BE_OVERRIDE}/v1`;
  }
  const careApiUrl =
    typeof window !== "undefined" ? window.CARE_API_URL : undefined;
  if (careApiUrl) {
    const base = careApiUrl.replace(/\/$/, "");
    return `${base}/api/care_filly/v1`;
  }
  return null;
}

/** Base URL of the scribe backend, ending in /v1 (or null when unresolvable). */
export const SCRIBE_BASE_URL = resolveScribeBackend();
