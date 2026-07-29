import { ScribeError, toScribeError } from "./errors";
import type { Transport } from "./transport";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  EndSessionRequest,
  EndSessionResponse,
  GetSessionStatusResponse,
  PatchSessionRequest,
  PatchSessionResponse,
  PollOptions,
} from "./types";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_MAX_ATTEMPTS = 60;
const TERMINAL_SESSION_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new ScribeError("Polling was aborted", { code: "polling_aborted" }),
      );
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(
          new ScribeError("Polling was aborted", { code: "polling_aborted" }),
        );
      },
      { once: true },
    );
  });
}

/** Session lifecycle API over the scribe backend. */
export class SessionManager {
  private current: CreateSessionResponse | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly debug = false,
  ) {}

  getCurrent(): CreateSessionResponse | null {
    return this.current;
  }

  private requireSessionId(sessionId?: string): string {
    const id = sessionId ?? this.current?.session_id;
    if (!id) {
      throw new ScribeError(
        "No active session. Provide a sessionId or start a session first.",
      );
    }
    return id;
  }

  async createSession(
    baseUrl: string,
    body: CreateSessionRequest,
    version?: string,
  ): Promise<CreateSessionResponse> {
    try {
      let url = `${baseUrl}/sessions`;
      if (version) url += `?version=${encodeURIComponent(version)}`;
      if (this.debug) console.log("[Scribe] Creating session:", url);
      const res = await this.transport.request<CreateSessionResponse>({
        method: "POST",
        url,
        body,
      });
      this.current = res.data;
      if (this.debug)
        console.log("[Scribe] Session created:", res.data.session_id);
      return res.data;
    } catch (err) {
      throw toScribeError(err, "Failed to create session");
    }
  }

  async endSession(
    baseUrl: string,
    body: EndSessionRequest,
    sessionId?: string,
  ): Promise<EndSessionResponse> {
    try {
      const id = this.requireSessionId(sessionId);
      const url = `${baseUrl}/sessions/${id}/end`;
      if (this.debug) console.log("[Scribe] Ending session:", id);
      const res = await this.transport.request<EndSessionResponse>({
        method: "POST",
        url,
        body,
      });
      if (this.current?.session_id === id) this.current = null;
      return res.data;
    } catch (err) {
      throw toScribeError(err, "Failed to end session");
    }
  }

  async getSessionStatus(
    baseUrl: string,
    sessionId?: string,
    templateId?: string,
    version?: string,
    signal?: AbortSignal,
  ): Promise<GetSessionStatusResponse> {
    try {
      const id = this.requireSessionId(sessionId);
      const params = new URLSearchParams();
      if (templateId) params.set("template_id", templateId);
      if (version) params.set("version", version);
      const qs = params.toString();
      const url = qs
        ? `${baseUrl}/sessions/${id}?${qs}`
        : `${baseUrl}/sessions/${id}`;
      const res = await this.transport.request<GetSessionStatusResponse>({
        method: "GET",
        url,
        acceptStatuses: [410],
        signal,
      });
      return res.data;
    } catch (err) {
      throw toScribeError(err, "Failed to get session status");
    }
  }

  /** Poll `getSessionStatus` until the session reaches a terminal state. */
  async pollSessionStatus(
    baseUrl: string,
    sessionId: string,
    options: PollOptions,
    templateId?: string,
    version?: string,
  ): Promise<GetSessionStatusResponse> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
    const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    let last: GetSessionStatusResponse | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (options.signal?.aborted) break;
      last = await this.getSessionStatus(
        baseUrl,
        sessionId,
        templateId,
        version,
        options.signal,
      );
      options.onProgress?.(last);
      if (TERMINAL_SESSION_STATUSES.has(String(last.status))) return last;
      try {
        await sleep(intervalMs, options.signal);
      } catch {
        break; // aborted
      }
    }

    if (!last) {
      throw new ScribeError("Polling ended before any status was received");
    }
    return last;
  }

  async patchSession(
    baseUrl: string,
    body: PatchSessionRequest,
    sessionId?: string,
  ): Promise<PatchSessionResponse> {
    try {
      const id = this.requireSessionId(sessionId);
      const url = `${baseUrl}/sessions/${id}`;
      if (this.debug) console.log("[Scribe] Patching session:", id, body);
      const res = await this.transport.request<PatchSessionResponse>({
        method: "PATCH",
        url,
        body,
      });
      return res.data;
    } catch (err) {
      throw toScribeError(err, "Failed to patch session");
    }
  }

  async cancelSession(
    baseUrl: string,
    sessionId?: string,
  ): Promise<PatchSessionResponse> {
    const res = await this.patchSession(
      baseUrl,
      { user_status: "cancelled" },
      sessionId,
    );
    const id = sessionId ?? this.current?.session_id;
    if (this.current?.session_id === id) this.current = null;
    return res;
  }

  clear(): void {
    this.current = null;
  }
}
