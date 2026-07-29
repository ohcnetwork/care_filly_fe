import { encodeMp3 } from "./encoder";
import { UploadError } from "./errors";
import { uploadToStorage } from "./storage";
import type { SessionUploadInfo, UploadEvent } from "./types";

interface WorkerResponse {
  id: number;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface UploadQueueConfig {
  useWorker: boolean | "auto";
  debug?: boolean;
  onUploadEvent?: (event: UploadEvent) => void;
}

/**
 * Coordinates MP3 encoding + presigned upload for recorded chunks, on a worker
 * when available and on the main thread otherwise. Tracks progress and retains
 * raw samples for chunks that fail so they can be retried.
 */
export class UploadQueue {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (status: number) => void; reject: (err: Error) => void }
  >();

  private upload: SessionUploadInfo | null = null;
  private inflight = new Set<Promise<void>>();

  private totalCount = 0;
  private successCount = 0;
  /** fileName → raw samples, kept only while a chunk is unresolved/failed. */
  private readonly failed = new Map<string, Float32Array>();

  constructor(private readonly config: UploadQueueConfig) {
    if (config.useWorker !== false) this.tryCreateWorker();
  }

  private tryCreateWorker(): void {
    try {
      this.worker = new Worker(new URL("./scribe.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, ok, status, error } = event.data;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        if (ok) entry.resolve(status ?? 200);
        else entry.reject(new Error(error ?? "Upload failed"));
      };
      this.worker.onerror = () => {
        // Fall back to main-thread processing for the rest of the session.
        this.disposeWorker();
      };
    } catch {
      this.worker = null;
    }
  }

  private disposeWorker(): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error("Upload worker terminated"));
    }
    this.pending.clear();
    try {
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
  }

  setUpload(upload: SessionUploadInfo): void {
    this.upload = upload;
  }

  /** Queue a recorded chunk for encode + upload. Never rejects. */
  enqueue(samples: Float32Array, fileName: string): void {
    this.totalCount += 1;
    // Retain a copy so a failed chunk can be retried after the worker (which
    // may transfer/detach the buffer) is done with it.
    this.failed.set(fileName, samples.slice());
    const task = this.process(samples, fileName)
      .then(() => {
        this.failed.delete(fileName);
        this.successCount += 1;
        this.config.onUploadEvent?.({
          type: "progress",
          timestamp: new Date().toISOString(),
          data: {
            successCount: this.successCount,
            totalCount: this.totalCount,
          },
        });
      })
      .catch((err: Error) => {
        this.config.onUploadEvent?.({
          type: "failed",
          timestamp: new Date().toISOString(),
          data: { fileName, error: err.message },
        });
        if (this.config.debug) {
          console.warn("[Scribe] chunk upload failed:", fileName, err.message);
        }
      })
      .finally(() => {
        this.inflight.delete(task);
      });
    this.inflight.add(task);
  }

  private process(samples: Float32Array, fileName: string): Promise<void> {
    const upload = this.upload;
    if (!upload) {
      return Promise.reject(
        new UploadError("No upload target configured", [fileName]),
      );
    }
    if (this.worker) return this.processOnWorker(samples, fileName, upload);
    return this.processOnMainThread(samples, fileName, upload);
  }

  private processOnWorker(
    samples: Float32Array,
    fileName: string,
    upload: SessionUploadInfo,
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return this.processOnMainThread(samples, fileName, upload);
    const id = this.nextId++;
    // Copy so the transfer doesn't detach the retry copy in `failed`.
    const payload = samples.slice();
    return new Promise<number>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, fileName, samples: payload, upload }, [
        payload.buffer,
      ]);
    }).then(() => undefined);
  }

  private async processOnMainThread(
    samples: Float32Array,
    fileName: string,
    upload: SessionUploadInfo,
  ): Promise<void> {
    const blob = encodeMp3(samples);
    if (!blob)
      throw new UploadError("MP3 encoding produced no data", [fileName]);
    await uploadToStorage(fileName, blob, upload);
  }

  /** Resolve once every queued chunk has settled. */
  async waitForAll(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }

  hasFailed(): boolean {
    return this.failed.size > 0;
  }

  getFailedFileNames(): string[] {
    return [...this.failed.keys()];
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  getSuccessCount(): number {
    return this.successCount;
  }

  /** Retry all failed chunks against a (possibly refreshed) upload target. */
  async retryFailed(
    upload?: SessionUploadInfo,
  ): Promise<{ retried: number; succeeded: number; stillFailed: string[] }> {
    if (upload) this.upload = upload;
    const entries = [...this.failed.entries()];
    const retried = entries.length;
    let succeeded = 0;
    const stillFailed: string[] = [];

    for (const [fileName, samples] of entries) {
      try {
        await this.process(samples.slice(), fileName);
        this.failed.delete(fileName);
        this.successCount += 1;
        succeeded += 1;
        this.config.onUploadEvent?.({
          type: "progress",
          timestamp: new Date().toISOString(),
          data: {
            successCount: this.successCount,
            totalCount: this.totalCount,
          },
        });
      } catch (err) {
        stillFailed.push(fileName);
        this.config.onUploadEvent?.({
          type: "failed",
          timestamp: new Date().toISOString(),
          data: {
            fileName,
            error: err instanceof Error ? err.message : "Retry failed",
          },
        });
      }
    }
    return { retried, succeeded, stillFailed };
  }

  destroy(): void {
    this.disposeWorker();
    this.inflight.clear();
    this.failed.clear();
    this.totalCount = 0;
    this.successCount = 0;
    this.upload = null;
  }
}
