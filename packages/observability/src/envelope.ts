/**
 * Request log envelope (architecture §6: "Never send full PHI through
 * ... URLs"). The envelope logs the ROUTE PATTERN — never the raw URL
 * with query strings or resource identifiers. The raw `path` is accepted
 * only to derive a sanitized pattern when the router could not provide
 * one, and it never appears in the produced fields. When logged through
 * `@orbb/observability`, the default redaction policy additionally
 * redacts `path`/`url`-style fields, so raw URLs cannot reach a sink
 * even if a caller smuggles them into context.
 */
import type { LogFields } from "./record.js";

/** Route pattern used when neither `routePattern` nor `path` is available. */
export const UNKNOWN_ROUTE_PATTERN = "[unknown]";

/** Replacement token for identifier-like path segments. */
const ID_SEGMENT = ":id";

/** Input of `requestLogEnvelope`. */
export interface RequestLogInput {
  /** HTTP method (e.g. "POST"). */
  readonly method: string;
  /**
   * Raw request path (possibly containing ids and query strings). Used
   * ONLY to derive a sanitized route pattern when `routePattern` is
   * absent; never included in the envelope fields.
   */
  readonly path?: string;
  /** Response status code. */
  readonly status?: number;
  /** Request duration in milliseconds. */
  readonly durationMs?: number;
  /** Correlation identifier for the request. */
  readonly requestId?: string;
  /**
   * Route pattern from the router (e.g. "/v1/observations/:id").
   * Preferred over deriving one from `path`.
   */
  readonly routePattern?: string;
}

/** True when a path segment looks like an identifier or a value, not a route word. */
function isIdentifierLike(segment: string): boolean {
  if (segment.length === 0) {
    return false;
  }
  // Numeric ids (>= 4 digits): "2024", "47891". Short prefixes like "v1" survive.
  if (/^[0-9]{4,}$/.test(segment)) {
    return true;
  }
  // UUIDs.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  // Long hex runs: content hashes, opaque ids ("deadbeef99").
  if (/^[0-9a-f]{8,}$/i.test(segment)) {
    return true;
  }
  // Email-ish segments.
  if (segment.includes("@")) {
    return true;
  }
  // ULID/base64-style tokens: >= 12 alphanumerics with at least 2 digits.
  if (/^[0-9a-z]{12,}$/i.test(segment) && (segment.match(/[0-9]/g)?.length ?? 0) >= 2) {
    return true;
  }
  return false;
}

function stripToPathname(input: string): string {
  let raw = input.trim();
  // Defense: accept absolute URLs by dropping scheme and host.
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(raw);
  if (schemeMatch !== null) {
    const afterScheme = raw.slice((schemeMatch[0] ?? "").length);
    const firstSlash = afterScheme.indexOf("/");
    raw = firstSlash === -1 ? "/" : afterScheme.slice(firstSlash);
  }
  // Defense: never keep query strings or fragments.
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}

/**
 * Sanitizes a route pattern (or a misused raw URL): strips scheme, host,
 * query strings, and fragments, then replaces identifier-like segments
 * with `:id`. Over-redaction is intentional — the safe direction.
 */
export function sanitizeRoutePattern(input: string): string {
  const pathname = stripToPathname(input);
  if (pathname.length === 0) {
    return UNKNOWN_ROUTE_PATTERN;
  }
  const segments = pathname.split("/").map((segment) =>
    isIdentifierLike(segment) ? ID_SEGMENT : segment,
  );
  const pattern = segments.join("/");
  return pattern.length === 0 ? UNKNOWN_ROUTE_PATTERN : pattern;
}

/**
 * Builds the PHI-safe log fields for a completed HTTP request. The
 * result contains the sanitized ROUTE PATTERN and operational fields
 * only — never the raw path, query string, or resource ids:
 *
 * ```ts
 * logger.info("request completed", requestLogEnvelope({
 *   method: "POST",
 *   path: req.url,
 *   status: 201,
 *   durationMs: 42,
 *   requestId: correlationId,
 *   routePattern: route.pattern,
 * }));
 * ```
 */
export function requestLogEnvelope(input: RequestLogInput): LogFields {
  const rawPattern =
    input.routePattern !== undefined && input.routePattern.trim().length > 0
      ? input.routePattern
      : input.path;
  const routePattern =
    rawPattern !== undefined && rawPattern.trim().length > 0
      ? sanitizeRoutePattern(rawPattern)
      : UNKNOWN_ROUTE_PATTERN;

  return {
    event: "http.request",
    method: input.method,
    routePattern,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  };
}
