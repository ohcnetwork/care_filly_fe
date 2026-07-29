import { getCurrentUser } from "@/lib/structured/care-api";

/**
 * Persisted position of the floating Filly widget (see FillyController's
 * `useDraggableFab`). Keyed per-user because a shared device/kiosk can be
 * used by more than one CARE user — without this, one user's dragged
 * position would leak into the next person's session on the same browser.
 */
const FAB_POSITION_STORAGE_PREFIX = "care_filly_fab_offset";

/** Dispatched (on `window`) whenever the position is reset from elsewhere
 *  (e.g. the "Reset position" button on the settings page), so any
 *  currently-mounted widget snaps back immediately without a reload. */
export const FAB_POSITION_RESET_EVENT = "care-filly-fab-position-reset";

export function fabPositionStorageKey(userId: string | null): string {
  return userId
    ? `${FAB_POSITION_STORAGE_PREFIX}:${userId}`
    : FAB_POSITION_STORAGE_PREFIX;
}

/** Best-effort current user id; `null` outside CARE or if the request fails
 *  (falls back to a shared, unscoped position in that case). */
export async function resolveCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

export function loadStoredFabOffset(key: string): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return parsed;
    }
  } catch {
    // ignore malformed/unavailable storage
  }
  return { x: 0, y: 0 };
}

/**
 * Clears the persisted widget position for the current user (used by the
 * "Reset Filly position" button in FillySettingsPage) and notifies any
 * mounted widget instance in this tab to snap back immediately.
 */
export async function resetFabPositionForCurrentUser(): Promise<void> {
  const userId = await resolveCurrentUserId();
  try {
    localStorage.removeItem(fabPositionStorageKey(userId));
    // Also clear the unscoped/legacy key in case it was ever used as a
    // fallback (e.g. getCurrentUser briefly failing) so nothing lingers.
    localStorage.removeItem(FAB_POSITION_STORAGE_PREFIX);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  window.dispatchEvent(new Event(FAB_POSITION_RESET_EVENT));
}
