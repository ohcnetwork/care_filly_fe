import { useCallback, useLayoutEffect, useState } from "react";

import { resolveCurrentUserId } from "@/lib/fab-position";
import {
  languageStorageKey,
  loadStoredLanguage,
  storeLanguage,
} from "@/lib/language-preference";

export interface FillyLanguageOption {
  code: string;
  labelKey: string;
}

// Bare ISO codes — the backend's Sarvam adapter expands them to BCP-47
// (e.g. "hi" -> "hi-IN") itself; "auto" is Medispeak's own no-hint sentinel
// (Scribe::AsrStage::AUTO_DETECT) — anything else reaches the ASR provider
// as a literal, invalid language code.
export const FILLY_LANGUAGE_OPTIONS: FillyLanguageOption[] = [
  { code: "auto", labelKey: "language_auto_detect" },
  { code: "en", labelKey: "language_english" },
  { code: "hi", labelKey: "language_hindi" },
  { code: "ta", labelKey: "language_tamil" },
  { code: "te", labelKey: "language_telugu" },
  { code: "ml", labelKey: "language_malayalam" },
  { code: "kn", labelKey: "language_kannada" },
  { code: "bn", labelKey: "language_bengali" },
  { code: "mr", labelKey: "language_marathi" },
  { code: "gu", labelKey: "language_gujarati" },
  { code: "pa", labelKey: "language_punjabi" },
  { code: "as", labelKey: "language_assamese" },
];

const DEFAULT_LANGUAGE = FILLY_LANGUAGE_OPTIONS[0].code;

interface UseFillyLanguageReturn {
  language: string;
  selectLanguage: (code: string) => void;
}

/**
 * Persists the spoken-language hint (per-user) so `useFilly`'s
 * `startRecording` sends the clinician's own choice instead of always
 * falling back to the build-time `REACT_FILLY_LANGUAGES` default.
 */
export function useFillyLanguage(): UseFillyLanguageReturn {
  const [language, setLanguageState] = useState(DEFAULT_LANGUAGE);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    resolveCurrentUserId().then((userId) => {
      if (cancelled) return;
      const key = languageStorageKey(userId);
      const stored = loadStoredLanguage(key);
      setStorageKey(key);
      if (stored && FILLY_LANGUAGE_OPTIONS.some((o) => o.code === stored)) {
        setLanguageState(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectLanguage = useCallback(
    (code: string) => {
      setLanguageState(code);
      if (storageKey) storeLanguage(storageKey, code);
    },
    [storageKey],
  );

  return { language, selectLanguage };
}
