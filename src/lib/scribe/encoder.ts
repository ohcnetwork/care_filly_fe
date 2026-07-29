import { Mp3Encoder } from "@breezystack/lamejs";

/** Output MIME for encoded chunks (matches the MedScribe protocol). */
export const MP3_MIME = "audio/mpeg";

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_BITRATE_KBPS = 128;

/**
 * Encode mono PCM (Float32, [-1, 1]) to an MP3 blob using lamejs.
 *
 * Runs identically on the main thread and inside the upload worker, so encoding
 * can be offloaded without behavioural drift.
 */
export function encodeMp3(
  samples: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
  bitrateKbps = DEFAULT_BITRATE_KBPS,
): Blob | null {
  try {
    const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const parts: Uint8Array[] = [];
    const encoded = encoder.encodeBuffer(pcm);
    if (encoded && encoded.length > 0) parts.push(encoded);
    const flushed = encoder.flush();
    if (flushed && flushed.length > 0) parts.push(flushed);
    if (parts.length === 0) return null;
    // Copy into fresh ArrayBuffers so the Blob owns contiguous memory.
    return new Blob(
      parts.map((p) => new Uint8Array(p)),
      { type: MP3_MIME },
    );
  } catch (err) {
    console.error("[Scribe] MP3 encoding failed:", err);
    return null;
  }
}
