/**
 * Renders the `@ohcnetwork/care-filly-character` mascot without going
 * through its `<FillyCharacter>`/`<FillyMascot>` React components.
 *
 * Those components render a react-three-fiber `<Canvas>`, which mounts a
 * *second* React renderer via `@react-three/fiber`'s bundled
 * react-reconciler. When care_filly_fe runs as a module-federation remote
 * inside the care_fe host (i.e. as intended — this app is a plugin, not a
 * standalone SPA), that second reconciler's internals don't line up with
 * the host's exact React build: the canvas never sizes (its
 * `react-use-measure` `ResizeObserver` never fires) and, once forced to
 * render anyway, r3f throws `dispatcher.getOwner is not a function` from
 * deep inside its own React internals — outside any error boundary. Net
 * effect: a blank canvas with no visible error, only when embedded live.
 *
 * This component sidesteps the problem entirely by driving the package's
 * lower-level, React-free API (`FillyModel` + `FillyAnimator`, the same
 * primitives `<FillyScene>` uses internally) with a plain
 * `requestAnimationFrame` loop and a manually managed `THREE.WebGLRenderer`.
 * There is only ever one React tree (ours), so there is no reconciler to
 * clash with the host's.
 */
import { useEffect, useRef } from "react";

import type { FillyStatus } from "@/lib/types/filly";
import { cn } from "@/lib/utils";

export interface FillyAvatarProps {
  status: FillyStatus;
  /** True while the assistant is speaking (recording → talking). */
  speaking?: boolean;
  /** 0..1 live audio level (mic/TTS); null/undefined = synthetic talking. */
  audioLevel?: number | null;
  /** Square size in px. Default 96. */
  size?: number;
  /** Hover → attentive, press → squash, click → short happy bounce. */
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
  /** Bump (e.g. increment) to wake from sleep with a happy bounce, same as a click. */
  wakeSignal?: number;
  /** Bump to trigger a dizzy spell, e.g. when Filly is dragged around fast. */
  dizzySignal?: number;
}

/** How long a click's "happy" bounce overrides the mapped status. */
const HAPPY_BOUNCE_MS = 1600;
/** Idle with no click for this long → falls asleep. */
const IDLE_SLEEP_MS = 5000;
/** Dizzy keeps spinning for this long after being triggered. */
const DIZZY_HOLD_MS = 1800;

/** Mirrors the light rig baked into the package's own `<FillyScene>` (see
 *  `src/react/FillyScene.tsx` there) so the vanilla render matches it. */
function addLights(
  THREE: typeof import("three"),
  scene: import("three").Scene,
) {
  scene.add(new THREE.HemisphereLight("#fffdf3", "#b0cba0", 0.9));
  const key = new THREE.DirectionalLight("#fffdf5", 2.2);
  key.position.set(-3.5, 5, 8);
  scene.add(key);
  const fillA = new THREE.DirectionalLight("#e7f1e7", 0.45);
  fillA.position.set(3, 1, 4);
  scene.add(fillA);
  const fillB = new THREE.DirectionalLight("#e3f4cf", 0.4);
  fillB.position.set(-1, -2, 5);
  scene.add(fillB);
  const rim = new THREE.DirectionalLight("#f8ffe8", 0.65);
  rim.position.set(0, 3, -4);
  scene.add(rim);
}

export function FillyAvatar({
  status,
  speaking = false,
  audioLevel = null,
  size = 96,
  interactive = true,
  onClick,
  className,
  wakeSignal,
  dizzySignal,
}: FillyAvatarProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Read by the render loop every frame — avoids tearing down/rebuilding the
  // whole renderer (and re-triggering enter impulses) on every prop change.
  const liveRef = useRef({ status, speaking, audioLevel });
  useEffect(() => {
    liveRef.current = { status, speaking, audioLevel };
  }, [status, speaking, audioLevel]);

  // Click → short happy bounce, overriding the mapped status; a click also
  // resets the idle-sleep timer below. Both read/written by the render loop,
  // so a ref (not state) avoids re-running the mount effect on every click.
  const overrideRef = useRef<{
    state: "happy" | "sleepy" | "dizzy" | null;
    until: number;
  }>({ state: null, until: 0 });
  const lastInteractionRef = useRef(0);
  //just for chicking if we can let filly sleep
  const lastCursorActivityRef = useRef(0);

  const wake = () => {
    const now = performance.now();
    lastInteractionRef.current = now;
    lastCursorActivityRef.current = now;
    overrideRef.current = { state: "happy", until: now + HAPPY_BOUNCE_MS };
  };

  // External wake-up (e.g. the FAB being dragged) — only reacts to a change,
  // never on the initial render, so a fresh `wakeSignal={0}` doesn't bounce.
  const prevWakeSignalRef = useRef(wakeSignal);
  useEffect(() => {
    if (wakeSignal !== undefined && wakeSignal !== prevWakeSignalRef.current) {
      wake();
    }
    prevWakeSignalRef.current = wakeSignal;
  }, [wakeSignal]);

  // Dizzy is triggered externally (fast FAB dragging), not by general mouse
  // movement on the page — same bump-on-change pattern as wakeSignal.
  const prevDizzySignalRef = useRef(dizzySignal);
  useEffect(() => {
    if (
      dizzySignal !== undefined &&
      dizzySignal !== prevDizzySignalRef.current
    ) {
      const now = performance.now();
      lastInteractionRef.current = now;
      lastCursorActivityRef.current = now;
      overrideRef.current = { state: "dizzy", until: now + DIZZY_HOLD_MS };
    }
    prevDizzySignalRef.current = dizzySignal;
  }, [dizzySignal]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    lastInteractionRef.current = performance.now();
    lastCursorActivityRef.current = performance.now();
    let cancelled = false;
    let dispose: (() => void) | undefined;

    Promise.all([
      import("@ohcnetwork/care-filly-character"),
      import("three"),
      import("three/examples/jsm/environments/RoomEnvironment.js"),
    ]).then(([mascot, THREE, { RoomEnvironment }]) => {
      if (cancelled) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(mascot.CAMERA_FOV, 1, 0.1, 50);
      camera.position.set(...mascot.CAMERA_POSITION);
      camera.lookAt(...mascot.CAMERA_TARGET);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const envRT = pmrem.fromScene(room, 0.04);
      scene.environment = envRT.texture;
      scene.environmentIntensity = mascot.ENVIRONMENT_INTENSITY;
      pmrem.dispose();
      room.dispose();

      addLights(THREE, scene);

      const model = new mascot.FillyModel();
      scene.add(model);

      const animator = new mascot.FillyAnimator();

      const resize = () => {
        const rect = wrapper.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        // Avatars render small (down to ~28px CSS), so even on 1x displays a
        // plain devicePixelRatio backing buffer is too few samples for crisp
        // edges — force at least 3x supersampling, capped at 4x since the
        // canvas is tiny (the extra pixels cost is negligible either way).
        const pixelRatio = Math.min(
          Math.max(window.devicePixelRatio || 1, 3),
          4,
        );
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(wrapper);

      const io =
        typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver(
              (entries) => {
                for (const e of entries) onScreen = e.isIntersecting;
              },
              { threshold: 0 },
            )
          : null;
      let onScreen = true;
      io?.observe(wrapper);

      const onPointerMove = (e: PointerEvent) => {
        const r = wrapper.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hw = Math.max(1, window.innerWidth / 2);
        const hh = Math.max(1, window.innerHeight / 2);
        animator.setPointer((e.clientX - cx) / hw, -(e.clientY - cy) / hh);
        // Any cursor movement on the page counts as activity — Filly only
        // falls asleep once the cursor has been still for IDLE_SLEEP_MS.
        lastCursorActivityRef.current = performance.now();
      };
      window.addEventListener("pointermove", onPointerMove, {
        passive: true,
      });

      let raf = 0;
      let last = performance.now();
      const loop = (t: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        if (!onScreen) return;

        const live = liveRef.current;
        let targetState = mascot.mapStatusToState(live.status, {
          speaking: live.speaking,
        });
        const override = overrideRef.current;
        if (override.state && t < override.until) {
          targetState = override.state;
        } else {
          if (override.state) overrideRef.current = { state: null, until: 0 };
          if (
            t - lastCursorActivityRef.current > IDLE_SLEEP_MS &&
            live.status === "idle"
          ) {
            targetState = "sleepy";
          } else if (
            t - lastInteractionRef.current > IDLE_SLEEP_MS &&
            (live.status === "completed" || live.status === "failed")
          ) {
            targetState = "idle";
          }
        }
        animator.setState(targetState);
        animator.setAudioLevel(live.audioLevel ?? null);
        animator.update(dt);
        model.applyPose(animator.pose, animator.time);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);

      dispose = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io?.disconnect();
        window.removeEventListener("pointermove", onPointerMove);
        scene.remove(model);
        model.dispose();
        envRT.texture.dispose();
        renderer.dispose();
      };
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const handleClick = () => {
    if (!interactive) return;
    wake();
    onClick?.();
  };

  const handlePointerEnter = () => {
    if (!interactive) return;
    wake();
  };

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative inline-block leading-none select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        cursor: interactive && onClick ? "pointer" : undefined,
      }}
      onClick={interactive ? handleClick : undefined}
      onPointerEnter={interactive ? handlePointerEnter : undefined}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
