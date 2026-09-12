// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  actOnReviewEntry,
  applyPlanTransitionMirror,
  createIntentRecord,
  findIntentByDraftId,
  listAuditTrail,
  listIntents,
  listPendingReviews,
  listPublishedPlans,
  resetIntentStore,
} from "./store";

/**
 * Store contract tests (M6-A): idempotent creation by client draft id,
 * the domain-transition mirror's legality table, publication ONLY through
 * the approve path, once-only acts, and the append-only audit trail.
 */

afterEach(() => {
  resetIntentStore();
});

const NOW = new Date("2026-09-12T10:00:00.000Z");
const LATER = new Date("2026-09-12T11:00:00.000Z");

function create(draftId: string, cadencePerDay = 1) {
  return createIntentRecord({
    draftId,
    goal: {
      metricId: "SYNTH-metric-bp-systolic",
      direction: "decrease",
      target: 120,
    },
    constraints: { cadencePerDay, methodPreference: "any" },
    now: NOW,
  });
}

describe("intent creation (idempotent by draft id)", () => {
  it("creates one intent + one pending review entry + one enqueue audit record", () => {
    const stored = create("SYNTH-DRAFT-alpha-0001");
    expect(stored.intent.intentId).toBe("intent_SYNTH-intent-000001");
    expect(stored.review.entry.entryId).toBe("revq_SYNTH-000001");
    expect(stored.review.entry.state).toBe("pending");
    expect(stored.review.entry.candidate?.planId).toBe(
      "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
    );
    expect(stored.review.entry.safety?.kind).toBe("PASS");
    expect(stored.review.entry.burden?.burdenUnitsPerDay).toBe(3);
    expect(listAuditTrail()).toHaveLength(1);
    expect(listAuditTrail()[0]?.kind).toBe("enqueued");
  });

  it("replays the SAME stored result for a repeated draft id (no duplicates)", () => {
    const first = create("SYNTH-DRAFT-alpha-0001");
    const second = create("SYNTH-DRAFT-alpha-0001");
    expect(second).toEqual(first);
    expect(listIntents()).toHaveLength(1);
    expect(listAuditTrail()).toHaveLength(1);
    expect(findIntentByDraftId("SYNTH-DRAFT-alpha-0001")?.intent.intentId).toBe(
      first.intent.intentId,
    );
  });

  it("numbers subsequent intents and entries with distinct creation-scoped ids", () => {
    create("SYNTH-DRAFT-alpha-0001");
    const second = create("SYNTH-DRAFT-beta-0002");
    expect(second.intent.intentId).toBe("intent_SYNTH-intent-000002");
    expect(second.review.entry.entryId).toBe("revq_SYNTH-000002");
  });
});

describe("reviewer acts (the publication path)", () => {
  it("approves with edits: publishes through the domain transition only", () => {
    const stored = create("SYNTH-DRAFT-alpha-0001");
    const entryId = stored.review.entry.entryId;
    const outcome = actOnReviewEntry(
      {
        action: "approve-with-edits",
        entryId,
        edits: { note: "good plan" },
      },
      LATER,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.kind === "approved") {
      expect(outcome.plan.state).toBe("published");
      expect(outcome.plan.reviewerNote).toBe("good plan");
      expect(outcome.plan.metrics).toEqual(["SYNTH-8480-5"]);
      expect(listPublishedPlans()).toHaveLength(1);
      expect(listPendingReviews()).toHaveLength(0);
      const audit = listAuditTrail();
      expect(audit[1]?.kind).toBe("approved");
      if (audit[1]?.kind === "approved") {
        expect(audit[1].fromState).toBe("draft");
        expect(audit[1].toState).toBe("published");
        expect(audit[1].reviewerNote).toBe("good plan");
      }
    }
  });

  it("applies edited concept codes at approval (original vs published recorded)", () => {
    const stored = create("SYNTH-DRAFT-alpha-0001");
    const outcome = actOnReviewEntry(
      {
        action: "approve-with-edits",
        entryId: stored.review.entry.entryId,
        edits: { metrics: ["SYNTH-8480-5", "SYNTH-8867-4"] },
      },
      LATER,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.kind === "approved") {
      expect(outcome.plan.metrics).toEqual(["SYNTH-8480-5", "SYNTH-8867-4"]);
      const audit = listAuditTrail()[1];
      if (audit?.kind === "approved") {
        expect(audit.originalMetrics).toEqual(["SYNTH-8480-5"]);
        expect(audit.publishedMetrics).toEqual(["SYNTH-8480-5", "SYNTH-8867-4"]);
      }
    }
  });

  it("refuses unknown entries, terminal entries, and empty metric edits", () => {
    const unknown = actOnReviewEntry(
      { action: "reject", entryId: "revq_SYNTH-999999", reason: "nope" },
      LATER,
    );
    expect(unknown).toEqual({ ok: false, error: { kind: "unknown-entry" } });

    const stored = create("SYNTH-DRAFT-alpha-0001");
    const entryId = stored.review.entry.entryId;

    const badEdit = actOnReviewEntry(
      {
        action: "approve-with-edits",
        entryId,
        edits: { metrics: [] },
      },
      LATER,
    );
    expect(badEdit).toEqual({ ok: false, error: { kind: "invalid-edit" } });

    const reject = actOnReviewEntry(
      { action: "reject", entryId, reason: "not for me" },
      LATER,
    );
    expect(reject.ok).toBe(true);

    // Rejection is terminal; approval is once-only.
    const afterReject = actOnReviewEntry(
      { action: "approve-with-edits", entryId },
      LATER,
    );
    expect(afterReject).toEqual({
      ok: false,
      error: { kind: "entry-not-pending" },
    });
  });

  it("refuses approval when no executable candidate was proposed", () => {
    // Sleep metric with measured-only: no executable candidate.
    const stored = createIntentRecord({
      draftId: "SYNTH-DRAFT-gamma-0003",
      goal: {
        metricId: "SYNTH-metric-sleep-minutes",
        direction: "increase",
        target: 480,
      },
      constraints: { cadencePerDay: 1, methodPreference: "measured-only" },
      now: NOW,
    });
    expect(stored.review.entry.candidate).toBeNull();
    const outcome = actOnReviewEntry(
      {
        action: "approve-with-edits",
        entryId: stored.review.entry.entryId,
      },
      LATER,
    );
    expect(outcome).toEqual({ ok: false, error: { kind: "invalid-edit" } });
  });

  it("keeps the plan store empty until an approval lands", () => {
    create("SYNTH-DRAFT-alpha-0001");
    expect(listPublishedPlans()).toHaveLength(0);
    expect(listPendingReviews()).toHaveLength(1);
  });
});

describe("domain-transition mirror", () => {
  it("allows exactly the frozen plan-state machine", () => {
    const draft = { state: "draft" };
    expect(applyPlanTransitionMirror(draft, "published").state).toBe("published");
    expect(
      applyPlanTransitionMirror({ state: "published" }, "active").state,
    ).toBe("active");
    expect(
      applyPlanTransitionMirror({ state: "active" }, "completed").state,
    ).toBe("completed");
    expect(
      applyPlanTransitionMirror({ state: "active" }, "cancelled").state,
    ).toBe("cancelled");
  });

  it("throws on every illegal transition (the domain guard discipline)", () => {
    expect(() => applyPlanTransitionMirror({ state: "draft" }, "active")).toThrow();
    expect(() =>
      applyPlanTransitionMirror({ state: "published" }, "published"),
    ).toThrow();
    expect(() =>
      applyPlanTransitionMirror({ state: "completed" }, "published"),
    ).toThrow();
    expect(() => applyPlanTransitionMirror({ state: "cancelled" }, "active")).toThrow();
  });
});
