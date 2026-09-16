import { describe, expect, it } from "vitest";
import type { GrantId, PersonId, PlanId } from "@orbb/domain";
import {
  MAX_RESTRICTION_DURATION_MS,
  resolveAdherencePolicy,
  type AdherencePolicy,
} from "./policy.js";

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const OTHER_PERSON_ID = "prsn_SYNTH-person-000002" as PersonId;
const PLAN_ID = "plan_SYNTH-plan-0000001" as PlanId;
const GRANT_ID = "grant_SYNTHTGRANT00000001" as GrantId;

function validPolicy(): Record<string, unknown> {
  return {
    policyId: "SYNTH-policy-evening-focus",
    version: 4,
    capability: "ios-focus",
    triggerOn: "missed",
    authorization: {
      permissions: ["adherence:restrict:ios-focus"],
    },
    scope: {
      personIds: [PERSON_ID],
      planIds: [PLAN_ID],
    },
    restriction: {
      durationMs: 2 * 60 * 60 * 1_000,
    },
  };
}

describe("resolveAdherencePolicy — the enforceable path", () => {
  it("resolves a valid policy with every field echoed faithfully", () => {
    const resolved = resolveAdherencePolicy(validPolicy());
    expect(resolved.kind).toBe("enforceable");
    if (resolved.kind !== "enforceable") {
      throw new Error("unreachable");
    }
    expect(resolved.policy).toEqual({
      policyId: "SYNTH-policy-evening-focus",
      version: 4,
      capability: "ios-focus",
      triggerOn: "missed",
      authorization: { permissions: ["adherence:restrict:ios-focus"] },
      scope: { personIds: [PERSON_ID], planIds: [PLAN_ID] },
      restriction: { durationMs: 2 * 60 * 60 * 1_000 },
    });
  });

  it("resolves with a pinned grant id and metric scoping", () => {
    const resolved = resolveAdherencePolicy({
      ...validPolicy(),
      authorization: { permissions: ["adherence:restrict:android-usage-access"], grantId: GRANT_ID },
      capability: "android-usage-access",
      scope: { metricIds: ["SYNTH-metric-sleep-minutes"] },
    });
    expect(resolved.kind).toBe("enforceable");
    if (resolved.kind !== "enforceable") {
      throw new Error("unreachable");
    }
    expect(resolved.policy.authorization.grantId).toBe(GRANT_ID);
    expect(resolved.policy.scope.metricIds).toEqual(["SYNTH-metric-sleep-minutes"]);
  });

  it("accepts the maximum (24h) bounded restriction duration", () => {
    const resolved = resolveAdherencePolicy({
      ...validPolicy(),
      restriction: { durationMs: MAX_RESTRICTION_DURATION_MS },
    });
    expect(resolved.kind).toBe("enforceable");
  });
});

describe("resolveAdherencePolicy — absent policy => NO-ENFORCEMENT", () => {
  it("resolves absent values to no-enforcement (table-driven)", () => {
    for (const absent of [null, undefined]) {
      const resolved = resolveAdherencePolicy(absent);
      expect(resolved.kind, `absent ${String(absent)}`).toBe("no-enforcement");
      if (resolved.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(resolved.reason).toBe("absent");
    }
  });
});

describe("resolveAdherencePolicy — malformed policy => NO-ENFORCEMENT (fail-closed)", () => {
  it("rejects non-object shapes (table-driven)", () => {
    for (const malformed of ["", "{}", 42, true, [], [{ policyId: "x" }]]) {
      const resolved = resolveAdherencePolicy(malformed);
      expect(resolved.kind, `malformed ${JSON.stringify(malformed)}`).toBe("no-enforcement");
      if (resolved.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(resolved.reason).toBe("malformed");
    }
  });

  it("rejects empty or empty-ish objects with a field detail", () => {
    const resolved = resolveAdherencePolicy({});
    expect(resolved.kind).toBe("no-enforcement");
    if (resolved.kind !== "no-enforcement") {
      throw new Error("unreachable");
    }
    expect(resolved.reason).toBe("malformed");
    expect(resolved.detail?.field).toBe("policyId");
  });

  it("rejects bad scalar fields (table-driven, PHID-safe field details)", () => {
    const cases: readonly { name: string; overrides: Record<string, unknown>; field: string }[] = [
      { name: "empty policyId", overrides: { policyId: "" }, field: "policyId" },
      { name: "non-string policyId", overrides: { policyId: 7 }, field: "policyId" },
      { name: "zero version", overrides: { version: 0 }, field: "version" },
      { name: "fractional version", overrides: { version: 1.5 }, field: "version" },
      { name: "typo'd capability", overrides: { capability: "ios-focusx" }, field: "capability" },
      {
        name: "third-party capability",
        overrides: { capability: "notify-clinician" },
        field: "capability",
      },
      { name: "missing triggerOn", overrides: { triggerOn: undefined }, field: "triggerOn" },
      { name: "trigger on on-track", overrides: { triggerOn: "on-track" }, field: "triggerOn" },
      { name: "trigger on recovered", overrides: { triggerOn: "recovered" }, field: "triggerOn" },
    ];
    for (const entry of cases) {
      const resolved = resolveAdherencePolicy({ ...validPolicy(), ...entry.overrides });
      expect(resolved.kind, entry.name).toBe("no-enforcement");
      if (resolved.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(resolved.reason, entry.name).toBe("malformed");
      expect(resolved.detail?.field, entry.name).toBe(entry.field);
    }
  });

  it("rejects bad authorization blocks (table-driven)", () => {
    const cases: readonly { name: string; authorization: unknown }[] = [
      { name: "missing", authorization: undefined },
      { name: "not an object", authorization: "everyone" },
      { name: "empty permissions", authorization: { permissions: [] } },
      { name: "blank permission entry", authorization: { permissions: [""] } },
      { name: "non-string permission entry", authorization: { permissions: [1] } },
      { name: "invalid grant id", authorization: { permissions: ["adherence:restrict:ios-focus"], grantId: "junk" } },
      { name: "unknown nested field", authorization: { permissions: ["adherence:restrict:ios-focus"], escalation: true } },
    ];
    for (const entry of cases) {
      const resolved = resolveAdherencePolicy({ ...validPolicy(), authorization: entry.authorization });
      expect(resolved.kind, entry.name).toBe("no-enforcement");
      if (resolved.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(resolved.reason, entry.name).toBe("malformed");
    }
  });

  it("rejects bad scopes (table-driven): no catch-all, no junk ids", () => {
    const cases: readonly { name: string; scope: unknown }[] = [
      { name: "missing scope", scope: undefined },
      { name: "empty scope (catch-all)", scope: {} },
      { name: "empty person array", scope: { personIds: [] } },
      { name: "invalid person id", scope: { personIds: ["junk"] } },
      { name: "empty plan array", scope: { planIds: [] } },
      { name: "invalid plan id", scope: { planIds: [PERSON_ID] } },
      { name: "empty metric array", scope: { metricIds: [] } },
      { name: "blank metric id", scope: { metricIds: [""] } },
      { name: "unknown nested field", scope: { personIds: [PERSON_ID], everyone: true } },
    ];
    for (const entry of cases) {
      const resolved = resolveAdherencePolicy({ ...validPolicy(), scope: entry.scope });
      expect(resolved.kind, entry.name).toBe("no-enforcement");
      if (resolved.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(resolved.reason, entry.name).toBe("malformed");
    }
  });

  it("rejects bad restrictions (table-driven): bounded, positive, integer", () => {
    const cases: readonly { name: string; restriction: unknown }[] = [
      { name: "missing", restriction: undefined },
      { name: "zero duration", restriction: { durationMs: 0 } },
      { name: "negative duration", restriction: { durationMs: -1 } },
      { name: "fractional duration", restriction: { durationMs: 1.5 } },
      { name: "unbounded duration", restriction: { durationMs: MAX_RESTRICTION_DURATION_MS + 1 } },
      { name: "missing durationMs", restriction: {} },
      { name: "unknown nested field", restriction: { durationMs: 1_000, permanent: true } },
    ];
    for (const entry of cases) {
      const resolved = resolveAdherencePolicy({ ...validPolicy(), restriction: entry.restriction });
      expect(resolved.kind, entry.name).toBe("no-enforcement");
      if (resolved.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(resolved.reason, entry.name).toBe("malformed");
    }
  });

  it("rejects unknown TOP-LEVEL fields (strict allowlist — no vocabulary, no enforcement)", () => {
    for (const smuggled of [
      "penalty",
      "streakReset",
      "score",
      "escalationContact",
      "notifyClinician",
      "capabilityy",
    ]) {
      const resolved = resolveAdherencePolicy({ ...validPolicy(), [smuggled]: true });
      expect(resolved.kind, smuggled).toBe("no-enforcement");
      if (resolved.kind !== "no-enforcement") {
        throw new Error("unreachable");
      }
      expect(resolved.reason).toBe("malformed");
      expect(resolved.detail?.field).toBe(smuggled);
    }
  });

  it("resolution is deterministic (same raw policy, same outcome, twice)", () => {
    const raw = validPolicy();
    const one = resolveAdherencePolicy(raw);
    const two = resolveAdherencePolicy(validPolicy());
    expect(one).toEqual(two);
  });

  it("the enforceable policy type carries no punitive vocabulary (compile-time fixture)", () => {
    // Compile-time check (see vocabulary.test.ts for the full proof): a
    // punitive construct cannot even be TYPED as an AdherencePolicy.
    const policy: AdherencePolicy = {
      policyId: "SYNTH-policy-evening-focus",
      version: 1,
      capability: "ios-focus",
      triggerOn: "missed",
      authorization: { permissions: ["adherence:restrict:ios-focus"] },
      scope: { personIds: [OTHER_PERSON_ID] },
      restriction: { durationMs: 1_000 },
    };
    expect(policy.triggerOn).toBe("missed");
  });
});
