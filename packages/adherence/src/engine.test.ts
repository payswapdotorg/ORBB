import { describe, expect, it } from "vitest";
import type { GrantId, PersonId, PlanId, TaskId } from "@orbb/domain";
import {
  AdherenceEnforcementEngine,
  RESTRICTION_DECISION_KIND,
  enforcementDecisionDigest,
  evaluateAdherenceSnapshot,
  type AdherenceAuthorizationGate,
  type AdherenceCapabilityProber,
  type AdherenceEvaluation,
  type EnforcementDecision,
} from "./index.js";

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const OTHER_PERSON_ID = "prsn_SYNTH-person-000002" as PersonId;
const PLAN_ID = "plan_SYNTH-plan-0000001" as PlanId;
const TASK_ID = "task_SYNTHTASK000000000001" as TaskId;
const GRANT_ID = "grant_SYNTHTGRANT00000001" as GrantId;

const NOW_MS = 1_789_000_000_000;
const DURATION_MS = 2 * 60 * 60 * 1_000;
const PERMISSION = "adherence:restrict:ios-focus";

function validPolicy(): Record<string, unknown> {
  return {
    policyId: "SYNTH-policy-evening-focus",
    version: 5,
    capability: "ios-focus",
    triggerOn: "missed",
    authorization: { permissions: [PERMISSION] },
    scope: { personIds: [PERSON_ID], planIds: [PLAN_ID], metricIds: ["SYNTH-metric-step-count"] },
    restriction: { durationMs: DURATION_MS },
  };
}

const MISS_WINDOW = {
  sequence: 7,
  startsAt: new Date(NOW_MS - 4 * 3_600_000),
  endsAt: new Date(NOW_MS - 2 * 3_600_000),
};

const ON_TRACK_WINDOW = {
  sequence: 8,
  startsAt: new Date(NOW_MS + 2 * 3_600_000),
  endsAt: new Date(NOW_MS + 4 * 3_600_000),
};

function missedEvaluation(): AdherenceEvaluation {
  const result = evaluateAdherenceSnapshot(
    {
      taskId: TASK_ID,
      planId: PLAN_ID,
      personId: PERSON_ID,
      metricId: "SYNTH-metric-step-count",
      window: MISS_WINDOW,
      taskState: "open",
      rollCount: 0,
    },
    NOW_MS,
  );
  if (!result.ok) {
    throw new Error("unexpected rejection building the missed evaluation");
  }
  return result.value;
}

function onTrackEvaluation(): AdherenceEvaluation {
  const result = evaluateAdherenceSnapshot(
    {
      taskId: TASK_ID,
      planId: PLAN_ID,
      personId: PERSON_ID,
      metricId: "SYNTH-metric-step-count",
      window: ON_TRACK_WINDOW,
      taskState: "open",
      rollCount: 0,
    },
    NOW_MS,
  );
  if (!result.ok) {
    throw new Error("unexpected rejection building the on-track evaluation");
  }
  return result.value;
}

function recoveredEvaluation(): AdherenceEvaluation {
  const result = evaluateAdherenceSnapshot(
    {
      taskId: TASK_ID,
      planId: PLAN_ID,
      personId: PERSON_ID,
      metricId: "SYNTH-metric-step-count",
      window: MISS_WINDOW,
      taskState: "completed",
      rollCount: 1,
      completedAt: new Date(NOW_MS - 1_000),
    },
    NOW_MS,
  );
  if (!result.ok) {
    throw new Error("unexpected rejection building the recovered evaluation");
  }
  return result.value;
}

function gateOf(authorized: boolean): AdherenceAuthorizationGate {
  return { isRestrictionAuthorized: async () => authorized };
}

function proberOf(
  state: "available" | "unavailable" | "needs-permission" | "needs-config",
): AdherenceCapabilityProber {
  return { detectionState: async () => ({ state }) };
}

function makeEngine(
  options?: {
    gate?: AdherenceAuthorizationGate;
    prober?: AdherenceCapabilityProber;
  },
): AdherenceEnforcementEngine {
  return new AdherenceEnforcementEngine({
    gate: options?.gate ?? gateOf(true),
    prober: options?.prober ?? proberOf("available"),
  });
}

function evaluate(
  options?: {
    policy?: unknown;
    evaluation?: AdherenceEvaluation;
    gate?: AdherenceAuthorizationGate;
    prober?: AdherenceCapabilityProber;
  },
): Promise<EnforcementDecision> {
  const engine = new AdherenceEnforcementEngine({
    gate: options?.gate ?? gateOf(true),
    prober: options?.prober ?? proberOf("available"),
  });
  return engine.evaluate({
    // NOTE: explicit null/undefined policies must reach the engine
    // untouched — key-presence check, no `??` default (that would
    // swallow the absent case).
    policy: options !== undefined && "policy" in options ? options.policy : validPolicy(),
    evaluation: options?.evaluation ?? missedEvaluation(),
    personId: PERSON_ID,
    planId: PLAN_ID,
    metricId: "SYNTH-metric-step-count",
    nowMs: NOW_MS,
  });
}

describe("AdherenceEnforcementEngine — observe-only by default", () => {
  it("no policy => no-enforcement (nothing restrictive happens)", async () => {
    for (const absent of [null, undefined]) {
      const decision = await evaluate({ policy: absent });
      expect(decision.kind, `absent ${String(absent)}`).toBe("no-enforcement");
      if (decision.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(decision.reason).toBe("no-policy");
      expect(decision.evaluation.state).toBe("missed");
      expect(decision.audit.steps[0]?.step).toBe("policy-resolution");
    }
  });

  it("malformed policy => no-enforcement (fail-closed, table-driven)", async () => {
    const malformed: unknown[] = [
      {},
      "policy",
      42,
      [],
      { ...validPolicy(), capability: "ios-focusx" },
      { ...validPolicy(), triggerOn: "recovered" },
      { ...validPolicy(), scope: {} },
      { ...validPolicy(), restriction: { durationMs: 0 } },
      { ...validPolicy(), penalty: true },
    ];
    for (const policy of malformed) {
      const decision = await evaluate({ policy });
      expect(decision.kind, `malformed ${JSON.stringify(String(policy))}`).toBe("no-enforcement");
      if (decision.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(decision.reason).toBe("policy-malformed");
      // The adherence state is STILL recorded — observe-only continues.
      expect(decision.evaluation.state).toBe("missed");
    }
  });

  it("on-track state never triggers enforcement", async () => {
    const decision = await evaluate({ evaluation: onTrackEvaluation() });
    expect(decision.kind).toBe("no-enforcement");
    if (decision.kind !== "no-enforcement") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("state-not-triggering");
  });

  it("RECOVERED state never triggers enforcement (recovery is never punished)", async () => {
    const decision = await evaluate({ evaluation: recoveredEvaluation() });
    expect(decision.kind).toBe("no-enforcement");
    if (decision.kind !== "no-enforcement") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("state-not-triggering");
    expect(decision.evaluation.state).toBe("recovered");
  });

  it("out-of-scope (person/plan/metric) => no-enforcement (table-driven)", async () => {
    const scopedToOther: Record<string, unknown> = {
      ...validPolicy(),
      scope: { personIds: [OTHER_PERSON_ID] },
    };
    const personMiss = await evaluate({ policy: scopedToOther });
    expect(personMiss.kind).toBe("no-enforcement");
    if (personMiss.kind !== "no-enforcement") {
      throw new Error("unreachable");
    }
    expect(personMiss.reason).toBe("out-of-scope");

    const otherPlan: Record<string, unknown> = {
      ...validPolicy(),
      scope: { planIds: ["plan_SYNTH-plan-000099" as PlanId] },
    };
    const planMiss = await evaluate({ policy: otherPlan });
    expect(planMiss.kind).toBe("no-enforcement");

    const otherMetric: Record<string, unknown> = {
      ...validPolicy(),
      scope: { metricIds: ["SYNTH-metric-sleep-minutes"] },
    };
    const metricMiss = await evaluate({ policy: otherMetric });
    expect(metricMiss.kind).toBe("no-enforcement");
  });
});

describe("AdherenceEnforcementEngine — fail-closed authorization", () => {
  it("configured but unauthorized => typed REFUSAL with an audit record (never silent)", async () => {
    const decision = await evaluate({ gate: gateOf(false) });
    expect(decision.kind).toBe("enforcement-refused");
    if (decision.kind !== "enforcement-refused") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("not-authorized");
    expect(decision.evaluation.state).toBe("missed");
    const gateStep = decision.audit.steps.find((step) => step.step === "authorization-gate");
    expect(gateStep?.detail).toBe("denied");
  });

  it("a throwing gate => refusal (broken dependency never restricts)", async () => {
    const exploding: AdherenceAuthorizationGate = {
      isRestrictionAuthorized: async () => {
        throw new Error("SYNTH gate failure");
      },
    };
    const decision = await evaluate({ gate: exploding });
    expect(decision.kind).toBe("enforcement-refused");
    if (decision.kind !== "enforcement-refused") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("authorization-gate-error");
  });
});

describe("AdherenceEnforcementEngine — graceful capability degrade", () => {
  it("capability unavailable => no-enforcement with the accounted reason (observe-only)", async () => {
    const decision = await evaluate({ prober: proberOf("unavailable") });
    expect(decision.kind).toBe("no-enforcement");
    if (decision.kind !== "no-enforcement") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("capability-unavailable");
    const detectionStep = decision.audit.steps.find(
      (step) => step.step === "capability-detection",
    );
    expect(detectionStep?.detail).toContain("state=unavailable");
  });

  it("capability needs-permission / needs-config => no-enforcement (table-driven)", async () => {
    for (const state of ["needs-permission", "needs-config"] as const) {
      const decision = await evaluate({ prober: proberOf(state) });
      expect(decision.kind, state).toBe("no-enforcement");
      if (decision.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(decision.reason, state).toBe("capability-unavailable");
      const detectionStep = decision.audit.steps.find(
        (step) => step.step === "capability-detection",
      );
      expect(detectionStep?.detail, state).toContain(`state=${state}`);
    }
  });

  it("authorization is checked BEFORE capability (an unavailable capability never masks a refusal)", async () => {
    const decision = await evaluate({ gate: gateOf(false), prober: proberOf("unavailable") });
    expect(decision.kind).toBe("enforcement-refused");
    if (decision.kind !== "enforcement-refused") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("not-authorized");
  });

  it("a throwing or garbage prober => refusal (probe errors never restrict)", async () => {
    const exploding: AdherenceCapabilityProber = {
      detectionState: async () => {
        throw new Error("SYNTH prober failure");
      },
    };
    const thrown = await evaluate({ prober: exploding });
    expect(thrown.kind).toBe("enforcement-refused");
    if (thrown.kind !== "enforcement-refused") {
      throw new Error("unreachable");
    }
    expect(thrown.reason).toBe("capability-probe-error");

    const garbage: AdherenceCapabilityProber = {
      detectionState: async () => ({ state: "pending" as never }),
    };
    const invalid = await evaluate({ prober: garbage });
    expect(invalid.kind).toBe("enforcement-refused");
    if (invalid.kind !== "enforcement-refused") {
      throw new Error("unreachable");
    }
    expect(invalid.reason).toBe("capability-probe-error");
  });
});

describe("AdherenceEnforcementEngine — the authorized restriction", () => {
  it("mints a bounded, auditable decision token on the all-green path", async () => {
    const decision = await evaluate();
    expect(decision.kind).toBe("restriction-authorized");
    if (decision.kind !== "restriction-authorized") {
      throw new Error("unreachable");
    }
    const token = decision.decision;
    expect(token.kind).toBe(RESTRICTION_DECISION_KIND);
    expect(token.policyId).toBe("SYNTH-policy-evening-focus");
    expect(token.policyVersion).toBe(5);
    expect(token.capability).toBe("ios-focus");
    expect(token.authorization).toEqual({ permission: PERMISSION, verifiedAtMs: NOW_MS });
    expect(token.evaluation).toEqual({ state: "missed", reason: "window-elapsed" });
    expect(token.scope).toEqual({
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-step-count",
    });
    expect(token.detection).toEqual({ state: "available" });
    expect(token.decidedAtMs).toBe(NOW_MS);
    expect(token.expiresAtMs).toBe(NOW_MS + DURATION_MS);
    expect(token.decisionId).toMatch(/^[0-9a-f]{64}$/);
    expect(decision.audit.decidedAtMs).toBe(NOW_MS);
    // The fixed evaluation order is part of the audit contract.
    expect(decision.audit.steps.map((step) => step.step)).toEqual([
      "policy-resolution",
      "trigger-evaluation",
      "scope-check",
      "authorization-gate",
      "capability-detection",
      "restriction-authorized",
    ]);
  });

  it("honors a pinned grant id by passing it through to the gate", async () => {
    let seen: { grantId?: GrantId } | undefined;
    const gate: AdherenceAuthorizationGate = {
      isRestrictionAuthorized: async (request) => {
        seen = {
          ...(request.grantId !== undefined ? { grantId: request.grantId } : {}),
        };
        return true;
      },
    };
    const decision = await evaluate({
      policy: {
        ...validPolicy(),
        authorization: { permissions: [PERMISSION], grantId: GRANT_ID },
      },
      gate,
    });
    expect(decision.kind).toBe("restriction-authorized");
    expect(seen?.grantId).toBe(GRANT_ID);
  });
});

describe("AdherenceEnforcementEngine — determinism (the replay proof)", () => {
  it("identical inputs produce identical decisions, run twice on one engine", async () => {
    const engine = makeEngine();
    const one = await engine.evaluate({
      policy: validPolicy(),
      evaluation: missedEvaluation(),
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-step-count",
      nowMs: NOW_MS,
    });
    const two = await engine.evaluate({
      policy: validPolicy(),
      evaluation: missedEvaluation(),
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-step-count",
      nowMs: NOW_MS,
    });
    expect(one).toEqual(two);
    expect(enforcementDecisionDigest(one)).toBe(enforcementDecisionDigest(two));
    if (one.kind === "restriction-authorized" && two.kind === "restriction-authorized") {
      expect(one.decision.decisionId).toBe(two.decision.decisionId);
    } else {
      throw new Error("expected authorized decisions");
    }
  });

  it("two fresh engine instances with equivalent deps produce identical decisions", async () => {
    const one = await makeEngine().evaluate({
      policy: validPolicy(),
      evaluation: missedEvaluation(),
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-step-count",
      nowMs: NOW_MS,
    });
    const two = await makeEngine().evaluate({
      policy: validPolicy(),
      evaluation: missedEvaluation(),
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-step-count",
      nowMs: NOW_MS,
    });
    expect(enforcementDecisionDigest(one)).toBe(enforcementDecisionDigest(two));
    expect(one).toEqual(two);
  });

  it("degradation decisions are deterministic too (no-policy path, twice)", async () => {
    const one = await evaluate({ policy: null });
    const two = await evaluate({ policy: null });
    expect(enforcementDecisionDigest(one)).toBe(enforcementDecisionDigest(two));
  });
});
