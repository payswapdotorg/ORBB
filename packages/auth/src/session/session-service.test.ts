import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import type { PersonId } from "@orbb/domain";
import { AuthInvariantError } from "../errors.js";
import type { AccountId } from "../ids.js";
import { fromBase64Url } from "../crypto.js";
import { InMemorySessionStore } from "./session-store.js";
import { SessionService } from "./session-service.js";

const DEFAULT_TTL_SECONDS = 43_200;

function buildHarness() {
  const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
  const ids = new DeterministicIdFactory({ seed: "session-tests" });
  const store = new InMemorySessionStore();
  const service = new SessionService({ store, clock, idFactory: ids });
  const personId = ids.next("prsn") as PersonId;
  return { clock, ids, store, service, personId };
}

describe("SessionService", () => {
  it("issues and verifies a session round-trip", async () => {
    const { service, store, personId, clock } = buildHarness();
    const issued = await service.issue({ personId });
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      throw new Error("unreachable");
    }
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(fromBase64Url(issued.token).length).toBe(32);
    expect(issued.session.id.startsWith("sess_")).toBe(true);
    expect(issued.session.personId).toBe(personId);
    expect(issued.session.createdAt.getTime()).toBe(clock.now().getTime());
    expect(issued.session.expiresAt.getTime()).toBe(
      clock.now().getTime() + DEFAULT_TTL_SECONDS * 1_000,
    );

    const verified = await service.verify(issued.token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.personId).toBe(personId);
      expect(verified.session.lastSeenAt).toBeDefined();
    }

    // At rest: token digest only — the token itself never persists.
    const dump = JSON.stringify(store.snapshot());
    expect(dump).not.toContain(issued.token);
    expect(store.snapshot()[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("binds an optional account id and preserves it through rotation", async () => {
    const { service, ids, personId } = buildHarness();
    const accountId = ids.next("acct") as AccountId;
    const issued = await service.issue({ personId, accountId });
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      throw new Error("unreachable");
    }
    const rotated = await service.rotate(issued.token);
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(rotated.session.accountId).toBe(accountId);
    }
  });

  it("rejects unknown tokens with INVALID_TOKEN", async () => {
    const { service } = buildHarness();
    const verified = await service.verify("totally-unknown-token-value");
    expect(verified).toEqual({ ok: false, code: "INVALID_TOKEN" });
  });

  it("expires sessions (exclusive horizon) with a DeterministicClock", async () => {
    const { service, clock, personId } = buildHarness();
    const issued = await service.issue({ personId, ttlSeconds: 60 });
    if (!issued.ok) {
      throw new Error("unreachable");
    }
    clock.advance(59_999);
    expect((await service.verify(issued.token)).ok).toBe(true);
    clock.advance(1);
    const expired = await service.verify(issued.token);
    expect(expired).toEqual({ ok: false, code: "EXPIRED" });
  });

  it("revokes sessions idempotently and reports REVOKED on verify", async () => {
    const { service, personId } = buildHarness();
    const issued = await service.issue({ personId });
    if (!issued.ok) {
      throw new Error("unreachable");
    }
    expect(await service.revoke(issued.token)).toBe(true);
    expect(await service.revoke(issued.token)).toBe(false);
    expect(await service.verify(issued.token)).toEqual({ ok: false, code: "REVOKED" });
  });

  it("rotates atomically: the old token dies, the new token lives, the binding survives", async () => {
    const { service, clock, personId } = buildHarness();
    const issued = await service.issue({ personId, ttlSeconds: 3_600 });
    if (!issued.ok) {
      throw new Error("unreachable");
    }
    clock.advance(10 * 60_000);
    const rotated = await service.rotate(issued.token);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) {
      throw new Error("unreachable");
    }
    // New token verifies; fresh TTL measured from the rotation time.
    expect((await service.verify(rotated.token)).ok).toBe(true);
    expect(rotated.session.expiresAt.getTime()).toBe(
      clock.now().getTime() + DEFAULT_TTL_SECONDS * 1_000,
    );
    // Old token is dead with the REVOKED tombstone.
    expect(await service.verify(issued.token)).toEqual({ ok: false, code: "REVOKED" });
    // Rotating the dead old token is a typed failure.
    expect(await service.rotate(issued.token)).toEqual({ ok: false, code: "REVOKED" });
  });

  it("applies a per-rotation TTL override", async () => {
    const { service, clock, personId } = buildHarness();
    const issued = await service.issue({ personId });
    if (!issued.ok) {
      throw new Error("unreachable");
    }
    const rotated = await service.rotate(issued.token, { ttlSeconds: 120 });
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(rotated.session.expiresAt.getTime()).toBe(clock.now().getTime() + 120_000);
    }
  });

  it("denies rotation of expired or unknown tokens", async () => {
    const { service, clock, personId } = buildHarness();
    const expiredIssue = await service.issue({ personId, ttlSeconds: 60 });
    expect(expiredIssue.ok).toBe(true);
    const expiredToken = expiredIssue.ok ? expiredIssue.token : "never";
    clock.advance(61_000);
    expect(await service.rotate(expiredToken)).toEqual({ ok: false, code: "EXPIRED" });
    expect(await service.rotate("unknown-token")).toEqual({ ok: false, code: "INVALID_TOKEN" });
  });

  it("touches lastSeenAt on every successful verification", async () => {
    const { service, clock, personId } = buildHarness();
    const issued = await service.issue({ personId });
    if (!issued.ok) {
      throw new Error("unreachable");
    }
    const first = await service.verify(issued.token);
    expect(first.ok).toBe(true);
    const firstSeen = first.ok ? first.session.lastSeenAt?.getTime() : undefined;
    clock.advance(5_000);
    const later = await service.verify(issued.token);
    expect(later.ok).toBe(true);
    if (later.ok) {
      expect(later.session.lastSeenAt?.getTime()).toBe(clock.now().getTime());
      expect((firstSeen ?? 0)).toBeLessThan(later.session.lastSeenAt?.getTime() ?? 0);
    }
  });

  it("rejects invalid person ids as programmer errors (not user-facing)", async () => {
    const { service } = buildHarness();
    await expect(
      service.issue({ personId: "not-a-person-id" as unknown as PersonId }),
    ).rejects.toBeInstanceOf(AuthInvariantError);
  });

  it("rejects an invalid default TTL at construction", () => {
    const store = new InMemorySessionStore();
    expect(
      () => new SessionService({ store, ttlSeconds: 59 }),
    ).toThrowError(RangeError);
  });
});
