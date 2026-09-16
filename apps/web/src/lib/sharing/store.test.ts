// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { createShare, listAccessEvents, listShares, recordAccessEvent, resetSharingStore, revokeShare } from "./store";
import { seedSharingFixtures } from "./fixtures";

/**
 * Sharing store tests (M6-C B7): the reviewable-contract lifecycle —
 * creation requires the FULL contract (no default-open), revocation is
 * terminal + audited, access events append to the trail, and the seed
 * world is deterministic.
 */

const FULL_INPUT = {
  recipientId: "recipient-synth-clinician",
  purposeId: "purpose-synth-care-monitoring",
  conceptIds: ["concept-heart-rate"],
  startsAtIso: "2026-09-03T00:00:00.000Z",
  endsAtIso: "2026-09-10T23:59:59.000Z",
  derivedDataAllowed: false,
  resharing: "no-resharing" as const,
  expiresAtIso: "2026-12-10T23:59:59.000Z",
};

beforeEach(() => {
  resetSharingStore();
});

describe("createShare (the full contract is required)", () => {
  it("creates a share from the full contract", () => {
    const r = createShare(FULL_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.share.state).toBe("active");
      expect(r.share.recipientLabel).toContain("SYNTH");
      expect(r.share.scopeSummary).toContain("Heart rate");
    }
  });

  it("rejects an empty scope (there is no share-everything)", () => {
    const r = createShare({ ...FULL_INPUT, conceptIds: [] });
    expect(r).toEqual({ ok: false, error: { kind: "empty-scope" } });
  });

  it("rejects unknown vocabulary", () => {
    expect(createShare({ ...FULL_INPUT, recipientId: "recipient-real" })).toEqual({
      ok: false,
      error: { kind: "unknown-recipient" },
    });
    expect(createShare({ ...FULL_INPUT, purposeId: "purpose-made-up" })).toEqual({
      ok: false,
      error: { kind: "unknown-purpose" },
    });
    expect(createShare({ ...FULL_INPUT, conceptIds: ["concept-not-real"] })).toEqual({
      ok: false,
      error: { kind: "unknown-concept", conceptId: "concept-not-real" },
    });
  });

  it("rejects inverted windows and expiry before the window end", () => {
    expect(createShare({ ...FULL_INPUT, endsAtIso: FULL_INPUT.startsAtIso })).toEqual({
      ok: false,
      error: { kind: "invalid-window" },
    });
    expect(
      createShare({ ...FULL_INPUT, expiresAtIso: "2026-09-05T00:00:00.000Z" }),
    ).toEqual({ ok: false, error: { kind: "invalid-expiry" } });
  });
});

describe("revokeShare (terminal + audited)", () => {
  it("revokes an active share, records the event, refuses re-revocation", () => {
    const created = createShare(FULL_INPUT);
    if (!created.ok) throw new Error("setup failed");
    const revoked = revokeShare(created.share.id, "2026-09-16T10:00:00.000Z");
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(revoked.share.state).toBe("revoked");
      expect(revoked.share.revokedAtIso).toBe("2026-09-16T10:00:00.000Z");
    }
    const events = listAccessEvents(created.share.id);
    expect(events.some((e) => e.kind === "revoked")).toBe(true);
    expect(revokeShare(created.share.id, "2026-09-16T11:00:00.000Z")).toEqual({
      ok: false,
      error: { kind: "not-active" },
    });
  });

  it("revocation is terminal: re-sharing creates a NEW id", () => {
    const a = createShare(FULL_INPUT);
    if (!a.ok) throw new Error("setup failed");
    revokeShare(a.share.id, "2026-09-16T10:00:00.000Z");
    const b = createShare(FULL_INPUT);
    if (!b.ok) throw new Error("setup failed");
    expect(b.share.id).not.toBe(a.share.id);
    expect(listShares()).toHaveLength(2);
  });
});

describe("recordAccessEvent (the audit trail)", () => {
  it("records viewed/exported events on existing shares; unknown ids fail", () => {
    const created = createShare(FULL_INPUT);
    if (!created.ok) throw new Error("setup failed");
    const e1 = recordAccessEvent(created.share.id, "viewed", "2026-09-16T09:00:00.000Z", "Test Actor", "scope");
    expect(e1.ok).toBe(true);
    const e2 = recordAccessEvent("shr_SYNTH-9999", "viewed", "2026-09-16T09:00:00.000Z", "X", "y");
    expect(e2).toEqual({ ok: false, error: { kind: "not-found" } });
    expect(listAccessEvents().some((e) => e.kind === "viewed")).toBe(true);
  });
});

describe("the deterministic seed world", () => {
  it("seeds one active + one revoked share with audit events, byte-stable ids", () => {
    const first = seedSharingFixtures();
    expect(first.activeShareId).toBe("shr_SYNTH-0001");
    expect(first.revokedShareId).toBe("shr_SYNTH-0002");
    const events = listAccessEvents();
    // active: 1 viewed; revoked: viewed + exported + revocation
    expect(events.filter((e) => e.shareId === first.activeShareId)).toHaveLength(1);
    expect(events.filter((e) => e.shareId === first.revokedShareId)).toHaveLength(3);
    // determinism: reseed reproduces identical ids
    resetSharingStore();
    const second = seedSharingFixtures();
    expect(second).toEqual(first);
  });
});
