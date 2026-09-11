/**
 * Upstash REST rate-limit adapter — implements the @orbb/platform
 * `RateLimiter` interface (architecture §3 A25: "rate limits and abuse
 * protection through Upstash").
 *
 * PLACEMENT (recorded): `packages/auth` — platform is interface-only
 * for this concern; the adapter ships with the identity package that
 * consumes it. Nothing outside packages/auth was modified.
 *
 * PROTOCOL (recorded): Upstash REST pipeline (POST to the database root
 * with a JSON array of commands, `Authorization: Bearer <token>`).
 *
 * WINDOWING (recorded): calendar-aligned FIXED windows, keyed
 * `rl:<key>:<floor(now/windowMs)>` — exactly the semantics of the
 * @orbb/platform in-memory reference implementation (`InMemoryRateLimiter`),
 * so both implementations make identical decisions for the same clock
 * stream. `INCR` counts every check (allowed or denied), which is
 * strictly MORE conservative than the in-memory reference (only allowed
 * checks consume an allowance there) — never more permissive, per the
 * platform contract. `EXPIRE` with `2 × window` lets abandoned buckets
 * age out (one full window of slack keeps the live bucket reachable).
 *
 * FAILURE MODE (recorded): fail-CLOSED ("deny") by default — deny-
 * by-default abuse protection; configurable to fail-open for callers
 * whose availability calculus differs. HTTP errors, network errors, and
 * malformed responses all take the failure path.
 *
 * VERIFICATION STATUS: SHAPE-VERIFIED, NOT LIVE-VERIFIED. The request
 * shape (URL, bearer header, pipeline body) and the response parsing
 * are asserted in `upstash.test.ts` against a fetch stub; no live
 * Upstash instance is ever contacted by this package's tests.
 */
import type { RateLimitDecision, RateLimitOptions, RateLimiter } from "@orbb/platform";

/** Fetch double compatible with the global `fetch` surface (injectable). */
export type FetchLike = (
  input: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string },
) => Promise<Response>;

/** Options for constructing an {@link UpstashRateLimiter}. */
export interface UpstashRateLimiterOptions {
  /** Upstash REST base URL (e.g. `https://<hash>.eu1.upstash.io`). */
  readonly baseUrl: string;
  /** Upstash REST bearer token (never logged, never echoed). */
  readonly token: string;
  /** Injectable fetch (default: global fetch; tests inject a stub). */
  readonly fetcher?: FetchLike;
  /** Injectable time source in epoch ms (default: `Date.now`). */
  readonly nowMs?: () => number;
  /** Failure mode: "deny" (default) or "allow". */
  readonly onError?: "deny" | "allow";
}

interface UpstashPipelineResult {
  readonly result?: unknown;
}

/** Upstash REST fixed-window adapter. SHAPE-VERIFIED, NOT LIVE-VERIFIED. */
export class UpstashRateLimiter implements RateLimiter {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetcher: FetchLike;
  readonly #nowMs: () => number;
  readonly #onError: "deny" | "allow";

  constructor(options: UpstashRateLimiterOptions) {
    if (typeof options.baseUrl !== "string" || !/^https:\/\/[^\s/]+/u.test(options.baseUrl)) {
      throw new RangeError("UpstashRateLimiterOptions.baseUrl must be an https Upstash REST URL.");
    }
    if (typeof options.token !== "string" || options.token.length === 0) {
      throw new RangeError("UpstashRateLimiterOptions.token must be a non-empty string.");
    }
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.#token = options.token;
    this.#fetcher = options.fetcher ?? globalFetch;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#onError = options.onError ?? "deny";
  }

  async limit(key: string, options: RateLimitOptions): Promise<RateLimitDecision> {
    if (!Number.isFinite(options.limit) || options.limit < 1) {
      throw new RangeError("RateLimitOptions.limit must be a finite number >= 1.");
    }
    if (!Number.isFinite(options.windowSeconds) || options.windowSeconds < 1) {
      throw new RangeError("RateLimitOptions.windowSeconds must be a finite number >= 1.");
    }
    const windowMs = options.windowSeconds * 1_000;
    const now = this.#nowMs();
    const windowIndex = Math.floor(now / windowMs);
    const resetAtMs = (windowIndex + 1) * windowMs;
    const bucketKey = `rl:${key}:${windowIndex}`;
    const ttlSeconds = options.windowSeconds * 2;

    let count: number | undefined;
    try {
      const response = await this.#fetcher(`${this.#baseUrl}/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", bucketKey],
          ["EXPIRE", bucketKey, String(ttlSeconds)],
        ]),
      });
      if (!response.ok) {
        throw new Error(`upstash responded with http ${response.status}`);
      }
      const parsed: unknown = await response.json();
      count = parseIncrResult(parsed);
    } catch {
      // Failure path (fail-closed by default — recorded decision).
      return {
        allowed: this.#onError === "allow",
        remaining: 0,
        resetAtMs,
      };
    }

    if (count === undefined) {
      return { allowed: this.#onError === "allow", remaining: 0, resetAtMs };
    }
    const allowed = count <= options.limit;
    return {
      allowed,
      remaining: allowed ? Math.max(0, options.limit - count) : 0,
      resetAtMs,
    };
  }
}

/** Extracts the INCR count from an Upstash pipeline response. */
function parseIncrResult(parsed: unknown): number | undefined {
  if (!Array.isArray(parsed) || parsed.length < 1) {
    return undefined;
  }
  const first = parsed[0] as UpstashPipelineResult | undefined;
  if (typeof first !== "object" || first === null) {
    return undefined;
  }
  const result = first.result;
  if (typeof result !== "number" || !Number.isFinite(result)) {
    return undefined;
  }
  return result;
}

const globalFetch: FetchLike = (input, init) => fetch(input, init);
