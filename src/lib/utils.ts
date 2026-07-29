import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a user's display name, mirroring care_fe's `formatName`
 * (src/Utils/utils.ts): first + last, falling back to
 * the username when no name parts are set.
 */
export function formatName(
  user?: {
    first_name?: string;
    last_name?: string;
    username?: string;
  } | null,
): string {
  if (!user) return "-";
  const name = [user.first_name, user.last_name]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  return name || user.username || "-";
}

/**
 * Patch the Duration element in a WebM blob's EBML header.
 *
 * MediaRecorder sets duration to 0 (or omits it entirely), so browsers
 * report `Infinity` and the scrubber breaks. We scan the first 32 KB for
 * the Duration element ID (0x4489) and overwrite its value. Works for
 * both float32 (VINT size 0x84) and float64 (0x88) encodings used by
 * Chrome and Firefox respectively.
 */
export async function patchWebmDuration(
  blob: Blob,
  durationMs: number,
): Promise<Blob> {
  if (!blob.type.includes("webm")) return blob; // m4a already has correct metadata
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const limit = Math.min(buffer.byteLength - 12, 32768);
  for (let i = 0; i < limit; i++) {
    if (view.getUint8(i) !== 0x44 || view.getUint8(i + 1) !== 0x89) continue;
    const sizeVint = view.getUint8(i + 2);
    if (sizeVint === 0x88) {
      view.setFloat64(i + 3, durationMs, false); // 8-byte float64 (Chrome)
    } else if (sizeVint === 0x84) {
      view.setFloat32(i + 3, durationMs, false); // 4-byte float32 (Firefox)
    } else {
      continue;
    }
    break;
  }
  return new Blob([buffer], { type: blob.type });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
