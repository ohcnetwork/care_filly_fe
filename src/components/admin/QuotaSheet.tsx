import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  FacilityOption,
  FillyQuota,
  QuotaCreateRequest,
  searchFacilities,
} from "@/lib/quota-api";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

import { useTranslation } from "@/hooks/useTranslation";

const DEFAULT_QUOTA: QuotaCreateRequest = {
  facility_external_id: "",
  tokens: 1_000_000,
  tokens_per_user: 100_000,
  allow_filly: true,
};

export function QuotaSheet(props: {
  open: boolean;
  /** When set, the sheet edits this quota instead of creating one. */
  quota?: FillyQuota;
  onClose: () => void;
  onSubmit: (quota: QuotaCreateRequest) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { open, quota: initQuota, onClose, onSubmit, onDelete } = props;
  const { t } = useTranslation();

  const [quota, setQuota] = useState<QuotaCreateRequest>(DEFAULT_QUOTA);
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [facilitiesLoading, setFacilitiesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuota(
      initQuota
        ? {
            facility_external_id: initQuota.facility_external_id,
            tokens: initQuota.tokens,
            tokens_per_user: initQuota.tokens_per_user,
            allow_filly: initQuota.allow_filly,
          }
        : DEFAULT_QUOTA,
    );
  }, [open, initQuota]);

  // Debounced facility search (create mode only).
  useEffect(() => {
    if (!open || initQuota) return;
    setFacilitiesLoading(true);
    const timeout = setTimeout(() => {
      searchFacilities(facilityQuery)
        .then(setFacilities)
        .finally(() => setFacilitiesLoading(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [open, initQuota, facilityQuery]);

  const canSubmit =
    quota.tokens > 0 && (Boolean(initQuota) || quota.facility_external_id);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-1 border-b border-gray-100 px-4 py-4 text-left">
          <SheetTitle className="text-base">
            {initQuota ? t("edit_quota") : t("new_quota")}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {t("quota_sheet_description")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4">
          {!initQuota && (
            <Command className="mt-1 rounded-md border border-gray-200">
              <CommandInput
                value={facilityQuery}
                onValueChange={setFacilityQuery}
                placeholder={t("search_facilities")}
                className="text-base sm:text-sm"
              />
              <CommandList className="max-h-44 overflow-y-auto">
                {facilitiesLoading ? (
                  <div className="flex items-center justify-center py-4 text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <>
                    <CommandEmpty className="px-3 py-3 text-gray-400">
                      {t("no_facilities_found")}
                    </CommandEmpty>
                    <CommandGroup>
                      {facilities.map((facility) => (
                        <CommandItem
                          key={facility.id}
                          value={facility.name}
                          onSelect={() =>
                            setQuota({
                              ...quota,
                              facility_external_id: facility.id,
                            })
                          }
                        >
                          {facility.name}
                          {quota.facility_external_id === facility.id && (
                            <Check className="ml-auto h-3.5 w-3.5 text-primary-600" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 mt-4">
              {t("monthly_tokens")}
            </label>
            <input
              type="number"
              min={1}
              value={quota.tokens}
              onChange={(e) =>
                setQuota({ ...quota, tokens: Number(e.target.value) })
              }
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">
              {t("tokens_per_user")}
            </label>
            <input
              type="number"
              min={0}
              value={quota.tokens_per_user}
              onChange={(e) =>
                setQuota({
                  ...quota,
                  tokens_per_user: Number(e.target.value),
                })
              }
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">
              {t("allow_filly")}
            </label>
            <Switch
              checked={quota.allow_filly}
              onCheckedChange={(checked) =>
                setQuota({ ...quota, allow_filly: checked })
              }
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="mt-2 flex flex-col gap-2">
            <button
              disabled={!canSubmit || busy}
              onClick={() => run(() => onSubmit(quota))}
              className="flex items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {initQuota ? t("update_quota") : t("create_quota")}
            </button>
            {initQuota && onDelete && (
              <button
                disabled={busy}
                onClick={() => run(onDelete)}
                className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                {t("delete_quota")}
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
