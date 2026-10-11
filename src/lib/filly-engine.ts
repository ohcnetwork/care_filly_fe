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

/**
 * Prompt the user to share a tab/screen with audio so the remote side of a
 * telemedicine call (played as system audio) is captured too. Must be called
 * synchronously from a user gesture, before any other `await`, or browsers
 * reject it for lacking transient activation.
 *
 * Browsers require a video track to be requested; it is stopped immediately
 * since only the audio is used.
 */
export async function requestSystemAudioStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  stream.getVideoTracks().forEach((track) => track.stop());
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new SystemAudioUnavailableError();
  }
  return stream;
}

/** The user shared a source without ticking "Share audio". */
export class SystemAudioUnavailableError extends Error {
  constructor() {
    super(
      'No system audio was shared. Choose the call\'s tab or your screen and enable "Share audio" to record both sides of the call.',
    );
    this.name = "SystemAudioUnavailableError";
  }
}

export class VadRecorder {
  private readonly callbacks: VadRecorderCallbacks;
  private vad: MicVAD | null = null;
  private stream: MediaStream | null = null;
  private systemStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private chunkIndex = 0;
  private paused = false;

  constructor(callbacks: VadRecorderCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Open the mic and begin VAD segmentation. When `systemStream` (from
   * `requestSystemAudioStream`) is given, its audio is mixed with the mic so
   * both sides of a call are transcribed. The recorder takes ownership of
   * it and stops its tracks on stop/cancel.
   */
  async start(deviceId?: string, systemStream?: MediaStream): Promise<void> {
    this.systemStream = systemStream ?? null;
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      video: false,
    });
    this.stream = micStream;

    const vadStream = this.systemStream
      ? this.mixStreams(micStream, this.systemStream)
      : micStream;

    this.vad = await MicVAD.new({
      stream: vadStream,
      model: "v5",
      // Slightly sticky end-of-speech so natural pauses inside a sentence
      // don't split a single thought into several chunks.
      redemptionFrames: 24,
      minSpeechFrames: 8,
      preSpeechPadFrames: 8,
      submitUserSpeechOnPause: true,
      onSpeechEnd: (audio: Float32Array) => {
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

  /** Mix mic + system audio into a single stream for the VAD. */
  private mixStreams(mic: MediaStream, system: MediaStream): MediaStream {
    const ctx = new AudioContext();
    const destination = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(mic).connect(destination);
    ctx.createMediaStreamSource(system).connect(destination);
    this.audioContext = ctx;
    return destination.stream;
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.systemStream?.getTracks().forEach((track) => track.stop());
    this.systemStream = null;
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
  }
}
