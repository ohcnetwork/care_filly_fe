import { Check, Mic, RotateCcw } from "lucide-react";
import { useState } from "react";

import { resetFabPositionForCurrentUser } from "@/lib/fab-position";

import { Button } from "@/components/ui/button";

import FieldFillDelaySettings from "@/components/filly/FieldFillDelaySettings";
import FillyProfileSection from "@/components/filly/FillyProfileSection";

import { useTranslation } from "@/hooks/useTranslation";

/**
 * Standalone "AI Filly" settings page, registered via `userNavItems`
 * in the manifest (the "Filly" entry in the user's nav menu).
 */
export default function FillySettingsPage() {
  const { t } = useTranslation();
  const [resetting, setResetting] = useState(false);
  const [justReset, setJustReset] = useState(false);

  const handleResetPosition = async () => {
    setResetting(true);
    try {
      await resetFabPositionForCurrentUser();
      setJustReset(true);
      setTimeout(() => setJustReset(false), 2000);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="care-filly-fe-container mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Mic className="size-6 text-gray-700 dark:text-gray-300" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t("enable_filly")}
        </h1>
      </div>
      <FillyProfileSection />

      <section className="mt-6 flex flex-col gap-5 sm:flex-row">
        <div className="sm:w-1/4">
          <div className="my-1 text-sm leading-5">
            <p className="mb-2 font-semibold">{t("reset_filly_position")}</p>
            <p className="text-secondary-600">
              {t("reset_filly_position_description")}
            </p>
          </div>
        </div>
        <div className="sm:w-3/4">
          <div className="flex h-full items-center rounded-lg bg-white px-4 py-5 shadow-sm sm:rounded-lg sm:px-6">
            <Button
              variant="outline"
              disabled={resetting}
              onClick={() => void handleResetPosition()}
            >
              {justReset ? (
                <>
                  <Check className="h-4 w-4" />
                  {t("position_reset")}
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4" />
                  {t("reset_filly_position")}
                </>
              )}
            </Button>
          </div>
        </div>
      </section>
      <FieldFillDelaySettings />
    </div>
  );
}
