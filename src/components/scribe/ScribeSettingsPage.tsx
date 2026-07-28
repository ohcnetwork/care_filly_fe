import { Mic } from "lucide-react";

import ScribeProfileSection from "@/components/scribe/ScribeProfileSection";

import { useTranslation } from "@/hooks/useTranslation";

/**
 * Standalone "AI Scribe" settings page, registered via `userNavItems`
 * in the manifest (the "Filly" entry in the user's nav menu).
 */
export default function ScribeSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="care-filly-fe-container mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Mic className="size-6 text-gray-700 dark:text-gray-300" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t("enable_filly")}
        </h1>
      </div>
      <ScribeProfileSection />
    </div>
  );
}
