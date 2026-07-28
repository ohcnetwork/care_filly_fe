import {
  CheckCircle2,
  ChevronDown,
  FileText,
  History,
  Loader2,
  Mic,
  Pause,
  Play,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  FAB_POSITION_RESET_EVENT,
  fabPositionStorageKey,
  loadStoredFabOffset,
  resolveCurrentUserId,
} from "@/lib/fab-position";
import { fetchHistoryAudio } from "@/lib/scribe-history";
import { getFacilityIdFromUrl } from "@/lib/structured/care-api";
import { applyFieldToState, collectFieldsToFill } from "@/lib/structured/fill";
import type { ScribeHistoryEntry, ScribeResult } from "@/lib/types/scribe";
import { cn } from "@/lib/utils";

import { HistoryPanel } from "@/components/scribe/HistoryPanel";

import { useQuota } from "@/hooks/useQuota";
import { useScribe } from "@/hooks/useScribe";
import { useScribePreference } from "@/hooks/useScribePreference";
import { useTranslation } from "@/hooks/useTranslation";

interface ScribeControllerProps {
  formState?: unknown;
  setFormState?: (fn: (state: unknown) => unknown) => void;
}

const FIELD_FILL_DELAY_MS = 500;

const PROCESSING_STEPS = [
  "transcribing_audio",
  "extracting_details",
  "filling_form",
] as const;

const DRAG_THRESHOLD_PX = 4;
const VIEWPORT_MARGIN_PX = 5;

function clampRectToViewport(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  const maxLeft = Math.max(
    VIEWPORT_MARGIN_PX,
    window.innerWidth - rect.width - VIEWPORT_MARGIN_PX,
  );
  const maxTop = Math.max(
    VIEWPORT_MARGIN_PX,
    window.innerHeight - rect.height - VIEWPORT_MARGIN_PX,
  );
  return {
    left: Math.min(Math.max(rect.left, VIEWPORT_MARGIN_PX), maxLeft),
    top: Math.min(Math.max(rect.top, VIEWPORT_MARGIN_PX), maxTop),
  };
}

/**
 * Lets the user drag the floating scribe widget away from its default
 * bottom-right corner — it can otherwise sit on top of a page's own submit
 * button. Position is persisted across sessions (per browser), keyed by
 * the current CARE user id (see `@/lib/fab-position`) so a shared/kiosk
 * device doesn't leak one person's dragged position into another user's
 * session. A plain click/tap still reaches the button underneath;
 * dragging only kicks in once the pointer has moved past a small
 * threshold, and the resulting click is suppressed so Start/Stop etc.
 * don't fire accidentally. Double-click/tap — or the "Reset position"
 * button on the settings page — resets the widget back to its default
 * corner. The widget's on-screen rect is always clamped to the viewport
 * (both while dragging and on window resize) so it can never be dragged
 * fully off-screen and become unreachable.
 */
function useDraggableFab() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const userIdRef = useRef<string | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    rectLeft: number;
    rectTop: number;
    width: number;
    height: number;
    pointerId: number;
  } | null>(null);
  const draggedRef = useRef(false);

  // Resolve the current user (async — CARE has no synchronous global for
  // it) and load *their* stored offset, so a shared device never shows a
  // previous user's dragged position. Clamped in case the window has
  // shrunk since that offset was last saved.
  useEffect(() => {
    let cancelled = false;
    resolveCurrentUserId().then((userId) => {
      if (cancelled || draggedRef.current) return;
      userIdRef.current = userId;
      const stored = loadStoredFabOffset(fabPositionStorageKey(userId));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        setOffset(stored);
        return;
      }
      // `rect` still reflects the un-offset (0,0) position at this point,
      // so it doubles as the "natural" anchor to clamp against.
      const clamped = clampRectToViewport({
        left: rect.left + stored.x,
        top: rect.top + stored.y,
        width: rect.width,
        height: rect.height,
      });
      setOffset({
        x: clamped.left - rect.left,
        y: clamped.top - rect.top,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleReset = () => setOffset({ x: 0, y: 0 });
    window.addEventListener(FAB_POSITION_RESET_EVENT, handleReset);
    return () =>
      window.removeEventListener(FAB_POSITION_RESET_EVENT, handleReset);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // left mouse / touch / pen only
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: offset.x,
        originY: offset.y,
        rectLeft: rect.left,
        rectTop: rect.top,
        width: rect.width,
        height: rect.height,
        pointerId: e.pointerId,
      };
    },
    [offset],
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!draggedRef.current) {
        draggedRef.current = true;
        setIsDragging(true);
      }
      // Clamp using the widget's own measured size so it always keeps at
      // least VIEWPORT_MARGIN_PX visible on every edge of the viewport.
      const clamped = clampRectToViewport({
        left: drag.rectLeft + dx,
        top: drag.rectTop + dy,
        width: drag.width,
        height: drag.height,
      });
      setOffset({
        x: drag.originX + (clamped.left - drag.rectLeft),
        y: drag.originY + (clamped.top - drag.rectTop),
      });
    };

    const handleUp = () => {
      dragRef.current = null;
      setIsDragging(false);
      if (draggedRef.current) {
        setOffset((current) => {
          try {
            localStorage.setItem(
              fabPositionStorageKey(userIdRef.current),
              JSON.stringify(current),
            );
          } catch {
            // ignore storage errors (private mode, quota, etc.)
          }
          return current;
        });
        // clear after this tick so the click event that follows a drag
        // (fired right after pointerup) is still recognised as a drag.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, []);

  useEffect(() => {
    const reclamp = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clamped = clampRectToViewport(rect);
      const dLeft = clamped.left - rect.left;
      const dTop = clamped.top - rect.top;
      if (dLeft === 0 && dTop === 0) return;
      setOffset((current) => ({
        x: current.x + dLeft,
        y: current.y + dTop,
      }));
    };

    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  const onClickCapture = useCallback((e: SyntheticEvent) => {
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const resetPosition = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    try {
      localStorage.removeItem(fabPositionStorageKey(userIdRef.current));
    } catch {
      // ignore
    }
  }, []);

  return {
    offset,
    isDragging,
    containerRef,
    onPointerDown,
    onClickCapture,
    resetPosition,
  };
}

export function ScribeController(props: ScribeControllerProps) {
  return (
    <div className="care-filly-fe-container">
      <ScribeControllerInner {...props} />
    </div>
  );
}

function ScribeControllerInner({
  formState,
  setFormState,
}: ScribeControllerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [transcriptMinimized, setTranscriptMinimized] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const appliedRef = useRef(false);
  const fillTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [filledCount, setFilledCount] = useState(0);

  // Per-user/facility quota gating (mirrors care_scribe_fe) + the user's
  // own scribe opt-in from the profile page.
  const facilityId = getFacilityIdFromUrl();
  const quota = useQuota(facilityId);
  const preference = useScribePreference();

  // Lets the widget be dragged clear of a page's own submit button.
  const fabDrag = useDraggableFab();
  const fabDragStyle = {
    transform: `translate3d(${fabDrag.offset.x}px, ${fabDrag.offset.y}px, 0)`,
    touchAction: "none",
    cursor: fabDrag.isDragging ? "grabbing" : undefined,
  } as const;

  const clearFillTimeouts = useCallback(() => {
    fillTimeoutsRef.current.forEach(clearTimeout);
    fillTimeoutsRef.current = [];
  }, []);

  const applyResults = useCallback(
    async (result: ScribeResult) => {
      if (!setFormState || !formState) return;
      if (!result.structuredData) {
        console.warn("[Scribe] No structured data to fill");
        return;
      }
      if (appliedRef.current) return;
      appliedRef.current = true;

      try {
        const fieldsToFill = await collectFieldsToFill(
          formState,
          result.structuredData,
        );

        if (import.meta.env.DEV) {
          console.log("[Scribe] Fields to fill:", fieldsToFill);
        }

        if (!fieldsToFill.length) {
          console.warn(
            "[Scribe] No matching fields found for extracted data",
            result.structuredData,
          );
        }

        setFilledCount(0);

        fieldsToFill.forEach((field, index) => {
          const timeoutId = setTimeout(() => {
            setFormState((currentState: unknown) =>
              applyFieldToState(currentState, field),
            );
            highlightField(field.qId);
            setFilledCount(index + 1);
          }, index * FIELD_FILL_DELAY_MS);

          fillTimeoutsRef.current.push(timeoutId);
        });
      } catch (err) {
        appliedRef.current = false;
        console.error("[Scribe] Failed to apply results:", err);
      }
    },
    [formState, setFormState],
  );

  /** Re-fill the form from a past session picked in the history panel. */
  const handleApplyFromHistory = useCallback(
    (entry: ScribeHistoryEntry) => {
      clearFillTimeouts();
      appliedRef.current = false; // applyResults is one-shot per recording
      setHistoryOpen(false);
      void applyResults({
        transcript: entry.transcript,
        structuredData: entry.structuredData,
      });
    },
    [applyResults, clearFillTimeouts],
  );

  const [liveTranscript, setLiveTranscript] = useState<string>("");

  const scribe = useScribe({
    formState,
    onTranscript: (transcript) => {
      setLiveTranscript(transcript);
    },
    onResult: (result) => {
      console.log("[Scribe] Result:", result);
      void applyResults(result);
    },
    onError: (error) => {
      console.error("[Scribe] Error:", error);
    },
  });

  // Open the results view automatically once transcription/processing finishes
  useEffect(() => {
    if (scribe.status === "completed") {
      setExpanded(true);
    }
  }, [scribe.status]);

  // ── Live audio level visualiser ──────────────────────────────────────────
  // Opens a lightweight Web Audio analyser directly against the mic whenever
  // recording is active. Independent of the SDK's own recording stream.
  const [barHeights, setBarHeights] = useState<number[]>([
    0.3, 0.3, 0.3, 0.3, 0.3,
  ]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const vizStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (scribe.status !== "recording") {
      // tear down
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      vizStreamRef.current?.getTracks().forEach((t) => t.stop());
      vizStreamRef.current = null;
      setBarHeights([0.3, 0.3, 0.3, 0.3, 0.3]);
      return;
    }

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        vizStreamRef.current = stream;

        const ctx = new AudioContext();
        audioCtxRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount); // 128 bins
        // Sample 5 bins across the 200–3 000 Hz speech band
        // bin index ≈ freq * fftSize / sampleRate
        const sampleRate = ctx.sampleRate;
        const binOf = (hz: number) =>
          Math.round((hz * analyser.fftSize) / sampleRate);
        const bins = [
          binOf(250),
          binOf(500),
          binOf(900),
          binOf(1600),
          binOf(2800),
        ];

        const tick = () => {
          analyser.getByteFrequencyData(freqData);
          setBarHeights(
            bins.map((b) => Math.max(0.12, (freqData[b] ?? 0) / 255)),
          );
          animFrameRef.current = requestAnimationFrame(tick);
        };
        animFrameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        /* mic permission denied – CSS fallback stays */
      });

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      vizStreamRef.current?.getTracks().forEach((t) => t.stop());
      vizStreamRef.current = null;
    };
  }, [scribe.status]);

  const beginRecording = async () => {
    clearFillTimeouts();
    appliedRef.current = false;
    setFilledCount(0);
    setTranscriptMinimized(false);
    setHistoryOpen(false);
    await scribe.startRecording();
  };

  const handleStart = async () => {
    await beginRecording();
  };

  const handleStop = async () => {
    await scribe.stopRecording();
  };

  const handleDismiss = async () => {
    clearFillTimeouts();
    await scribe.reset();
    setExpanded(false);
    setTranscriptMinimized(false);
  };

  /** Re-run the whole pipeline on a past entry's stored recording. */
  const handleReprocessFromHistory = useCallback(
    async (entry: ScribeHistoryEntry) => {
      setHistoryOpen(false);
      clearFillTimeouts();
      appliedRef.current = false;
      setFilledCount(0);
      setLiveTranscript("");
      setTranscriptMinimized(false);
      const audio = await fetchHistoryAudio(entry.id);
      if (!audio) {
        console.warn("[Scribe] No stored audio for history entry", entry.id);
        return;
      }
      await scribe.processAudioFile(audio, {
        durationSeconds: entry.duration,
      });
    },
    [clearFillTimeouts, scribe],
  );

  useEffect(() => clearFillTimeouts, [clearFillTimeouts]);

  const duration = scribe.duration;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const timeStr = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

  // Idle state — floating pill FAB (bottom-right) + history
  if (scribe.status === "idle") {
    // Scribe is only offered when the facility has an active quota AND
    // the user has enabled scribe (+ consented) from their profile page.
    // Standalone deployments without quota/preference endpoints stay enabled.
    if (
      quota.isLoading ||
      !quota.scribeEnabled ||
      preference.isLoading ||
      !preference.enabled
    ) {
      return null;
    }

    const exceeded = quota.quotaExceeded;

    return (
      <div
        ref={fabDrag.containerRef}
        className="scribe-pop-in fixed right-4 bottom-2 z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-4"
        style={fabDragStyle}
        onPointerDown={fabDrag.onPointerDown}
        onClickCapture={fabDrag.onClickCapture}
        onDoubleClick={fabDrag.resetPosition}
        title={t("ai_filly")}
      >
        <HistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          onApply={
            formState && setFormState ? handleApplyFromHistory : undefined
          }
          onReprocess={
            quota.quotaExceeded
              ? undefined
              : (entry) => void handleReprocessFromHistory(entry)
          }
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHistoryOpen((prev) => !prev)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border bg-white text-gray-500 shadow-md transition-all hover:text-primary-700 hover:shadow-lg active:scale-95",
              historyOpen
                ? "border-primary-200 text-primary-700"
                : "border-gray-100",
            )}
            title={t("scribe_history")}
            //TODO: add hidden when no history
          >
            <History className="h-4.5 w-4.5" />
          </button>
          <button
            onClick={handleStart}
            disabled={scribe.isStarting || Boolean(exceeded)}
            className={cn(
              "group relative flex items-center gap-2 overflow-hidden rounded-full py-3 pr-5 pl-4 text-white shadow-lg transition-all",
              exceeded
                ? "cursor-not-allowed bg-gray-400 shadow-gray-400/30"
                : "bg-linear-to-br from-primary-600 via-primary-700 to-primary-800 shadow-primary-700/30",
              !exceeded &&
                (scribe.isStarting
                  ? "opacity-90"
                  : "hover:shadow-xl hover:shadow-primary-700/40 hover:brightness-110 active:scale-95"),
            )}
            title={
              exceeded
                ? exceeded === "facility"
                  ? t("facility_quota_exceeded")
                  : t("monthly_quota_exceeded")
                : scribe.isStarting
                  ? t("starting")
                  : t("start_ai_scribe")
            }
          >
            {/* soft rotating glow */}
            {!exceeded && (
              <span className="scribe-spin-slow pointer-events-none absolute -inset-16 scale-150 rounded-full bg-[conic-gradient(from_0deg,transparent,rgba(255,255,255,0.35),transparent)] opacity-60" />
            )}
            <span className="relative flex h-6 w-6 items-center justify-center">
              {scribe.isStarting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </span>
            <span className="relative text-sm font-semibold">
              {exceeded
                ? t("quota_exceeded")
                : scribe.isStarting
                  ? t("starting")
                  : t("ai_filly")}
            </span>
            {!exceeded && <Sparkles className="relative h-4 w-4 opacity-80" />}
          </button>
        </div>
      </div>
    );
  }

  const transcript = liveTranscript || scribe.result?.transcript || "";
  const showTranscript =
    transcript &&
    (scribe.status === "processing" || scribe.status === "completed");

  // Real processing progress, derived from actual API signals (not a timer):
  //  0 = transcribing audio  (recording ended, no transcript yet)
  //  1 = extracting details  (transcript received, structuring templates)
  //  2 = filling the form    (structured result received / completed)
  const processingStep = scribe.status === "completed" ? 2 : transcript ? 1 : 0;

  // Compact / status views (recording, processing, completed, failed)
  if (!expanded) {
    return (
      <div
        ref={fabDrag.containerRef}
        className="scribe-pop-in fixed right-4 bottom-4 z-9999 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6"
        style={fabDragStyle}
        onPointerDown={fabDrag.onPointerDown}
        onClickCapture={fabDrag.onClickCapture}
        onDoubleClick={fabDrag.resetPosition}
      >
        {/* Live transcript — collapsible, shown while processing/completed */}
        {showTranscript && !transcriptMinimized && (
          <div className="w-72 overflow-hidden rounded-2xl border border-gray-100 bg-white/95 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                <FileText className="h-3 w-3" />
                {t("transcript")}
              </span>
              <div className="flex items-center gap-1">
                {scribe.status === "completed" && (
                  <span className="text-[10px] font-semibold text-primary-700">
                    {t("filled_count", { n: filledCount })}
                  </span>
                )}
                <button
                  onClick={() => setTranscriptMinimized(true)}
                  className="rounded-md p-0.5 text-gray-400 hover:bg-gray-100"
                  title={t("minimize_transcript")}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <p className="max-h-28 overflow-y-auto px-3 py-2.5 text-xs leading-relaxed text-gray-600">
              {transcript}
            </p>
          </div>
        )}

        {/* PROCESSING — text above orb, no card */}
        {scribe.status === "processing" && (
          <div className="flex flex-col items-center gap-2">
            <p className="scribe-shimmer-text text-xs font-medium">
              {t(PROCESSING_STEPS[processingStep])}
            </p>
            <AiPulse />
            {showTranscript && transcriptMinimized && (
              <button
                onClick={() => setTranscriptMinimized(false)}
                className="flex items-center gap-1 text-[10px] font-medium text-primary-600 hover:text-primary-800"
              >
                <FileText className="h-2.5 w-2.5" />
                {t("show_transcript")}
              </button>
            )}
          </div>
        )}

        {/* RECORDING — same size/position as processing orb for seamless transition */}
        {scribe.status === "recording" && (
          <div className="flex flex-col items-center gap-2 pr-4">
            {/* timer + pause button inline */}
            <div className="flex items-center gap-1.5">
              <span className="scribe-shimmer-text text-xs font-medium">
                {timeStr}
              </span>
              <button
                onClick={scribe.pauseRecording}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200"
                title={t("pause")}
              >
                <Pause className="h-2.5 w-2.5 blur-lg" />
              </button>
            </div>
            <button
              onClick={handleStop}
              title={t("stop_and_process")}
              className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-primary-600 via-primary-700 to-primary-800 shadow-lg shadow-primary-700/40 transition-all active:scale-95 hover:shadow-xl hover:shadow-primary-700/50 opacity-85 blur-lg hover:opacity-100"
            >
              {/* rotating conic glow */}
              <span className="scribe-spin-slow pointer-events-none absolute -inset-10 rounded-full bg-[conic-gradient(from_0deg,transparent,rgba(255,255,255,0.3),transparent)] opacity-50" />
              {/* live audio bars — height driven by Web Audio AnalyserNode */}
              <span className="relative flex h-6 items-center gap-0.5 transition-opacity group-hover:opacity-0">
                {barHeights.map((h, i) => (
                  <span
                    key={i}
                    className="w-0.5 rounded-full bg-white/85 transition-[height] duration-75 blur-2xl"
                    style={{ height: `${h * 100}%` }}
                  />
                ))}
              </span>
              {/* stop icon on hover */}
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                <Square className="h-5 w-5 text-white" />
              </span>
            </button>
          </div>
        )}

        {/* PAUSED — resume near timer; stop on orb hover */}
        {scribe.status === "paused" && (
          <div className="flex flex-col items-center gap-2 pr-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-amber-500">
                {timeStr}
              </span>
              <button
                onClick={scribe.resumeRecording}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700 opacity-90"
                title={t("resume")}
              >
                <Play className="h-2.5 w-2.5" />
              </button>
            </div>
            <button
              onClick={handleStop}
              title={t("stop_and_process")}
              className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-primary-600 via-primary-700 to-primary-800 opacity-85 shadow-lg shadow-primary-700/30 transition-all hover:opacity-100 active:scale-95"
            >
              <Pause className="relative h-6 w-6 text-white transition-opacity group-hover:opacity-0" />
              <Square className="absolute h-5 w-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </div>
        )}

        {/* COMPLETED — success pill */}
        {scribe.status === "completed" && (
          <div className="flex items-center gap-2 rounded-full border border-primary-100 bg-white py-2 pr-2 pl-3 shadow-xl">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-white">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-primary-800">
              {t("filled_count", { n: filledCount })}
            </span>
            <button
              onClick={() => setExpanded(true)}
              className="rounded-full px-3 py-1 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
            >
              {t("view")}
            </button>
            <button
              onClick={handleDismiss}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100"
              title={t("dismiss")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* FAILED — error pill */}
        {scribe.status === "failed" && (
          <div className="flex items-center gap-2 rounded-full border border-red-100 bg-white py-2 pr-2 pl-3 shadow-xl">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-red-600">
              {t("failed")}
            </span>
            <button
              onClick={() => setExpanded(true)}
              className="rounded-full px-3 py-1 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
            >
              {t("view")}
            </button>
            <button
              onClick={handleDismiss}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100"
              title={t("dismiss")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Expanded view — show transcript & results
  return (
    <div
      ref={fabDrag.containerRef}
      className="scribe-pop-in fixed right-4 bottom-4 z-9999 w-80 sm:right-6 sm:bottom-6"
      style={fabDragStyle}
    >
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b border-gray-100 bg-linear-to-r from-primary-100 to-transparent px-3 py-2.5"
          onPointerDown={fabDrag.onPointerDown}
          onClickCapture={fabDrag.onClickCapture}
          onDoubleClick={fabDrag.resetPosition}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold text-gray-700">
              {t("fields_filled", { n: filledCount })}
            </span>
          </div>
          <button
            onClick={() => {
              setExpanded(false);
              setTranscriptMinimized(true);
            }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100"
            title={t("minimize")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Transcript */}
        <div className="max-h-60 overflow-y-auto p-3">
          {scribe.result?.transcript && (
            <div className="mb-3">
              <span className="text-[10px] font-medium text-gray-400 uppercase">
                {t("transcript")}
              </span>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                {scribe.result.transcript}
              </p>
            </div>
          )}

          {scribe.result?.structuredData && (
            <div>
              <span className="text-[10px] font-medium text-gray-400 uppercase">
                {t("extracted_values")}
              </span>
              <div className="mt-1 space-y-1">
                {Object.entries(scribe.result.structuredData).map(
                  ([key, val]) =>
                    key !== "clinical_notes" &&
                    !key.endsWith("_note") && (
                      <div
                        key={key}
                        className="flex items-center justify-between rounded bg-gray-50 px-2 py-1"
                      >
                        <span className="text-xs text-gray-500">{key}</span>
                        <span className="text-xs font-medium text-gray-900">
                          {Array.isArray(val)
                            ? `${val.length} item${val.length === 1 ? "" : "s"}`
                            : typeof val === "object"
                              ? JSON.stringify(val)
                              : String(val)}
                          {scribe.result?.structuredData?.[`${key}_note`] !=
                            null && (
                            <span className="ml-1 font-normal text-gray-500">
                              (
                              {String(
                                scribe.result.structuredData[`${key}_note`],
                              )}
                              )
                            </span>
                          )}
                        </span>
                      </div>
                    ),
                )}
              </div>
            </div>
          )}

          {scribe.error && (
            <p className="text-xs text-red-500">{scribe.error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-3 py-2">
          <button
            onClick={handleDismiss}
            className="w-full rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
          >
            {t("done")}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- AI animation sub-components ---

/** Premium AI processing indicator — two counter-rotating gradient arc
 *  "comets" around a glowing core. No dependencies, care green palette. */
function AiPulse() {
  return (
    <div className="relative flex h-20 w-20 items-center justify-center">
      {/* ambient glow */}
      <span className="scribe-glow absolute h-14 w-14 rounded-full bg-primary-400/40 blur-xl" />

      {/* outer arc — slow clockwise comet */}
      <svg
        className="scribe-spin-slow absolute inset-0 h-full w-full"
        viewBox="0 0 80 80"
        fill="none"
      >
        <defs>
          <linearGradient
            id="scribe-arc-outer"
            gradientUnits="userSpaceOnUse"
            x1="4"
            y1="40"
            x2="76"
            y2="40"
          >
            <stop offset="0%" stopColor="#31c48d" stopOpacity="0" />
            <stop offset="100%" stopColor="#0d9f6e" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <circle
          cx="40"
          cy="40"
          r="36"
          stroke="url(#scribe-arc-outer)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="158 68"
        />
      </svg>

      {/* inner arc — faster counter-clockwise comet */}
      <svg
        className="absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)]"
        style={{ animation: "scribe-spin 2.6s linear infinite reverse" }}
        viewBox="0 0 64 64"
        fill="none"
      >
        <defs>
          <linearGradient
            id="scribe-arc-inner"
            gradientUnits="userSpaceOnUse"
            x1="4"
            y1="32"
            x2="60"
            y2="32"
          >
            <stop offset="0%" stopColor="#84e1bc" stopOpacity="0" />
            <stop offset="100%" stopColor="#84e1bc" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <circle
          cx="32"
          cy="32"
          r="28"
          stroke="url(#scribe-arc-inner)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="110 66"
        />
      </svg>

      {/* blinking blurry star core */}
      <div className="relative z-10 flex h-8 w-8 items-center justify-center">
        {/* soft glow behind the star */}
        <span className="scribe-orb absolute h-8 w-8 rounded-full bg-primary-400/50 blur-md" />
        <Sparkles className="scribe-star-blink relative h-5 w-5 text-white drop-shadow-[0_0_6px_#31c48d]" />
      </div>
    </div>
  );
}

// --- Form fill utilities ---

function highlightField(qId: string): void {
  const HIGHLIGHT_CLASS = "scribe-highlight";
  const el = document.getElementById(`question-${qId}`);
  if (!el) return;

  el.classList.remove(HIGHLIGHT_CLASS);
  void el.offsetWidth;
  el.classList.add(HIGHLIGHT_CLASS);
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 3000);
}

export default ScribeController;
