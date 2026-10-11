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

/**
 * `"mic"` records from the microphone only. `"mic_and_system"` (default)
 * also mixes in system/tab audio — needed in telemedicine calls, where the
 * patient's voice plays back as system audio rather than through the
 * clinician's own microphone.
 */
export type AudioSourceMode = "mic" | "mic_and_system";

const AUDIO_SOURCE_STORAGE_PREFIX = "care_filly_audio_source";

export function audioSourceStorageKey(userId: string | null): string {
  return userId
    ? `${AUDIO_SOURCE_STORAGE_PREFIX}:${userId}`
    : AUDIO_SOURCE_STORAGE_PREFIX;
}

export function loadStoredAudioSourceMode(key: string): AudioSourceMode | null {
  try {
    const value = localStorage.getItem(key);
    return value === "mic" || value === "mic_and_system" ? value : null;
  } catch {
    return null;
  }
}

export function storeAudioSourceMode(key: string, mode: AudioSourceMode): void {
  try {
    localStorage.setItem(key, mode);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

/** The user's preferred audio source, defaulting to mic + system audio. */
export async function resolvePreferredAudioSource(): Promise<AudioSourceMode> {
  const userId = await resolveCurrentUserId();
  return (
    loadStoredAudioSourceMode(audioSourceStorageKey(userId)) ?? "mic_and_system"
  );
}
