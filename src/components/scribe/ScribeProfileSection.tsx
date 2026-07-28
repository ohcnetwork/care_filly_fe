import { Info, Loader2, Mic } from "lucide-react";
import { useState } from "react";

import { SCRIBE_BASE_URL } from "@/lib/scribe-be";

import { Switch } from "@/components/ui/switch";

import { TncDialog } from "@/components/scribe/TncDialog";

import { useScribePreference } from "@/hooks/useScribePreference";
import { useTranslation } from "@/hooks/useTranslation";

interface ScribeProfileSectionProps {
  className?: string;
}

/**
 * "AI Scribe" opt-in card, reached from the user's own nav menu
 * (registered via `userNavItems` in the manifest, see
 * `ScribeSettingsPage`).
 *
 * Scribe is opt-in per user: the floating scribe button only appears
 * after the user enables it here. Enabling opens the consent (TnC)
 * dialog first; acceptance is recorded server-side with the TnC hash,
 * so a changed TnC automatically requires re-consent.
 */
export default function ScribeProfileSection({
  className,
}: ScribeProfileSectionProps) {
  const { t } = useTranslation();
  const pref = useScribePreference();
  const [tncOpen, setTncOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SCRIBE_BASE_URL) return null;

  // Only relevant when at least one of the user's facilities actually
  // offers scribe — otherwise let the user know who to contact instead
  // of silently hiding the section.
  const facilityUnavailable = !pref.isLoading && !pref.facilityAvailable;

  const handleToggle = async (checked: boolean) => {
    setError(null);
    if (checked) {
      // Consent first — the preference is only enabled on accept.
      setTncOpen(true);
      return;
    }
    setSaving(true);
    try {
      await pref.setEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`care-filly-fe-container ${className ?? ""}`}>
      <TncDialog
        open={tncOpen}
        tnc={pref.tnc}
        onAccept={async () => {
          await pref.setEnabled(true);
          setTncOpen(false);
        }}
        onClose={() => setTncOpen(false)}
      />

      <section className="flex flex-col gap-5 sm:flex-row">
        {/* Left: label + description */}
        <div className="sm:w-1/4">
          <div className="my-1 text-sm leading-5">
            <p className="mb-2 font-semibold">{t("ai_filly")}</p>
            <p className="text-secondary-600">
              {t("scribe_profile_section_description")}
            </p>
          </div>
        </div>

        {/* Right: card */}
        <div className="sm:w-3/4">
          <div className="overflow-visible rounded-lg bg-white px-4 py-5 shadow-sm sm:rounded-lg sm:px-6 items-center h-full flex">
            {pref.isLoading ? (
              <div className="flex w-full items-center gap-3">
                <Loader2 className="size-6 shrink-0 animate-spin text-gray-400" />
              </div>
            ) : facilityUnavailable ? (
              <div className="flex w-full items-center gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <Info className="h-4 w-4" />
                </span>
                <p className="text-sm text-gray-600">
                  {t("scribe_not_enabled_for_facility")}
                </p>
              </div>
            ) : (
              <div className="flex w-full items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                    <Mic className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {pref.enabled
                        ? t("scribe_enabled")
                        : t("scribe_disabled")}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {pref.enabled
                        ? t("scribe_enabled_note")
                        : t("scribe_disabled_note")}
                    </p>
                    {error && (
                      <p className="mt-1 text-xs text-red-500">{error}</p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {saving && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                  )}
                  <Switch
                    checked={pref.enabled}
                    disabled={saving}
                    onCheckedChange={(checked) => void handleToggle(checked)}
                    aria-label={t("enable_ai_scribe")}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
