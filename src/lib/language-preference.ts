/**
 * Persisted spoken-language preference for Filly recording. Keyed per-user,
 * same rationale as `mic-preference.ts` — a shared/kiosk device can be used
 * by more than one CARE user.
 */
import { resolveCurrentUserId } from "@/lib/fab-position";

const LANGUAGE_STORAGE_PREFIX = "care_filly_language";

export function languageStorageKey(userId: string | null): string {
  return userId
    ? `${LANGUAGE_STORAGE_PREFIX}:${userId}`
    : LANGUAGE_STORAGE_PREFIX;
}

export function loadStoredLanguage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeLanguage(key: string, language: string): void {
  try {
    localStorage.setItem(key, language);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

/** The user's preferred spoken language, if one was ever picked in settings. */
export async function resolvePreferredLanguage(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  return loadStoredLanguage(languageStorageKey(userId));
}
