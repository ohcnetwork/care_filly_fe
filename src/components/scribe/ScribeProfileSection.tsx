import { Loader2, Mic } from "lucide-react";
import { useState } from "react";

import { SCRIBE_BASE_URL } from "@/lib/scribe-be";

import { Switch } from "@/components/ui/switch";

import { TncDialog } from "@/components/scribe/TncDialog";

import { useScribePreference } from "@/hooks/useScribePreference";
import { useTranslation } from "@/hooks/useTranslation";

interface ScribeProfileSectionProps {
  user: unknown;
  isOwnProfile: boolean;
  className?: string;
}

/**
 * "AI Scribe" section on the user's profile page (rendered through
 * care_fe's `UserProfileSections` plugin slot).
 *
 * Scribe is opt-in per user: the floating scribe button only appears
 * after the user enables it here. Enabling opens the consent (TnC)
 * dialog first; acceptance is recorded server-side with the TnC hash,
 * so a changed TnC automatically requires re-consent.
 */
export default function ScribeProfileSection({
  isOwnProfile,
  className,
}: ScribeProfileSectionProps) {
  const { t } = useTranslation();
  const pref = useScribePreference();
  const [tncOpen, setTncOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the user themself can manage their scribe opt-in, and only
  // when at least one of their facilities actually offers scribe —
  // otherwise there is nothing to enable.
  if (!isOwnProfile || !SCRIBE_BASE_URL) return null;
  if (!pref.isLoading && !pref.facilityAvailable) return null;

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
    <div className={`care-scribie-fe-container ${className ?? ""}`}>
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
            <p className="mb-2 font-semibold">{t("ai_scribe")}</p>
            <p className="text-secondary-600">
              {t("scribe_profile_section_description")}
            </p>
          </div>
        </div>

        {/* Right: card */}
        <div className="sm:w-3/4">
          <div className="overflow-visible rounded-lg bg-white px-4 py-5 shadow-sm sm:rounded-lg sm:px-6 items-center h-full flex">
            <div className="flex w-full items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                  <Mic className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {pref.enabled ? t("scribe_enabled") : t("scribe_disabled")}
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
                {(pref.isLoading || saving) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                )}
                <Switch
                  checked={pref.enabled}
                  disabled={pref.isLoading || saving}
                  onCheckedChange={(checked) => void handleToggle(checked)}
                  aria-label={t("enable_ai_scribe")}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
