/** Error hierarchy for the in-repo scribe client. Async client methods never
 * throw — they return `SDKResult<T>` with one of these in `error`. */

export class ScribeError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: { code?: string; status?: number; details?: unknown },
  ) {
    super(message);
    this.name = "ScribeError";
    this.code = options?.code ?? "scribe_error";
    this.status = options?.status;
    this.details = options?.details;
  }
}

export class ValidationError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "validation_error", status: 400, details });
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "authentication_error", status: 401, details });
    this.name = "AuthenticationError";
  }
}

export class ForbiddenError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "forbidden", status: 403, details });
    this.name = "ForbiddenError";
  }
}

export class SessionNotFoundError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "session_not_found", status: 404, details });
    this.name = "SessionNotFoundError";
  }
}

export class SessionExpiredError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "session_expired", status: 410, details });
    this.name = "SessionExpiredError";
  }
}

export class RateLimitError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "rate_limit", status: 429, details });
    this.name = "RateLimitError";
  }
}

export class DiscoveryError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "discovery_error", details });
    this.name = "DiscoveryError";
  }
}

export class TransportError extends ScribeError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "transport_error", details });
    this.name = "TransportError";
  }
}

export class UploadError extends ScribeError {
  readonly failedFiles: string[];
  constructor(message: string, failedFiles: string[] = [], details?: unknown) {
    super(message, { code: "upload_error", details });
    this.name = "UploadError";
    this.failedFiles = failedFiles;
  }
}

/** Map an HTTP status to the right error class. */
export function errorFromStatus(
  status: number,
  message: string,
  details?: unknown,
): ScribeError {
  switch (status) {
    case 400:
      return new ValidationError(message, details);
    case 401:
      return new AuthenticationError(message, details);
    case 403:
      return new ForbiddenError(message, details);
    case 404:
      return new SessionNotFoundError(message, details);
    case 410:
      return new SessionExpiredError(message, details);
    case 429:
      return new RateLimitError(message, details);
    default:
      return new ScribeError(message, { code: "http_error", status, details });
  }
}

/** Normalise any thrown value into a ScribeError. */
export function toScribeError(err: unknown, fallback: string): ScribeError {
  if (err instanceof ScribeError) return err;
  return new ScribeError(err instanceof Error ? err.message : fallback);
}
