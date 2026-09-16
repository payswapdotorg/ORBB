import { describe, expect, it } from "vitest";
import { createLogger, InMemorySink } from "@orbb/observability";
import type { PersonId, PlanId } from "@orbb/domain";
import {
  AndroidUsageAccessAdapter,
  SyntheticAndroidUsageAccessNativeModule,
  type AndroidUsageAccessStatus,
} from "./android-usage.js";
import { RESTRICTION_DECISION_KIND, type RestrictionDecision } from "./capabilities.js";

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const PLAN_ID = "plan_SYNTH-plan-0000001" as PlanId;

const NOW_MS = 1_789_000_000_000;
const DURATION_MS = 90 * 60 * 1_000;

const AVAILABLE: AndroidUsageAccessStatus = {
  usageStatsSupported: true,
  usageAccessGranted: true,
  restrictionPolicyAvailable: true,
};

function decisionFixture(
  capability: "ios-focus" | "android-usage-access" = "android-usage-access",
): RestrictionDecision {
  return {
    kind: RESTRICTION_DECISION_KIND,
    decisionId: "c".repeat(64),
    policyId: "SYNTH-policy-usage-guard",
    policyVersion: 2,
    capability,
    authorization: {
      permission: `adherence:restrict:${capability}`,
      verifiedAtMs: NOW_MS,
    },
    evaluation: { state: "missed", reason: "window-elapsed" },
    scope: {
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-sleep-minutes",
    },
    detection: { state: "available" },
    decidedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + DURATION_MS,
  };
}

function makeAdapter(options?: {
  status?: AndroidUsageAccessStatus;
  nowMs?: () => number;
  grantOnRequest?: boolean;
}): {
  adapter: AndroidUsageAccessAdapter;
  native: SyntheticAndroidUsageAccessNativeModule;
} {
  const native = new SyntheticAndroidUsageAccessNativeModule({
    status: options?.status ?? AVAILABLE,
    grantOnRequest: options?.grantOnRequest ?? true,
  });
  const adapter = new AndroidUsageAccessAdapter({
    native,
    logger: createLogger(undefined, { sink: new InMemorySink(), nowMs: () => NOW_MS }),
    nowMs: options?.nowMs ?? (() => NOW_MS),
  });
  return { adapter, native };
}

describe("AndroidUsageAccessAdapter.detect", () => {
  it("reports unavailable when usage stats are unsupported on the OS", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, usageStatsSupported: false },
    });
    await expect(adapter.detect()).resolves.toEqual({
      state: "unavailable",
      reason: "usage-stats-unsupported",
    });
  });

  it("reports needs-permission when usage access is not granted", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, usageAccessGranted: false },
    });
    await expect(adapter.detect()).resolves.toEqual({
      state: "needs-permission",
      reason: "usage-access-not-granted",
    });
  });

  it("reports needs-config when the restriction policy surface is missing", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, restrictionPolicyAvailable: false },
    });
    await expect(adapter.detect()).resolves.toEqual({
      state: "needs-config",
      reason: "restriction-policy-unavailable",
    });
  });

  it("reports available when supported, granted, and policy-backed", async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.detect()).resolves.toEqual({ state: "available" });
  });
});

describe("AndroidUsageAccessAdapter.requestUsageAccess (explicit UX flow)", () => {
  it("models a grant and flips detection to available", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, usageAccessGranted: false },
    });
    await expect(adapter.requestUsageAccess()).resolves.toBe(true);
    await expect(adapter.detect()).resolves.toEqual({ state: "available" });
  });

  it("models a denial and keeps detection at needs-permission", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, usageAccessGranted: false },
      grantOnRequest: false,
    });
    await expect(adapter.requestUsageAccess()).resolves.toBe(false);
    await expect(adapter.detect()).resolves.toEqual({
      state: "needs-permission",
      reason: "usage-access-not-granted",
    });
  });
});

describe("AndroidUsageAccessAdapter.invokeRestriction (typed invocation contract)", () => {
  it("applies the authorized app timers via the native double", async () => {
    const { adapter, native } = makeAdapter();
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.feed"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.capability).toBe("android-usage-access");
    expect(result.value.policyId).toBe("SYNTH-policy-usage-guard");
    expect(result.value.appIds).toEqual(["SYNTH-com.example.feed"]);
    expect(result.value.expiresAtMs).toBe(NOW_MS + DURATION_MS);
    expect(native.timerCalls).toHaveLength(1);
    expect(native.timerCalls[0]?.appPackages).toEqual(["SYNTH-com.example.feed"]);
    expect(native.timerCalls[0]?.untilMs).toBe(NOW_MS + DURATION_MS);
  });

  it("REFUSES a forged decision token (no policy decision => no restriction)", async () => {
    const { adapter, native } = makeAdapter();
    const forgeries: unknown[] = [
      undefined,
      null,
      "token",
      {},
      { ...decisionFixture(), kind: "wrong" },
      { ...decisionFixture(), scope: { personId: "junk", planId: "junk", metricId: "m" } },
    ];
    for (const forged of forgeries) {
      const result = await adapter.invokeRestriction({
        decision: forged as RestrictionDecision,
        target: { appIds: ["SYNTH-com.example.feed"] },
      });
      expect(result.ok, `forgery ${JSON.stringify(String(forged))}`).toBe(false);
      if (result.ok) {
        throw new Error("unreachable");
      }
      expect(result.error.kind).toBe("decision-invalid");
    }
    expect(native.timerCalls).toHaveLength(0);
  });

  it("refuses a decision minted for another capability", async () => {
    const { adapter, native } = makeAdapter();
    const result = await adapter.invokeRestriction({
      decision: decisionFixture("ios-focus"),
      target: { appIds: ["SYNTH-com.example.feed"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({
      kind: "capability-mismatch",
      expected: "android-usage-access",
      received: "ios-focus",
    });
    expect(native.timerCalls).toHaveLength(0);
  });

  it("refuses an expired decision (point-in-time tokens only)", async () => {
    const { adapter, native } = makeAdapter({ nowMs: () => NOW_MS + DURATION_MS });
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.feed"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe("decision-expired");
    expect(native.timerCalls).toHaveLength(0);
  });

  it("gracefully degrades (typed rejection) when the capability needs config", async () => {
    const { adapter, native } = makeAdapter({
      status: { ...AVAILABLE, restrictionPolicyAvailable: false },
    });
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.feed"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({
      kind: "capability-unavailable",
      detection: { state: "needs-config", reason: "restriction-policy-unavailable" },
    });
    expect(native.timerCalls).toHaveLength(0);
  });

  it("refuses an invalid target (empty or malformed app ids)", async () => {
    const { adapter, native } = makeAdapter();
    const badTargets: readonly unknown[] = [[], [""], ["ok", ""], 42];
    for (const appIds of badTargets) {
      const result = await adapter.invokeRestriction({
        decision: decisionFixture(),
        target: { appIds: appIds as string[] },
      });
      expect(result.ok, `target ${JSON.stringify(appIds)}`).toBe(false);
      if (result.ok) {
        throw new Error("unreachable");
      }
      expect(result.error.kind).toBe("invalid-target");
    }
    expect(native.timerCalls).toHaveLength(0);
  });

  it("converts a native failure into a typed native-error (never a throw)", async () => {
    const { adapter, native } = makeAdapter();
    native.failNextApply();
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.feed"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe("native-error");
  });
});

describe("AndroidUsageAccessAdapter.releaseRestriction (recovery direction)", () => {
  it("lifts the timers and returns an auditable record", async () => {
    const { adapter, native } = makeAdapter();
    const result = await adapter.releaseRestriction({ decisionId: "c".repeat(64) });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.decisionId).toBe("c".repeat(64));
    expect(result.value.releasedAtMs).toBe(NOW_MS);
    expect(native.clearCalls).toBe(1);
  });

  it("refuses an empty decision id", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.releaseRestriction({ decisionId: "" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({ kind: "decision-invalid", detail: "decisionId" });
  });
});
