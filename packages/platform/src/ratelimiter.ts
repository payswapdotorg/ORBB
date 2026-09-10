/**
 * Rate limiter adapter (architecture provider map: Cache/rate limits →
 * Upstash Redis → Cache/RateLimiter).
 *
 * Abuse protection for public endpoints (A25). Fixed-window semantics are
 * the baseline contract; implementations with finer granularity must
 * remain conservative, never more permissive.
 */

/** Options for one rate-limit check. */
export interface RateLimitOptions {
  /** Maximum allowed requests within the window (finite, >= 1). */
  readonly limit: number;
  /** Fixed window length in seconds (finite, >= 1). */
  readonly windowSeconds: number;
}

/** Outcome of one rate-limit check. */
export interface RateLimitDecision {
  /** Whether the request is allowed (an allowed check consumes an allowance). */
  readonly allowed: boolean;
  /** Allowances left in the current window after this decision. */
  readonly remaining: number;
  /** Epoch milliseconds at which the current window resets. */
  readonly resetAtMs: number;
}

/**
 * Replacement interface for the rate-limit concern.
 *
 * Provider default: Upstash Redis. The reference in-memory implementation
 * lives in `inmemory.ts` and exists for tests.
 */
export interface RateLimiter {
  limit(key: string, options: RateLimitOptions): Promise<RateLimitDecision>;
}
