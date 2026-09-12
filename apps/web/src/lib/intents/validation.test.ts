// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  INTENT_NOTE_MAX_LENGTH,
  validateIntentCreateRequest,
  validatePlanActRequest,
} from "./validation";

/**
 * Validation contract tests (M6-A): typed, deny-by-default request
 * validation with field-level issues that never echo values.
 */

const VALID_CREATE = {
  draftId: "SYNTH-DRAFT-abc123-def456",
  goal: { metricId: "SYNTH-metric-bp-systolic", direction: "decrease", target: 120 },
  constraints: { cadencePerDay: 1, methodPreference: "any" },
};

describe("validateIntentCreateRequest", () => {
  it("accepts a well-formed submission and rebuilds it defensively", () => {
    const result = validateIntentCreateRequest(VALID_CREATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.draftId).toBe(VALID_CREATE.draftId);
      expect(result.request.goal.target).toBe(120);
      expect(result.request.constraints.cadencePerDay).toBe(1);
    }
  });

  it("rejects non-object bodies with a body-level issue", () => {
    const result = validateIntentCreateRequest("nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.field).toBe("body");
    }
  });

  it("rejects draft-id grammar violations without echoing the value", () => {
    const result = validateIntentCreateRequest({
      ...VALID_CREATE,
      draftId: "not-a-draft-id",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.field === "draftId");
      expect(issue?.problem).toContain("SYNTH-DRAFT");
      expect(issue?.problem).not.toContain("not-a-draft-id");
    }
  });

  it("rejects unknown goal metrics and bad directions as field issues", () => {
    const result = validateIntentCreateRequest({
      ...VALID_CREATE,
      goal: { metricId: "SYNTH-metric-unknown", direction: "sideways", target: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.field)).toEqual(
        expect.arrayContaining(["goal.metricId", "goal.direction"]),
      );
    }
  });

  it("rejects out-of-guard targets with a guard-mentioning problem", () => {
    const result = validateIntentCreateRequest({
      ...VALID_CREATE,
      goal: { ...VALID_CREATE.goal, target: 9999 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.field === "goal.target");
      expect(issue?.problem).toContain("guards");
    }
  });

  it("rejects degenerate cadences and unknown preferences", () => {
    const result = validateIntentCreateRequest({
      ...VALID_CREATE,
      constraints: { cadencePerDay: 0, methodPreference: "whatever" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.field)).toEqual(
        expect.arrayContaining([
          "constraints.cadencePerDay",
          "constraints.methodPreference",
        ]),
      );
    }
  });
});

describe("validatePlanActRequest", () => {
  const VALID_APPROVE = {
    action: "approve-with-edits",
    entryId: "revq_SYNTH-000001",
    edits: { note: "tightened the cadence" },
  };

  it("accepts an approve-with-edits act", () => {
    const result = validatePlanActRequest(VALID_APPROVE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.action).toBe("approve-with-edits");
    }
  });

  it("accepts a reject act with a trimmed reason", () => {
    const result = validatePlanActRequest({
      action: "reject",
      entryId: "revq_SYNTH-000001",
      reason: "  too frequent for my mornings  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.request.action === "reject") {
      expect(result.request.reason).toBe("too frequent for my mornings");
    }
  });

  it("rejects a reject act without a reason", () => {
    const result = validatePlanActRequest({
      action: "reject",
      entryId: "revq_SYNTH-000001",
      reason: "   ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.field).toBe("reason");
    }
  });

  it("rejects unknown actions and malformed entry ids", () => {
    const badAction = validatePlanActRequest({
      action: "delete",
      entryId: "revq_SYNTH-000001",
    });
    expect(badAction.ok).toBe(false);

    const badEntry = validatePlanActRequest({
      action: "reject",
      entryId: "nope",
      reason: "reason",
    });
    expect(badEntry.ok).toBe(false);
  });

  it("rejects edited metrics that are not catalog concept codes", () => {
    const result = validatePlanActRequest({
      ...VALID_APPROVE,
      edits: { metrics: ["NOT-A-CODE"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.field).toBe("edits.metrics");
    }
  });

  it("rejects over-length notes (bounded audit surface)", () => {
    const result = validatePlanActRequest({
      ...VALID_APPROVE,
      edits: { note: "x".repeat(INTENT_NOTE_MAX_LENGTH + 1) },
    });
    expect(result.ok).toBe(false);
  });
});
