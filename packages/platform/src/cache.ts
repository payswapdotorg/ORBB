/**
 * Cache adapter (architecture provider map: Cache/rate limits → Upstash
 * Redis → Cache/RateLimiter).
 *
 * Cache is ephemeral by contract: it is never a source of truth and never
 * a transaction coordinator (architecture §4). Values are opaque — the
 * serialization boundary belongs to implementations.
 */

/** Options for setting a cache entry. */
export interface CacheSetOptions {
  /** Time-to-live in seconds (finite, >= 1). Omitted means no expiry. */
  readonly ttlSeconds?: number;
}

/**
 * Replacement interface for the cache concern.
 *
 * Provider default: Upstash Redis (serverless, free tier). The reference
 * in-memory implementation lives in `inmemory.ts` and exists for tests.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
}
