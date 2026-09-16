import { describe, expect, it } from "vitest";
import { createLogger, InMemorySink, type Logger } from "@orbb/observability";
import {
  IosFocusAdapter,
  SyntheticIosFocusNativeModule,
  type IosFocusCapabilityStatus,
} from "./ios-focus.js";
import {
  RESTRICTION_DECISION_KIND,
  type RestrictionDecision,
} from "./capabilities.js";
import type { PersonId, PlanId } from "@orbb/domain";

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const PLAN_ID = "plan_SYNTH-plan-0000001" as PlanId;

const NOW_MS = 1_789_000_000_000;
const DURATION_MS = 2 * 60 * 60 * 1_000;

const AVAILABLE: IosFocusCapabilityStatus = {
  screenTimeSupported: true,
  screenTimeEnabled: true,
  authorizationStatus: "authorized",
};

function decisionFixture(capability: "ios-focus" | "android-usage-access" = "ios-focus"): RestrictionDecision {
  return {
    kind: RESTRICTION_DECISION_KIND,
    decisionId: "b".repeat(64),
    policyId: "SYNTH-policy-evening-focus",
    policyVersion: 1,
    capability,
    authorization: {
      permission: `adherence:restrict:${capability}`,
      verifiedAtMs: NOW_MS,
    },
    evaluation: { state: "missed", reason: "window-elapsed" },
    scope: {
      personId: PERSON_ID,
      planId: PLAN_ID,
      metricId: "SYNTH-metric-step-count",
    },
    detection: { state: "available" },
    decidedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + DURATION_MS,
  };
}

function makeAdapter(options?: {
  status?: IosFocusCapabilityStatus;
  nowMs?: () => number;
  logger?: Logger;
  grantOnRequest?: boolean;
}): {
  adapter: IosFocusAdapter;
  native: SyntheticIosFocusNativeModule;
} {
  const native = new SyntheticIosFocusNativeModule({
    status: options?.status ?? AVAILABLE,
    grantOnRequest: options?.grantOnRequest ?? true,
  });
  const adapter = new IosFocusAdapter({
    native,
    logger: options?.logger ?? createLogger(undefined, { sink: new InMemorySink() }),
    nowMs: options?.nowMs ?? (() => NOW_MS),
  });
  return { adapter, native };
}

describe("IosFocusAdapter.detect", () => {
  it("reports unavailable when Screen Time is unsupported on the OS", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, screenTimeSupported: false },
    });
    await expect(adapter.detect()).resolves.toEqual({
      state: "unavailable",
      reason: "screen-time-unsupported",
    });
  });

  it("reports needs-permission when authorization is notDetermined", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, authorizationStatus: "notDetermined" },
    });
    await expect(adapter.detect()).resolves.toEqual({
      state: "needs-permission",
      reason: "focus-authorization-not-determined",
    });
  });

  it("reports needs-permission when authorization was denied", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, authorizationStatus: "denied" },
    });
    await expect(adapter.detect()).resolves.toEqual({
      state: "needs-permission",
      reason: "focus-authorization-denied",
    });
  });

  it("reports needs-config when Screen Time is disabled in Settings", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, screenTimeEnabled: false },
    });
    await expect(adapter.detect()).resolves.toEqual({
      state: "needs-config",
      reason: "screen-time-disabled",
    });
  });

  it("reports available when supported, enabled, and authorized", async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.detect()).resolves.toEqual({ state: "available" });
  });
});

describe("IosFocusAdapter.requestAuthorization (explicit UX flow)", () => {
  it("models a grant and flips detection to available", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, authorizationStatus: "notDetermined" },
    });
    await expect(adapter.requestAuthorization()).resolves.toBe(true);
    await expect(adapter.detect()).resolves.toEqual({ state: "available" });
  });

  it("models a denial and keeps detection at needs-permission", async () => {
    const { adapter } = makeAdapter({
      status: { ...AVAILABLE, authorizationStatus: "notDetermined" },
      grantOnRequest: false,
    });
    await expect(adapter.requestAuthorization()).resolves.toBe(false);
    await expect(adapter.detect()).resolves.toEqual({
      state: "needs-permission",
      reason: "focus-authorization-denied",
    });
  });
});

describe("IosFocusAdapter.invokeRestriction (typed invocation contract)", () => {
  it("applies the authorized shield via the native double", async () => {
    const { adapter, native } = makeAdapter();
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.social", "SYNTH-com.example.game"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.capability).toBe("ios-focus");
    expect(result.value.policyId).toBe("SYNTH-policy-evening-focus");
    expect(result.value.appIds).toEqual(["SYNTH-com.example.social", "SYNTH-com.example.game"]);
    expect(result.value.expiresAtMs).toBe(NOW_MS + DURATION_MS);
    expect(native.shieldCalls).toHaveLength(1);
    expect(native.shieldCalls[0]?.appBundleIds).toEqual([
      "SYNTH-com.example.social",
      "SYNTH-com.example.game",
    ]);
    expect(native.shieldCalls[0]?.untilMs).toBe(NOW_MS + DURATION_MS);
  });

  it("REFUSES a forged decision token (no policy decision => no restriction)", async () => {
    const { adapter, native } = makeAdapter();
    const forgeries: unknown[] = [
      undefined,
      null,
      "token",
      {},
      { ...decisionFixture(), kind: "wrong" },
      { ...decisionFixture(), decisionId: "" },
      { ...decisionFixture(), authorization: { permission: "", verifiedAtMs: NOW_MS } },
    ];
    for (const forged of forgeries) {
      const result = await adapter.invokeRestriction({
        decision: forged as RestrictionDecision,
        target: { appIds: ["SYNTH-com.example.social"] },
      });
      expect(result.ok, `forgery ${JSON.stringify(String(forged))}`).toBe(false);
      if (result.ok) {
        throw new Error("unreachable");
      }
      expect(result.error.kind).toBe("decision-invalid");
    }
    expect(native.shieldCalls).toHaveLength(0);
  });

  it("refuses a decision minted for another capability", async () => {
    const { adapter, native } = makeAdapter();
    const result = await adapter.invokeRestriction({
      decision: decisionFixture("android-usage-access"),
      target: { appIds: ["SYNTH-com.example.social"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({
      kind: "capability-mismatch",
      expected: "ios-focus",
      received: "android-usage-access",
    });
    expect(native.shieldCalls).toHaveLength(0);
  });

  it("refuses an expired decision (point-in-time tokens only)", async () => {
    const { adapter, native } = makeAdapter({ nowMs: () => NOW_MS + DURATION_MS + 1 });
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.social"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe("decision-expired");
    expect(native.shieldCalls).toHaveLength(0);
  });

  it("gracefully degrades (typed rejection) when the capability is unavailable", async () => {
    const { adapter, native } = makeAdapter({
      status: { ...AVAILABLE, screenTimeEnabled: false },
    });
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.social"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({
      kind: "capability-unavailable",
      detection: { state: "needs-config", reason: "screen-time-disabled" },
    });
    expect(native.shieldCalls).toHaveLength(0);
  });

  it("refuses an invalid target (empty or malformed app ids)", async () => {
    const { adapter, native } = makeAdapter();
    const badTargets: readonly unknown[] = [[], [""], ["ok", ""], "not-an-array"];
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
    expect(native.shieldCalls).toHaveLength(0);
  });

  it("converts a native failure into a typed native-error (never a throw)", async () => {
    const { adapter, native } = makeAdapter();
    native.failNextApply();
    const result = await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.social"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe("native-error");
  });

  it("logs the auditable invocation event (ids PHI-redacted per the observability contract)", async () => {
    const sink = new InMemorySink();
    const { adapter } = makeAdapter({
      logger: createLogger(undefined, { sink, nowMs: () => NOW_MS }),
    });
    await adapter.invokeRestriction({
      decision: decisionFixture(),
      target: { appIds: ["SYNTH-com.example.social"] },
    });
    expect(sink.records.length).toBeGreaterThan(0);
    const applied = sink.records.find(
      (record) => record["event"] === "adherence.ios-focus.restriction.applied",
    );
    // The typed invocation record carries the audit; the LOG survives the
    // deny-by-default redaction policy only for allow-listed shapes
    // (counts/durations). decisionId redacts exactly like personId does in
    // the health seam — the PHI-safe observability contract.
    expect(applied).toBeDefined();
    expect(applied?.["appCount"]).toBe(1);
    expect(applied?.["expiresAtMs"]).toBe(NOW_MS + DURATION_MS);
    expect(applied?.["decisionId"]).toBe("[REDACTED]");
  });
});

describe("IosFocusAdapter.releaseRestriction (recovery direction)", () => {
  it("lifts the shield and returns an auditable record", async () => {
    const { adapter, native } = makeAdapter();
    const result = await adapter.releaseRestriction({ decisionId: "b".repeat(64) });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.decisionId).toBe("b".repeat(64));
    expect(result.value.releasedAtMs).toBe(NOW_MS);
    expect(native.removeCalls).toBe(1);
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
