import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { FillyQuota } from "@/lib/quota-api";
import { formatName } from "@/lib/utils";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

import { useTranslation } from "@/hooks/useTranslation";

export interface UserQuotaUpdate {
  tokens: number;
  allow_filly: boolean;
}

export function UserQuotaSheet(props: {
  open: boolean;
  userQuota: FillyQuota | null;
  onClose: () => void;
  onSubmit: (update: UserQuotaUpdate) => Promise<void>;
}) {
  const { open, userQuota, onClose, onSubmit } = props;
  const { t } = useTranslation();

  const [tokens, setTokens] = useState(0);
  const [allowFilly, setAllowFilly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userQuota) return;
    setError(null);
    setTokens(userQuota.tokens);
    setAllowFilly(userQuota.allow_filly);
  }, [open, userQuota]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ tokens, allow_filly: allowFilly });
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
          <SheetTitle className="text-base">{t("edit_user_quota")}</SheetTitle>
          <SheetDescription className="text-xs">
            {formatName(userQuota?.user)}
            {userQuota?.user?.username ? ` (${userQuota.user.username})` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4">
          <div>
            <label className="text-xs font-medium text-gray-600">
              {t("token_allowance")}
            </label>
            <input
              type="number"
              min={0}
              value={tokens}
              onChange={(e) => setTokens(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <label className="text-xs font-medium text-gray-600">
                {t("user_access")}
              </label>
              <span className="text-xs text-gray-400">
                {t("user_access_hint")}
              </span>
            </div>
            <Switch checked={allowFilly} onCheckedChange={setAllowFilly} />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            disabled={busy || tokens < 0}
            onClick={save}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("save")}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
