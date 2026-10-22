import { useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import {
  type FieldFillDelayMs,
  useFillyPreference,
} from "@/hooks/useFillyPreference";
import { useTranslation } from "@/hooks/useTranslation";

const DELAY_OPTIONS = [
  { delay: 0, label: "field_fill_instant" },
  { delay: 100, label: "field_fill_fast" },
  { delay: 500, label: "field_fill_normal" },
] as const;

export default function FieldFillDelaySettings() {
  const { t } = useTranslation();
  const pref = useFillyPreference();
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (delay: FieldFillDelayMs) => {
    setError(null);
    try {
      await pref.setFieldFillDelayMs(delay);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    }
  };

  return (
    <section className="mt-6 flex flex-col gap-5 sm:flex-row">
      <div className="sm:w-1/4">
        <div className="my-1 text-sm leading-5">
          <p id="field-fill-delay-label" className="mb-2 font-semibold">
            {t("field_fill_delay")}
          </p>
          <p id="field-fill-delay-description" className="text-secondary-600">
            {t("field_fill_delay_description")}
          </p>
        </div>
      </div>
      <div className="sm:w-3/4">
        <div className="rounded-lg bg-white px-4 py-5 shadow-sm sm:px-6">
          <div
            role="radiogroup"
            aria-labelledby="field-fill-delay-label"
            aria-describedby="field-fill-delay-description"
            aria-busy={pref.isLoading || pref.isSaving}
            className="flex flex-wrap items-center gap-3"
          >
            {DELAY_OPTIONS.map(({ delay, label }, index) => (
              <Button
                key={delay}
                type="button"
                variant="ghost"
                role="radio"
                aria-checked={pref.fieldFillDelayMs === delay}
                tabIndex={pref.fieldFillDelayMs === delay ? 0 : -1}
                className={cn(
                  "min-h-12 flex-1 justify-start gap-3 rounded-lg px-4 py-3 text-left text-sm shadow-none",
                  pref.fieldFillDelayMs === delay
                    ? "bg-primary-50 font-medium text-primary-700 hover:bg-primary-50 hover:text-primary-700"
                    : "text-gray-600 hover:bg-gray-50",
                )}
                disabled={pref.isLoading || pref.isSaving || !!pref.error}
                onClick={() => void handleSelect(delay)}
                onKeyDown={(event) => {
                  let nextIndex: number;
                  switch (event.key) {
                    case "ArrowDown":
                    case "ArrowRight":
                      nextIndex = (index + 1) % DELAY_OPTIONS.length;
                      break;
                    case "ArrowUp":
                    case "ArrowLeft":
                      nextIndex =
                        (index + DELAY_OPTIONS.length - 1) %
                        DELAY_OPTIONS.length;
                      break;
                    case "Home":
                      nextIndex = 0;
                      break;
                    case "End":
                      nextIndex = DELAY_OPTIONS.length - 1;
                      break;
                    default:
                      return;
                  }
                  event.preventDefault();
                  const next =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role="radio"]',
                    )[nextIndex];
                  next?.focus();
                  next?.click();
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    pref.fieldFillDelayMs === delay
                      ? "border-primary-600"
                      : "border-gray-300",
                  )}
                >
                  {pref.fieldFillDelayMs === delay && (
                    <span className="h-2.5 w-2.5 rounded-full bg-primary-600" />
                  )}
                </span>
                {t(label)}
              </Button>
            ))}
          </div>
          {(error || pref.error) && (
            <p role="alert" className="mt-2 text-xs text-red-500">
              {error || pref.error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
