import { Loader2, ScrollText } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";

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
  const [agreed, setAgreed] = useState(false);

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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setAgreed(false);
        }
      }}
    >
      <DialogContent className="flex max-h-[60vh] flex-col gap-0 p-0 sm:max-w-md">
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
          <p className="text-xs whitespace-pre-wrap text-gray-600 text-justify">
            {tnc || t("tnc_unavailable")}
          </p>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>

        <Field
          orientation="horizontal"
          className="border-t border-gray-100 px-4 py-3 data-[state=checked]:text-red-600"
        >
          <Checkbox
            id="tnc-agree-checkbox"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            disabled={accepting}
            className="shadow-none data-[state=checked]:border-primary-500 border border-red-600"
          />
          <FieldLabel
            htmlFor="tnc-agree-checkbox"
            className={cn(
              agreed === true ? "text-gray-600" : "text-red-600",
              "text-xs italic font-normal -ml-0.5",
            )}
            aria-required={true}
          >
            {t("tnc_agree_checkbox")}
            <span>*</span>
          </FieldLabel>
        </Field>

        <DialogFooter className="border-t border-gray-100 px-4 py-3 gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" disabled={accepting} size="sm">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            onClick={handleAccept}
            disabled={accepting || !tnc || !agreed}
            size="sm"
          >
            {accepting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {t("accept_and_continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
