import { describe, expect, it } from "vitest";
import {
  SEED_SHARES,
  accessEvents,
  activeShares,
  consentPostureSummary,
  shareStateLabel,
} from "./model";

/**
 * Mobile sharing model tests (M6-C B7): the seeded world mirrors the
 * web fixtures (byte-stable ids), the state labels are honest, and the
 * consent-posture summary aggregates the deny-by-default posture.
 */
describe("the seeded sharing world", () => {
  it("has one active + one revoked share with SYNTH ids", () => {
    expect(SEED_SHARES).toHaveLength(2);
    expect(SEED_SHARES[0]?.id).toBe("shr_SYNTH-0001");
    expect(SEED_SHARES.every((s) => s.recipientLabel.includes("SYNTH"))).toBe(true);
    expect(activeShares()).toHaveLength(1);
  });

  it("state labels are honest (Active / Revoked on …)", () => {
    expect(shareStateLabel(SEED_SHARES[0]!)).toBe("Active share");
    expect(shareStateLabel(SEED_SHARES[1]!)).toBe("Revoked on 2026-08-06");
  });

  it("access events filter by share and sort newest-first", () => {
    const forRevoked = accessEvents("shr_SYNTH-0002");
    expect(forRevoked).toHaveLength(3);
    expect(forRevoked[0]?.kind).toBe("revoked");
    expect(accessEvents()).toHaveLength(4);
  });
});

describe("consent posture summary (B9)", () => {
  it("aggregates active shares + deny-by-default sources + quiet hours", () => {
    const summary = consentPostureSummary();
    expect(summary.activeShareCount).toBe(1);
    expect(summary.enabledSourceCount).toBe(1);
    expect(summary.quietHoursLabel).toContain("22:00");
  });
});
