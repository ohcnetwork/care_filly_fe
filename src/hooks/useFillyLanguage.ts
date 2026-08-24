import { useCallback, useLayoutEffect, useMemo, useState } from "react";

import { resolveCurrentUserId } from "@/lib/fab-position";
import {
  languageStorageKey,
  loadStoredLanguage,
  storeLanguage,
} from "@/lib/language-preference";
import { readPluginConfig } from "@/lib/plugin-config";

export interface FillyLanguageOption {
  code: string;
  labelKey: string;
}

// Bare ISO codes — the backend's Sarvam adapter expands them to BCP-47
// (e.g. "hi" -> "hi-IN") itself; "auto" is Medispeak's own no-hint sentinel
// (Scribe::AsrStage::AUTO_DETECT) — anything else reaches the ASR provider
// as a literal, invalid language code. Only used to label a deployment's
// configured codes — it is not itself the list offered in the UI.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
  auto: "language_auto_detect",
  en: "language_english",
  hi: "language_hindi",
  ta: "language_tamil",
  te: "language_telugu",
  ml: "language_malayalam",
  kn: "language_kannada",
  bn: "language_bengali",
  mr: "language_marathi",
  gu: "language_gujarati",
  pa: "language_punjabi",
  as: "language_assamese",
  ur: "language_urdu",
  ne: "language_nepali",
  kok: "language_konkani",
  ks: "language_kashmiri",
  sd: "language_sindhi",
  sa: "language_sanskrit",
  sat: "language_santali",
  mni: "language_manipuri",
  brx: "language_bodo",
  mai: "language_maithili",
  doi: "language_dogri",
};

/**
 * The languages offered in the UI, resolved at call time (never module
 * scope — the plugin config global is assigned by CARE's host after
 * mount): the same "FILLY_LANGUAGES" env var `useFilly` already reads for
 * its recording-language default, plus the plugin-config override CARE
 * admins can set per-deployment without a rebuild (see `MEDISPEAK_API_URL`
 * in medispeak-api.ts for the same pattern). Unconfigured, only "auto"
 * (auto-detect) is offered — a deployment opts into specific languages.
 */
function resolveFillyLanguageOptions(): FillyLanguageOption[] {
  const configured =
    readPluginConfig("FILLY_LANGUAGES") ??
    readPluginConfig("REACT_FILLY_LANGUAGES") ??
    (import.meta.env.REACT_FILLY_LANGUAGES as string | undefined);

  const codes = configured
    ? configured
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean)
    : [];

  if (!codes.includes("auto")) codes.unshift("auto");

  return [...new Set(codes)].map((code) => ({
    code,
    labelKey: LANGUAGE_LABEL_KEYS[code] ?? code,
  }));
}

interface UseFillyLanguageReturn {
  language: string;
  options: FillyLanguageOption[];
  selectLanguage: (code: string) => void;
}

/**
 * Persists the spoken-language hint (per-user) so `useFilly`'s
 * `startRecording` sends the clinician's own choice instead of always
 * falling back to the build-time `REACT_FILLY_LANGUAGES` default.
 */
export function useFillyLanguage(): UseFillyLanguageReturn {
  // Deferred to render (not module scope) so a plugin-config override that
  // loads after mount is still picked up.
  const options = useMemo(resolveFillyLanguageOptions, []);
  const [language, setLanguageState] = useState(options[0].code);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    resolveCurrentUserId().then((userId) => {
      if (cancelled) return;
      const key = languageStorageKey(userId);
      const stored = loadStoredLanguage(key);
      setStorageKey(key);
      if (stored && options.some((o) => o.code === stored)) {
        setLanguageState(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [options]);

  const selectLanguage = useCallback(
    (code: string) => {
      setLanguageState(code);
      if (storageKey) storeLanguage(storageKey, code);
    },
    [storageKey],
  );

  return { language, options, selectLanguage };
}
