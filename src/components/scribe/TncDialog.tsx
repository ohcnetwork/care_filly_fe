import { Loader2, ScrollText } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useTranslation } from "@/hooks/useTranslation";

interface TncDialogProps {
  open: boolean;
  tnc?: string;
  onAccept: () => Promise<void>;
  onClose: () => void;
}

/**
 * Terms & conditions gate shown before the user's first scribe session.
 * Accepting creates the user's quota row on the backend.
 */
export function TncDialog({ open, tnc, onAccept, onClose }: TncDialogProps) {
  const { t } = useTranslation();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      await onAccept();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tnc_accept_failed"));
      setAccepting(false);
      return;
    }
    setAccepting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-gray-100 bg-linear-to-r from-primary-100 to-transparent px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-white">
              <ScrollText className="h-4 w-4" />
            </span>
            {t("scribe_terms_and_conditions")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("scribe_terms_and_conditions")}
          </DialogDescription>
        </DialogHeader>

        <div className="mx-0 no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-gray-600">
            {tnc || t("tnc_unavailable")}
          </p>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter className="border-t border-gray-100 px-4 py-3 gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" disabled={accepting} size="sm">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button onClick={handleAccept} disabled={accepting || !tnc} size="sm">
            {accepting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {t("accept_and_continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
