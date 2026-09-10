import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import { parsePersonId, parsePlanId, parseIntentId } from "./ids.js";
import {
  INTENT_STATE_TRANSITIONS,
  allowedIntentTransitions,
  assertHealthIntent,
  assertIntentTransition,
  canTransitionIntent,
  isEvidencePackVersion,
  isHealthIntent,
  isIntentState,
  parseEvidencePackVersion,
  parseIntentState,
  type HealthIntent,
} from "./intent.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

describe("intent state machine", () => {
  it("allows the legal grammar draft -> active -> (paused <-> active) -> achieved | retired", () => {
    expect(canTransitionIntent("draft", "active")).toBe(true);
    expect(canTransitionIntent("active", "paused")).toBe(true);
    expect(canTransitionIntent("paused", "active")).toBe(true);
    expect(canTransitionIntent("active", "achieved")).toBe(true);
    expect(canTransitionIntent("active", "retired")).toBe(true);
  });

  it("asserts legal transitions without throwing", () => {
    expect(() => assertIntentTransition("draft", "active")).not.toThrow();
    expect(() => assertIntentTransition("active", "paused")).not.toThrow();
    expect(() => assertIntentTransition("paused", "active")).not.toThrow();
    expect(() => assertIntentTransition("active", "achieved")).not.toThrow();
    expect(() => assertIntentTransition("active", "retired")).not.toThrow();
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionIntent("draft", "paused")).toBe(false);
    expect(canTransitionIntent("draft", "achieved")).toBe(false);
    expect(canTransitionIntent("draft", "retired")).toBe(false);
    expect(canTransitionIntent("paused", "achieved")).toBe(false);
    expect(canTransitionIntent("paused", "retired")).toBe(false);
    expect(canTransitionIntent("active", "draft")).toBe(false);
    expect(() => assertIntentTransition("draft", "paused")).toThrow(DomainInvariantError);
    expect(() => assertIntentTransition("paused", "retired")).toThrow(DomainInvariantError);
  });

  it("treats achieved and retired as terminal", () => {
    expect(allowedIntentTransitions("achieved")).toEqual([]);
    expect(allowedIntentTransitions("retired")).toEqual([]);
    expect(INTENT_STATE_TRANSITIONS.achieved).toEqual([]);
    expect(INTENT_STATE_TRANSITIONS.retired).toEqual([]);
    expect(() => assertIntentTransition("achieved", "active")).toThrow(DomainInvariantError);
    expect(() => assertIntentTransition("retired", "active")).toThrow(DomainInvariantError);
  });

  it("rejects self-loops", () => {
    expect(canTransitionIntent("active", "active")).toBe(false);
    expect(() => assertIntentTransition("active", "active")).toThrow(DomainInvariantError);
  });

  it("parses legal states and rejects unknown state names", () => {
    expect(parseIntentState("paused")).toBe("paused");
    expect(isIntentState("paused")).toBe(true);
    expect(isIntentState("sleeping")).toBe(false);
    expect(isIntentState(4)).toBe(false);
    expect(() => parseIntentState("sleeping")).toThrow(DomainInvariantError);
    expect(() => parseIntentState(null)).toThrow(DomainInvariantError);
  });

  it("accepts a well-formed HealthIntent with optional fields present", () => {
    const intent: HealthIntent = {
      id: parseIntentId(`intent_${BODY}`),
      personId: parsePersonId(`prsn_${BODY}`),
      objective: "Lower resting heart rate below 60 bpm",
      state: "active",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      evidencePackVersion: 3,
      planId: parsePlanId(`plan_${BODY}`),
    };
    expect(intent.state).toBe("active");
    expect(intent.evidencePackVersion).toBe(3);
  });

  it("accepts a minimal HealthIntent without optional fields", () => {
    const intent: HealthIntent = {
      id: parseIntentId(`intent_${BODY}`),
      personId: parsePersonId(`prsn_${BODY}`),
      objective: "Walk 8k steps daily",
      state: "draft",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    expect(intent.evidencePackVersion).toBeUndefined();
    expect(intent.planId).toBeUndefined();
  });
});

describe("evidence pack version (M1 gap review)", () => {
  it("accepts positive integers", () => {
    expect(isEvidencePackVersion(1)).toBe(true);
    expect(parseEvidencePackVersion(3)).toBe(3);
    expect(isEvidencePackVersion(1_000)).toBe(true);
  });

  it("rejects zero, negatives, non-integers, and non-numbers", () => {
    expect(isEvidencePackVersion(0)).toBe(false);
    expect(isEvidencePackVersion(-1)).toBe(false);
    expect(isEvidencePackVersion(1.5)).toBe(false);
    expect(isEvidencePackVersion("3")).toBe(false);
    expect(() => parseEvidencePackVersion(0)).toThrow(DomainInvariantError);
    expect(() => parseEvidencePackVersion(1.5)).toThrow(DomainInvariantError);
    expect(() => parseEvidencePackVersion(null)).toThrow(DomainInvariantError);
  });
});

describe("health intent structural guard (M1 gap review)", () => {
  it("accepts a well-formed intent with and without optional fields", () => {
    const intent: HealthIntent = {
      id: parseIntentId(`intent_${BODY}`),
      personId: parsePersonId(`prsn_${BODY}`),
      objective: "Lower resting heart rate below 60 bpm",
      state: "active",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      evidencePackVersion: 3,
      planId: parsePlanId(`plan_${BODY}`),
    };
    expect(isHealthIntent(intent)).toBe(true);
    expect(() => assertHealthIntent(intent)).not.toThrow();

    const minimal: HealthIntent = {
      id: parseIntentId(`intent_${BODY}`),
      personId: parsePersonId(`prsn_${BODY}`),
      objective: "Walk 8k steps daily",
      state: "draft",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    expect(isHealthIntent(minimal)).toBe(true);
  });

  it("rejects malformed ids, empty objectives, illegal states, bad dates, and bad optional fields", () => {
    expect(isHealthIntent(null)).toBe(false);
    expect(
      isHealthIntent({ ...minimalIntent(), id: "not-an-intent-id" as unknown as HealthIntent["id"] }),
    ).toBe(false);
    expect(
      isHealthIntent({ ...minimalIntent(), personId: "intent_x" as unknown as HealthIntent["personId"] }),
    ).toBe(false);
    expect(isHealthIntent({ ...minimalIntent(), objective: "" })).toBe(false);
    expect(
      isHealthIntent({ ...minimalIntent(), state: "sleeping" as unknown as HealthIntent["state"] }),
    ).toBe(false);
    expect(isHealthIntent({ ...minimalIntent(), createdAt: new Date("not-a-date") })).toBe(false);
    expect(
      isHealthIntent({ ...minimalIntent(), evidencePackVersion: 0 as unknown as number }),
    ).toBe(false);
    expect(
      isHealthIntent({ ...minimalIntent(), planId: "junk" as unknown as HealthIntent["planId"] }),
    ).toBe(false);
    expect(() => assertHealthIntent(null)).toThrow(DomainInvariantError);
    expect(() => assertHealthIntent({ ...minimalIntent(), objective: "" })).toThrow(
      DomainInvariantError,
    );
    expect(
      () => assertHealthIntent({ ...minimalIntent(), evidencePackVersion: 0 as unknown as number }),
    ).toThrow(DomainInvariantError);
  });
});

function minimalIntent(): HealthIntent {
  return {
    id: parseIntentId(`intent_${BODY}`),
    personId: parsePersonId(`prsn_${BODY}`),
    objective: "Walk 8k steps daily",
    state: "draft",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
  };
}
