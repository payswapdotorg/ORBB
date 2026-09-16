import { describe, expect, it } from "vitest";
import {
  assertTodayAdherenceModelInvariants,
  todayConfiguredPolicyVariant,
  todayDefaultPosture,
  todayMissDetectionInstant,
  findMissedWeightRecord,
  TODAY_ADHERENCE_CAPABILITY_IDS,
  TODAY_ADHERENCE_DEFAULT_LINE,
  TODAY_ADHERENCE_GRANT_ID,
  TODAY_ADHERENCE_PERMISSION,
  TODAY_ADHERENCE_POLICY_ID,
  TODAY_ADHERENCE_STATES,
  TODAY_ADHERENCE_VARIANT_DISCLAIMER,
  TODAY_MAX_RESTRICTION_DURATION_MS,
  TODAY_RESTRICTION_DECISION_KIND,
} from "./model";
import { initialTodaySession, TODAY_TASK_WEIGHT_ID } from "../today/model";
import { TODAY_ESCALATION_GRACE_MS } from "../reminders/model";

/**
 * Mobile restriction-posture model contract tests (M6 EXIT): the web
 * adherence-store assertions mirrored onto the client-local session API —
 * the observe-only DEFAULT as the loudest truth, the configured-policy
 * fixture variant with every frozen B10 field, the bounded
 * restriction-authorized token, the B10 audit step vocabulary, and the
 * non-gamification / PHI-free proofs. Zero PHI; deterministic worlds.
 */

/** A deterministic reference noon (local) — the tests' fixed world. */
function referenceNow(): Date {
  return new Date(2026, 8, 15, 12, 0, 0);
}

describe("the frozen B10 vocabulary mirrors", () => {
  it("pins the states, capabilities, kind, and bounds", () => {
    expect(TODAY_ADHERENCE_STATES).toEqual(["on-track", "missed", "recovered"]);
    expect(TODAY_ADHERENCE_CAPABILITY_IDS).toEqual(["ios-focus", "android-usage-access"]);
    expect(TODAY_RESTRICTION_DECISION_KIND).toBe(
      "orbb/adherence/restriction-decision/v1",
    );
    expect(TODAY_MAX_RESTRICTION_DURATION_MS).toBe(24 * 60 * 60 * 1_000);
  });
});

describe("the DEFAULT posture (observe-only)", () => {
  it("makes 'nothing happens unless you configured it' the loudest truth", () => {
    const posture = todayDefaultPosture(initialTodaySession(referenceNow()));
    expect(posture.variant).toBe("observe-only");
    expect(posture.variantLabel).toBe("Restriction posture: observe-only (the default)");
    expect(posture.defaultLine).toBe(TODAY_ADHERENCE_DEFAULT_LINE);
    expect(posture.defaultLine).toBe(
      "No restrictions are configured — nothing happens when you miss a measurement.",
    );
    expect(posture.policy).toBeUndefined();
  });

  it("carries the fail-closed no-enforcement / no-policy decision record", () => {
    const decision = todayDefaultPosture(initialTodaySession(referenceNow())).decision;
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

  it("anchors the decision to the deterministic miss-detection instant", () => {
    const session = initialTodaySession(referenceNow());
    const record = findMissedWeightRecord(session);
    const expected =
      new Date(record.task.window.endsAt).getTime() + TODAY_ESCALATION_GRACE_MS;
    expect(todayMissDetectionInstant(record)).toBe(expected);
  });
});

describe("the configured-policy fixture variant", () => {
  it("is explicitly labeled and never the default posture", () => {
    const variant = todayConfiguredPolicyVariant(initialTodaySession(referenceNow()));
    expect(variant.variant).toBe("configured-policy");
    expect(variant.variantLabel).toBe(
      "Restriction posture: configured policy (SYNTH fixture variant)",
    );
    expect(variant.defaultLine).toBe(TODAY_ADHERENCE_VARIANT_DISCLAIMER);
    expect(variant.defaultLine).toContain("No policy is configured for you");
  });

  it("carries the policy summary with every frozen field, verbatim", () => {
    const policy = todayConfiguredPolicyVariant(initialTodaySession(referenceNow())).policy;
    expect(policy?.policyId).toBe(TODAY_ADHERENCE_POLICY_ID);
    expect(TODAY_ADHERENCE_POLICY_ID.startsWith("SYNTH-")).toBe(true);
    expect(policy?.version).toBe(1);
    expect(policy?.capability).toBe("ios-focus");
    expect(policy?.triggerOn).toBe("missed");
    expect(policy?.authorization.permissions).toEqual([TODAY_ADHERENCE_PERMISSION]);
    expect(policy?.authorization.grantId).toBe(TODAY_ADHERENCE_GRANT_ID);
    expect(TODAY_ADHERENCE_GRANT_ID.startsWith("grant_SYNTH-")).toBe(true);
    expect(policy?.scope.personIds).toEqual(["prsn_SYNTH-person-0001"]);
    expect(policy?.scope.planIds).toEqual(["plan_SYNTH-today-wt-mornings-0003"]);
    expect(policy?.scope.metricIds).toEqual(["SYNTH-metric-body-weight"]);
    expect(policy?.restriction.durationMs).toBe(7_200_000);
    expect(policy?.durationLabel).toBe(
      "2 hours (bounded — restrictions are at most 24 hours)",
    );
  });

  it("shows restriction-authorized only under policy + authorization grant", () => {
    const decision = todayConfiguredPolicyVariant(initialTodaySession(referenceNow()))
      .decision;
    expect(decision.kind).toBe("restriction-authorized");
    const restriction = decision.restriction;
    expect(restriction?.kind).toBe(TODAY_RESTRICTION_DECISION_KIND);
    expect(restriction?.decisionId).toBe("SYNTH-DECISION-evening-focus-wt-0001");
    expect(restriction?.policyId).toBe(TODAY_ADHERENCE_POLICY_ID);
    expect(restriction?.capability).toBe("ios-focus");
    expect(restriction?.authorization.permission).toBe(TODAY_ADHERENCE_PERMISSION);
    // Bounded exactly by the policy duration.
    expect(
      new Date(restriction?.expiresAtIso ?? 0).getTime() -
        new Date(restriction?.decidedAtIso ?? 0).getTime(),
    ).toBe(7_200_000);
    // The audit trail walks every B10 gate in order.
    expect(decision.auditSteps.map((step) => step.step)).toEqual([
      "policy-resolution",
      "trigger-evaluation",
      "scope-check",
      "authorization-gate",
      "capability-detection",
      "restriction-authorized",
    ]);
    expect(decision.auditSteps[3]).toEqual({
      step: "authorization-gate",
      detail: "authorized",
    });
  });
});

describe("model invariants + the binding safety proofs", () => {
  it("passes the fixture loud-failure contract", () => {
    expect(() =>
      assertTodayAdherenceModelInvariants(initialTodaySession(referenceNow())),
    ).not.toThrow();
  });

  it("never gamifies the posture (no punitive vocabulary anywhere)", () => {
    const serialized = JSON.stringify([
      todayDefaultPosture(initialTodaySession(referenceNow())),
      todayConfiguredPolicyVariant(initialTodaySession(referenceNow())),
    ]).toLowerCase();
    for (const barred of ["streak", "score", "points", "penalty", "badge", "punish"]) {
      expect(serialized).not.toContain(barred);
    }
  });

  it("keeps every posture payload PHI-free (ids + vocabulary only)", () => {
    const serialized = JSON.stringify([
      todayDefaultPosture(initialTodaySession(referenceNow())),
      todayConfiguredPolicyVariant(initialTodaySession(referenceNow())),
    ]);
    expect(serialized).not.toContain("value");
    expect(serialized).not.toContain("conceptCode");
    expect(serialized).not.toContain("evidence");
  });
});
