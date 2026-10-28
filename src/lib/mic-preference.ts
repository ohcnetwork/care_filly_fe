/**
 * Persisted microphone device choice for Filly recording. Keyed per-user,
 * same rationale as `fab-position.ts` — a shared device/kiosk can be used
 * by more than one CARE user.
 */
import { resolveCurrentUserId } from "@/lib/fab-position";

const MIC_DEVICE_STORAGE_PREFIX = "care_filly_mic_device";

export function micDeviceStorageKey(userId: string | null): string {
  return userId
    ? `${MIC_DEVICE_STORAGE_PREFIX}:${userId}`
    : MIC_DEVICE_STORAGE_PREFIX;
}

export function loadStoredMicDeviceId(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeMicDeviceId(key: string, deviceId: string): void {
  try {
    localStorage.setItem(key, deviceId);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

export async function clearPreferredMicDeviceId(): Promise<void> {
  const userId = await resolveCurrentUserId();
  try {
    localStorage.removeItem(micDeviceStorageKey(userId));
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

/** The user's preferred mic device id, if one was ever picked in settings. */
export async function resolvePreferredMicDeviceId(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  return loadStoredMicDeviceId(micDeviceStorageKey(userId));
}
