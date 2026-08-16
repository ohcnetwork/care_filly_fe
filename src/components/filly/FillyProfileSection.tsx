import { Loader2, Mic } from "lucide-react";
import { useState } from "react";

import { FILLY_BASE_URL } from "@/lib/filly-be";

import { Switch } from "@/components/ui/switch";

import { useFillyPreference } from "@/hooks/useFillyPreference";
import { useTranslation } from "@/hooks/useTranslation";

interface FillyProfileSectionProps {
  className?: string;
}

/**
 * "AI Filly" opt-in card, reached from the user's own nav menu
 * (registered via `userNavItems` in the manifest, see `FillySettingsPage`).
 *
 * Filly is opt-in per user: the floating filly button only appears after
 * the user enables it here. The flag lives on CARE core's
 * `User.preferences`, and the backend refuses to start a session while it
 * is off. Whether the user may use Filly at all is a separate question,
 * answered by the `can_use_filly` facility permission.
 */
export default function FillyProfileSection({
  className,
}: FillyProfileSectionProps) {
  const { t } = useTranslation();
  const pref = useFillyPreference();
  const [error, setError] = useState<string | null>(null);

  if (!FILLY_BASE_URL) return null;

  const handleToggle = async (checked: boolean) => {
    setError(null);
    try {
      await pref.setEnabled(checked);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    }
  };

  return (
    <div className={`care-filly-fe-container ${className ?? ""}`}>
      <section className="flex flex-col gap-5 sm:flex-row">
        {/* Left: label + description */}
        <div className="sm:w-1/4">
          <div className="my-1 text-sm leading-5">
            <p className="mb-2 font-semibold">{t("ai_filly")}</p>
            <p className="text-secondary-600">
              {t("filly_profile_section_description")}
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
            ) : (
              <div className="flex w-full items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                    <Mic className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {pref.enabled ? t("filly_enabled") : t("filly_disabled")}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {pref.enabled
                        ? t("filly_enabled_note")
                        : t("filly_disabled_note")}
                    </p>
                    {error && (
                      <p className="mt-1 text-xs text-red-500">{error}</p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {pref.isSaving && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                  )}
                  <Switch
                    checked={pref.enabled}
                    disabled={pref.isSaving}
                    onCheckedChange={(checked) => void handleToggle(checked)}
                    aria-label={t("enable_ai_filly")}
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
