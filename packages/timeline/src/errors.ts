/**
 * @orbb/timeline — typed error surface.
 *
 * Two error disciplines live side by side in this package (both recorded
 * in README.md):
 *
 *   1. {@link TimelineError} — the REQUEST-side discipline (mirrors the
 *      `@orbb/db` `PersistenceError("invalid-request")` law for cursor
 *      pagination): a malformed window, limit, or cursor fails CLOSED
 *      with a typed error code. The offending value is never echoed
 *      (PHID discipline — messages describe the expected shape only).
 *
 *   2. `DomainInvariantError` (from `@orbb/domain`) — the STRUCTURAL
 *      discipline (mirrors `@orbb/clinical` / `@orbb/measurement`): a
 *      malformed store record or timeline entry is a data-integrity
 *      failure and throws the kernel invariant error.
 *
 * Authorization NEVER throws and NEVER allows-by-default: semantic
 * authorization failures are typed DENY outcomes, not errors (the
 * clinical evaluator's own discipline).
 */

/** Typed timeline error codes (frozen vocabulary). */
export const TIMELINE_ERROR_CODES = [
  /** Malformed subject / practitioner context / query shape. */
  "invalid-request",
  /** A window whose lower bound is after its upper bound. */
  "invalid-window",
  /** A non-integer or out-of-range page limit (silent clamping hides caller bugs). */
  "invalid-limit",
  /** A malformed, corrupt, or unsupported-version pagination cursor. */
  "invalid-cursor",
] as const;

export type TimelineErrorCode = (typeof TIMELINE_ERROR_CODES)[number];

export function isTimelineErrorCode(value: unknown): value is TimelineErrorCode {
  return (
    typeof value === "string" && (TIMELINE_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * A typed timeline request error. Codes are a frozen closed vocabulary;
 * messages carry expected shapes only — received values are never echoed.
 */
export class TimelineError extends Error {
  readonly code: TimelineErrorCode;

  constructor(code: TimelineErrorCode, message: string) {
    super(message);
    this.name = "TimelineError";
    this.code = code;
  }
}

export function isTimelineError(value: unknown): value is TimelineError {
  return (
    value instanceof TimelineError && isTimelineErrorCode(value.code)
  );
}
