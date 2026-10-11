import { useCallback, useEffect, useState } from "react";

import { resolveCurrentUserId } from "@/lib/fab-position";
import {
  loadStoredSystemAudio,
  storeSystemAudio,
  systemAudioStorageKey,
} from "@/lib/mic-preference";

/** Browsers without `getDisplayMedia` (most mobile) can't capture system audio. */
export const isSystemAudioSupported =
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getDisplayMedia === "function";

/**
 * Per-user toggle for capturing system/tab audio (the remote side of a
 * telemedicine call) in addition to the microphone.
 */
export function useSystemAudioPreference() {
  const [enabled, setEnabledState] = useState(false);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveCurrentUserId()
      .catch(() => null)
      .then((userId) => {
        if (cancelled) return;
        const key = systemAudioStorageKey(userId);
        setStorageKey(key);
        setEnabledState(loadStoredSystemAudio(key));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback(
    (value: boolean) => {
      setEnabledState(value);
      if (storageKey) storeSystemAudio(storageKey, value);
    },
    [storageKey],
  );

  return { enabled: enabled && isSystemAudioSupported, setEnabled };
}
