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

/** The user's preferred mic device id, if one was ever picked in settings. */
export async function resolvePreferredMicDeviceId(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  return loadStoredMicDeviceId(micDeviceStorageKey(userId));
}

const SYSTEM_AUDIO_STORAGE_PREFIX = "care_filly_system_audio";

/**
 * Whether Filly should also capture system/tab audio (e.g. the remote party
 * of a telemedicine call) alongside the microphone.
 */
export function systemAudioStorageKey(userId: string | null): string {
  return userId
    ? `${SYSTEM_AUDIO_STORAGE_PREFIX}:${userId}`
    : SYSTEM_AUDIO_STORAGE_PREFIX;
}

export function loadStoredSystemAudio(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function storeSystemAudio(key: string, enabled: boolean): void {
  try {
    localStorage.setItem(key, String(enabled));
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}
