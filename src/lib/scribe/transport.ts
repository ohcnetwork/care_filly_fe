import { TransportError, errorFromStatus } from "./errors";

interface RequestSpec {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** HTTP statuses to treat as success (e.g. 410 for expired-session reads). */
  acceptStatuses?: number[];
  signal?: AbortSignal;
}

export interface TransportResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

/**
 * Thin fetch wrapper for the scribe backend.
 *
 * Unlike the previous SDK, this never sends `credentials: "include"`, so the
 * CARE API's CORS config (no `Access-Control-Allow-Credentials`) is happy and
 * the fetch-credentials shim is no longer needed. Auth is a Bearer JWT header.
 */
export class Transport {
  private accessToken: string;
  private readonly debug: boolean;
  /** Called on 401 to obtain a fresh token; returns null if unavailable. */
  onUnauthorized?: () => Promise<string | null>;

  constructor(accessToken = "", debug = false) {
    this.accessToken = accessToken;
    this.debug = debug;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    return { ...headers, ...extra };
  }

  async request<T = unknown>(spec: RequestSpec): Promise<TransportResponse<T>> {
    const doFetch = () =>
      fetch(spec.url, {
        method: spec.method,
        headers: this.buildHeaders(spec.headers),
        body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
        signal: spec.signal,
      });

    let response: Response;
    try {
      response = await doFetch();
    } catch (err) {
      throw new TransportError(
        err instanceof Error ? err.message : "Network request failed",
        { url: spec.url },
      );
    }

    // One transparent retry after a token refresh on 401.
    if (response.status === 401 && this.onUnauthorized) {
      const fresh = await this.onUnauthorized().catch(() => null);
      if (fresh) {
        this.accessToken = fresh;
        try {
          response = await doFetch();
        } catch (err) {
          throw new TransportError(
            err instanceof Error ? err.message : "Network request failed",
            { url: spec.url },
          );
        }
      }
    }

    const accept = spec.acceptStatuses ?? [];
    if (!response.ok && !accept.includes(response.status)) {
      const body = await response.json().catch(() => null);
      const message =
        (body as { error?: { message?: string }; message?: string })?.error
          ?.message ??
        (body as { message?: string })?.message ??
        response.statusText ??
        "Request failed";
      const details = (body as { error?: { details?: unknown } })?.error
        ?.details;
      if (this.debug) {
        console.error(
          "[Scribe] request failed",
          spec.url,
          response.status,
          body,
        );
      }
      throw errorFromStatus(response.status, message, details);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? ((await response.json()) as T)
      : (undefined as T);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { status: response.status, headers, data };
  }
}
