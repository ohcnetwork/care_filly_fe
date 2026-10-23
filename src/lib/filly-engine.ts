import type { AudioNodeVAD } from "@ricky0123/vad-web";

/**
 * In-house voice-activity-detection recorder.
 *
 * Opens the microphone once and drives a Silero-VAD
 * (`@ricky0123/vad-web`) instance off the stream, segmenting continuous
 * speech into utterances. Each finished utterance is encoded to a small
 * 16 kHz mono WAV and handed to `onSpeechChunk`, which uploads it to
 * Medispeak so transcription can start while the doctor is still talking.
 *
 * VAD model, worklet and onnxruntime wasm assets are self-hosted by the
 * plugin (emitted by `vite.config.mts` under a versioned path and served with
 * immutable cache headers), so after the first recording they come from the
 * browser cache instead of jsDelivr.
 */

const DEBUG = import.meta.env.DEV;

// Resolved against the plugin chunk's own origin — the chunk is loaded
// cross-origin by the host, so a bare "/vad/" would hit the host instead.
const VAD_ASSET_BASE = new URL(
  `${import.meta.env.BASE_URL}vad/${__VAD_VERSION__}/`,
  import.meta.url,
).href;

type VadModule = typeof import("@ricky0123/vad-web");

let vadModulePromise: Promise<VadModule> | null = null;

function loadVadModule(): Promise<VadModule> {
  vadModulePromise ??= import("@ricky0123/vad-web").catch((err) => {
    vadModulePromise = null; // allow a retry on the next call
    throw err;
  });
  return vadModulePromise;
}

/**
 * A fully initialised VAD (model downloaded, onnx session compiled, worklet
 * loaded) that is not yet attached to a microphone. Building this is the slow
 * part of starting a recording, so it is done ahead of time.
 */
interface WarmVad {
  ctx: AudioContext;
  vad: AudioNodeVAD;
  utils: VadModule["utils"];
  /** Receives finished utterances from whichever recorder currently owns it. */
  sink: { onSpeechEnd: ((audio: Float32Array) => void) | null };
}

let warmVadPromise: Promise<WarmVad> | null = null;

async function createWarmVad(): Promise<WarmVad> {
  const { AudioNodeVAD, utils } = await loadVadModule();
  const ctx = new AudioContext();
  const sink: WarmVad["sink"] = { onSpeechEnd: null };
  try {
    const vad = await AudioNodeVAD.new(ctx, {
      model: "v5",
      baseAssetPath: VAD_ASSET_BASE,
      onnxWASMBasePath: VAD_ASSET_BASE,
      // Slightly sticky end-of-speech so natural pauses inside a sentence
      // don't split a single thought into several chunks.
      redemptionFrames: 24,
      minSpeechFrames: 8,
      preSpeechPadFrames: 8,
      submitUserSpeechOnPause: true,
      // The tiny Silero model gains nothing from threads, and this keeps
      // onnxruntime on the single-threaded wasm we actually ship.
      ortConfig: (ort) => {
        ort.env.wasm.numThreads = 1;
      },
      onSpeechEnd: (audio: Float32Array) => sink.onSpeechEnd?.(audio),
      onVADMisfire: () => {
        if (DEBUG) console.log("[Filly] VAD misfire");
      },
    });
    return { ctx, vad, utils, sink };
  } catch (err) {
    void ctx.close();
    throw err;
  }
}

/** Caches a warm VAD for reuse, dropping it if it turns out to have failed. */
function cacheWarmVad(pending: Promise<WarmVad>): void {
  warmVadPromise = pending;
  pending.catch(() => {
    if (warmVadPromise === pending) warmVadPromise = null;
  });
}

/** Hands out the warm VAD (building one if needed); each is used once. */
function takeWarmVad(): Promise<WarmVad> {
  const pending = warmVadPromise ?? createWarmVad();
  warmVadPromise = null;
  return pending;
}

/**
 * Build a VAD ahead of the first recording so a slow network or CPU doesn't
 * delay recording start. Fire-and-forget; failures are ignored because
 * `VadRecorder.start()` builds one on demand if none is ready.
 */
export function preloadVad(): void {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData || warmVadPromise) return;

  cacheWarmVad(createWarmVad());
}

// Speech below this many seconds is treated as a VAD misfire and dropped —
// avoids uploading coughs/clicks as their own chunk.
const MIN_UTTERANCE_SECONDS = 0.4;
// Hard cap per chunk — Sarvam's ASR REST endpoint rejects audio over ~30s.
const MAX_CHUNK_SECONDS = 25;
const VAD_SAMPLE_RATE = 16000;

/** Splits `samples` into windows no longer than MAX_CHUNK_SECONDS. */
function* capSegments(samples: Float32Array): Generator<Float32Array> {
  const maxLen = Math.floor(MAX_CHUNK_SECONDS * VAD_SAMPLE_RATE);
  if (samples.length <= maxLen) {
    yield samples;
    return;
  }
  for (let offset = 0; offset < samples.length; offset += maxLen) {
    yield samples.subarray(offset, Math.min(offset + maxLen, samples.length));
  }
}

export interface VadRecorderCallbacks {
  /** A completed speech utterance, ready to upload as a chunk. */
  onSpeechChunk: (wav: Blob, index: number) => void;
  /** Non-fatal engine error (mic denied, VAD load failure, …). */
  onError?: (error: Error) => void;
}

export class VadRecorder {
  private readonly callbacks: VadRecorderCallbacks;
  private warm: WarmVad | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private chunkIndex = 0;
  private paused = false;
  private cancelled = false;

  constructor(callbacks: VadRecorderCallbacks) {
    this.callbacks = callbacks;
  }

  /** Open the mic and begin VAD segmentation. */
  async start(deviceId?: string): Promise<void> {
    // The VAD is usually ready already; either way it initialises while the
    // mic permission prompt is open.
    const warmPromise = takeWarmVad();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        video: false,
      });
    } catch (err) {
      // Mic denied/unavailable — keep the prepared VAD for the next attempt.
      if (!warmVadPromise) cacheWarmVad(warmPromise);
      throw err;
    }

    // Cancelled while the permission prompt was open: free the mic right away.
    if (this.cancelled) {
      this.releaseStream();
      if (!warmVadPromise) cacheWarmVad(warmPromise);
      return;
    }

    let warm: WarmVad;
    try {
      warm = await warmPromise;
    } catch (err) {
      this.releaseStream();
      throw err;
    }
    if (this.cancelled) {
      this.releaseStream();
      if (warmVadPromise) void warm.ctx.close();
      else cacheWarmVad(warmPromise);
      return;
    }
    this.warm = warm;
    warm.sink.onSpeechEnd = (audio) => this.handleSpeechEnd(audio, warm.utils);

    // A context built before any user gesture starts suspended.
    await warm.ctx.resume();
    this.source = new MediaStreamAudioSourceNode(warm.ctx, {
      mediaStream: this.stream,
    });
    warm.vad.receive(this.source);
    warm.vad.start();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.warm?.vad.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.warm?.vad.start();
  }

  /**
   * Stop VAD and release the microphone. This is the only path that ends
   * the MediaStream tracks — callers must always await it, or the mic
   * stays live after recording appears to have stopped.
   */
  async stop(): Promise<void> {
    this.teardownVad();
    this.releaseStream();
  }

  /** Stop everything and discard any captured audio. */
  cancel(): void {
    this.teardownVad();
    this.releaseStream();
  }

  // ── internals ────────────────────────────────────────────────────────

  private handleSpeechEnd(audio: Float32Array, utils: VadModule["utils"]) {
    if (this.paused) return;
    if (audio.length < MIN_UTTERANCE_SECONDS * VAD_SAMPLE_RATE) return;
    try {
      for (const segment of capSegments(audio)) {
        const wavBuffer = utils.encodeWAV(segment);
        const blob = new Blob([wavBuffer], { type: "audio/wav" });
        this.callbacks.onSpeechChunk(blob, this.chunkIndex++);
      }
    } catch (err) {
      if (DEBUG) console.warn("[Filly] WAV encode failed:", err);
    }
  }

  private teardownVad(): void {
    this.cancelled = true;
    const warm = this.warm;
    if (warm) {
      try {
        // Pausing flushes any in-flight speech through the sink first.
        warm.vad.pause();
        warm.sink.onSpeechEnd = null;
        this.source?.disconnect();
        warm.vad.destroy();
        void warm.ctx.close();
      } catch (err) {
        if (DEBUG) console.warn("[Filly] VAD teardown failed:", err);
      }
    }
    this.warm = null;
    this.source = null;
    // A fresh VAD is consumed per recording; warm the next one now.
    preloadVad();
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
