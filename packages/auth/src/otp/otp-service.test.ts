import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { InMemoryRateLimiter } from "@orbb/platform";
import type { PersonId } from "@orbb/domain";
import { sha256Hex } from "../crypto.js";
import { InMemoryOtpStore, InMemoryOtpTransport } from "./otp-store.js";
import { EmailOtpService, normalizeEmail } from "./otp-service.js";

const EMAIL = "Ada.Lovelace@Example-Health.test";

function buildHarness() {
  const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
  const ids = new DeterministicIdFactory({ seed: "otp-tests" });
  const store = new InMemoryOtpStore();
  const transport = new InMemoryOtpTransport();
  const limiter = new InMemoryRateLimiter({ nowMs: () => clock.now().getTime() });
  const service = new EmailOtpService({
    store,
    transport,
    limiter,
    clock,
    idFactory: ids,
    ttlSeconds: 300,
    maxAttempts: 5,
    issueLimit: 3,
    issueWindowSeconds: 600,
  });
  const personId = ids.next("prsn") as PersonId;
  return { clock, ids, store, transport, limiter, service, personId };
}

describe("EmailOtpService", () => {
  it("issues a single-use OTP: code goes only to the transport, hash to the store", async () => {
    const { service, store, transport, personId, clock } = buildHarness();
    const issued = await service.issue({ personId, email: EMAIL, purpose: "login" });
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      throw new Error(`expected ok, got ${issued.code}`);
    }
    expect(issued.expiresAt.getTime()).toBe(clock.now().getTime() + 300_000);
    expect(transport.deliveries).toHaveLength(1);
    const delivery = transport.deliveries[0];
    expect(delivery?.code).toMatch(/^\d{6}$/u);
    expect(delivery?.email).toBe(normalizeEmail(EMAIL));
    expect(delivery?.purpose).toBe("login");
    // At rest: digests only.
    const record = store.snapshot()[0];
    expect(record?.codeHash).toBe(sha256Hex(delivery?.code ?? ""));
    expect(record?.emailHash).toBe(sha256Hex(normalizeEmail(EMAIL)));
    expect(JSON.stringify(store.snapshot())).not.toContain(delivery?.code ?? "x");
    expect(JSON.stringify(store.snapshot())).not.toContain(normalizeEmail(EMAIL));
    expect(record?.id.startsWith("otp_")).toBe(true);
  });

  it("verifies a correct code and enforces single use", async () => {
    const { service, transport, personId } = buildHarness();
    await service.issue({ personId, email: EMAIL, purpose: "login" });
    const code = transport.deliveries[0]?.code;
    expect(code).toBeDefined();
    const verified = await service.verify({ personId, email: EMAIL, purpose: "login", code: code ?? "" });
    expect(verified).toEqual({ ok: true, personId });
    const replay = await service.verify({ personId, email: EMAIL, purpose: "login", code: code ?? "" });
    expect(replay).toEqual({ ok: false, code: "NO_ACTIVE_CHALLENGE" });
  });

  it("rejects a wrong code and counts attempts", async () => {
    const { service, store, transport, personId } = buildHarness();
    await service.issue({ personId, email: EMAIL, purpose: "login" });
    const wrong = await service.verify({
      personId,
      email: EMAIL,
      purpose: "login",
      code: wrongCodeOf(transport.deliveries[0]?.code ?? ""),
    });
    expect(wrong).toEqual({ ok: false, code: "INVALID_CODE" });
    expect(store.snapshot()[0]?.attempts).toBe(1);
    // The real code still works while attempts remain.
    const code = transport.deliveries[0]?.code ?? "";
    const correct = await service.verify({ personId, email: EMAIL, purpose: "login", code });
    expect(correct.ok).toBe(true);
  });

  it("locks the challenge after the attempt budget is exhausted", async () => {
    const { service, transport, personId } = buildHarness();
    await service.issue({ personId, email: EMAIL, purpose: "login" });
    const code = transport.deliveries[0]?.code ?? "";
    for (let i = 0; i < 5; i += 1) {
      const failed = await service.verify({
        personId,
        email: EMAIL,
        purpose: "login",
        code: wrongCodeOf(code),
      });
      expect(failed).toEqual({ ok: false, code: "INVALID_CODE" });
    }
    const budgetGone = await service.verify({ personId, email: EMAIL, purpose: "login", code });
    expect(budgetGone).toEqual({ ok: false, code: "TOO_MANY_ATTEMPTS" });
  });

  it("expires challenges after the TTL", async () => {
    const { service, clock, transport, personId } = buildHarness();
    await service.issue({ personId, email: EMAIL, purpose: "login" });
    const code = transport.deliveries[0]?.code ?? "";
    clock.advance(300_000);
    const expired = await service.verify({ personId, email: EMAIL, purpose: "login", code });
    expect(expired).toEqual({ ok: false, code: "EXPIRED" });
  });

  it("throttles resend through the platform RateLimiter and recovers after the window", async () => {
    const { service, clock, personId } = buildHarness();
    for (let i = 0; i < 3; i += 1) {
      const issued = await service.issue({ personId, email: EMAIL, purpose: "login" });
      expect(issued.ok).toBe(true);
    }
    const throttled = await service.issue({ personId, email: EMAIL, purpose: "login" });
    expect(throttled.ok).toBe(false);
    if (!throttled.ok) {
      expect(throttled.code).toBe("RATE_LIMITED");
      // Calendar-aligned fixed window: the reset is within one window.
      expect(throttled.retryAtMs).toBeGreaterThan(clock.now().getTime());
      expect(throttled.retryAtMs).toBeLessThanOrEqual(clock.now().getTime() + 600_000);
    }
    // The fixed window is calendar-aligned: advancing past it restores allowance.
    clock.advance(600_001);
    const recovered = await service.issue({ personId, email: EMAIL, purpose: "login" });
    expect(recovered.ok).toBe(true);
  });

  it("re-issuance replaces the active challenge (old code dies)", async () => {
    const { service, transport, personId } = buildHarness();
    await service.issue({ personId, email: EMAIL, purpose: "login" });
    const firstCode = transport.deliveries[0]?.code ?? "";
    await service.issue({ personId, email: EMAIL, purpose: "login" });
    const secondCode = transport.deliveries[1]?.code ?? "";
    // The old code no longer matches the replaced challenge: typed deny.
    const oldCode = await service.verify({ personId, email: EMAIL, purpose: "login", code: firstCode });
    expect(oldCode).toEqual({ ok: false, code: "INVALID_CODE" });
    const newCode = await service.verify({ personId, email: EMAIL, purpose: "login", code: secondCode });
    expect(newCode.ok).toBe(true);
  });

  it("denies verification with no active challenge (unknown person / wrong email)", async () => {
    const { service, personId } = buildHarness();
    const nothing = await service.verify({
      personId,
      email: EMAIL,
      purpose: "login",
      code: wrongCodeOf("123456"),
    });
    expect(nothing).toEqual({ ok: false, code: "NO_ACTIVE_CHALLENGE" });
    await service.issue({ personId, email: EMAIL, purpose: "login" });
    const wrongEmail = await service.verify({
      personId,
      email: "other@example.test",
      purpose: "login",
      code: "123456",
    });
    expect(wrongEmail).toEqual({ ok: false, code: "NO_ACTIVE_CHALLENGE" });
  });

  it("normalizes emails case-insensitively (trim + lowercase)", async () => {
    const { service, transport, personId } = buildHarness();
    await service.issue({ personId, email: `  ${EMAIL.toUpperCase()}  `, purpose: "login" });
    const code = transport.deliveries[0]?.code ?? "";
    const verified = await service.verify({ personId, email: EMAIL, purpose: "login", code });
    expect(verified.ok).toBe(true);
  });

  it("reports delivery failures as typed outcomes", async () => {
    const { clock, ids, store, limiter, personId } = buildHarness();
    const failingTransport = {
      async deliver(): Promise<void> {
        throw new Error("smtp down");
      },
    };
    const service = new EmailOtpService({
      store,
      transport: failingTransport,
      limiter,
      clock,
      idFactory: ids,
    });
    const issued = await service.issue({ personId, email: EMAIL, purpose: "login" });
    expect(issued).toEqual({ ok: false, code: "DELIVERY_FAILED" });
  });

  it("rejects invalid configuration at construction", () => {
    const store = new InMemoryOtpStore();
    const transport = new InMemoryOtpTransport();
    expect(() => new EmailOtpService({ store, transport, ttlSeconds: 59 })).toThrowError(RangeError);
    expect(() => new EmailOtpService({ store, transport, maxAttempts: 0 })).toThrowError(RangeError);
    expect(() => new EmailOtpService({ store, transport, codeLength: 3 })).toThrowError(RangeError);
  });
});

/** A six-digit code that is guaranteed different from `code`. */
function wrongCodeOf(code: string): string {
  return code === "999999" ? "000000" : "999999";
}
