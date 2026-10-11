import { useCallback, useLayoutEffect, useState } from "react";

import { resolveCurrentUserId } from "@/lib/fab-position";
import {
  type AudioSourceMode,
  audioSourceStorageKey,
  loadStoredAudioSourceMode,
  storeAudioSourceMode,
} from "@/lib/mic-preference";

interface UseAudioSourcePreferenceReturn {
  mode: AudioSourceMode;
  selectMode: (mode: AudioSourceMode) => void;
}

/**
 * Persists the clinician's audio-source choice (per-user): mic + system/tab
 * audio (default) for telemedicine calls where the patient's side of the
 * conversation plays back as system audio rather than through the
 * clinician's own microphone, or mic-only. No `getUserMedia` call is
 * needed here (unlike `useMicrophoneDevices`), so no `enabled` gate.
 */
export function useAudioSourcePreference(): UseAudioSourcePreferenceReturn {
  const [mode, setMode] = useState<AudioSourceMode>("mic_and_system");
  const [storageKey, setStorageKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    resolveCurrentUserId().then((userId) => {
      if (cancelled) return;
      const key = audioSourceStorageKey(userId);
      const stored = loadStoredAudioSourceMode(key);
      setStorageKey(key);
      if (stored) setMode(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectMode = useCallback(
    (next: AudioSourceMode) => {
      setMode(next);
      if (storageKey) storeAudioSourceMode(storageKey, next);
    },
    [storageKey],
  );

  return { mode, selectMode };
}
