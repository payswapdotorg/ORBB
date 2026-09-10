/**
 * In-memory reference implementations — deliberately ONLY for Cache and
 * RateLimiter (the Upstash replacement pair). Everything else in
 * `@orbb/platform` stays interface-only at M0: unit and contract tests
 * must run without credentials, and no in-memory database/queue/object
 * store is provided so tests cannot accidentally depend on one.
 *
 * Determinism: both implementations accept an injectable `nowMs` time
 * source (default `Date.now()`). Tests inject a manual clock for
 * deterministic TTL/window behaviour.
 */
import type { Cache, CacheSetOptions } from "./cache.js";
import type { RateLimitDecision, RateLimitOptions, RateLimiter } from "./ratelimiter.js";

/** Shared options for the in-memory adapters. */
export interface InMemoryAdapterOptions {
  /**
   * Injectable time source in epoch milliseconds. Default: `Date.now()`
   * (tests should inject a manual clock to stay deterministic).
   */
  readonly nowMs?: () => number;
}

interface CacheEntry {
  readonly value: unknown;
  /** Expiry epoch ms; undefined means no expiry. */
  readonly expiresAtMs: number | undefined;
}

/** Reference in-memory `Cache` (fixed TTL, injectable time source). */
export class InMemoryCache implements Cache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #nowMs: () => number;

  constructor(options?: InMemoryAdapterOptions) {
    this.#nowMs = options?.nowMs ?? Date.now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAtMs !== undefined && entry.expiresAtMs <= this.#nowMs()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, options?: CacheSetOptions): Promise<void> {
    const ttlSeconds = options?.ttlSeconds;
    let expiresAtMs: number | undefined;
    if (ttlSeconds !== undefined) {
      if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
        throw new RangeError("CacheSetOptions.ttlSeconds must be a finite number >= 1.");
      }
      expiresAtMs = this.#nowMs() + ttlSeconds * 1_000;
    }
    this.#entries.set(key, { value, expiresAtMs });
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  /** Empties the cache (test-reset convenience; not part of `Cache`). */
  clear(): void {
    this.#entries.clear();
  }
}

interface WindowCounter {
  readonly windowIndex: number;
  readonly used: number;
}

/** Reference in-memory `RateLimiter` (fixed windows, injectable time source). */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #counters = new Map<string, WindowCounter>();
  readonly #nowMs: () => number;

  constructor(options?: InMemoryAdapterOptions) {
    this.#nowMs = options?.nowMs ?? Date.now;
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
    const current = this.#counters.get(key);
    const used =
      current !== undefined && current.windowIndex === windowIndex ? current.used : 0;
    const attempted = used + 1;
    const allowed = attempted <= options.limit;
    if (allowed) {
      this.#counters.set(key, { windowIndex, used: attempted });
    }
    return {
      allowed,
      remaining: allowed ? options.limit - attempted : 0,
      resetAtMs: (windowIndex + 1) * windowMs,
    };
  }

  /** Clears all window counters (test-reset convenience; not part of `RateLimiter`). */
  clear(): void {
    this.#counters.clear();
  }
}
