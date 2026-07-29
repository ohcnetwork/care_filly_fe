import { MicVAD } from "@ricky0123/vad-web";

// Silero VAD frame at 16 kHz. Matches the previous SDK's recorder defaults.
const SAMPLE_RATE = 16000;
const FRAME_SIZE = 1024;
const PRE_SPEECH_PAD_FRAMES = 20;

// Chunk-boundary tuning (seconds → samples), from the MedScribe defaults.
const PREF_CHUNK_SECONDS = 10;
const DESP_CHUNK_SECONDS = 20;
const MAX_CHUNK_SECONDS = 25;
const SHORT_SILENCE_SECONDS = 0.1;
const LONG_SILENCE_SECONDS = 0.5;

const MAX_CHUNKS = 500;

export interface VadChunkerConfig {
  deviceId?: string;
  maxChunkSeconds?: number;
  vadAssetBasePath?: string;
  vadOnnxWasmBasePath?: string;
}

export interface VadChunkerCallbacks {
  /** A finished audio chunk is ready to encode + upload. */
  onChunk: (
    samples: Float32Array,
    fileName: string,
    chunkIndex: number,
  ) => void;
  onSpeechStateChange?: (isSpeaking: boolean) => void;
  onError?: (error: Error) => void;
}

/**
 * Owns the microphone + voice-activity detection and cuts the stream into
 * silence-aligned chunks. Chunk boundaries reproduce the MedScribe protocol's
 * behaviour so backend transcription quality is unchanged.
 */
export class VadChunker {
  private vad: MicVAD | null = null;
  private stream: MediaStream | null = null;
  private recording = false;
  private chunkCount = 0;

  // Buffer of raw PCM frames accumulated since the last clip point.
  private buffer: Float32Array[] = [];
  private bufferSamples = 0;

  // VAD clip-point bookkeeping.
  private vadPast: number[] = [];
  private lastClipIndex = 0;
  private silDurationAcc = 0;

  private readonly prefSamples = PREF_CHUNK_SECONDS * SAMPLE_RATE;
  private readonly despSamples = DESP_CHUNK_SECONDS * SAMPLE_RATE;
  private maxSamples = MAX_CHUNK_SECONDS * SAMPLE_RATE;
  private readonly shortSilence = SHORT_SILENCE_SECONDS * SAMPLE_RATE;
  private readonly longSilence = LONG_SILENCE_SECONDS * SAMPLE_RATE;

  constructor(
    private readonly config: VadChunkerConfig,
    private readonly callbacks: VadChunkerCallbacks,
  ) {
    if (config.maxChunkSeconds) {
      this.maxSamples = config.maxChunkSeconds * SAMPLE_RATE;
    }
  }

  isRecording(): boolean {
    return this.recording;
  }

  async start(): Promise<void> {
    const stream = await this.getMicStream(this.config.deviceId);
    this.stream = stream;

    this.vad = await MicVAD.new({
      stream,
      frameSamples: FRAME_SIZE,
      preSpeechPadFrames: PRE_SPEECH_PAD_FRAMES,
      ...(this.config.vadAssetBasePath
        ? { baseAssetPath: this.config.vadAssetBasePath }
        : {}),
      ...(this.config.vadOnnxWasmBasePath
        ? { onnxWASMBasePath: this.config.vadOnnxWasmBasePath }
        : {}),
      onFrameProcessed: (probabilities, frame) => {
        this.handleFrame(probabilities.isSpeech, frame);
      },
      onSpeechStart: () => this.callbacks.onSpeechStateChange?.(true),
      onSpeechEnd: () => this.callbacks.onSpeechStateChange?.(false),
    });

    this.vad.start();
    this.recording = true;
  }

  pause(): void {
    if (this.vad) {
      void this.vad.pause();
      this.recording = false;
    }
  }

  resume(): void {
    if (this.vad) {
      void this.vad.start();
      this.recording = true;
    }
  }

  /** Emit any remaining buffered audio as a final chunk. */
  flush(): void {
    if (this.bufferSamples === 0) return;
    if (this.chunkCount >= MAX_CHUNKS) return;
    const samples = this.drainBuffer();
    const fileName = `${++this.chunkCount}.mp3`;
    this.callbacks.onChunk(samples, fileName, this.chunkCount - 1);
  }

  async destroy(): Promise<void> {
    this.recording = false;
    try {
      if (this.vad) await this.vad.destroy();
    } catch (err) {
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error("VAD destroy failed"),
      );
    }
    this.vad = null;
    this.stopStream();
    this.reset();
  }

  private reset(): void {
    this.buffer = [];
    this.bufferSamples = 0;
    this.vadPast = [];
    this.lastClipIndex = 0;
    this.silDurationAcc = 0;
    this.chunkCount = 0;
  }

  private handleFrame(isSpeechProb: number, frame: Float32Array): void {
    try {
      if (!this.recording) return;
      // Copy the frame — vad-web may reuse the backing buffer.
      this.buffer.push(frame.slice());
      this.bufferSamples += frame.length;

      const isSpeech = isSpeechProb >= 0.5 ? 1 : 0;
      if (this.processVadFrame(isSpeech)) this.emitChunk();
    } catch (err) {
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error("Frame processing failed"),
      );
    }
  }

  /** Returns true when the current frame closes a chunk. */
  private processVadFrame(isSpeech: number): boolean {
    let clip = false;
    if (this.vadPast.length > 0) {
      if (isSpeech === 0) this.silDurationAcc += 1;
      if (isSpeech === 1) this.silDurationAcc = 0;
    }

    const activeSamples =
      (this.vadPast.length - this.lastClipIndex) * FRAME_SIZE;
    const trailingSilence = this.silDurationAcc * FRAME_SIZE;

    if (
      (activeSamples > this.prefSamples &&
        trailingSilence > this.longSilence) ||
      (activeSamples > this.despSamples && trailingSilence > this.shortSilence)
    ) {
      this.lastClipIndex =
        this.vadPast.length - Math.min(Math.floor(this.silDurationAcc / 2), 5);
      this.silDurationAcc = 0;
      clip = true;
    } else if (activeSamples >= this.maxSamples) {
      this.lastClipIndex = this.vadPast.length;
      this.silDurationAcc = 0;
      clip = true;
    }

    this.vadPast.push(isSpeech);
    if (clip) {
      this.vadPast = this.vadPast.slice(this.lastClipIndex);
      this.lastClipIndex = 0;
    }
    return clip;
  }

  private emitChunk(): void {
    if (this.chunkCount >= MAX_CHUNKS) {
      // Drop the buffer to bound memory once the hard cap is hit.
      this.buffer = [];
      this.bufferSamples = 0;
      return;
    }
    if (this.bufferSamples === 0) return;
    const samples = this.drainBuffer();
    const fileName = `${++this.chunkCount}.mp3`;
    this.callbacks.onChunk(samples, fileName, this.chunkCount - 1);
  }

  private drainBuffer(): Float32Array {
    const out = new Float32Array(this.bufferSamples);
    let offset = 0;
    for (const frame of this.buffer) {
      out.set(frame, offset);
      offset += frame.length;
    }
    this.buffer = [];
    this.bufferSamples = 0;
    return out;
  }

  private async getMicStream(deviceId?: string): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "OverconstrainedError" || name === "NotFoundError") {
        return navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw err;
    }
  }

  private stopStream(): void {
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch {
      // ignore
    }
    this.stream = null;
  }
}
