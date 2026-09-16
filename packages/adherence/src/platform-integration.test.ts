import { describe, expect, it } from "vitest";
import type { AccessGrant, GrantId, PersonId, PlanId, TaskId } from "@orbb/domain";
import { createLogger, InMemorySink } from "@orbb/observability";
import {
  AccessGrantAdherenceGate,
  ADHERENCE_CAPABILITY_IDS,
  ADHERENCE_STATES,
  CAPABILITY_DETECTION_STATES,
  RESTRICTION_DECISION_KIND,
  AdherenceEnforcementEngine,
  evaluateAdherenceSnapshot,
  type AdherenceCapabilityProber,
} from "./index.js";
import {
  ADHERENCE_CAPABILITY_IDS as PLATFORM_CAPABILITY_IDS,
  ADHERENCE_STATES as PLATFORM_ADHERENCE_STATES,
  AndroidUsageAccessAdapter,
  CAPABILITY_DETECTION_STATES as PLATFORM_DETECTION_STATES,
  IosFocusAdapter,
  RESTRICTION_DECISION_KIND as PLATFORM_DECISION_KIND,
  SyntheticAndroidUsageAccessNativeModule,
  SyntheticIosFocusNativeModule,
} from "@orbb/platform";

/**
 * CROSS-PACKAGE INTEGRATION (B10): the typed handoff between the
 * `@orbb/adherence` policy engine and the `@orbb/platform` capability
 * seams — proven end to end over the platform SYNTHETIC native doubles
 * (the M4-C discipline: no native calls, deterministic doubles).
 *
 * Everything asserted here is type-checked by the compiler first: the
 * engine's `RestrictionDecision` token, the engine-side prober, and the
 * platform mirror shapes are structurally compatible — no casts, no
 * `any`. That is the "drivable ONLY by the policy" proof by construction.
 */

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const PLAN_ID = "plan_SYNTH-plan-0000001" as PlanId;
const TASK_ID = "task_SYNTHTASK000000000001" as TaskId;
const GRANT_ID = "grant_SYNTHTGRANT00000001" as GrantId;

const NOW_MS = 1_789_000_000_000;
const DURATION_MS = 2 * 60 * 60 * 1_000;
const PERMISSION = "adherence:restrict:ios-focus";

const POLICY = {
  policyId: "SYNTH-policy-evening-focus",
  version: 1,
  capability: "ios-focus",
  triggerOn: "missed",
  authorization: { permissions: [PERMISSION], grantId: GRANT_ID },
  scope: { personIds: [PERSON_ID], planIds: [PLAN_ID], metricIds: ["SYNTH-metric-step-count"] },
  restriction: { durationMs: DURATION_MS },
};

const GRANT: AccessGrant = {
  id: GRANT_ID,
  subjectId: PERSON_ID,
  recipientId: "SYNTH-recipient-orbb-app",
  purpose: "SYNTH-SELF_MANAGEMENT",
  scope: [PERMISSION],
  state: "active",
  expiresAt: new Date(NOW_MS + 60_000),
};

/** A missed task: the window fully elapsed before the decision instant. */
function missedEvaluation() {
  const result = evaluateAdherenceSnapshot(
    {
      taskId: TASK_ID,
      planId: PLAN_ID,
      personId: PERSON_ID,
      metricId: "SYNTH-metric-step-count",
      window: {
        sequence: 7,
        startsAt: new Date(NOW_MS - 4 * 3_600_000),
        endsAt: new Date(NOW_MS - 2 * 3_600_000),
      },
      taskState: "open",
      rollCount: 0,
    },
    NOW_MS,
  );
  if (!result.ok) {
    throw new Error("unexpected rejection");
  }
  return result.value;
}

function engineInput() {
  return {
    policy: POLICY,
    evaluation: missedEvaluation(),
    personId: PERSON_ID,
    planId: PLAN_ID,
    metricId: "SYNTH-metric-step-count",
    nowMs: NOW_MS,
  };
}

function makeIosFocus(available: boolean) {
  const native = new SyntheticIosFocusNativeModule({
    status: available
      ? { screenTimeSupported: true, screenTimeEnabled: true, authorizationStatus: "authorized" }
      : { screenTimeSupported: false, screenTimeEnabled: true, authorizationStatus: "authorized" },
  });
  const adapter = new IosFocusAdapter({
    native,
    logger: createLogger(undefined, { sink: new InMemorySink(), nowMs: () => NOW_MS }),
    nowMs: () => NOW_MS,
  });
  return { adapter, native };
}

/** Wires the platform adapters into the engine's prober seam (no casts). */
function proberOf(
  iosAdapter: IosFocusAdapter,
  androidAdapter: AndroidUsageAccessAdapter,
): AdherenceCapabilityProber {
  return {
    detectionState: async (capability) =>
      capability === "ios-focus" ? iosAdapter.detect() : androidAdapter.detect(),
  };
}

describe("vocabulary mirrors stay in lockstep across the packages", () => {
  it("capability ids, states, detection states, and the decision discriminant match", () => {
    expect([...PLATFORM_CAPABILITY_IDS]).toEqual([...ADHERENCE_CAPABILITY_IDS]);
    expect([...PLATFORM_ADHERENCE_STATES]).toEqual([...ADHERENCE_STATES]);
    expect([...PLATFORM_DETECTION_STATES]).toEqual([...CAPABILITY_DETECTION_STATES]);
    expect(PLATFORM_DECISION_KIND).toBe(RESTRICTION_DECISION_KIND);
  });
});

describe("golden journey #7 (missed -> authorized restriction applied), end to end", () => {
  it("mints the token from a REAL access-grant gate and applies it through the iOS seam", async () => {
    const { adapter: iosAdapter, native } = makeIosFocus(true);
    const android = new AndroidUsageAccessAdapter({
      native: new SyntheticAndroidUsageAccessNativeModule(),
      logger: createLogger(undefined, { sink: new InMemorySink(), nowMs: () => NOW_MS }),
      nowMs: () => NOW_MS,
    });
    // The REAL M1-shaped gate over the person's access grants.
    const gate = new AccessGrantAdherenceGate({
      grants: async () => [GRANT],
      nowMs: () => NOW_MS,
    });
    const engine = new AdherenceEnforcementEngine({
      gate,
      prober: proberOf(iosAdapter, android),
    });

    const decision = await engine.evaluate(engineInput());
    expect(decision.kind).toBe("restriction-authorized");
    if (decision.kind !== "restriction-authorized") {
      throw new Error("unreachable");
    }
    // The token passes the platform forgery guard (typed handoff, no casts).
    const result = await iosAdapter.invokeRestriction({
      decision: decision.decision,
      target: { appIds: ["SYNTH-com.example.social", "SYNTH-com.example.game"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.decisionId).toBe(decision.decision.decisionId);
    expect(result.value.expiresAtMs).toBe(NOW_MS + DURATION_MS);
    expect(native.shieldCalls).toHaveLength(1);
    expect(native.shieldCalls[0]?.appBundleIds).toEqual([
      "SYNTH-com.example.social",
      "SYNTH-com.example.game",
    ]);
    expect(native.shieldCalls[0]?.untilMs).toBe(NOW_MS + DURATION_MS);
  });

  it("applies the android-usage-access seam under its own policy", async () => {
    const ios = makeIosFocus(true);
    const androidNative = new SyntheticAndroidUsageAccessNativeModule();
    const androidAdapter = new AndroidUsageAccessAdapter({
      native: androidNative,
      logger: createLogger(undefined, { sink: new InMemorySink(), nowMs: () => NOW_MS }),
      nowMs: () => NOW_MS,
    });
    const gate = new AccessGrantAdherenceGate({
      grants: async () => [{ ...GRANT, scope: ["adherence:restrict:android-usage-access"] }],
      nowMs: () => NOW_MS,
    });
    const engine = new AdherenceEnforcementEngine({
      gate,
      prober: proberOf(ios.adapter, androidAdapter),
    });
    const decision = await engine.evaluate({
      ...engineInput(),
      policy: {
        ...POLICY,
        capability: "android-usage-access",
        authorization: {
          permissions: ["adherence:restrict:android-usage-access"],
          grantId: GRANT_ID,
        },
      },
    });
    expect(decision.kind).toBe("restriction-authorized");
    if (decision.kind !== "restriction-authorized") {
      throw new Error("unreachable");
    }
    const result = await androidAdapter.invokeRestriction({
      decision: decision.decision,
      target: { appIds: ["SYNTH-com.example.feed"] },
    });
    expect(result.ok).toBe(true);
    expect(androidNative.timerCalls).toHaveLength(1);
    expect(androidNative.timerCalls[0]?.untilMs).toBe(NOW_MS + DURATION_MS);
  });
});

describe("graceful degrade to observe-only, end to end", () => {
  it("capability unavailable on the device => no-enforcement, NOTHING applied", async () => {
    const { adapter: iosAdapter, native } = makeIosFocus(false);
    const androidAdapter = new AndroidUsageAccessAdapter({
      native: new SyntheticAndroidUsageAccessNativeModule({
        status: { usageStatsSupported: false, usageAccessGranted: true, restrictionPolicyAvailable: true },
      }),
      logger: createLogger(undefined, { sink: new InMemorySink(), nowMs: () => NOW_MS }),
      nowMs: () => NOW_MS,
    });
    const gate = new AccessGrantAdherenceGate({
      grants: async () => [GRANT],
      nowMs: () => NOW_MS,
    });
    const engine = new AdherenceEnforcementEngine({
      gate,
      prober: proberOf(iosAdapter, androidAdapter),
    });
    const decision = await engine.evaluate(engineInput());
    expect(decision.kind).toBe("no-enforcement");
    if (decision.kind !== "no-enforcement") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("capability-unavailable");
    const detectionStep = decision.audit.steps.find(
      (step) => step.step === "capability-detection",
    );
    expect(detectionStep?.detail).toContain("state=unavailable");
    // Observe-only: the adherence state is recorded, nothing restrictive happened.
    expect(decision.evaluation.state).toBe("missed");
    expect(native.shieldCalls).toHaveLength(0);
  });
});

describe("configured but unauthorized, end to end", () => {
  it("a revoked grant => typed refusal with an audit record, NOTHING applied", async () => {
    const { adapter: iosAdapter, native } = makeIosFocus(true);
    const androidAdapter = new AndroidUsageAccessAdapter({
      native: new SyntheticAndroidUsageAccessNativeModule(),
      logger: createLogger(undefined, { sink: new InMemorySink(), nowMs: () => NOW_MS }),
      nowMs: () => NOW_MS,
    });
    const gate = new AccessGrantAdherenceGate({
      grants: async () => [{ ...GRANT, state: "revoked" }],
      nowMs: () => NOW_MS,
    });
    const engine = new AdherenceEnforcementEngine({
      gate,
      prober: proberOf(iosAdapter, androidAdapter),
    });
    const decision = await engine.evaluate(engineInput());
    expect(decision.kind).toBe("enforcement-refused");
    if (decision.kind !== "enforcement-refused") {
      throw new Error("unreachable");
    }
    expect(decision.reason).toBe("not-authorized");
    expect(decision.evaluation.state).toBe("missed");
    expect(native.shieldCalls).toHaveLength(0);
  });
});
