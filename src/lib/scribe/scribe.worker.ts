/// <reference lib="webworker" />
/**
 * Upload worker: offloads MP3 encoding + presigned upload off the main thread.
 *
 * Bundled locally by Vite via `new Worker(new URL("./scribe.worker.ts", ...))`,
 * so there is no CDN fetch or runtime worker patching. If the worker fails to
 * construct, the client falls back to main-thread encoding transparently.
 */
import { encodeMp3 } from "./encoder";
import { uploadToStorage } from "./storage";
import type { SessionUploadInfo } from "./types";

interface WorkerRequest {
  id: number;
  fileName: string;
  samples: Float32Array;
  upload: SessionUploadInfo;
}

type WorkerResponse =
  | { id: number; ok: true; status: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, fileName, samples, upload } = event.data;
  try {
    const blob = encodeMp3(samples);
    if (!blob) throw new Error("MP3 encoding produced no data");
    const result = await uploadToStorage(fileName, blob, upload);
    const response: WorkerResponse = { id, ok: true, status: result.status };
    ctx.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : "Upload failed",
    };
    ctx.postMessage(response);
  }
};
