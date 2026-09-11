/**
 * ORBB edge API — standardized error envelope + middlewares (M3-A, A21).
 *
 * Architecture §3: every error responds with the machine-checkable
 * envelope
 *
 *   { "error": { "code", "message", "details?", "requestId" } }
 *
 * with a stable status mapping (400/401/403/404/409/422/429/500). The
 * stable contract is the `code`, never the message; messages are
 * PHI-safe by construction (they describe the violated invariant and
 * never echo received values — ids, payloads, keys).
 *
 * Status mapping (recorded):
 *   400 invalid-request   — malformed transport input: unparseable JSON,
 *                           wrong content type, malformed query/header
 *                           values (limit, Idempotency-Key), malformed
 *                           pagination cursor (via @orbb/db).
 *   401 unauthenticated   — no principal could be resolved.
 *   403 forbidden         — authorization denied (emitted by the A23
 *                           authorization layer; the mapping exists now
 *                           so the envelope contract is complete).
 *   404 not-found         — unknown route/method, malformed path ids
 *                           (uniform with existence secrecy), and
 *                           missing or FOREIGN person-scoped resources.
 *   409 conflict          — idempotency claim in flight; persistence
 *                           state-conflict (optimistic concurrency).
 *   422 validation-failed — well-formed JSON that violates the domain
 *                           input contract (field types, vocabularies,
 *                           grammar of body fields).
 *   429 rate-limited      — abuse protection (A25; mapping exists now).
 *   500 internal-error    — transaction-integrity failures
 *                           (outbox-required, migration-failure) and any
 *                           unknown error (generic message — original
 *                           error text is never echoed).
 *
 * Bundling note: `PersistenceError` is imported as a TYPE only and
 * matched structurally at runtime — a value import of @orbb/db would drag
 * the Drizzle/postgres.js driver into the Worker bundle. The structural
 * check is keyed on the frozen @orbb/db error-code vocabulary.
 */
import { DomainInvariantError } from "@orbb/domain";
import type { PersistenceError as PersistenceErrorType } from "@orbb/db";
import type { PersistenceErrorCode } from "@orbb/db";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiEnv } from "./context.js";
import type { RequestIdFactory } from "./context.js";

/** Stable machine-readable error codes (one per HTTP status). */
export type ApiErrorCode =
  | "invalid-request"
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "validation-failed"
  | "rate-limited"
  | "internal-error";

/** HTTP status for each error code. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = Object.freeze({
  "invalid-request": 400,
  unauthenticated: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "validation-failed": 422,
  "rate-limited": 429,
  "internal-error": 500,
});

/** Field-level validation issue (field PATH only — values never echoed). */
export interface ValidationIssue {
  readonly field: string;
  readonly problem: string;
}

/** `details` payload for validation failures. */
export interface ValidationDetails {
  readonly issues: readonly ValidationIssue[];
}

/**
 * Typed API failure. Throw from any handler or middleware; the
 * {@link errorHandler} renders it in the standardized envelope.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }

  /** HTTP status for this error (from the frozen code table). */
  get status(): number {
    return API_ERROR_STATUS[this.code];
  }
}

/** Convenience: typed 404 (missing or foreign person-scoped resource). */
export function apiNotFound(what: string): ApiError {
  return new ApiError("not-found", `${what} not found.`);
}

/** Convenience: typed 422 with field-level validation issues. */
export function apiValidationFailed(
  message: string,
  issues: readonly ValidationIssue[],
): ApiError {
  return new ApiError("validation-failed", message, {
    details: { issues } satisfies ValidationDetails,
  });
}

/** The wire shape of the standardized error envelope. */
export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly requestId: string;
  };
}

/** Fallback request id when the request-id middleware has not run. */
const REQUEST_ID_FALLBACK = "unattributed";

/** The frozen @orbb/db persistence error-code vocabulary. */
const PERSISTENCE_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  "invalid-request",
  "state-conflict",
  "not-found",
  "outbox-required",
  "migration-failure",
] satisfies readonly PersistenceErrorCode[]);

/**
 * Structural `PersistenceError` test (see the bundling note above): an
 * `Error` carrying one of the frozen persistence codes.
 */
function isPersistenceError(error: unknown): error is PersistenceErrorType {
  if (!(error instanceof Error)) {
    return false;
  }
  const code: unknown = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && PERSISTENCE_ERROR_CODES.has(code);
}

function requestIdOf(c: Context<ApiEnv>): string {
  const id = c.get("requestId");
  return typeof id === "string" && id.length > 0 ? id : REQUEST_ID_FALLBACK;
}

/**
 * Maps a thrown error onto the envelope contract. Unknown errors get the
 * generic 500 message — their text is never echoed (PHI discipline).
 */
function toEnvelopeParts(error: unknown): {
  status: number;
  code: ApiErrorCode;
  message: string;
  details: Readonly<Record<string, unknown>> | undefined;
} {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof DomainInvariantError) {
    // Domain guards are PHI-safe by construction (shape descriptions).
    return { status: 422, code: "validation-failed", message: error.message, details: undefined };
  }
  if (isPersistenceError(error)) {
    switch (error.code) {
      case "invalid-request":
        return { status: 400, code: "invalid-request", message: error.message, details: undefined };
      case "state-conflict":
        return { status: 409, code: "conflict", message: error.message, details: undefined };
      case "not-found":
        return { status: 404, code: "not-found", message: error.message, details: undefined };
      case "outbox-required":
      case "migration-failure":
        return { status: 500, code: "internal-error", message: error.message, details: undefined };
    }
  }
  return {
    status: 500,
    code: "internal-error",
    message: "An internal error occurred.",
    details: undefined,
  };
}

/** The application-wide error handler (`app.onError`). */
export function errorHandler(error: unknown, c: Context<ApiEnv>): Response {
  const { status, code, message, details } = toEnvelopeParts(error);
  const requestId = requestIdOf(c);
  const envelope: ApiErrorEnvelope = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
    },
  };
  return c.json(envelope, status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500);
}

/** Unknown routes and methods (`app.notFound`) — 404 in envelope form. */
export function notFoundHandler(c: Context<ApiEnv>): Response {
  const requestId = requestIdOf(c);
  const envelope: ApiErrorEnvelope = {
    error: {
      code: "not-found",
      message: "The requested route does not exist.",
      requestId,
    },
  };
  return c.json(envelope, 404);
}

/** Accepted grammar for an ECHOED `x-request-id` (best effort). */
const ECHOED_REQUEST_ID_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/;

/**
 * Request-id middleware: echoes a well-formed `x-request-id` or mints a
 * fresh one; the id rides the Hono context (for the error envelope) and
 * is emitted as the `x-request-id` response header on EVERY response,
 * including error envelopes and idempotent replays.
 */
export function requestIdMiddleware(factory: RequestIdFactory): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const echoed = c.req.header("x-request-id");
    const id =
      typeof echoed === "string" && ECHOED_REQUEST_ID_PATTERN.test(echoed)
        ? echoed
        : factory.next();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
    // Defensive net: responses built outside Hono helpers (e.g. raw
    // `c.res = new Response(...)` in the idempotency replay path) may not
    // carry the header — rebuild once, if needed, so the contract holds.
    if (!c.res.headers.has("x-request-id")) {
      const body = await c.res.text();
      const headers = new Headers(c.res.headers);
      headers.set("x-request-id", id);
      c.res = new Response(body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers,
      });
    }
  };
}
