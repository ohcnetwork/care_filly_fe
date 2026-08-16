import { MicVAD, utils } from "@ricky0123/vad-web";

/**
 * In-house voice-activity-detection recorder.
 *
 * Opens the microphone once and drives a Silero-VAD
 * (`@ricky0123/vad-web`) instance off the stream, segmenting continuous
 * speech into utterances. Each finished utterance is encoded to a small
 * 16 kHz mono WAV and handed to `onSpeechChunk`, which uploads it to
 * Medispeak so transcription can start while the doctor is still talking.
 *
 * VAD model + onnxruntime wasm assets are loaded from the library's default
 * CDN, so nothing extra needs bundling into the federated plugin.
 */

const DEBUG = import.meta.env.DEV;

// Speech below this many seconds is treated as a VAD misfire and dropped —
// avoids uploading coughs/clicks as their own chunk.
const MIN_UTTERANCE_SECONDS = 0.4;
const VAD_SAMPLE_RATE = 16000;

/**
 * A short silent WAV used to mark a Medispeak session's audio complete
 * when recording stops without a trailing utterance still queued — the
 * session API needs one chunk flagged `final` to know no more audio is
 * coming.
 */
export function encodeSilenceMarker(): Blob {
  const samples = new Float32Array(Math.floor(0.1 * VAD_SAMPLE_RATE));
  return new Blob([utils.encodeWAV(samples)], { type: "audio/wav" });
}

export interface VadRecorderCallbacks {
  /** A completed speech utterance, ready to upload as a chunk. */
  onSpeechChunk: (wav: Blob, index: number) => void;
  /** Non-fatal engine error (mic denied, VAD load failure, …). */
  onError?: (error: Error) => void;
}

export class VadRecorder {
  private readonly callbacks: VadRecorderCallbacks;
  private vad: MicVAD | null = null;
  private stream: MediaStream | null = null;
  private chunkIndex = 0;
  private paused = false;

  constructor(callbacks: VadRecorderCallbacks) {
    this.callbacks = callbacks;
  }

  /** Open the mic and begin VAD segmentation. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.vad = await MicVAD.new({
      stream: this.stream,
      model: "v5",
      // Slightly sticky end-of-speech so natural pauses inside a sentence
      // don't split a single thought into several chunks.
      redemptionFrames: 24,
      minSpeechFrames: 8,
      preSpeechPadFrames: 8,
      onSpeechEnd: (audio: Float32Array) => {
        if (this.paused) return;
        if (audio.length < MIN_UTTERANCE_SECONDS * VAD_SAMPLE_RATE) return;
        try {
          const wavBuffer = utils.encodeWAV(audio);
          const blob = new Blob([wavBuffer], { type: "audio/wav" });
          this.callbacks.onSpeechChunk(blob, this.chunkIndex++);
        } catch (err) {
          if (DEBUG) console.warn("[Filly] WAV encode failed:", err);
        }
      },
      onVADMisfire: () => {
        if (DEBUG) console.log("[Filly] VAD misfire");
      },
    });

    this.vad.start();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.vad?.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.vad?.start();
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

  private teardownVad(): void {
    try {
      this.vad?.pause();
      this.vad?.destroy();
    } catch (err) {
      if (DEBUG) console.warn("[Filly] VAD teardown failed:", err);
    }
    this.vad = null;
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
