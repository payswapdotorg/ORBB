import { describe, expect, it } from "vitest";
import type { PersonId, PlanId } from "@orbb/domain";
import {
  ADHERENCE_CAPABILITY_IDS,
  ADHERENCE_STATES,
  CAPABILITY_DETECTION_STATES,
  isRestrictionDecision,
  RESTRICTION_DECISION_KIND,
  type RestrictionDecision,
} from "./capabilities.js";

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const PLAN_ID = "plan_SYNTH-plan-0000001" as PlanId;

const NOW_MS = 1_789_000_000_000;
const DURATION_MS = 60 * 60 * 1_000;

function decisionFixture(): RestrictionDecision {
  return {
    kind: RESTRICTION_DECISION_KIND,
    decisionId: "a".repeat(64),
    policyId: "SYNTH-policy-evening-focus",
    policyVersion: 3,
    capability: "ios-focus",
    authorization: {
      permission: "adherence:restrict:ios-focus",
      verifiedAtMs: NOW_MS,
    },
    evaluation: {
      state: "missed",
      reason: "window-elapsed",
    },
    scope: {
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-step-count",
    },
    detection: {
      state: "available",
    },
    decidedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + DURATION_MS,
  };
}

/** Builds a forged variant of the fixture via spread (no readonly mutation). */
function forged(overrides: Record<string, unknown>): unknown {
  return { ...decisionFixture(), ...overrides };
}

/** Builds a forged variant with one top-level field REMOVED. */
function withoutField(field: keyof RestrictionDecision): unknown {
  const candidate = { ...decisionFixture() } as Partial<RestrictionDecision>;
  delete candidate[field];
  return candidate;
}

describe("isRestrictionDecision (the forgery guard)", () => {
  it("accepts a well-formed decision", () => {
    expect(isRestrictionDecision(decisionFixture())).toBe(true);
  });

  it("accepts a well-formed decision with an optional detection reason", () => {
    expect(
      isRestrictionDecision(forged({ detection: { state: "available", reason: "SYNTH-none" } })),
    ).toBe(true);
  });

  it("rejects non-objects and arrays", () => {
    expect(isRestrictionDecision(undefined)).toBe(false);
    expect(isRestrictionDecision(null)).toBe(false);
    expect(isRestrictionDecision("token")).toBe(false);
    expect(isRestrictionDecision(42)).toBe(false);
    expect(isRestrictionDecision([])).toBe(false);
  });

  it("rejects a wrong or missing kind discriminant", () => {
    expect(isRestrictionDecision(forged({ kind: "orbb/adherence/restriction-decision/v2" }))).toBe(
      false,
    );
    expect(isRestrictionDecision(withoutField("kind"))).toBe(false);
  });

  it("rejects missing required fields (table-driven)", () => {
    for (const field of [
      "decisionId",
      "policyId",
      "policyVersion",
      "capability",
      "authorization",
      "evaluation",
      "scope",
      "detection",
      "decidedAtMs",
      "expiresAtMs",
    ] as const) {
      expect(isRestrictionDecision(withoutField(field)), `missing ${field}`).toBe(false);
    }
  });

  it("rejects empty/blank scalar fields (table-driven)", () => {
    expect(isRestrictionDecision(forged({ decisionId: "" }))).toBe(false);
    expect(isRestrictionDecision(forged({ policyId: "" }))).toBe(false);
    expect(
      isRestrictionDecision(
        forged({ authorization: { permission: "", verifiedAtMs: NOW_MS } }),
      ),
    ).toBe(false);
    expect(
      isRestrictionDecision(forged({ evaluation: { state: "missed", reason: "" } })),
    ).toBe(false);
  });

  it("rejects out-of-vocabulary enum values (table-driven)", () => {
    expect(isRestrictionDecision(forged({ capability: "notify-third-party" }))).toBe(false);
    expect(isRestrictionDecision(forged({ evaluation: { state: "lapsed", reason: "x" } }))).toBe(
      false,
    );
    expect(isRestrictionDecision(forged({ detection: { state: "pending" } }))).toBe(false);
  });

  it("rejects non-canonical person/plan ids", () => {
    expect(
      isRestrictionDecision(
        forged({ scope: { personId: "not-a-person-id", planId: PLAN_ID, metricId: "m" } }),
      ),
    ).toBe(false);
    expect(
      isRestrictionDecision(
        forged({ scope: { personId: PERSON_ID, planId: "nope", metricId: "m" } }),
      ),
    ).toBe(false);
  });

  it("rejects non-positive policy versions and non-finite timestamps", () => {
    expect(isRestrictionDecision(forged({ policyVersion: 0 }))).toBe(false);
    expect(isRestrictionDecision(forged({ expiresAtMs: Number.NaN }))).toBe(false);
  });

  it("rejects expired-or-degenerate bounds (expiresAtMs must exceed decidedAtMs)", () => {
    expect(isRestrictionDecision(forged({ expiresAtMs: NOW_MS }))).toBe(false);
    expect(isRestrictionDecision(forged({ expiresAtMs: NOW_MS - 1 }))).toBe(false);
  });

  it("rejects unknown extra fields (strict allowlist)", () => {
    expect(isRestrictionDecision(forged({ penalty: "streak-reset" }))).toBe(false);
    expect(
      isRestrictionDecision(
        forged({ scope: { personId: PERSON_ID, planId: PLAN_ID, metricId: "m", score: 10 } }),
      ),
    ).toBe(false);
  });

  it("keeps the vocabulary mirrors closed sets", () => {
    expect(CAPABILITY_DETECTION_STATES).toEqual([
      "available",
      "unavailable",
      "needs-permission",
      "needs-config",
    ]);
    expect(ADHERENCE_CAPABILITY_IDS).toEqual(["ios-focus", "android-usage-access"]);
    expect(ADHERENCE_STATES).toEqual(["on-track", "missed", "recovered"]);
  });
});
