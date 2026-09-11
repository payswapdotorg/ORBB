import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "@orbb/platform";
import type { RateLimitOptions } from "@orbb/platform";
import { UpstashRateLimiter, type FetchLike } from "./upstash.js";

interface CapturedRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly body: string | undefined;
}

/**
 * Fetch stub capturing the request shape and answering with a canned
 * Upstash REST pipeline response. SHAPE-VERIFIED, NOT LIVE-VERIFIED:
 * no Upstash instance is contacted.
 */
function stubFetch(response: { status: number; body: string } | "reject"): {
  readonly fetcher: FetchLike;
  readonly requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetcher: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    });
    if (response === "reject") {
      throw new Error("network unreachable");
    }
    return new Response(response.body, { status: response.status });
  };
  return { fetcher, requests };
}

const OPTIONS: RateLimitOptions = { limit: 3, windowSeconds: 300 };

function pipelineResult(count: number): string {
  return JSON.stringify([{ result: count }, { result: true }]);
}

describe("UpstashRateLimiter (SHAPE-VERIFIED, NOT LIVE-VERIFIED)", () => {
  it("sends the documented Upstash REST pipeline shape", async () => {
    const { fetcher, requests } = stubFetch({ status: 200, body: pipelineResult(2) });
    const nowMs = 1_700_000_000_000;
    const limiter = new UpstashRateLimiter({
      baseUrl: "https://abc123.eu1.upstash.io",
      token: "test-token",
      fetcher,
      nowMs: () => nowMs,
    });
    const decision = await limiter.limit("auth:otp:issue:deadbeef", OPTIONS);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) {
      throw new Error("no request captured");
    }
    // URL: pipeline POST to the database root.
    expect(request.url).toBe("https://abc123.eu1.upstash.io/");
    expect(request.method).toBe("POST");
    // Auth header: bearer token, never the token in the URL or body.
    expect(request.headers?.["Authorization"]).toBe("Bearer test-token");
    expect(request.headers?.["Content-Type"]).toBe("application/json");
    // Pipeline body: INCR bucket + EXPIRE ttl (2 × window, stringified).
    const windowIndex = Math.floor(nowMs / (OPTIONS.windowSeconds * 1_000));
    const bucketKey = `rl:auth:otp:issue:deadbeef:${windowIndex}`;
    expect(JSON.parse(request.body ?? "null")).toEqual([
      ["INCR", bucketKey],
      ["EXPIRE", bucketKey, String(OPTIONS.windowSeconds * 2)],
    ]);
    // Decision semantics identical to the in-memory reference.
    expect(decision).toEqual({
      allowed: true,
      remaining: 1,
      resetAtMs: (windowIndex + 1) * OPTIONS.windowSeconds * 1_000,
    });
  });

  it("normalizes a trailing slash in the base URL", async () => {
    const { fetcher, requests } = stubFetch({ status: 200, body: pipelineResult(1) });
    const limiter = new UpstashRateLimiter({
      baseUrl: "https://abc123.eu1.upstash.io/",
      token: "t",
      fetcher,
      nowMs: () => 0,
    });
    await limiter.limit("k", OPTIONS);
    expect(requests[0]?.url).toBe("https://abc123.eu1.upstash.io/");
  });

  it("keys the bucket by the calendar window index (in-memory parity)", async () => {
    const { fetcher, requests } = stubFetch({ status: 200, body: pipelineResult(1) });
    const limiter = new UpstashRateLimiter({
      baseUrl: "https://abc123.eu1.upstash.io",
      token: "t",
      fetcher,
      nowMs: () => 0,
    });
    await limiter.limit("k", OPTIONS);
    const firstBody = JSON.parse(requests[0]?.body ?? "null") as unknown[][];
    expect((firstBody[0]?.[1] as string)).toBe("rl:k:0");

    const second = stubFetch({ status: 200, body: pipelineResult(1) });
    const limiter2 = new UpstashRateLimiter({
      baseUrl: "https://abc123.eu1.upstash.io",
      token: "t",
      fetcher: second.fetcher,
      nowMs: () => 300_001,
    });
    await limiter2.limit("k", OPTIONS);
    const secondBody = JSON.parse(second.requests[0]?.body ?? "null") as unknown[][];
    expect((secondBody[0]?.[1] as string)).toBe("rl:k:1");
  });

  it("denies when the window count exceeds the limit", async () => {
    const { fetcher } = stubFetch({ status: 200, body: pipelineResult(4) });
    const limiter = new UpstashRateLimiter({
      baseUrl: "https://abc123.eu1.upstash.io",
      token: "t",
      fetcher,
      nowMs: () => 1_700_000_000_000,
    });
    const decision = await limiter.limit("k", OPTIONS);
    expect(decision).toEqual({
      allowed: false,
      remaining: 0,
      resetAtMs: Math.floor(1_700_000_000_000 / 300_000 + 1) * 300_000,
    });
  });

  it("matches the in-memory reference decisions for the same clock stream", async () => {
    // Both implementations: calendar-aligned fixed windows.
    let now = 1_700_000_000_000;
    const { fetcher } = stubFetch({ status: 200, body: pipelineResult(1) });
    const upstash = new UpstashRateLimiter({
      baseUrl: "https://x.upstash.io",
      token: "t",
      fetcher,
      nowMs: () => now,
    });
    const inMemory = new InMemoryRateLimiter({ nowMs: () => now });
    const upstashDecision = await upstash.limit("k", OPTIONS);
    const memoryDecision = await inMemory.limit("k", OPTIONS);
    expect(upstashDecision.allowed).toBe(memoryDecision.allowed);
    expect(upstashDecision.resetAtMs).toBe(memoryDecision.resetAtMs);

    // Window rollover: both reset to the same boundary.
    now += 300_000;
    const nextUpstash = await upstash.limit("k", OPTIONS);
    const nextMemory = await inMemory.limit("k", OPTIONS);
    expect(nextUpstash.resetAtMs).toBe(nextMemory.resetAtMs);
  });

  it("fails CLOSED on http errors, network failures, and malformed responses", async () => {
    const base = { baseUrl: "https://x.upstash.io", token: "t", nowMs: () => 0 } as const;
    const httpError = stubFetch({ status: 500, body: "oops" });
    expect(
      await new UpstashRateLimiter({ ...base, fetcher: httpError.fetcher }).limit("k", OPTIONS),
    ).toEqual({ allowed: false, remaining: 0, resetAtMs: 300_000 });

    const networkFailure = stubFetch("reject");
    expect(
      await new UpstashRateLimiter({ ...base, fetcher: networkFailure.fetcher }).limit("k", OPTIONS),
    ).toEqual({ allowed: false, remaining: 0, resetAtMs: 300_000 });

    const malformed = stubFetch({ status: 200, body: '{"error":"not a pipeline"}' });
    expect(
      await new UpstashRateLimiter({ ...base, fetcher: malformed.fetcher }).limit("k", OPTIONS),
    ).toEqual({ allowed: false, remaining: 0, resetAtMs: 300_000 });

    const notAnArray = stubFetch({ status: 200, body: '{"result":1}' });
    expect(
      await new UpstashRateLimiter({ ...base, fetcher: notAnArray.fetcher }).limit("k", OPTIONS),
    ).toEqual({ allowed: false, remaining: 0, resetAtMs: 300_000 });
  });

  it("can be configured to fail OPEN", async () => {
    const networkFailure = stubFetch("reject");
    const decision = await new UpstashRateLimiter({
      baseUrl: "https://x.upstash.io",
      token: "t",
      fetcher: networkFailure.fetcher,
      nowMs: () => 0,
      onError: "allow",
    }).limit("k", OPTIONS);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(0);
  });

  it("validates options exactly like the platform contract", async () => {
    const { fetcher } = stubFetch({ status: 200, body: pipelineResult(1) });
    const limiter = new UpstashRateLimiter({
      baseUrl: "https://x.upstash.io",
      token: "t",
      fetcher,
      nowMs: () => 0,
    });
    await expect(limiter.limit("k", { limit: 0, windowSeconds: 60 })).rejects.toThrowError(
      RangeError,
    );
    await expect(limiter.limit("k", { limit: 1, windowSeconds: 0 })).rejects.toThrowError(
      RangeError,
    );
    expect(() => new UpstashRateLimiter({ baseUrl: "http://insecure", token: "t" })).toThrowError(
      RangeError,
    );
    expect(() => new UpstashRateLimiter({ baseUrl: "https://x.upstash.io", token: "" })).toThrowError(
      RangeError,
    );
  });
});
