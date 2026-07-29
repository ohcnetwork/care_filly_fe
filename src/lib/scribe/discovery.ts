import { DiscoveryError } from "./errors";
import type { Transport } from "./transport";
import type { DiscoveryDocument, ResolvedConfig } from "./types";

const DISCOVERY_PATH = "/.well-known/medscribealliance";
const CACHE_TTL_MS = 5 * 60 * 1000;

function resolve(doc: DiscoveryDocument): ResolvedConfig {
  return {
    baseUrl: doc.endpoints?.base_url,
    supportedLanguages: doc.languages?.supported ?? [],
    storageProvider: doc.capabilities?.storage_provider ?? "aws",
    maxChunkDurationSeconds: doc.capabilities?.max_chunk_duration_seconds,
  };
}

/** Fetches and caches the backend discovery document. */
export class DiscoveryManager {
  private cached: ResolvedConfig | null = null;
  private cachedAt = 0;

  constructor(
    private readonly transport: Transport,
    private readonly debug = false,
  ) {}

  private isFresh(): boolean {
    return Date.now() - this.cachedAt < CACHE_TTL_MS;
  }

  async fetch(baseUrl: string, force = false): Promise<ResolvedConfig> {
    if (!force && this.cached && this.isFresh()) return this.cached;
    const url = baseUrl + DISCOVERY_PATH;
    if (this.debug) console.log("[Scribe] Fetching discovery from:", url);
    try {
      const res = await this.transport.request<DiscoveryDocument>({
        method: "GET",
        url,
      });
      const resolved = resolve(res.data);
      this.cached = resolved;
      this.cachedAt = Date.now();
      if (this.debug) {
        console.log("[Scribe] Discovery complete:", res.data.service?.name);
      }
      return resolved;
    } catch (err) {
      throw new DiscoveryError(
        `Failed to fetch discovery document: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
        { baseUrl },
      );
    }
  }

  getResolved(): ResolvedConfig | null {
    return this.cached;
  }

  getStorageProvider(): string {
    return this.cached?.storageProvider ?? "aws";
  }

  clear(): void {
    this.cached = null;
    this.cachedAt = 0;
  }
}
