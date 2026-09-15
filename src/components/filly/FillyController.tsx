import {
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
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
import {
  type FieldFill,
  applyFieldToState,
  collectFieldsToFill,
} from "@/lib/structured/fill";
import type { FillyResult } from "@/lib/types/filly";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import { FillyAvatar } from "@/components/filly/FillyAvatar";

import { useFilly } from "@/hooks/useFilly";
import { useFillyLanguage } from "@/hooks/useFillyLanguage";
import { useFillyPreference } from "@/hooks/useFillyPreference";
import { useMicrophoneDevices } from "@/hooks/useMicrophoneDevices";
import { useTranslation } from "@/hooks/useTranslation";

interface FillyControllerProps {
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
const LONG_PRESS_RESET_MS = 2000;

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

/** Ring + rising 30%-opacity fill with a short status label, shown while
 *  the widget is pressed and held, giving visual feedback for the
 *  press-and-hold reset gesture. */
function LongPressIndicator({ progress }: { progress: number }) {
  const { t } = useTranslation();
  if (progress <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute top-0 bottom-0 right-0.5 -left-0.5 overflow-hidden rounded-3xl ring-2 ring-primary-500">
        <div
          className="absolute inset-y-0 left-0 bg-primary-600/30"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="absolute top-full bg-transparent left-1/2 mt-1 -translate-x-1/2 truncate px-2 py-0.5 text-[10px] text-gray-500 italic sm:text-xs">
        {t("resetting_position")}
      </span>
    </div>
  );
}

/**
 * Lets the user drag the floating filly widget away from its default
 * bottom-right corner — it can otherwise sit on top of a page's own submit
 * button. Position is persisted across sessions (per browser), keyed by
 * the current CARE user id (see `@/lib/fab-position`) so a shared/kiosk
 * device doesn't leak one person's dragged position into another user's
 * session. A plain click/tap still reaches the button underneath;
 * dragging only kicks in once the pointer has moved past a small
 * threshold, and the resulting click is suppressed so Start/Stop etc.
 * don't fire accidentally. Double-click/tap, pressing and holding for
 * ~3s (LONG_PRESS_RESET_MS — a touch-friendly alternative to double-tap;
 * a ring fills in via LongPressIndicator as visual feedback), or the
 * "Reset position" button on the settings page all reset the widget back
 * to its default corner. The widget's on-screen rect is always clamped
 * to the viewport (both while dragging and on window resize) so it can
 * never be dragged fully off-screen and become unreachable.
 */
function useDraggableFab() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [longPressProgress, setLongPressProgress] = useState(0);
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
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRafRef = useRef<number | null>(null);
  const longPressStartRef = useRef(0);
  const longPressTriggeredRef = useRef(false);

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

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (longPressRafRef.current) {
      cancelAnimationFrame(longPressRafRef.current);
      longPressRafRef.current = null;
    }
    setLongPressProgress(0);
  }, []);

  const resetPosition = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    try {
      localStorage.removeItem(fabPositionStorageKey(userIdRef.current));
    } catch {
      // ignore
    }
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

      // Press-and-hold reset: cancelled the moment the pointer moves past
      // the drag threshold (handleMove below) or is released/leaves early
      // (handleUp below). longPressTriggeredRef suppresses the click that
      // otherwise follows the eventual pointerup/tap.
      longPressTriggeredRef.current = false;
      longPressStartRef.current = performance.now();
      const tick = () => {
        const elapsed = performance.now() - longPressStartRef.current;
        setLongPressProgress(Math.min(1, elapsed / LONG_PRESS_RESET_MS));
        longPressRafRef.current = requestAnimationFrame(tick);
      };
      longPressRafRef.current = requestAnimationFrame(tick);
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        clearLongPress();
        resetPosition();
      }, LONG_PRESS_RESET_MS);
    },
    [offset, clearLongPress, resetPosition],
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
        clearLongPress(); // dragging supersedes the press-and-hold reset
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
      clearLongPress();
      if (longPressTriggeredRef.current) {
        // clear after this tick so the click event that follows release
        // is still suppressed by onClickCapture below.
        setTimeout(() => {
          longPressTriggeredRef.current = false;
        }, 0);
      }
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
  }, [clearLongPress]);

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
    if (draggedRef.current || longPressTriggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    offset,
    isDragging,
    longPressProgress,
    containerRef,
    onPointerDown,
    onClickCapture,
    resetPosition,
  };
}

export function FillyController(props: FillyControllerProps) {
  return (
    <div className="care-filly-fe-container">
      <FillyControllerInner {...props} />
    </div>
  );
}

function FillyControllerInner({
  formState,
  setFormState,
}: FillyControllerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [transcriptMinimized, setTranscriptMinimized] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [draftTranscript, setDraftTranscript] = useState("");
  const appliedRef = useRef(false);
  const fillTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [filledCount, setFilledCount] = useState(0);
  // The real, post-resolution fields — used for the preview instead of raw
  // extracted data, since a hallucinated/unresolved/disabled value never
  // reaches here even though Medispeak's raw output had something for it.
  const [appliedFields, setAppliedFields] = useState<FieldFill[]>([]);
  const [isResolvingFields, setIsResolvingFields] = useState(false);

  // The user's own filly opt-in from the profile page.
  const preference = useFillyPreference();

  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const micMenuRef = useRef<HTMLDivElement>(null);
  const mic = useMicrophoneDevices(micMenuOpen);
  const fillyLanguage = useFillyLanguage();

  useEffect(() => {
    if (!micMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!micMenuRef.current?.contains(e.target as Node)) {
        setMicMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [micMenuOpen]);

  // Lets the widget be dragged clear of a page's own submit button.
  const fabDrag = useDraggableFab();
  const fabDragStyle = {
    transform: `translate3d(${fabDrag.offset.x}px, ${fabDrag.offset.y}px, 0)`,
    touchAction: "none",
    cursor: fabDrag.isDragging ? "grabbing" : undefined,
  } as const;

  // Dragging the FAB counts as interacting with Filly — wakes it from sleep
  // with a happy bounce instead of leaving it snoozing mid-drag.
  const [wakeSignal, setWakeSignal] = useState(0);
  useEffect(() => {
    if (fabDrag.isDragging) setWakeSignal((c) => c + 1);
  }, [fabDrag.isDragging]);

  const clearFillTimeouts = useCallback(() => {
    fillTimeoutsRef.current.forEach(clearTimeout);
    fillTimeoutsRef.current = [];
  }, []);

  const applyResults = useCallback(
    async (result: FillyResult) => {
      if (!setFormState || !formState) return;
      if (!result.structuredData) {
        console.warn("[Filly] No structured data to fill");
        return;
      }
      if (appliedRef.current) return;
      appliedRef.current = true;
      setIsResolvingFields(true);

      try {
        const fieldsToFill = await collectFieldsToFill(
          formState,
          result.structuredData,
          result.transcript,
        );

        if (import.meta.env.DEV) {
          console.log("[Filly] Fields to fill:", fieldsToFill);
        }

        if (!fieldsToFill.length) {
          console.warn(
            "[Filly] No matching fields found for extracted data",
            result.structuredData,
          );
        }

        setFilledCount(0);
        setAppliedFields(fieldsToFill);

        fieldsToFill.forEach((field, index) => {
          const timeoutId = setTimeout(() => {
            setFormState((currentState: unknown) =>
              applyFieldToState(currentState, field),
            );
            highlightField(field.qId);
            setFilledCount(index + 1);
            if (field.structuredType === "service_request") {
              expandServiceRequestRows(field.qId, field.structuredValue);
            }
            if (field.structuredType === "medication_request") {
              revealMedicationAdvancedFields(field.qId, field.structuredValue);
            }
          }, index * FIELD_FILL_DELAY_MS);

          fillTimeoutsRef.current.push(timeoutId);
        });
      } catch (err) {
        appliedRef.current = false;
        console.error("[Filly] Failed to apply results:", err);
      } finally {
        setIsResolvingFields(false);
      }
    },
    [formState, setFormState],
  );

  const [liveTranscript, setLiveTranscript] = useState<string>("");

  const filly = useFilly({
    formState,
    onTranscript: (transcript) => {
      setLiveTranscript(transcript);
    },
    onResult: (result) => {
      console.log("[Filly] Result:", result);
      void applyResults(result);
    },
    onError: (error) => {
      console.error("[Filly] Error:", error);
    },
  });

  // Open the results view automatically once transcription/processing finishes
  useEffect(() => {
    if (filly.status === "completed") {
      setExpanded(true);
    }
  }, [filly.status]);

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
    if (filly.status !== "recording") {
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
  }, [filly.status]);

  const beginRecording = async () => {
    clearFillTimeouts();
    appliedRef.current = false;
    setFilledCount(0);
    setAppliedFields([]);
    setIsResolvingFields(false);
    setTranscriptMinimized(false);
    setEditingTranscript(false);
    setDraftTranscript("");
    await filly.startRecording({ language: [fillyLanguage.language] });
  };

  const handleStart = async () => {
    await beginRecording();
  };

  const handleStop = async () => {
    await filly.stopRecording();
  };

  const handleDismiss = async () => {
    clearFillTimeouts();
    await filly.reset();
    setExpanded(false);
    setTranscriptMinimized(false);
    setEditingTranscript(false);
    setDraftTranscript("");
  };

  const handleEditTranscript = () => {
    setDraftTranscript(filly.result?.transcript ?? "");
    setEditingTranscript(true);
  };

  const handleCancelEditTranscript = () => {
    setEditingTranscript(false);
    setDraftTranscript("");
  };

  const handleRetryWithCorrectedTranscript = async () => {
    const corrected = draftTranscript.trim();
    if (!corrected) return;
    clearFillTimeouts();
    appliedRef.current = false;
    setEditingTranscript(false);
    await filly.retryStructuring(corrected);
  };

  const handleReprocess = async () => {
    clearFillTimeouts();
    appliedRef.current = false;
    setEditingTranscript(false);
    await filly.retryTranscription();
  };

  useEffect(() => clearFillTimeouts, [clearFillTimeouts]);

  const duration = filly.duration;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const timeStr = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  const avgBarLevel =
    barHeights.reduce((sum, h) => sum + h, 0) / Math.max(1, barHeights.length);

  // Idle state — floating pill FAB (bottom-right)
  if (filly.status === "idle") {
    // Filly is only offered once the user has enabled it from their
    // profile page. Whether they may use it at all is enforced separately
    // by the backend's can_use_filly permission check.
    if (preference.isLoading || !preference.enabled) {
      return null;
    }

    return (
      <div
        ref={fabDrag.containerRef}
        className="filly-pop-in fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6"
        style={fabDragStyle}
        onPointerDown={fabDrag.onPointerDown}
        onClickCapture={fabDrag.onClickCapture}
        onDoubleClick={fabDrag.resetPosition}
        title={t("ai_filly")}
      >
        <LongPressIndicator progress={fabDrag.longPressProgress} />
        <div ref={micMenuRef} className="relative flex items-center gap-2">
          {micMenuOpen && (
            <div className="absolute right-0 bottom-full mb-2 w-64 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl">
              <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-semibold tracking-wide text-gray-500 uppercase bg-linear-to-r from-primary-100 to-transparent">
                {t("microphone")}
              </div>
              <div className="max-h-48 overflow-y-auto p-1">
                {mic.error ? (
                  <p className="px-2 py-1.5 text-xs text-gray-500">
                    {t("microphone_permission_required")}
                  </p>
                ) : mic.isLoading ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                ) : mic.devices.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-gray-500">
                    {t("no_microphones_found")}
                  </p>
                ) : (
                  mic.devices.map((device) => {
                    const selected = device.deviceId === mic.selectedDeviceId;
                    return (
                      <button
                        key={device.deviceId}
                        onClick={() => {
                          mic.selectDevice(device.deviceId);
                          setMicMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                          selected
                            ? "bg-primary-50 font-medium text-primary-700"
                            : "text-gray-600 hover:bg-gray-50",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                            selected
                              ? "border-primary-600 bg-primary-600"
                              : "border-gray-300 bg-white",
                          )}
                        >
                          {selected && (
                            <Check className="h-2.5 w-2.5 text-white" />
                          )}
                        </span>
                        <span className="truncate">{device.label}</span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="border-y border-gray-100 px-3 py-2 text-[11px] font-semibold tracking-wide text-gray-500 uppercase bg-linear-to-r from-primary-100 to-transparent">
                {t("language")}
              </div>
              <div className="max-h-48 overflow-y-auto p-1">
                {fillyLanguage.options.map((option) => {
                  const selected = option.code === fillyLanguage.language;
                  return (
                    <button
                      key={option.code}
                      onClick={() => {
                        fillyLanguage.selectLanguage(option.code);
                        setMicMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                        selected
                          ? "bg-primary-50 font-medium text-primary-700"
                          : "text-gray-600 hover:bg-gray-50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                          selected
                            ? "border-primary-600 bg-primary-600"
                            : "border-gray-300 bg-white",
                        )}
                      >
                        {selected && (
                          <Check className="h-2.5 w-2.5 text-white" />
                        )}
                      </span>
                      <span className="truncate">{t(option.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button
            onClick={() => setMicMenuOpen((open) => !open)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-500 shadow-lg transition-colors hover:bg-gray-50"
            title={t("microphone")}
            aria-label={t("microphone")}
          >
            <Settings2 className="h-4 w-4" />
          </button>
          {/* same 64px slot as the recording/paused orb below, so the character
              doesn't jump position or size once a session starts */}
          <div className="relative flex h-16 w-16 items-center justify-center">
            <FillyAvatar
              status="idle"
              size={70}
              interactive={!filly.isStarting}
              onClick={filly.isStarting ? undefined : handleStart}
              wakeSignal={wakeSignal}
              className="drop-shadow-lg"
            />
            {filly.isStarting && (
              <span
                className="pointer-events-none absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow"
                title={t("starting")}
              >
                <Loader2 className="h-3 w-3 animate-spin text-primary-600" />
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const transcript = liveTranscript || filly.result?.transcript || "";
  const showTranscript =
    transcript &&
    (filly.status === "processing" || filly.status === "completed");

  // Real processing progress, derived from actual API signals (not a timer):
  //  0 = transcribing audio  (recording ended, no transcript yet)
  //  1 = extracting details  (transcript received, structuring templates)
  //  2 = filling the form    (structured result received / completed)
  const processingStep = filly.status === "completed" ? 2 : transcript ? 1 : 0;

  // Compact / status views (recording, processing, completed, failed)
  if (!expanded) {
    return (
      <div
        ref={fabDrag.containerRef}
        className="filly-pop-in fixed right-4 bottom-4 z-9999 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6"
        style={fabDragStyle}
        onPointerDown={fabDrag.onPointerDown}
        onClickCapture={fabDrag.onClickCapture}
        onDoubleClick={fabDrag.resetPosition}
      >
        <LongPressIndicator progress={fabDrag.longPressProgress} />
        {/* Live transcript — collapsible, shown while processing/completed */}
        {showTranscript && !transcriptMinimized && (
          <div className="w-72 overflow-hidden rounded-2xl border border-gray-100 bg-white/95 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-gray-100 bg-linear-to-r from-primary-100 to-transparent px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                <FileText className="h-3 w-3" />
                {t("transcript")}
              </span>
              <div className="flex items-center gap-1">
                {filly.status === "completed" && (
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
        {filly.status === "processing" && (
          <div className="flex flex-col items-center gap-2">
            <p className="filly-shimmer-text text-xs font-medium">
              {t(PROCESSING_STEPS[processingStep])}
            </p>
            <FillyAvatar status="processing" size={70} interactive={false} />
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

        {/* RECORDING — character listens; audio level drives its talking/ear animation.
            Same 64px slot/position as the idle orb above for a seamless transition. */}
        {filly.status === "recording" && (
          <div className="flex flex-col items-center gap-2">
            {/* timer + pause button inline */}
            <div className="flex items-center gap-1.5">
              <span className="filly-shimmer-text text-xs font-medium">
                {timeStr}
              </span>
              <button
                onClick={filly.pauseRecording}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200"
                title={t("pause")}
              >
                <Pause className="h-2.5 w-2.5" />
              </button>
            </div>
            <button
              onClick={handleStop}
              title={t("stop_and_process")}
              className="group relative flex h-16 w-16 items-center justify-center rounded-full transition-transform active:scale-95"
            >
              <FillyAvatar
                status="recording"
                audioLevel={avgBarLevel}
                size={70}
                interactive={false}
              />
              {/* stop icon on hover */}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
                <Square className="h-5 w-5 text-primary-700 drop-shadow" />
              </span>
            </button>
          </div>
        )}

        {/* PAUSED — resume near timer; stop on orb hover */}
        {filly.status === "paused" && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-amber-500">
                {timeStr}
              </span>
              <button
                onClick={filly.resumeRecording}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700 opacity-90"
                title={t("resume")}
              >
                <Play className="h-2.5 w-2.5" />
              </button>
            </div>
            <button
              onClick={handleStop}
              title={t("stop_and_process")}
              className="group relative flex h-16 w-16 items-center justify-center rounded-full transition-transform active:scale-95"
            >
              <FillyAvatar status="paused" size={70} interactive={false} />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
                <Square className="h-5 w-5 text-primary-700 drop-shadow" />
              </span>
            </button>
          </div>
        )}

        {/* COMPLETED — success pill */}
        {filly.status === "completed" && (
          <div className="flex items-center gap-2 rounded-full border border-primary-100 bg-white py-2 pr-2 pl-3 shadow-xl">
            <FillyAvatar status="completed" size={28} interactive={false} />
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
        {filly.status === "failed" && (
          <div className="flex items-center gap-2 rounded-full border border-red-100 bg-white py-2 pr-2 pl-3 shadow-xl">
            <FillyAvatar status="failed" size={28} interactive={false} />
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
    <>
      <div
        ref={fabDrag.containerRef}
        className="filly-pop-in fixed right-4 bottom-4 z-9999 w-80 sm:right-6 sm:bottom-6"
        style={fabDragStyle}
      >
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
          <LongPressIndicator progress={fabDrag.longPressProgress} />
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
              {!editingTranscript && filly.status !== "processing" && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleReprocess}
                    className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-gray-700"
                    title={t("reprocess")}
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    {t("reprocess")}
                  </Button>
                </div>
              )}
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
            {filly.result?.transcript && (
              <div className="mb-3">
                <div className="flex items-center justify-between">
                  <span className="flex gap-3 text-[10px] font-medium text-gray-400 uppercase">
                    {t("transcript")}
                  </span>
                  {!editingTranscript && filly.status !== "processing" && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleEditTranscript}
                        className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-gray-700"
                        title={t("edit_transcript")}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                        {t("edit")}
                      </button>
                    </div>
                  )}
                </div>
                {filly.status === "processing" ? (
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("retrying")}
                  </div>
                ) : (
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">
                    {filly.result.transcript}
                  </p>
                )}
              </div>
            )}

            {filly.result?.structuredData && (
              <div>
                <span className="text-[10px] font-medium text-gray-400 uppercase">
                  {t("extracted_values")}
                </span>
                <div className="mt-1 space-y-1">
                  {isResolvingFields ? (
                    <div className="flex items-center justify-center py-2">
                      <p className="text-xs text-gray-400">
                        {t("filly_is_resolving_fields")}
                      </p>
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    </div>
                  ) : appliedFields.length === 0 ? (
                    <p className="text-xs text-gray-400">
                      {t("no_matching_fields")}
                    </p>
                  ) : (
                    appliedFields.map((field, i) => (
                      <button
                        key={`${field.qId}-${i}`}
                        type="button"
                        onClick={() => highlightField(field.qId, !!field.error)}
                        title={t("go_to_field")}
                        className={cn(
                          "flex w-full items-center justify-between rounded px-2 py-1 text-left transition-colors",
                          field.error
                            ? "bg-amber-50 hover:bg-amber-100"
                            : "bg-gray-50 hover:bg-gray-100",
                        )}
                      >
                        <span className="text-xs text-gray-500 mr-5">
                          {field.label}
                        </span>
                        {field.error ? (
                          <span className="text-xs font-medium text-amber-700">
                            {field.error}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-900">
                            {field.structuredValue
                              ? t("n_filled", {
                                  n: Array.isArray(field.structuredValue)
                                    ? field.structuredValue.length
                                    : 1,
                                })
                              : field.coding
                                ? field.coding.display
                                : (field.matchedValue ??
                                  t("n_filled", { n: 1 }))}
                            {field.matchedNote && (
                              <span className="ml-1 font-normal text-gray-500">
                                ({field.matchedNote})
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {filly.error && (
              <p className="text-xs text-red-500 mt-1.5">{filly.error}</p>
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

      {editingTranscript && (
        <div className="fixed inset-0 z-10000 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-[32rem] min-w-0 flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-linear-to-r from-primary-100 to-transparent rounded-t-2xl">
              <span className="text-sm font-semibold text-gray-700">
                {t("edit_transcript")}
              </span>
              <button
                onClick={handleCancelEditTranscript}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
                title={t("cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={draftTranscript}
              onChange={(e) => setDraftTranscript(e.target.value)}
              rows={10}
              autoFocus
              className="m-4 min-w-0 resize-y rounded-md border border-gray-200 p-3 text-sm leading-relaxed text-gray-700 ring-primary-400 focus:border-primary-400 focus:outline-hidden"
            />
            <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
              <button
                onClick={handleCancelEditTranscript}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleRetryWithCorrectedTranscript}
                disabled={!draftTranscript.trim()}
                className="flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                {t("retry")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// --- Form fill utilities ---

function highlightField(qId: string, isError = false): void {
  const HIGHLIGHT_CLASS = isError ? "filly-highlight-error" : "filly-highlight";
  const el = document.getElementById(`question-${qId}`);
  if (!el) return;

  el.classList.remove("filly-highlight", "filly-highlight-error");
  void el.offsetWidth;
  el.classList.add(HIGHLIGHT_CLASS);
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 3000);
}

function expandServiceRequestRows(qId: string, structuredValue: unknown) {
  if (!Array.isArray(structuredValue) || !structuredValue.length) return;

  setTimeout(() => {
    const container = document.getElementById(`question-${qId}`);
    if (!container) return;

    for (const item of structuredValue) {
      const sr = (item as Record<string, unknown> | null)?.service_request as
        | Record<string, unknown>
        | undefined;
      const title = typeof sr?.title === "string" ? sr.title : undefined;
      const hasExtraDetails = !!(
        sr?.body_site ||
        (typeof sr?.patient_instruction === "string" &&
          sr.patient_instruction.trim()) ||
        (typeof sr?.note === "string" && sr.note.trim())
      );
      if (!title || !hasExtraDetails) continue;

      const trigger = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '[data-slot="collapsible-trigger"][data-state="closed"]',
        ),
      ).find((btn) => btn.textContent?.includes(title));
      trigger?.click();
    }
  }, 100);
}

// expand the medication request advanced fields if any of the dosage instructions have additional instructions,
// site, route, or method specified
function revealMedicationAdvancedFields(
  qId: string,
  structuredValue: unknown,
): void {
  if (!Array.isArray(structuredValue) || !structuredValue.length) return;

  const hasAdvancedData = structuredValue.some((medication) => {
    const dosageInstruction = (medication as Record<string, unknown> | null)
      ?.dosage_instruction;
    if (!Array.isArray(dosageInstruction)) return false;
    return dosageInstruction.some((di: Record<string, unknown>) => {
      const additionalInstruction = di?.additional_instruction;
      return (
        (Array.isArray(additionalInstruction) &&
          additionalInstruction.length > 0) ||
        !!di?.site ||
        !!di?.route ||
        !!di?.method
      );
    });
  });
  if (!hasAdvancedData) return;

  setTimeout(() => {
    const container = document.getElementById(`question-${qId}`);
    const toggle = (container ?? document).querySelector<HTMLElement>(
      '[title="Show Advanced Fields"]',
    );
    toggle?.click();
  }, 100);
}

export default FillyController;
