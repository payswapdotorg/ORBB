import { describe, expect, it } from "vitest";
import type { PersonId, PlanId, TaskId } from "@orbb/domain";
import {
  adherenceEvaluationDigest,
  evaluateAdherenceSnapshot,
  type AdherenceTaskSnapshot,
} from "./evaluation.js";

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const PLAN_ID = "plan_SYNTH-plan-0000001" as PlanId;
const TASK_ID = "task_SYNTHTASK000000000001" as TaskId;

/** UTC midnight boundary, 2026-09-16T00:00:00.000Z. */
const UTC_MIDNIGHT_MS = Date.parse("2026-09-16T00:00:00.000Z");
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

/**
 * A window ending EXACTLY at UTC midnight:
 * [2026-09-15T22:00:00.000Z, 2026-09-16T00:00:00.000Z).
 */
function midnightWindow() {
  return {
    sequence: 0,
    startsAt: new Date(UTC_MIDNIGHT_MS - TWO_HOURS_MS),
    endsAt: new Date(UTC_MIDNIGHT_MS),
  };
}

function snapshot(overrides?: {
  taskState?: "open" | "completed";
  rollCount?: number;
  completedAt?: Date;
  window?: ReturnType<typeof midnightWindow>;
}): AdherenceTaskSnapshot {
  const base = {
    taskId: TASK_ID,
    planId: PLAN_ID,
    personId: PERSON_ID,
    metricId: "SYNTH-metric-step-count",
    window: overrides?.window ?? midnightWindow(),
    taskState: overrides?.taskState ?? "open",
    rollCount: overrides?.rollCount ?? 0,
  };
  if (overrides?.completedAt !== undefined) {
    return { ...base, completedAt: overrides.completedAt };
  }
  return base;
}

function expectState(
  result: ReturnType<typeof evaluateAdherenceSnapshot>,
  state: string,
  reason: string,
): void {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`unexpected rejection: ${result.error.field}`);
  }
  expect(result.value.state).toBe(state);
  expect(result.value.reason).toBe(reason);
  expect(result.value.taskId).toBe(TASK_ID);
  expect(result.value.steps.length).toBeGreaterThan(0);
}

describe("evaluateAdherenceSnapshot — state transitions", () => {
  it("open task, window not yet elapsed => on-track / window-open", () => {
    const result = evaluateAdherenceSnapshot(snapshot(), UTC_MIDNIGHT_MS - 1);
    expectState(result, "on-track", "window-open");
  });

  it("open task, window elapsed EXACTLY at the UTC midnight boundary => missed", () => {
    const result = evaluateAdherenceSnapshot(snapshot(), UTC_MIDNIGHT_MS);
    expectState(result, "missed", "window-elapsed");
  });

  it("open task, window elapsed well past the boundary => missed", () => {
    const result = evaluateAdherenceSnapshot(snapshot(), UTC_MIDNIGHT_MS + 6 * TWO_HOURS_MS);
    expectState(result, "missed", "window-elapsed");
  });

  it("completed inside the window (due instant inclusive) => on-track / completed-in-window", () => {
    const result = evaluateAdherenceSnapshot(
      snapshot({ taskState: "completed", completedAt: new Date(UTC_MIDNIGHT_MS) }),
      UTC_MIDNIGHT_MS + 1,
    );
    expectState(result, "on-track", "completed-in-window");
  });

  it("completed one millisecond after the window end => recovered / completed-after-window", () => {
    const result = evaluateAdherenceSnapshot(
      snapshot({ taskState: "completed", completedAt: new Date(UTC_MIDNIGHT_MS + 1) }),
      UTC_MIDNIGHT_MS + 2,
    );
    expectState(result, "recovered", "completed-after-window");
  });

  it("completed after a roll-forward => recovered / completed-after-roll-forward", () => {
    // Rolled task: the CURRENT window is the next-day window, rollCount 1.
    const rolledWindow = {
      sequence: 12,
      startsAt: new Date(UTC_MIDNIGHT_MS + 22 * 3_600_000),
      endsAt: new Date(UTC_MIDNIGHT_MS + 24 * 3_600_000),
    };
    const result = evaluateAdherenceSnapshot(
      snapshot({
        taskState: "completed",
        rollCount: 1,
        completedAt: new Date(UTC_MIDNIGHT_MS + 23 * 3_600_000),
        window: rolledWindow,
      }),
      UTC_MIDNIGHT_MS + 25 * 3_600_000,
    );
    expectState(result, "recovered", "completed-after-roll-forward");
  });

  it("windows in progress mid-day are on-track until their end instant", () => {
    const window = {
      sequence: 3,
      startsAt: new Date(Date.parse("2026-09-16T08:00:00.000Z")),
      endsAt: new Date(Date.parse("2026-09-16T12:00:00.000Z")),
    };
    const during = evaluateAdherenceSnapshot(
      snapshot({ window }),
      Date.parse("2026-09-16T11:59:59.999Z"),
    );
    expectState(during, "on-track", "window-open");
    const after = evaluateAdherenceSnapshot(snapshot({ window }), Date.parse("2026-09-16T12:00:00.000Z"));
    expectState(after, "missed", "window-elapsed");
  });
});

describe("evaluateAdherenceSnapshot — determinism + replay", () => {
  it("identical (snapshot, nowMs) pairs produce identical evaluations (run twice)", () => {
    const one = evaluateAdherenceSnapshot(snapshot(), UTC_MIDNIGHT_MS);
    const two = evaluateAdherenceSnapshot(snapshot(), UTC_MIDNIGHT_MS);
    expect(one).toEqual(two);
    expect(
      one.ok && two.ok ? adherenceEvaluationDigest(one.value) === adherenceEvaluationDigest(two.value) : false,
    ).toBe(true);
  });

  it("the evaluation digest is stable across recomputation", () => {
    const one = evaluateAdherenceSnapshot(
      snapshot({ taskState: "completed", rollCount: 2, completedAt: new Date(UTC_MIDNIGHT_MS) }),
      UTC_MIDNIGHT_MS,
    );
    const two = evaluateAdherenceSnapshot(
      snapshot({ taskState: "completed", rollCount: 2, completedAt: new Date(UTC_MIDNIGHT_MS) }),
      UTC_MIDNIGHT_MS,
    );
    if (!one.ok || !two.ok) {
      throw new Error("unexpected rejection");
    }
    expect(adherenceEvaluationDigest(one.value)).toBe(adherenceEvaluationDigest(two.value));
    expect(adherenceEvaluationDigest(one.value)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("evaluateAdherenceSnapshot — validation (typed rejections, never throws)", () => {
  it("rejects malformed snapshots with PHID-safe field paths (table-driven)", () => {
    const base = () => snapshot();
    const invalid: readonly { name: string; build: () => unknown; field: string }[] = [
      { name: "bad task id", build: () => ({ ...base(), taskId: "junk" }), field: "taskId" },
      { name: "bad plan id", build: () => ({ ...base(), planId: "junk" }), field: "planId" },
      { name: "bad person id", build: () => ({ ...base(), personId: "junk" }), field: "personId" },
      { name: "empty metric id", build: () => ({ ...base(), metricId: "" }), field: "metricId" },
      {
        name: "inverted window bounds",
        build: () => ({
          ...base(),
          window: { sequence: 0, startsAt: new Date(UTC_MIDNIGHT_MS), endsAt: new Date(UTC_MIDNIGHT_MS - 1) },
        }),
        field: "window.bounds",
      },
      {
        name: "negative sequence",
        build: () => ({
          ...base(),
          window: { sequence: -1, startsAt: new Date(0), endsAt: new Date(1) },
        }),
        field: "window.sequence",
      },
      { name: "bad task state", build: () => ({ ...base(), taskState: "paused" }), field: "taskState" },
      { name: "negative roll count", build: () => ({ ...base(), rollCount: -1 }), field: "rollCount" },
      {
        name: "completed without completedAt",
        build: () => ({ ...base(), taskState: "completed" }),
        field: "completedAt",
      },
      {
        name: "open with completedAt",
        build: () => ({ ...base(), taskState: "open", completedAt: new Date(0) }),
        field: "completedAt.inconsistent",
      },
    ];
    for (const entry of invalid) {
      const result = evaluateAdherenceSnapshot(entry.build() as AdherenceTaskSnapshot, 1);
      expect(result.ok, entry.name).toBe(false);
      if (result.ok) {
        throw new Error("unreachable");
      }
      expect(result.error).toEqual({ kind: "invalid-snapshot", field: entry.field });
    }
  });

  it("rejects a non-finite decision instant", () => {
    const result = evaluateAdherenceSnapshot(snapshot(), Number.NaN);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({ kind: "invalid-snapshot", field: "nowMs" });
  });
});
