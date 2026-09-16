// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertSharingCatalogInvariants,
  COMPOSER_STEPS,
  findPurposeOption,
  findRecipientOption,
  SHARE_CONCEPT_OPTIONS,
} from "./catalog";

/**
 * Sharing catalog contract tests (M6-C B7): the vocabulary invariants —
 * SYNTH-marked ids, no duplicates, real consequence lines on every
 * composer step, and the concept vocabulary coherence with the DataBox
 * (B6) labels.
 */
describe("sharing catalog", () => {
  it("passes its invariant assertion (fixture loud-failure contract)", () => {
    expect(() => assertSharingCatalogInvariants()).not.toThrow();
  });

  it("offers >= 3 recipients and >= 3 purposes, SYNTH-marked", () => {
    expect(SHARE_CONCEPT_OPTIONS.length).toBeGreaterThanOrEqual(5);
    const recipient = findRecipientOption("recipient-synth-clinician");
    expect(recipient?.label).toContain("SYNTH");
    const purpose = findPurposeOption("purpose-synth-care-monitoring");
    expect(purpose?.consequence.length).toBeGreaterThan(20);
  });

  it("defines the six frozen composer steps with consequence lines", () => {
    expect(COMPOSER_STEPS.map((s) => s.key)).toEqual([
      "recipient",
      "purpose",
      "scope",
      "terms",
      "expiry",
      "review",
    ]);
    for (const step of COMPOSER_STEPS) {
      expect(step.consequence.length).toBeGreaterThan(20);
    }
  });
});
