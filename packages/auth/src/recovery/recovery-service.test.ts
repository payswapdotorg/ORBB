import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { InMemoryRateLimiter } from "@orbb/platform";
import { sha256Hex } from "../crypto.js";
import type { AccountId } from "../ids.js";
import { InMemoryRecoveryCodeStore } from "./recovery-store.js";
import { RecoveryService, normalizeRecoveryCode } from "./recovery-service.js";

function buildHarness(verifyLimit?: number) {
  const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
  const ids = new DeterministicIdFactory({ seed: "recovery-tests" });
  const store = new InMemoryRecoveryCodeStore();
  const limiter = new InMemoryRateLimiter({ nowMs: () => clock.now().getTime() });
  const service = new RecoveryService({
    store,
    clock,
    verifyLimiter: limiter,
    verifyLimit: verifyLimit ?? 10,
    verifyWindowSeconds: 600,
  });
  const accountId = ids.next("acct") as AccountId;
  return { clock, ids, store, limiter, service, accountId };
}

describe("RecoveryService", () => {
  it("rotates a set of 10 codes and persists only digests", async () => {
    const { service, store, accountId } = buildHarness();
    const rotated = await service.rotate(accountId);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) {
      throw new Error(`expected ok, got ${rotated.code}`);
    }
    expect(rotated.codes).toHaveLength(10);
    for (const code of rotated.codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/u);
    }
    expect(new Set(rotated.codes).size).toBe(10);
    // At rest: SHA-256 digests only — no plaintext codes.
    const set = store.snapshot()[0];
    expect(set?.codes).toHaveLength(10);
    expect(set?.codes[0]?.codeHash).toBe(sha256Hex(normalizeRecoveryCode(rotated.codes[0] ?? "")));
    expect(JSON.stringify(store.snapshot())).not.toContain(rotated.codes[0] ?? "x");
  });

  it("verifies a code once (single use)", async () => {
    const { service, accountId } = buildHarness();
    const rotated = await service.rotate(accountId);
    expect(rotated.ok).toBe(true);
    const code = rotated.ok ? (rotated.codes[0] ?? "") : "";
    const first = await service.verify(accountId, code);
    expect(first).toEqual({ ok: true });
    const replay = await service.verify(accountId, code);
    expect(replay).toEqual({ ok: false, code: "INVALID_CODE" });
    // A different code from the set still works.
    const second = rotated.ok ? (rotated.codes[1] ?? "") : "";
    expect((await service.verify(accountId, second)).ok).toBe(true);
  });

  it("normalizes user input (case, separators, whitespace)", async () => {
    const { service, accountId } = buildHarness();
    const rotated = await service.rotate(accountId);
    const code = rotated.ok ? (rotated.codes[2] ?? "") : "";
    const sloppy = `  ${code.toLowerCase()}  `;
    const verified = await service.verify(accountId, sloppy);
    expect(verified).toEqual({ ok: true });
  });

  it("denies verification for accounts without codes", async () => {
    const { service, ids } = buildHarness();
    const unknown = ids.next("acct") as AccountId;
    const result = await service.verify(unknown, "AAAAA-BBCCC");
    expect(result).toEqual({ ok: false, code: "NO_CODES" });
  });

  it("denies wrong codes", async () => {
    const { service, accountId } = buildHarness();
    await service.rotate(accountId);
    const wrong = await service.verify(accountId, "ZZZZZ-ZZZZZ");
    expect(wrong).toEqual({ ok: false, code: "INVALID_CODE" });
  });

  it("rotation invalidates all previous codes", async () => {
    const { service, accountId } = buildHarness(50);
    const first = await service.rotate(accountId);
    const oldCode = first.ok ? (first.codes[0] ?? "") : "";
    expect((await service.verify(accountId, oldCode)).ok).toBe(true);
    const second = await service.rotate(accountId);
    const newCode = second.ok ? (second.codes[0] ?? "") : "";
    // The OLD code (from set one) is dead after rotation.
    const oldSet = first.ok ? first.codes : [];
    for (const deadCode of oldSet) {
      expect(await service.verify(accountId, deadCode)).toEqual({ ok: false, code: "INVALID_CODE" });
    }
    expect((await service.verify(accountId, newCode)).ok).toBe(true);
  });

  it("throttles verification attempts through the platform RateLimiter", async () => {
    const { service, clock, accountId } = buildHarness();
    await service.rotate(accountId);
    for (let i = 0; i < 10; i += 1) {
      const result = await service.verify(accountId, "ZZZZZ-ZZZZZ");
      expect(result).toEqual({ ok: false, code: "INVALID_CODE" });
    }
    const throttled = await service.verify(accountId, "ZZZZZ-ZZZZZ");
    expect(throttled.ok).toBe(false);
    if (!throttled.ok) {
      expect(throttled.code).toBe("RATE_LIMITED");
      expect(throttled.retryAtMs).toBeGreaterThan(clock.now().getTime());
    }
    // Calendar-aligned window: past it, attempts are allowed again.
    clock.advance(600_001);
    const recovered = await service.verify(accountId, "ZZZZZ-ZZZZZ");
    expect(recovered).toEqual({ ok: false, code: "INVALID_CODE" });
  });

  it("supports custom code counts and validates configuration", async () => {
    const store = new InMemoryRecoveryCodeStore();
    const clock = new DeterministicClock();
    const service = new RecoveryService({ store, clock, codeCount: 4 });
    const rotated = await service.rotate("acct_SYNTH-custom-00000001" as AccountId);
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(rotated.codes).toHaveLength(4);
    }
    expect(() => new RecoveryService({ store, clock, codeCount: 3 })).toThrowError(RangeError);
    expect(() => new RecoveryService({ store, clock, codeCount: 65 })).toThrowError(RangeError);
  });
});
