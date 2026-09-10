import { describe, expect, it } from "vitest";
import type { Cache, RateLimiter } from "./index.js";
import { InMemoryCache, InMemoryRateLimiter } from "./inmemory.js";

function createManualClock(initialMs: number) {
  let now = initialMs;
  return {
    nowMs: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("InMemoryCache", () => {
  it("round-trips values", async () => {
    const cache: Cache = new InMemoryCache({ nowMs: () => 0 });
    await cache.set("SYNTH-key", { count: 7 });
    const value = await cache.get<{ count: number }>("SYNTH-key");
    expect(value).toEqual({ count: 7 });
  });

  it("returns undefined for missing keys", async () => {
    const cache = new InMemoryCache();
    expect(await cache.get("SYNTH-missing")).toBeUndefined();
  });

  it("deletes entries", async () => {
    const cache = new InMemoryCache();
    await cache.set("SYNTH-key", "SYNTH-value");
    await cache.delete("SYNTH-key");
    expect(await cache.get("SYNTH-key")).toBeUndefined();
  });

  it("overwrites entries", async () => {
    const cache = new InMemoryCache();
    await cache.set("SYNTH-key", "SYNTH-first");
    await cache.set("SYNTH-key", "SYNTH-second");
    expect(await cache.get("SYNTH-key")).toBe("SYNTH-second");
  });

  it("expires entries exactly at the TTL boundary", async () => {
    const clock = createManualClock(1_000);
    const cache = new InMemoryCache({ nowMs: clock.nowMs });
    await cache.set("SYNTH-ttl", "SYNTH-value", { ttlSeconds: 10 });
    clock.advance(9_999);
    expect(await cache.get("SYNTH-ttl")).toBe("SYNTH-value");
    clock.advance(1);
    expect(await cache.get("SYNTH-ttl")).toBeUndefined();
    clock.advance(10_000);
    expect(await cache.get("SYNTH-ttl")).toBeUndefined();
  });

  it("keeps entries without a TTL indefinitely", async () => {
    const clock = createManualClock(0);
    const cache = new InMemoryCache({ nowMs: clock.nowMs });
    await cache.set("SYNTH-permanent", "SYNTH-value");
    clock.advance(1_000_000_000);
    expect(await cache.get("SYNTH-permanent")).toBe("SYNTH-value");
  });

  it("rejects invalid TTLs", async () => {
    const cache = new InMemoryCache();
    await expect(cache.set("SYNTH-bad", "x", { ttlSeconds: 0 })).rejects.toThrow(RangeError);
    await expect(cache.set("SYNTH-bad", "x", { ttlSeconds: -5 })).rejects.toThrow(RangeError);
    await expect(cache.set("SYNTH-bad", "x", { ttlSeconds: Number.NaN })).rejects.toThrow(
      RangeError,
    );
  });

  it("clear() empties the cache", async () => {
    const cache = new InMemoryCache();
    await cache.set("SYNTH-a", 1);
    await cache.set("SYNTH-b", 2);
    cache.clear();
    expect(await cache.get("SYNTH-a")).toBeUndefined();
    expect(await cache.get("SYNTH-b")).toBeUndefined();
  });
});

describe("InMemoryRateLimiter", () => {
  it("allows up to the limit within a window and then denies", async () => {
    const clock = createManualClock(0);
    const limiter: RateLimiter = new InMemoryRateLimiter({ nowMs: clock.nowMs });
    const first = await limiter.limit("SYNTH-key", { limit: 2, windowSeconds: 60 });
    expect(first).toEqual({ allowed: true, remaining: 1, resetAtMs: 60_000 });
    const second = await limiter.limit("SYNTH-key", { limit: 2, windowSeconds: 60 });
    expect(second).toEqual({ allowed: true, remaining: 0, resetAtMs: 60_000 });
    const third = await limiter.limit("SYNTH-key", { limit: 2, windowSeconds: 60 });
    expect(third).toEqual({ allowed: false, remaining: 0, resetAtMs: 60_000 });
  });

  it("resets counters at the window boundary", async () => {
    const clock = createManualClock(59_999);
    const limiter = new InMemoryRateLimiter({ nowMs: clock.nowMs });
    await limiter.limit("SYNTH-key", { limit: 1, windowSeconds: 60 });
    const denied = await limiter.limit("SYNTH-key", { limit: 1, windowSeconds: 60 });
    expect(denied.allowed).toBe(false);
    clock.advance(1);
    const fresh = await limiter.limit("SYNTH-key", { limit: 1, windowSeconds: 60 });
    expect(fresh).toEqual({ allowed: true, remaining: 0, resetAtMs: 120_000 });
  });

  it("tracks keys independently", async () => {
    const limiter = new InMemoryRateLimiter({ nowMs: () => 0 });
    await limiter.limit("SYNTH-a", { limit: 1, windowSeconds: 60 });
    const other = await limiter.limit("SYNTH-b", { limit: 1, windowSeconds: 60 });
    expect(other.allowed).toBe(true);
  });

  it("rejects invalid options without consuming quota", async () => {
    const limiter = new InMemoryRateLimiter();
    await expect(limiter.limit("SYNTH-key", { limit: 0, windowSeconds: 60 })).rejects.toThrow(
      RangeError,
    );
    await expect(limiter.limit("SYNTH-key", { limit: 1, windowSeconds: 0 })).rejects.toThrow(
      RangeError,
    );
    await expect(
      limiter.limit("SYNTH-key", { limit: Number.POSITIVE_INFINITY, windowSeconds: 60 }),
    ).rejects.toThrow(RangeError);
    const decision = await limiter.limit("SYNTH-key", { limit: 1, windowSeconds: 60 });
    expect(decision.allowed).toBe(true);
  });

  it("clear() resets all windows", async () => {
    const limiter = new InMemoryRateLimiter({ nowMs: () => 0 });
    await limiter.limit("SYNTH-key", { limit: 1, windowSeconds: 60 });
    limiter.clear();
    const after = await limiter.limit("SYNTH-key", { limit: 1, windowSeconds: 60 });
    expect(after.allowed).toBe(true);
  });
});
