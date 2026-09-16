// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { resetTodayStore, TODAY_TASK_WEIGHT_ID } from "../today/store";
import {
  TODAY_ADHERENCE_DEFAULT_LINE,
  assertTodayAdherenceStoreInvariants,
  todayConfiguredPolicyVariant,
  todayDefaultPosture,
} from "./store";
import { TODAY_ADHERENCE_VARIANT_DISCLAIMER } from "./store";

/**
 * Adherence posture store tests (M6 EXIT): the wire projections of the
 * two fixture worlds — the observe-only DEFAULT (the loudest truth) and
 * the explicitly-labeled configured-policy SYNTH variant — plus the
 * non-gamification and PHI-free proofs for the posture surface. All
 * fixtures are SYNTH; zero PHI.
 */

/** A deterministic reference noon (local) — the tests' fixed world. */
function referenceNow(): Date {
  return new Date(2026, 8, 15, 12, 0, 0);
}

beforeEach(() => {
  resetTodayStore();
});

describe("the DEFAULT posture (observe-only)", () => {
  it("makes 'nothing happens unless you configured it' the loudest truth", () => {
    const posture = todayDefaultPosture(referenceNow());
    expect(posture.variant).toBe("observe-only");
    expect(posture.variantLabel).toBe("Restriction posture: observe-only (the default)");
    expect(posture.defaultLine).toBe(
      "No restrictions are configured — nothing happens when you miss a measurement.",
    );
    expect(posture.defaultLine).toBe(TODAY_ADHERENCE_DEFAULT_LINE);
    // No policy rides the default posture.
    expect(posture.policy).toBeUndefined();
  });

  it("carries the fail-closed no-enforcement / no-policy decision record", () => {
    const decision = todayDefaultPosture(referenceNow()).decision;
    expect(decision.kind).toBe("no-enforcement");
    expect(decision.reason).toBe("no-policy");
    expect(decision.decisionLabel).toBe("Observe-only — nothing restrictive happens");
    expect(decision.evaluation.taskId).toBe(TODAY_TASK_WEIGHT_ID);
    expect(decision.evaluation.state).toBe("missed");
    expect(decision.evaluation.reason).toBe("window-elapsed");
    expect(decision.auditSteps).toEqual([
      { step: "policy-resolution", detail: "absent:policy" },
    ]);
  });
});

describe("the configured-policy fixture variant", () => {
  it("is explicitly labeled and never the default posture", () => {
    const variant = todayConfiguredPolicyVariant(referenceNow());
    expect(variant.variant).toBe("configured-policy");
    expect(variant.variantLabel).toBe(
      "Restriction posture: configured policy (SYNTH fixture variant)",
    );
    expect(variant.defaultLine).toBe(TODAY_ADHERENCE_VARIANT_DISCLAIMER);
    expect(variant.defaultLine).toContain("No policy is configured for you");
  });

  it("carries the policy summary with every frozen field verbatim", () => {
    const policy = todayConfiguredPolicyVariant(referenceNow()).policy;
    expect(policy).toBeDefined();
    expect(policy?.policyId).toBe("SYNTH-policy-evening-focus-0001");
    expect(policy?.version).toBe(1);
    expect(policy?.capability).toBe("ios-focus");
    expect(policy?.capabilityLabel).toContain("iOS Focus");
    expect(policy?.triggerOn).toBe("missed");
    expect(policy?.authorization.permissions).toEqual(["adherence:restrict:ios-focus"]);
    expect(policy?.authorization.grantId).toBe("grant_SYNTH-adherence-demo-0001");
    expect(policy?.scope.personIds).toEqual(["prsn_SYNTH-person-0001"]);
    expect(policy?.scope.planIds).toEqual(["plan_SYNTH-today-wt-mornings-0003"]);
    expect(policy?.scope.metricIds).toEqual(["SYNTH-metric-body-weight"]);
    expect(policy?.restriction.durationMs).toBe(7_200_000);
    expect(policy?.durationLabel).toBe(
      "2 hours (bounded — restrictions are at most 24 hours)",
    );
  });

  it("shows restriction-authorized only under policy + authorization grant", () => {
    const variant = todayConfiguredPolicyVariant(referenceNow());
    expect(variant.decision.kind).toBe("restriction-authorized");
    const restriction = variant.decision.restriction;
    expect(restriction).toBeDefined();
    expect(restriction?.kind).toBe("orbb/adherence/restriction-decision/v1");
    expect(restriction?.decisionId).toBe("SYNTH-DECISION-evening-focus-wt-0001");
    expect(restriction?.authorization.permission).toBe("adherence:restrict:ios-focus");
    expect(restriction?.detection.state).toBe("available");
    // Bounded exactly: expiry minus decision === the policy duration.
    expect(
      new Date(restriction?.expiresAtIso ?? 0).getTime() -
        new Date(restriction?.decidedAtIso ?? 0).getTime(),
    ).toBe(7_200_000);
  });

  it("walks the full B10 gate order in the audit trail", () => {
    const decision = todayConfiguredPolicyVariant(referenceNow()).decision;
    expect(decision.auditSteps.map((step) => step.step)).toEqual([
      "policy-resolution",
      "trigger-evaluation",
      "scope-check",
      "authorization-gate",
      "capability-detection",
      "restriction-authorized",
    ]);
    expect(decision.auditSteps[3]).toEqual({ step: "authorization-gate", detail: "authorized" });
  });
});

describe("store invariants + the binding safety proofs", () => {
  it("passes the fixture loud-failure contract", () => {
    expect(() => assertTodayAdherenceStoreInvariants(referenceNow())).not.toThrow();
  });

  it("never gamifies the posture (no punitive vocabulary anywhere)", () => {
    const serialized = JSON.stringify([
      todayDefaultPosture(referenceNow()),
      todayConfiguredPolicyVariant(referenceNow()),
    ]).toLowerCase();
    for (const barred of [
      "streak",
      "score",
      "points",
      "penalty",
      "badge",
      "level",
      "punish",
      "shame",
      "fail",
    ]) {
      expect(serialized).not.toContain(barred);
    }
  });

  it("keeps every posture payload PHI-free (ids + vocabulary only)", () => {
    const serialized = JSON.stringify([
      todayDefaultPosture(referenceNow()),
      todayConfiguredPolicyVariant(referenceNow()),
    ]);
    expect(serialized).not.toContain("value");
    expect(serialized).not.toContain("conceptCode");
    expect(serialized).not.toContain("evidence");
    expect(serialized).not.toContain("observationValue");
  });
});
