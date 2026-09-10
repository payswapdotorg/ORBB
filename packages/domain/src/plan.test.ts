import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import { parseIntentId, parsePersonId, parsePlanId } from "./ids.js";
import {
  PLAN_STATE_TRANSITIONS,
  allowedPlanTransitions,
  assertMeasurementPlan,
  assertPlanTransition,
  canTransitionPlan,
  isMeasurementPlan,
  isPlanState,
  parsePlanState,
  type MeasurementPlan,
} from "./plan.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

describe("plan state machine", () => {
  it("allows draft -> published -> active -> completed | cancelled", () => {
    expect(canTransitionPlan("draft", "published")).toBe(true);
    expect(canTransitionPlan("published", "active")).toBe(true);
    expect(canTransitionPlan("active", "completed")).toBe(true);
    expect(canTransitionPlan("active", "cancelled")).toBe(true);
    expect(() => assertPlanTransition("draft", "published")).not.toThrow();
    expect(() => assertPlanTransition("published", "active")).not.toThrow();
    expect(() => assertPlanTransition("active", "completed")).not.toThrow();
    expect(() => assertPlanTransition("active", "cancelled")).not.toThrow();
  });

  it("rejects transitions that skip states", () => {
    expect(canTransitionPlan("draft", "active")).toBe(false);
    expect(canTransitionPlan("draft", "completed")).toBe(false);
    expect(canTransitionPlan("published", "completed")).toBe(false);
    expect(canTransitionPlan("published", "cancelled")).toBe(false);
    expect(() => assertPlanTransition("draft", "active")).toThrow(DomainInvariantError);
    expect(() => assertPlanTransition("published", "cancelled")).toThrow(DomainInvariantError);
  });

  it("treats completed and cancelled as terminal", () => {
    expect(allowedPlanTransitions("completed")).toEqual([]);
    expect(allowedPlanTransitions("cancelled")).toEqual([]);
    expect(PLAN_STATE_TRANSITIONS.completed).toEqual([]);
    expect(PLAN_STATE_TRANSITIONS.cancelled).toEqual([]);
    expect(() => assertPlanTransition("completed", "active")).toThrow(DomainInvariantError);
    expect(() => assertPlanTransition("cancelled", "draft")).toThrow(DomainInvariantError);
  });

  it("rejects self-loops and backwards transitions", () => {
    expect(canTransitionPlan("active", "active")).toBe(false);
    expect(canTransitionPlan("active", "published")).toBe(false);
    expect(() => assertPlanTransition("active", "active")).toThrow(DomainInvariantError);
    expect(() => assertPlanTransition("active", "published")).toThrow(DomainInvariantError);
  });

  it("parses legal states and rejects unknown state names", () => {
    expect(parsePlanState("published")).toBe("published");
    expect(isPlanState("cancelled")).toBe(true);
    expect(isPlanState("archived")).toBe(false);
    expect(() => parsePlanState("archived")).toThrow(DomainInvariantError);
    expect(() => parsePlanState(undefined)).toThrow(DomainInvariantError);
  });

  it("accepts a well-formed MeasurementPlan", () => {
    const plan: MeasurementPlan = {
      id: parsePlanId(`plan_${BODY}`),
      personId: parsePersonId(`prsn_${BODY}`),
      intentId: parseIntentId(`intent_${BODY}`),
      state: "published",
      metrics: ["8867-4", "85354-9"],
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
    };
    expect(plan.state).toBe("published");
    expect(plan.metrics).toEqual(["8867-4", "85354-9"]);
  });
});

describe("measurement plan structural guard (M1 gap review)", () => {
  it("accepts a well-formed plan", () => {
    expect(isMeasurementPlan(minimalPlan())).toBe(true);
    expect(() => assertMeasurementPlan(minimalPlan())).not.toThrow();
  });

  it("rejects a plan with no metrics (a plan that measures nothing)", () => {
    const empty = { ...minimalPlan(), metrics: [] as string[] };
    expect(isMeasurementPlan(empty)).toBe(false);
    expect(() => assertMeasurementPlan(empty)).toThrow(DomainInvariantError);
  });

  it("rejects a plan with blank or non-string metric codes", () => {
    expect(isMeasurementPlan({ ...minimalPlan(), metrics: [""] })).toBe(false);
    expect(isMeasurementPlan({ ...minimalPlan(), metrics: ["8867-4", 42] })).toBe(false);
    expect(() => assertMeasurementPlan({ ...minimalPlan(), metrics: [""] })).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects malformed ids, illegal states, and bad dates", () => {
    expect(isMeasurementPlan(null)).toBe(false);
    expect(
      isMeasurementPlan({ ...minimalPlan(), id: "junk" as unknown as MeasurementPlan["id"] }),
    ).toBe(false);
    expect(
      isMeasurementPlan({ ...minimalPlan(), personId: "junk" as unknown as MeasurementPlan["personId"] }),
    ).toBe(false);
    expect(
      isMeasurementPlan({ ...minimalPlan(), intentId: "junk" as unknown as MeasurementPlan["intentId"] }),
    ).toBe(false);
    expect(
      isMeasurementPlan({ ...minimalPlan(), state: "archived" as unknown as MeasurementPlan["state"] }),
    ).toBe(false);
    expect(isMeasurementPlan({ ...minimalPlan(), createdAt: new Date("not-a-date") })).toBe(
      false,
    );
    expect(() => assertMeasurementPlan(null)).toThrow(DomainInvariantError);
  });
});

function minimalPlan(): MeasurementPlan {
  return {
    id: parsePlanId(`plan_${BODY}`),
    personId: parsePersonId(`prsn_${BODY}`),
    intentId: parseIntentId(`intent_${BODY}`),
    state: "draft",
    metrics: ["8867-4"],
    createdAt: new Date("2025-01-02T00:00:00.000Z"),
  };
}
