import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  History,
  MicOff,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearHistory,
  deleteHistoryEntry,
  fetchHistoryAudio,
  listHistoryEntries,
} from "@/lib/scribe-history";
import type { ScribeHistoryEntry } from "@/lib/types/scribe";
import { cn } from "@/lib/utils";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { useTranslation } from "@/hooks/useTranslation";

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fill the current form with an entry's extracted values. */
  onApply?: (entry: ScribeHistoryEntry) => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function HistoryPanel({
  open,
  onOpenChange,
  onApply,
}: HistoryPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ScribeHistoryEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await listHistoryEntries());
    } catch {
      setEntries([]);
    }
  }, []);

  // Reload every time the sheet opens; reset transient UI state on close.
  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setSearch("");
      setExpandedId(null);
      setConfirmClear(false);
    }
  }, [open, refresh]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const query = search.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(
      (entry) =>
        entry.transcript?.toLowerCase().includes(query) ||
        formatDate(entry.startedAt).toLowerCase().includes(query),
    );
  }, [entries, search]);

  const handleDelete = async (id: string) => {
    await deleteHistoryEntry(id);
    if (expandedId === id) setExpandedId(null);
    void refresh();
  };

  const handleClearAll = async () => {
    await clearHistory();
    setConfirmClear(false);
    setExpandedId(null);
    void refresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {/* Header */}
        <SheetHeader className="care-scribie-fe-container space-y-1 border-b border-gray-100 bg-linear-to-r from-primary-100 to-transparent px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white">
              <History className="h-3.5 w-3.5" />
            </span>
            {t("scribe_history")}
            {!!entries?.length && (
              <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                {entries.length}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {t("scribe_history_description")}
          </SheetDescription>
        </SheetHeader>

        {/* Search */}
        {!!entries?.length && (
          <div className="border-b border-gray-100 px-4 py-2">
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search_history")}
                className="w-full border-none bg-transparent p-0 text-xs text-gray-700 placeholder:text-gray-400 focus:ring-0 focus:outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Entries */}
        <div className="flex-1 overflow-y-auto">
          {filtered === null && (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-gray-100"
                />
              ))}
            </div>
          )}

          {filtered?.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <History className="h-8 w-8 text-gray-300" />
              <p className="text-xs text-gray-400">
                {entries?.length ? t("no_matching_history") : t("no_history")}
              </p>
            </div>
          )}

          {filtered?.map((entry) => (
            <HistoryEntryRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === entry.id ? null : entry.id))
              }
              onDelete={() => void handleDelete(entry.id)}
              onApply={onApply}
            />
          ))}
        </div>

        {/* Footer */}
        {!!entries?.length && (
          <div className="border-t border-gray-100 px-3 py-2">
            {confirmClear ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-600">
                  {t("clear_history_confirm")}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void handleClearAll()}
                    className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    {t("clear_all")}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("clear_all")}
              </button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function HistoryEntryRow({
  entry,
  expanded,
  onToggle,
  onDelete,
  onApply,
}: {
  entry: ScribeHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onApply?: (entry: ScribeHistoryEntry) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Fetch the recording only while expanded; revoke the blob URL when
  // collapsed/unmounted.
  useEffect(() => {
    let cancelled = false;
    if (expanded && entry.hasAudio) {
      void fetchHistoryAudio(entry.id)
        .then((blob) => {
          if (cancelled || !blob) return;
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          setAudioUrl(url);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      setAudioUrl(null);
    };
  }, [expanded, entry.hasAudio, entry.id]);

  const handleCopy = async () => {
    if (!entry.transcript) return;
    await navigator.clipboard.writeText(entry.transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadName = `scribe-${new Date(entry.startedAt)
    .toISOString()
    .slice(0, 16)
    .replace(
      /[T:]/g,
      "-",
    )}.${entry.audioMimeType?.includes("mp4") ? "m4a" : "webm"}`;

  const structuredEntries = Object.entries(entry.structuredData || {}).filter(
    ([key]) => key !== "clinical_notes" && !key.endsWith("_note"),
  );

  return (
    <div className="border-b border-gray-50 last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <span
          className={cn(
            "mt-1 h-2 w-2 shrink-0 rounded-full",
            entry.status === "completed" ? "bg-primary-500" : "bg-red-500",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[11px] text-gray-400">
            <span>{formatDate(entry.startedAt)}</span>
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {formatDuration(entry.duration)}
            </span>
            {!entry.hasAudio && (
              <span title={t("audio_unavailable")}>
                <MicOff className="h-3 w-3 text-gray-300" />
              </span>
            )}
          </span>
          <span
            className={cn(
              "truncate mt-0.5 line-clamp-2 block text-xs leading-relaxed",
              entry.status === "failed"
                ? "text-red-500"
                : entry.transcript
                  ? "text-gray-600"
                  : "text-gray-400 italic",
            )}
          >
            {entry.status === "failed"
              ? entry.error || t("failed")
              : entry.transcript || t("no_transcript")}
          </span>
        </span>
        {expanded ? (
          <ChevronUp className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-400" />
        ) : (
          <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="space-y-3 bg-gray-50/60 px-4 pt-1 pb-3">
          {/* Audio playback — streamed from the user's server-side history */}
          {entry.hasAudio ? (
            audioUrl ? (
              <audio
                controls
                src={audioUrl}
                className="h-9 w-full"
                preload="metadata"
              />
            ) : (
              <div className="h-9 w-full animate-pulse rounded-full bg-gray-100" />
            )
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <MicOff className="h-3 w-3" />
              {t("audio_unavailable")}
            </p>
          )}

          {/* Full transcript */}
          {entry.transcript && (
            <div>
              <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
                {t("transcript")}
              </span>
              <p className="mt-1 max-h-32 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-gray-600">
                {entry.transcript}
              </p>
            </div>
          )}

          {/* Extracted values */}
          {structuredEntries.length > 0 && (
            <div>
              <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
                {t("extracted_values")}
              </span>
              <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                {structuredEntries.map(([key, val]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1"
                  >
                    <span className="truncate text-xs text-gray-500">
                      {key}
                    </span>
                    <span className="truncate text-xs font-medium text-gray-900">
                      {Array.isArray(val)
                        ? t("items_count", { n: val.length })
                        : typeof val === "object"
                          ? JSON.stringify(val)
                          : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {onApply &&
              entry.status === "completed" &&
              !!Object.keys(entry.structuredData || {}).length && (
                <button
                  onClick={() => onApply(entry)}
                  className="flex items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-[11px] border border-primary-800 font-semibold text-white shadow-sm hover:bg-primary-700"
                >
                  <Sparkles className="h-3 w-3 shrink-0" />
                  {t("apply_to_form")}
                </button>
              )}
            {entry.transcript && (
              <button
                onClick={() => void handleCopy()}
                className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-primary-600 shrink-0" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0" />
                )}
                <span className="sm:block hidden">
                  {copied ? t("copied") : t("copy_transcript")}
                </span>
              </button>
            )}
            {audioUrl && (
              <a
                title={t("download_audio")}
                href={audioUrl}
                download={downloadName}
                className="flex items-center gap-1 rounded-md bg-white px-2 py-1.5 text-[11px] font-medium text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
              >
                <Download className="h-3 w-3 shrink-0" />
              </a>
            )}
            <button
              onClick={onDelete}
              className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3 w-3 shrink-0" />
              {t("delete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
