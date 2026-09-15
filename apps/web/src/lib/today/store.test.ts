import { afterEach, describe, expect, it } from "vitest";
import { resetCaptureStore, storeCapture } from "../capture/store";
import type { CaptureSubmission } from "../capture/types";
import {
  TODAY_FALLBACK,
  TODAY_INTENT_FIXTURES,
  TODAY_METHOD_LANDSCAPES,
  assertTodayCatalogInvariants,
} from "./catalog";
import {
  TODAY_TASK_BP_ID,
  TODAY_TASK_HR_ID,
  TODAY_TASK_SLEEP_ID,
  TODAY_TASK_WEIGHT_ID,
  completeTodayTask,
  dueWindowLabel,
  listTodayIntents,
  listTodayTasks,
  resetTodayStore,
  todayProgressOf,
} from "./store";
import type { MeasurementTask } from "@orbb/measurement";
import type { TodayTaskRecord } from "./types";

/**
 * Today-surface catalog + store contract tests (M6-B B4): fixture
 * invariants (SYNTH marking, least-burden-first ordering), deterministic
 * seeding (due-today / missed-window / two-method / completed), the
 * open -> completed transition, and conservative per-intent progress.
 */

const NOW = new Date("2025-09-15T14:00:00.000");

function submission(overrides: Partial<CaptureSubmission> = {}): CaptureSubmission {
  return {
    shapeId: "SYNTH-shape-bp-panel",
    methodOptionId: "SYNTH-method-manual-bp-panel",
    fieldValues: { systolic: 118, diastolic: 76 },
    qualityState: "complete",
    capturedAtIso: "2025-09-15T08:30:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  resetTodayStore();
  resetCaptureStore();
});

describe("today catalog invariants", () => {
  it("passes the catalog invariants (SYNTH marking, burden order, fallback)", () => {
    expect(() => assertTodayCatalogInvariants()).not.toThrow();
  });

  it("seeds four active intents with plan ids in the canonical grammar", () => {
    expect(TODAY_INTENT_FIXTURES).toHaveLength(4);
    for (const fixture of TODAY_INTENT_FIXTURES) {
      expect(fixture.intentId.startsWith("intent_SYNTH-")).toBe(true);
      expect(fixture.planId.startsWith("plan_SYNTH-")).toBe(true);
      expect(fixture.planState).toBe("active");
    }
  });

  it("orders every method landscape least-burden first", () => {
    for (const methods of Object.values(TODAY_METHOD_LANDSCAPES)) {
      const burdens = methods.map((method) => method.relativeBurden);
      expect([...burdens].sort((a, b) => a - b)).toEqual(burdens);
    }
  });

  it("carries the clinic/CHW fallback vocabulary from the SYNTH catalog", () => {
    expect(TODAY_FALLBACK.providers).toContain("SYNTH-Clinic-A");
    expect(TODAY_FALLBACK.providers).toContain("SYNTH-CHW-2");
    expect(TODAY_FALLBACK.label).toBe("Clinic/CHW fallback");
  });
});

describe("today store: deterministic seed", () => {
  it("seeds the four fixture tasks (due-today x2, missed window, completed)", () => {
    const tasks = listTodayTasks(NOW);
    expect(tasks).toHaveLength(4);

    const bp = tasks.find((task) => task.taskId === TODAY_TASK_BP_ID);
    const hr = tasks.find((task) => task.taskId === TODAY_TASK_HR_ID);
    const weight = tasks.find((task) => task.taskId === TODAY_TASK_WEIGHT_ID);
    const sleep = tasks.find((task) => task.taskId === TODAY_TASK_SLEEP_ID);

    // Due-today BP: whole-day window, still open, due-by label.
    expect(bp?.state).toBe("open");
    expect(bp?.missedWindow).toBe(false);
    expect(bp?.dueWindowLabel).toBe("Due by end of today");
    expect(bp?.metricLabel).toBe("Blood Pressure Systolic");

    // Due-today HR: open, two methods, wearable FIRST (least burden).
    expect(hr?.state).toBe("open");
    expect(hr?.methodCountLabel).toBe("2 methods available");
    expect(hr?.methods[0]?.methodId).toBe("SYNTH-method-wearable-heart-rate");
    expect(hr?.methods[0]?.availability).toBe("available");
    expect(hr?.methods[1]?.methodId).toBe("SYNTH-method-manual-heart-rate");

    // Missed window weight: open, missed marker, fallback surfaced.
    expect(weight?.state).toBe("open");
    expect(weight?.missedWindow).toBe(true);
    expect(weight?.dueWindowLabel).toContain("Window missed — was due yesterday at 09:00");
    expect(weight?.fallback.providers).toContain("SYNTH-Clinic-A");

    // Completed sleep: completion link present, nothing-more-due copy.
    expect(sleep?.state).toBe("completed");
    expect(sleep?.completion?.captureId).toBe("SYNTH-CAP-SEED-SLEEP");
    expect(sleep?.completion?.observationIds).toEqual(["obs_SYNTH-obs-seed-sleep-0001"]);
  });

  it("places AVAILABLE methods before not-connected seams (never the reverse)", () => {
    const tasks = listTodayTasks(NOW);
    const bp = tasks.find((task) => task.taskId === TODAY_TASK_BP_ID);
    expect(bp?.methods.map((method) => method.availability)).toEqual([
      "available",
      "not-connected",
    ]);
    // The not-connected cuff seam is still VISIBLE (the landscape shows).
    expect(bp?.methods[1]?.methodId).toBe("SYNTH-method-cuff-bp-panel");
    expect(bp?.primaryRouteLabel).toContain("Manual entry");
  });

  it("orders open due-today first, missed second, completed last", () => {
    const tasks = listTodayTasks(NOW);
    expect(tasks.map((task) => task.taskId)).toEqual([
      TODAY_TASK_BP_ID,
      TODAY_TASK_HR_ID,
      TODAY_TASK_WEIGHT_ID,
      TODAY_TASK_SLEEP_ID,
    ]);
  });

  it("re-seeds identically after a reset (same ids, same semantic content)", () => {
    const first = listTodayTasks(NOW);
    resetTodayStore();
    const second = listTodayTasks(new Date("2025-09-15T16:30:00.000"));
    expect(second.map((task) => task.taskId)).toEqual(first.map((task) => task.taskId));
    expect(second.map((task) => task.metricId)).toEqual(first.map((task) => task.metricId));
    expect(second.map((task) => task.state)).toEqual(first.map((task) => task.state));
  });

  it("never places the sleep completion in the future (early-hours session)", () => {
    const early = new Date("2025-09-15T00:30:00.000");
    const tasks = listTodayTasks(early);
    const sleep = tasks.find((task) => task.taskId === TODAY_TASK_SLEEP_ID);
    expect(new Date(sleep?.completion?.completedAt ?? "").getTime()).toBeLessThanOrEqual(
      early.getTime(),
    );
  });
});

describe("today store: completion transition", () => {
  it("completes an open task through a real capture and links the observations", () => {
    const capture = storeCapture(submission(), new Date("2025-09-15T14:01:00.000Z"));
    const outcome = completeTodayTask(
      TODAY_TASK_BP_ID,
      capture.captureId,
      new Date("2025-09-15T14:02:00.000Z"),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.task.state).toBe("completed");
      expect(outcome.task.completion?.captureId).toBe(capture.captureId);
      expect(outcome.task.completion?.observationIds).toHaveLength(2);
      // Window/due label no longer matters, but the missed marker is stable.
      expect(outcome.task.missedWindow).toBe(false);
    }
  });

  it("refuses completion for an unknown task (typed not-found, no echo)", () => {
    const capture = storeCapture(submission(), new Date());
    const outcome = completeTodayTask("task_SYNTH-does-not-exist", capture.captureId, NOW);
    expect(outcome).toEqual({ ok: false, error: { kind: "task-not-found" } });
  });

  it("refuses completion when the capture does not exist", () => {
    const outcome = completeTodayTask(TODAY_TASK_BP_ID, "SYNTH-CAP-999999", NOW);
    expect(outcome).toEqual({ ok: false, error: { kind: "capture-not-found" } });
  });

  it("refuses a second completion of the same task (conflict)", () => {
    const capture = storeCapture(submission(), new Date());
    const now = new Date("2025-09-15T14:02:00.000Z");
    expect(completeTodayTask(TODAY_TASK_BP_ID, capture.captureId, now).ok).toBe(true);
    const second = completeTodayTask(TODAY_TASK_BP_ID, capture.captureId, now);
    expect(second).toEqual({ ok: false, error: { kind: "task-not-open" } });
  });

  it("updates the owning intent's progress after completion", () => {
    const before = listTodayIntents(NOW).find(
      (intent) => intent.intentId === "intent_SYNTH-today-bp-000001",
    );
    expect(before?.progress.completedToday).toBe(0);
    expect(before?.progress.dueNow).toBe(1);

    const capture = storeCapture(submission(), new Date("2025-09-15T14:01:00.000Z"));
    completeTodayTask(TODAY_TASK_BP_ID, capture.captureId, new Date("2025-09-15T14:02:00.000Z"));

    const after = listTodayIntents(NOW).find(
      (intent) => intent.intentId === "intent_SYNTH-today-bp-000001",
    );
    expect(after?.progress.completedToday).toBe(1);
    expect(after?.progress.dueNow).toBe(0);
    expect(after?.progress.label).toBe("1 completed — nothing due right now.");
  });
});

describe("today store: pure helpers", () => {
  it("derives due-window labels for open, future-day, and missed windows", () => {
    const open = dueWindowLabel(
      { sequence: 0, startsAt: NOW, endsAt: new Date(NOW.getTime() + 60_000) },
      NOW,
    );
    expect(open).toEqual({ label: "Due by 14:01", missed: false });

    const endOfToday = dueWindowLabel(
      {
        sequence: 0,
        startsAt: NOW,
        endsAt: new Date(2025, 8, 15, 23, 59, 59, 999),
      },
      NOW,
    );
    expect(endOfToday).toEqual({ label: "Due by end of today", missed: false });

    const missed = dueWindowLabel(
      {
        sequence: 0,
        startsAt: new Date(2025, 8, 14, 7, 0),
        endsAt: new Date(2025, 8, 14, 9, 0),
      },
      NOW,
    );
    expect(missed.missed).toBe(true);
    expect(missed.label).toContain("Window missed — was due yesterday at 09:00");
  });

  it("computes conservative per-intent progress (counts only, no gamification)", () => {
    const records: readonly TodayTaskRecord[] = [
      {
        task: {
          id: "task_SYNTH-progress-00000001" as MeasurementTask["id"],
          planId: "plan_SYNTH-today-bp-daily-0001" as MeasurementTask["planId"],
          personId: "prsn_SYNTH-person-0001" as MeasurementTask["personId"],
          metricId: "SYNTH-metric-bp-systolic",
          conceptCode: "SYNTH-8480-5",
          methodOrder: [],
          window: { sequence: 0, startsAt: NOW, endsAt: NOW },
          state: "completed",
          createdAt: NOW,
          rollCount: 0,
        },
        completion: {
          captureId: "SYNTH-CAP-000001",
          observationIds: ["obs_SYNTH-obs-000001"],
          completedAt: NOW.toISOString(),
        },
      },
      {
        task: {
          id: "task_SYNTH-progress-00000002" as MeasurementTask["id"],
          planId: "plan_SYNTH-today-bp-daily-0001" as MeasurementTask["planId"],
          personId: "prsn_SYNTH-person-0001" as MeasurementTask["personId"],
          metricId: "SYNTH-metric-bp-systolic",
          conceptCode: "SYNTH-8480-5",
          methodOrder: [],
          window: { sequence: 1, startsAt: NOW, endsAt: NOW },
          state: "open",
          createdAt: NOW,
          rollCount: 0,
        },
      },
    ];
    const progress = todayProgressOf(records, NOW);
    expect(progress).toEqual({
      completedToday: 1,
      dueNow: 1,
      label: "1 of 2 due measurements completed.",
    });
  });
});
