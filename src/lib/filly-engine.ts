import { MicVAD, NonRealTimeVAD, utils } from "@ricky0123/vad-web";

/**
 * In-house voice-activity-detection recorder.
 *
 * Replaces the med-filly-alliance SDK's recording engine. It opens the
 * microphone once and drives two consumers off the single stream:
 *
 * 1. A Silero-VAD (`@ricky0123/vad-web`) instance that segments continuous
 *    speech into utterances. Each finished utterance is encoded to a small
 *    16 kHz mono WAV and handed to `onSpeechChunk`, which uploads it to the
 *    backend so transcription can start while the doctor is still talking.
 * 2. A full-session `MediaRecorder` (webm/opus) whose blob is kept for the
 *    history panel — the same audio the user can replay or re-run later.
 *
 * VAD model + onnxruntime wasm assets are loaded from the library's default
 * CDN, so nothing extra needs bundling into the federated plugin.
 */

const DEBUG = import.meta.env.DEV;

// Speech below this many seconds is treated as a VAD misfire and dropped —
// avoids uploading coughs/clicks as their own chunk.
const MIN_UTTERANCE_SECONDS = 0.4;
const VAD_SAMPLE_RATE = 16000;
// Hard cap per uploaded chunk. Real-time ASR backends (e.g. Sarvam Saaras)
// reject audio longer than 30s, so keep every chunk safely under that.
const MAX_CHUNK_SECONDS = 25;

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

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
  private recorder: MediaRecorder | null = null;
  private historyChunks: Blob[] = [];
  private chunkIndex = 0;
  private paused = false;

  constructor(callbacks: VadRecorderCallbacks) {
    this.callbacks = callbacks;
  }

  /** Open the mic, start the history recorder, and begin VAD segmentation. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.startHistoryRecorder(this.stream);

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
    if (this.recorder?.state === "recording") this.recorder.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.vad?.start();
    if (this.recorder?.state === "paused") this.recorder.resume();
  }

  /**
   * Stop VAD + history recorder and return the full-session recording
   * (or null if capture never produced audio).
   */
  async stop(): Promise<Blob | null> {
    this.teardownVad();
    const blob = await this.finishHistoryRecorder();
    this.releaseStream();
    return blob;
  }

  /** Stop everything and discard any captured audio. */
  cancel(): void {
    this.teardownVad();
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.recorder = null;
    this.historyChunks = [];
    this.releaseStream();
  }

  // ── internals ────────────────────────────────────────────────────────

  private startHistoryRecorder(stream: MediaStream): void {
    try {
      const mimeType = RECORDER_MIME_CANDIDATES.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      this.historyChunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.historyChunks.push(event.data);
      };
      recorder.start(1000);
      this.recorder = recorder;
    } catch (err) {
      // Non-fatal — VAD chunks still drive transcription, only the
      // replayable history recording is lost.
      if (DEBUG) console.warn("[Filly] History recorder failed:", err);
      this.recorder = null;
    }
  }

  private finishHistoryRecorder(): Promise<Blob | null> {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder || recorder.state === "inactive") {
      const chunks = this.historyChunks;
      this.historyChunks = [];
      return Promise.resolve(
        chunks.length ? new Blob(chunks, { type: "audio/webm" }) : null,
      );
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const chunks = this.historyChunks;
        this.historyChunks = [];
        resolve(
          chunks.length
            ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
            : null,
        );
      };
      recorder.stop();
    });
  }

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

// ── offline segmentation (re-run of stored recordings) ─────────────────────

/** Decode any browser-supported audio blob to a 16 kHz mono Float32Array. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    // slice(0) hands decodeAudioData its own detached copy of the buffer.
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void decodeCtx.close();
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * VAD_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, VAD_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Split a sample buffer into windows no longer than MAX_CHUNK_SECONDS. */
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

/**
 * Segment a pre-recorded audio blob into upload-ready WAV chunks, mirroring
 * the live pipeline's VAD chunking. Used to re-run stored history recordings:
 * uploading the whole file as one chunk breaks real-time ASR backends that
 * cap request duration (Sarvam rejects audio > 30s). Voice-activity segments
 * keep chunks natural; any overly long utterance is hard-split under the cap.
 * Falls back to fixed-window slicing if VAD finds no speech.
 */
export async function segmentAudioBlob(blob: Blob): Promise<Blob[]> {
  const mono = await decodeToMono16k(blob);
  const chunks: Blob[] = [];

  const pushSegment = (segment: Float32Array) => {
    if (segment.length < MIN_UTTERANCE_SECONDS * VAD_SAMPLE_RATE) return;
    for (const capped of capSegments(segment)) {
      chunks.push(new Blob([utils.encodeWAV(capped)], { type: "audio/wav" }));
    }
  };

  try {
    const vad = await NonRealTimeVAD.new();
    for await (const { audio } of vad.run(mono, VAD_SAMPLE_RATE)) {
      pushSegment(audio);
    }
  } catch (err) {
    if (DEBUG) console.warn("[Filly] offline VAD failed, using windows:", err);
  }

  // No speech detected (or VAD failed): fall back to fixed-size windows so
  // the recording is still transcribed rather than dropped.
  if (chunks.length === 0) {
    for (const capped of capSegments(mono)) {
      chunks.push(new Blob([utils.encodeWAV(capped)], { type: "audio/wav" }));
    }
  }

  return chunks;
}
