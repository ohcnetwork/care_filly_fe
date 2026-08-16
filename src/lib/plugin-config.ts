/**
 * Runtime plugin config, supplied by the CARE host.
 *
 * care_fe's PluginEngine fetches the backend's `PlugConfig` rows and
 * publishes them as
 *
 *   window.__CARE_PLUGIN_RUNTIME__ = { meta: { [slug]: PlugConfigMeta } }
 *
 * where each entry may carry an arbitrary `config` bag. Registering the
 * plugin in CARE therefore looks like:
 *
 *   {
 *     "url": "http://localhost:10122/assets/remoteEntry.js",
 *     "name": "care_filly_fe",
 *     "config": { "MEDISPEAK_API_URL": "https://api.medispeak.example/api/v2" }
 *   }
 *
 * Values read this way are resolved at call time, never at module scope:
 * the host assigns the global from an effect once the configs have loaded,
 * so anything captured at import time would still be undefined.
 */

interface PlugConfigMeta {
  url?: string;
  name?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __CARE_PLUGIN_RUNTIME__?: { meta?: Record<string, PlugConfigMeta> };
  }
}

/**
 * Identifiers this plugin may be registered under. `meta` is keyed by the
 * `PlugConfig.slug` chosen when the plugin was registered, which is not
 * guaranteed to match our manifest name — so we match on the entry's own
 * `name` too, and fall back to scanning every entry.
 */
const PLUGIN_ALIASES = ["care_filly_fe", "care-filly-fe"];

function readFrom(entry: PlugConfigMeta | undefined, key: string) {
  const value = entry?.config?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Look up one key from the host-supplied plugin config, if present. */
export function readPluginConfig(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const meta = window.__CARE_PLUGIN_RUNTIME__?.meta;
  if (!meta) return undefined;

  // Our own entry first, matched by slug or by the registration's name.
  for (const alias of PLUGIN_ALIASES) {
    const found =
      readFrom(meta[alias], key) ??
      readFrom(
        Object.values(meta).find((entry) => entry?.name === alias),
        key,
      );
    if (found) return found;
  }

  // Registered under an unexpected slug — take the first entry that
  // defines the key rather than failing on a naming mismatch.
  for (const entry of Object.values(meta)) {
    const found = readFrom(entry, key);
    if (found) return found;
  }
  return undefined;
}
