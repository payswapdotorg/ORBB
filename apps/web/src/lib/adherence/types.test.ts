// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AdherencePolicy,
  EnforcementDecision,
  RestrictionDecision,
} from "@orbb/adherence";
import { resetTodayStore, TODAY_TASK_WEIGHT_ID } from "../today/store";
import {
  todayConfiguredDecisionFixture,
  todayConfiguredPolicyFixture,
  todayDefaultDecisionFixture,
  todayMissedEvaluationFixture,
  findMissedWeightRecord,
  TODAY_ADHERENCE_GRANT_ID,
  TODAY_ADHERENCE_PERMISSION,
  TODAY_ADHERENCE_POLICY_ID,
} from "./catalog";
import {
  TODAY_ADHERENCE_DEFAULT_LINE,
  todayConfiguredPolicyVariant,
  todayDefaultPosture,
} from "./store";
import {
  TODAY_ADHERENCE_CAPABILITY_IDS,
  TODAY_ADHERENCE_STATES,
  TODAY_MAX_RESTRICTION_DURATION_MS,
  TODAY_RESTRICTION_DECISION_KIND,
  isTodayAdherenceResponse,
  type TodayAdherenceResponse,
} from "./types";

/**
 * Adherence wire-type CONTRACT tests (M6 EXIT): pin the app-side mirror to
 * the REAL `@orbb/adherence` (B10) shapes — the M6-A catalog-mirror
 * pattern, in two layers:
 *
 *   1. COMPILE-TIME structural pins (this file is typechecked by
 *      `pnpm typecheck`): the fixture builders' return values are
 *      assignable to the REAL package types (they are typed BY them);
 *      the restriction token fixture is assignable to the REAL
 *      `RestrictionDecision` (the only value OS adapters accept);
 *   2. RUNTIME frozen-vocabulary pins (this file runs under vitest): the
 *      state/capability/kind literals and the schema bounds are pinned
 *      to the frozen B10 vocabulary, so a package change fails loudly.
 *
 * RECORDED BOUNDARY: `@orbb/adherence` resolves at runtime to its
 * unbuilt `dist/` entry, so only `import type` is possible here (the
 * recorded handoff in `types.ts`).
 */

/** A deterministic reference noon (local) — the tests' fixed world. */
function referenceNow(): Date {
  return new Date(2026, 8, 15, 12, 0, 0);
}

beforeEach(() => {
  resetTodayStore();
});

// ---------------------------------------------------------------------------
// 1. Compile-time structural pins (the fixtures ARE the real types).
// ---------------------------------------------------------------------------

// The policy fixture flows REAL-typed in both directions.
const policyPin: AdherencePolicy = todayConfiguredPolicyFixture();
const policyVersionPin: number = policyPin.version;

// The decision fixtures are REAL EnforcementDecision values.
const decisionPin: EnforcementDecision = todayDefaultDecisionFixture(
  findMissedWeightRecord(referenceNow()),
);
const configuredPin: EnforcementDecision = todayConfiguredDecisionFixture(
  findMissedWeightRecord(referenceNow()),
);

// The restriction token inside the configured decision is the REAL
// RestrictionDecision shape — the only value OS adapters accept.
const tokenPin: RestrictionDecision | undefined =
  configuredPin.kind === "restriction-authorized" ? configuredPin.decision : undefined;

// The evaluation fixture is the REAL AdherenceEvaluation shape.
const evaluationPin = todayMissedEvaluationFixture(findMissedWeightRecord(referenceNow()));

// ---------------------------------------------------------------------------
// 2. Runtime frozen-vocabulary + fixture pins.
// ---------------------------------------------------------------------------

describe("adherence wire types — the B10 contract mirror", () => {
  it("keeps the compile-time structural pins live (REAL-typed both directions)", () => {
    // The module-level pins above are the compile-time proof (this file
    // is typechecked); these assertions keep them REFERENCED so the
    // bi-directional assignability stays enforced, never rotting away
    // under no-unused-vars.
    expect(policyVersionPin).toBe(1);
    expect(decisionPin.kind).toBe("no-enforcement");
    expect(tokenPin?.kind).toBe(TODAY_RESTRICTION_DECISION_KIND);
    expect(evaluationPin.state).toBe("missed");
    expect(todayDefaultPosture(referenceNow()).defaultLine).toBe(
      TODAY_ADHERENCE_DEFAULT_LINE,
    );
  });

  it("mirrors the frozen adherence state vocabulary", () => {
    expect(TODAY_ADHERENCE_STATES).toEqual(["on-track", "missed", "recovered"]);
  });

  it("mirrors the frozen closed capability set (OS surfaces only)", () => {
    expect(TODAY_ADHERENCE_CAPABILITY_IDS).toEqual(["ios-focus", "android-usage-access"]);
  });

  it("mirrors the frozen restriction-decision kind discriminant", () => {
    expect(TODAY_RESTRICTION_DECISION_KIND).toBe(
      "orbb/adherence/restriction-decision/v1",
    );
  });

  it("mirrors the recorded 24h bounded-duration maximum", () => {
    expect(TODAY_MAX_RESTRICTION_DURATION_MS).toBe(24 * 60 * 60 * 1_000);
  });

  it("guards the response payload shape", () => {
    const response: TodayAdherenceResponse = {
      synthetic: true,
      personId: "prsn_SYNTH-person-0001",
      posture: todayDefaultPosture(referenceNow()),
      fixtureVariant: todayConfiguredPolicyVariant(referenceNow()),
      generatedAt: referenceNow().toISOString(),
    };
    expect(isTodayAdherenceResponse(response)).toBe(true);
    expect(isTodayAdherenceResponse({ synthetic: true })).toBe(false);
    expect(isTodayAdherenceResponse(null)).toBe(false);
  });
});

describe("the configured-policy fixture (fields verbatim from the B10 schema)", () => {
  it("carries every frozen schema field with legal values", () => {
    const policy = todayConfiguredPolicyFixture();
    expect(policy.policyId).toBe(TODAY_ADHERENCE_POLICY_ID);
    expect(TODAY_ADHERENCE_POLICY_ID.startsWith("SYNTH-")).toBe(true);
    expect(policy.version).toBe(1);
    expect(policy.capability).toBe("ios-focus");
    expect(policy.triggerOn).toBe("missed");
    expect(policy.authorization.permissions).toEqual([TODAY_ADHERENCE_PERMISSION]);
    expect(policy.authorization.grantId).toBe(TODAY_ADHERENCE_GRANT_ID);
    expect(TODAY_ADHERENCE_GRANT_ID.startsWith("grant_SYNTH-")).toBe(true);
    expect(policy.scope.personIds).toEqual(["prsn_SYNTH-person-0001"]);
    expect(policy.scope.planIds).toEqual(["plan_SYNTH-today-wt-mornings-0003"]);
    expect(policy.scope.metricIds).toEqual(["SYNTH-metric-body-weight"]);
    expect(policy.restriction.durationMs).toBe(2 * 60 * 60 * 1_000);
    expect(policy.restriction.durationMs).toBeLessThanOrEqual(
      TODAY_MAX_RESTRICTION_DURATION_MS,
    );
  });

  it("contains NO punitive construct (the non-gamification proof)", () => {
    const serialized = JSON.stringify(todayConfiguredPolicyFixture());
    for (const barred of [
      "streak",
      "score",
      "points",
      "penalty",
      "penalt",
      "badge",
      "level",
      "escalat",
      "punish",
    ]) {
      expect(serialized).not.toContain(barred);
    }
  });
});

describe("the decision fixtures (the B10 EnforcementDecision mirror)", () => {
  it("defaults to no-enforcement / no-policy (fail-closed posture)", () => {
    const decision = todayDefaultDecisionFixture(findMissedWeightRecord(referenceNow()));
    expect(decision.kind).toBe("no-enforcement");
    if (decision.kind !== "no-enforcement") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("no-policy");
    expect(decision.audit.steps).toEqual([
      { step: "policy-resolution", detail: "absent:policy" },
    ]);
  });

  it("evaluates the missed task with the engine's step vocabulary", () => {
    const evaluation = todayMissedEvaluationFixture(findMissedWeightRecord(referenceNow()));
    expect(evaluation.taskId).toBe(TODAY_TASK_WEIGHT_ID);
    expect(evaluation.state).toBe("missed");
    expect(evaluation.reason).toBe("window-elapsed");
    expect(evaluation.steps).toEqual([
      { step: "task-state", detail: "open" },
      { step: "window-elapsed-check", detail: "endsAt<=now" },
    ]);
  });

  it("authorizes a restriction ONLY on the configured variant, bounded exactly", () => {
    const decision = todayConfiguredDecisionFixture(findMissedWeightRecord(referenceNow()));
    expect(decision.kind).toBe("restriction-authorized");
    if (decision.kind !== "restriction-authorized") {
      throw new Error("unreachable");
    }
    const token = decision.decision;
    expect(token.kind).toBe(TODAY_RESTRICTION_DECISION_KIND);
    expect(token.policyId).toBe(TODAY_ADHERENCE_POLICY_ID);
    expect(token.capability).toBe("ios-focus");
    expect(token.authorization.permission).toBe(TODAY_ADHERENCE_PERMISSION);
    expect(token.detection.state).toBe("available");
    expect(token.evaluation).toEqual({ state: "missed", reason: "window-elapsed" });
    // Bounded exactly by the policy duration (at most 24h).
    expect(token.expiresAtMs - token.decidedAtMs).toBe(2 * 60 * 60 * 1_000);
    // The audit trail walks every B10 gate in order.
    expect(decision.audit.steps.map((step) => step.step)).toEqual([
      "policy-resolution",
      "trigger-evaluation",
      "scope-check",
      "authorization-gate",
      "capability-detection",
      "restriction-authorized",
    ]);
  });

  it("anchors the decision to the deterministic miss-detection instant", () => {
    const record = findMissedWeightRecord(referenceNow());
    const evaluation = todayMissedEvaluationFixture(record);
    // Window end (yesterday 09:00 local) + 60 min escalation grace.
    const expected = record.task.window.endsAt.getTime() + 3_600_000;
    expect(evaluation.evaluatedAtMs).toBe(expected);
  });
});
