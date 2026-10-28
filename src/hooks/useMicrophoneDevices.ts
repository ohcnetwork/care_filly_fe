import { useCallback, useLayoutEffect, useState } from "react";

import { resolveCurrentUserId } from "@/lib/fab-position";
import {
  loadStoredMicDeviceId,
  micDeviceStorageKey,
  storeMicDeviceId,
} from "@/lib/mic-preference";

export interface MicrophoneOption {
  deviceId: string;
  label: string;
}

interface UseMicrophoneDevicesReturn {
  devices: MicrophoneOption[];
  selectedDeviceId: string | null;
  isLoading: boolean;
  error: string | null;
  selectDevice: (deviceId: string) => void;
}

/**
 * Lists available microphones and persists the chosen one (per-user), so
 * `useFilly`'s `startRecording` can request that exact device instead of
 * whatever the browser picks by default.
 *
 * `enabled` (default `true`) gates the actual enumeration — it requests mic
 * access, so callers that render unconditionally (e.g. the always-mounted
 * `FillyController`) should pass `false` until the user opens the picker,
 * rather than prompting for mic permission on every page load.
 */
export function useMicrophoneDevices(
  enabled = true,
): UseMicrophoneDevicesReturn {
  const [devices, setDevices] = useState<MicrophoneOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        // Device labels are only populated once mic access has been
        // granted at least once — request it so the picker shows real
        // names instead of blank ones.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        stream.getTracks().forEach((track) => track.stop());

        const all = await navigator.mediaDevices.enumerateDevices();
        const mics = all
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${i + 1}`,
          }));

        const userId = await resolveCurrentUserId();
        const key = micDeviceStorageKey(userId);
        const stored = loadStoredMicDeviceId(key);
        const preferred =
          stored && mics.some((m) => m.deviceId === stored)
            ? stored
            : (mics[0]?.deviceId ?? null);

        if (cancelled) return;
        setDevices(mics);
        setStorageKey(key);
        setSelectedDeviceId(preferred);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to list microphones",
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const selectDevice = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      if (storageKey) storeMicDeviceId(storageKey, deviceId);
    },
    [storageKey],
  );

  return { devices, selectedDeviceId, isLoading, error, selectDevice };
}
