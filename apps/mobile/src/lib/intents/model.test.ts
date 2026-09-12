import { describe, expect, it } from "vitest";
import {
  INTENT_REGISTERED_SOURCES,
  approveIntentSession,
  buildSyntheticEvidencePack,
  composeObjectiveStatement,
  createIntentSession,
  evaluateSafetyOutcome,
  findGoalMetricOption,
  hasRegisteredSource,
  initialIntentIdCounters,
  methodsForMetric,
  rejectIntentSession,
  type IntentGoalView,
  type IntentIdCounters,
} from "./model";

/**
 * Mobile intent model contract tests (M6-A): the mirrored M5 pipeline —
 * determinism, burden order, no-source seam drops, safety outcomes, the
 * domain-transition mirror, and the session lifecycle (approve/reject).
 */

const NOW = new Date("2026-09-12T10:00:00.000Z");

const BP_GOAL: IntentGoalView = {
  metricId: "SYNTH-metric-bp-systolic",
  direction: "decrease",
  target: 120,
};

function create(
  goal: IntentGoalView = BP_GOAL,
  cadencePerDay = 1,
  methodPreference: "any" | "measured-only" = "any",
  counters: IntentIdCounters = initialIntentIdCounters(),
) {
  return createIntentSession({
    draftId: "SYNTH-DRAFT-mobile-0001",
    goal,
    constraints: { cadencePerDay, methodPreference },
    now: NOW,
    counters,
  });
}

describe("mobile intent model vocabulary", () => {
  it("derives goal options from the capture catalog with guards", () => {
    const systolic = findGoalMetricOption("SYNTH-metric-bp-systolic");
    expect(systolic?.conceptCode).toBe("SYNTH-8480-5");
    expect(systolic?.category).toBe("vital-signs");
    expect(systolic?.unit).toBe("mmHg");
  });

  it("registers the manual source only (seam display-only)", () => {
    expect(INTENT_REGISTERED_SOURCES).toHaveLength(1);
    expect(hasRegisteredSource("SYNTH-method-bpsys-manual")).toBe(true);
    expect(hasRegisteredSource("SYNTH-method-cuff-bp-panel")).toBe(false);
    expect(methodsForMetric("SYNTH-metric-bp-systolic")[0]?.kind).toBe("device");
  });

  it("builds a deterministic pack with label counts summing to counts", () => {
    const pack = buildSyntheticEvidencePack(NOW);
    expect(buildSyntheticEvidencePack(NOW)).toEqual(pack);
    for (const entry of pack.entries) {
      const labels = entry.qualityMix.byEvidenceLabel;
      expect(
        labels.MEASURED + labels.ESTIMATED + labels.IMPORTED + labels.DERIVED,
      ).toBe(entry.count);
    }
  });
});

describe("mobile compile mirror", () => {
  it("creates a session with the manual candidate and the seam drop audit", () => {
    const { session, counters } = create();
    expect(counters).toEqual({ intent: 1, entry: 1 });
    expect(session.intent.intentId).toBe("intent_SYNTH-intent-000001");
    expect(session.review.entryId).toBe("revq_SYNTH-000001");
    expect(session.review.state).toBe("pending");
    expect(session.review.candidate?.planId).toBe(
      "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
    );
    expect(session.review.candidate?.contributingEntries[0]?.count).toBe(12);
    expect(session.review.dropped).toEqual([
      expect.objectContaining({
        methodId: "SYNTH-method-cuff-bp-panel",
        reason: "no-source",
      }),
    ]);
    expect(session.review.safety?.kind).toBe("PASS");
    expect(session.review.burden?.burdenUnitsPerDay).toBe(3);
  });

  it("composes the objective statement", () => {
    expect(composeObjectiveStatement(BP_GOAL)).toBe(
      "Lower Blood Pressure Systolic toward 120 mmHg.",
    );
  });

  it("escalates weekly vital-signs cadence with reason codes", () => {
    const { session } = create(BP_GOAL, 1 / 7);
    expect(session.review.safety?.kind).toBe("ESCALATE");
    expect(session.review.safety?.reasonCodes).toEqual(["cadence-below-floor"]);
  });

  it("evaluates the safety mirror across PASS / ESCALATE / REJECT", () => {
    expect(
      evaluateSafetyOutcome({
        metricId: "SYNTH-metric-bp-systolic",
        domain: "vital-signs",
        cadencePerDay: 1,
      }).kind,
    ).toBe("PASS");
    expect(
      evaluateSafetyOutcome({
        metricId: "SYNTH-metric-bp-systolic",
        domain: "vital-signs",
        cadencePerDay: 1 / 7,
      }).kind,
    ).toBe("ESCALATE");
    expect(
      evaluateSafetyOutcome({
        metricId: "SYNTH-metric-sleep-minutes",
        domain: "sleep",
        cadencePerDay: 6,
      }).kind,
    ).toBe("REJECT");
  });
});

describe("mobile session lifecycle (the domain-transition mirror)", () => {
  it("approves with edits and publishes ONLY through the transition", () => {
    const { session } = create();
    const approved = approveIntentSession(
      session,
      { note: "good plan" },
      new Date("2026-09-12T11:00:00.000Z"),
    );
    expect(approved.review.state).toBe("approved");
    expect(approved.published?.state).toBe("published");
    expect(approved.published?.reviewerNote).toBe("good plan");
    expect(approved.published?.metrics).toEqual(["SYNTH-8480-5"]);
  });

  it("applies edited concept codes at approval", () => {
    const { session } = create();
    const approved = approveIntentSession(
      session,
      { metrics: ["SYNTH-8480-5", "SYNTH-8867-4"] },
      NOW,
    );
    expect(approved.published?.metrics).toEqual(["SYNTH-8480-5", "SYNTH-8867-4"]);
  });

  it("refuses approval after rejection (terminal) and empty edits", () => {
    const { session } = create();
    expect(() => approveIntentSession(session, { metrics: [] }, NOW)).toThrow();
    const rejected = rejectIntentSession(session, "not for me", NOW);
    expect(rejected.review.state).toBe("rejected");
    expect(rejected.rejectionReason).toBe("not for me");
    expect(() =>
      approveIntentSession(rejected, undefined, NOW),
    ).toThrow("pending");
    expect(() => rejectIntentSession(rejected, "again", NOW)).toThrow("pending");
  });

  it("refuses rejection without a reason", () => {
    const { session } = create();
    expect(() => rejectIntentSession(session, "   ", NOW)).toThrow();
  });

  it("numbers subsequent sessions with distinct creation-scoped ids", () => {
    const first = create();
    const second = create(BP_GOAL, 1, "any", first.counters);
    expect(second.session.intent.intentId).toBe("intent_SYNTH-intent-000002");
    expect(second.session.review.entryId).toBe("revq_SYNTH-000002");
  });
});
