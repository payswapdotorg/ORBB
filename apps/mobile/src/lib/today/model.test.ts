import { describe, expect, it } from "vitest";
import {
  TODAY_FALLBACK,
  TODAY_INTENT_FIXTURES,
  TODAY_METHOD_LANDSCAPES,
  TODAY_TASK_BP_ID,
  TODAY_TASK_HR_ID,
  TODAY_TASK_SLEEP_ID,
  TODAY_TASK_WEIGHT_ID,
  assertTodayCatalogInvariants,
  completeTodayTask,
  dueWindowLabel,
  initialTodayIdCounters,
  initialTodaySession,
  isTodayTaskState,
  listTodayIntents,
  listTodayTasks,
  resetTodayCounters,
  todayProgressOf,
  type TodayTaskRecord,
} from "./model";

/**
 * Mobile Today-surface model contract tests (M6-B B4): the web today-store
 * assertions mirrored onto the client-local session API — fixture
 * invariants (SYNTH marking, least-burden-first ordering), deterministic
 * seeding (due-today / missed-window / two-method / completed), the
 * immutable open -> completed transition with deterministic completion ids,
 * and conservative per-intent progress.
 */

const NOW = new Date(2026, 8, 10, 12, 0);
const LATER = new Date(2026, 8, 10, 16, 30);
const EARLY = new Date(2026, 8, 10, 0, 30);

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
    expect(TODAY_FALLBACK.detail).toContain(
      "Fallback data reaches the same Observation model with its own provenance.",
    );
  });

  it("guards the task-state vocabulary (A30 runtime mirror)", () => {
    expect(isTodayTaskState("open")).toBe(true);
    expect(isTodayTaskState("completed")).toBe(true);
    expect(isTodayTaskState("rolled-over")).toBe(false);
    expect(isTodayTaskState(42)).toBe(false);
  });

  it("resets the completion counters to zero (test determinism anchor)", () => {
    expect(resetTodayCounters()).toEqual(initialTodayIdCounters());
    expect(resetTodayCounters()).toEqual({ capture: 0, observation: 0 });
  });
});

describe("today session: deterministic seed", () => {
  it("seeds the four fixture tasks (due-today x2, missed window, completed)", () => {
    const session = initialTodaySession(NOW);
    const tasks = listTodayTasks(session, NOW);
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
    expect(bp?.captureShapeId).toBe("SYNTH-shape-bp-panel");

    // Due-today HR: open, two methods, wearable FIRST (least burden).
    expect(hr?.state).toBe("open");
    expect(hr?.methodCountLabel).toBe("2 methods available");
    expect(hr?.methods[0]?.methodId).toBe("SYNTH-method-wearable-heart-rate");
    expect(hr?.methods[0]?.availability).toBe("available");
    expect(hr?.methods[1]?.methodId).toBe("SYNTH-method-manual-heart-rate");

    // Missed window weight: open, missed marker, fallback surfaced.
    expect(weight?.state).toBe("open");
    expect(weight?.missedWindow).toBe(true);
    expect(weight?.dueWindowLabel).toBe("Window missed — was due yesterday at 09:00");
    expect(weight?.fallback.providers).toContain("SYNTH-Clinic-A");

    // Completed sleep: completion link present (the seeded capture).
    expect(sleep?.state).toBe("completed");
    expect(sleep?.completion?.captureId).toBe("SYNTH-CAP-SEED-SLEEP");
    expect(sleep?.completion?.observationIds).toEqual(["obs_SYNTH-obs-seed-sleep-0001"]);
  });

  it("places AVAILABLE methods before not-connected seams (never the reverse)", () => {
    const tasks = listTodayTasks(initialTodaySession(NOW), NOW);
    const bp = tasks.find((task) => task.taskId === TODAY_TASK_BP_ID);
    expect(bp?.methods.map((method) => method.availability)).toEqual([
      "available",
      "not-connected",
    ]);
    // The not-connected cuff seam is still VISIBLE (the landscape shows).
    expect(bp?.methods[1]?.methodId).toBe("SYNTH-method-cuff-bp-panel");
    expect(bp?.methods[1]?.availabilityNote).toContain("not connected yet");
    expect(bp?.primaryRouteLabel).toBe("Manual entry — home BP cuff reading");
  });

  it("orders open due-today first, missed second, completed last", () => {
    const tasks = listTodayTasks(initialTodaySession(NOW), NOW);
    expect(tasks.map((task) => task.taskId)).toEqual([
      TODAY_TASK_BP_ID,
      TODAY_TASK_HR_ID,
      TODAY_TASK_WEIGHT_ID,
      TODAY_TASK_SLEEP_ID,
    ]);
  });

  it("re-seeds identically (same ids, same semantic content) at a later hour", () => {
    const first = listTodayTasks(initialTodaySession(NOW), NOW);
    const second = listTodayTasks(initialTodaySession(LATER), LATER);
    expect(second.map((task) => task.taskId)).toEqual(first.map((task) => task.taskId));
    expect(second.map((task) => task.metricId)).toEqual(first.map((task) => task.metricId));
    expect(second.map((task) => task.state)).toEqual(first.map((task) => task.state));
    expect(second.map((task) => task.dueWindowLabel)).toEqual(
      first.map((task) => task.dueWindowLabel),
    );
  });

  it("never places the sleep completion in the future (early-hours session)", () => {
    const tasks = listTodayTasks(initialTodaySession(EARLY), EARLY);
    const sleep = tasks.find((task) => task.taskId === TODAY_TASK_SLEEP_ID);
    expect(new Date(sleep?.completion?.completedAt ?? "").getTime()).toBeLessThanOrEqual(
      EARLY.getTime(),
    );
  });

  it("lists the four intents with conservative progress labels", () => {
    const session = initialTodaySession(NOW);
    const intents = listTodayIntents(session, NOW);
    expect(intents.map((intent) => intent.intentId)).toEqual([
      "intent_SYNTH-today-bp-000001",
      "intent_SYNTH-today-hr-000002",
      "intent_SYNTH-today-wt-000003",
      "intent_SYNTH-today-sleep-000004",
    ]);
    const bp = intents[0];
    expect(bp?.progress.completedToday).toBe(0);
    expect(bp?.progress.dueNow).toBe(1);
    expect(bp?.progress.label).toBe("0 of 1 due measurements completed.");
    const sleep = intents[3];
    expect(sleep?.progress.completedToday).toBe(1);
    expect(sleep?.progress.dueNow).toBe(0);
    expect(sleep?.progress.label).toBe("1 completed — nothing due right now.");
  });
});

describe("today session: completion transition", () => {
  it("completes an open task with a deterministic synthetic capture link", () => {
    const session = initialTodaySession(NOW);
    const outcome = completeTodayTask(session, TODAY_TASK_BP_ID, new Date(2026, 8, 10, 14, 2));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.task.state).toBe("completed");
    expect(outcome.task.completion?.captureId).toBe("SYNTH-CAP-TODAY-000001");
    expect(outcome.task.completion?.observationIds).toEqual([
      "obs_SYNTH-obs-today-000001",
    ]);
    // Completed tasks keep the stable missed marker; the card shows text.
    expect(outcome.task.missedWindow).toBe(false);
    // The intent progress updated through the SAME call.
    const bpIntent = outcome.intents.find(
      (intent) => intent.intentId === "intent_SYNTH-today-bp-000001",
    );
    expect(bpIntent?.progress.completedToday).toBe(1);
    expect(bpIntent?.progress.dueNow).toBe(0);
    expect(bpIntent?.progress.label).toBe("1 completed — nothing due right now.");
  });

  it("NEVER mutates the original session (immutable transitions)", () => {
    const session = initialTodaySession(NOW);
    const outcome = completeTodayTask(session, TODAY_TASK_BP_ID, LATER);
    expect(outcome.ok).toBe(true);
    // The original session still has the task open.
    const original = session.tasks.find(
      (record) => record.task.id === TODAY_TASK_BP_ID,
    );
    expect(original?.task.state).toBe("open");
    expect(original?.completion).toBeUndefined();
    expect(session.counters).toEqual({ capture: 0, observation: 0 });
    // The new session has it completed.
    if (outcome.ok) {
      const next = outcome.session.tasks.find(
        (record) => record.task.id === TODAY_TASK_BP_ID,
      );
      expect(next?.task.state).toBe("completed");
      expect(next?.completion).toBeDefined();
    }
  });

  it("advances the completion counters deterministically", () => {
    let session = initialTodaySession(NOW);
    const first = completeTodayTask(session, TODAY_TASK_BP_ID, new Date(2026, 8, 10, 14, 2));
    expect(first.ok).toBe(true);
    if (first.ok) {
      session = first.session;
    }
    const second = completeTodayTask(session, TODAY_TASK_HR_ID, new Date(2026, 8, 10, 14, 5));
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.task.completion?.captureId).toBe("SYNTH-CAP-TODAY-000002");
      expect(second.task.completion?.observationIds).toEqual([
        "obs_SYNTH-obs-today-000002",
      ]);
    }
  });

  it("refuses completion for an unknown task (typed not-found, no echo)", () => {
    const outcome = completeTodayTask(
      initialTodaySession(NOW),
      "task_SYNTH-does-not-exist",
      NOW,
    );
    expect(outcome).toEqual({ ok: false, error: { kind: "task-not-found" } });
  });

  it("refuses a second completion of the same task (conflict)", () => {
    let session = initialTodaySession(NOW);
    const first = completeTodayTask(session, TODAY_TASK_BP_ID, new Date(2026, 8, 10, 14, 2));
    expect(first.ok).toBe(true);
    if (first.ok) {
      session = first.session;
    }
    const second = completeTodayTask(session, TODAY_TASK_BP_ID, new Date(2026, 8, 10, 14, 3));
    expect(second).toEqual({ ok: false, error: { kind: "task-not-open" } });
  });

  it("moves completed tasks last in the re-projected list", () => {
    let session = initialTodaySession(NOW);
    const outcome = completeTodayTask(session, TODAY_TASK_BP_ID, new Date(2026, 8, 10, 14, 2));
    if (outcome.ok) {
      session = outcome.session;
    }
    const order = listTodayTasks(session, NOW).map((task) => task.taskId);
    expect(order).toEqual([TODAY_TASK_HR_ID, TODAY_TASK_WEIGHT_ID, TODAY_TASK_BP_ID, TODAY_TASK_SLEEP_ID]);
  });
});

describe("today session: pure helpers", () => {
  it("derives due-window labels for open, future-day, and missed windows", () => {
    const open = dueWindowLabel(
      { sequence: 0, startsAt: NOW.toISOString(), endsAt: new Date(NOW.getTime() + 60_000).toISOString() },
      NOW,
    );
    expect(open).toEqual({ label: "Due by 12:01", missed: false });

    const endOfToday = dueWindowLabel(
      {
        sequence: 0,
        startsAt: NOW.toISOString(),
        endsAt: new Date(2026, 8, 10, 23, 59, 59, 999).toISOString(),
      },
      NOW,
    );
    expect(endOfToday).toEqual({ label: "Due by end of today", missed: false });

    const missed = dueWindowLabel(
      {
        sequence: 0,
        startsAt: new Date(2026, 8, 9, 7, 0).toISOString(),
        endsAt: new Date(2026, 8, 9, 9, 0).toISOString(),
      },
      NOW,
    );
    expect(missed.missed).toBe(true);
    expect(missed.label).toBe("Window missed — was due yesterday at 09:00");
  });

  it("computes conservative per-intent progress (counts only, no gamification)", () => {
    const records: readonly TodayTaskRecord[] = [
      {
        task: {
          id: "task_SYNTH-progress-00000001",
          planId: "plan_SYNTH-today-bp-daily-0001",
          personId: "prsn_SYNTH-person-0001",
          metricId: "SYNTH-metric-bp-systolic",
          conceptCode: "SYNTH-8480-5",
          methodOrder: [],
          window: { sequence: 0, startsAt: NOW.toISOString(), endsAt: NOW.toISOString() },
          state: "completed",
          createdAt: NOW.toISOString(),
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
          id: "task_SYNTH-progress-00000002",
          planId: "plan_SYNTH-today-bp-daily-0001",
          personId: "prsn_SYNTH-person-0001",
          metricId: "SYNTH-metric-bp-systolic",
          conceptCode: "SYNTH-8480-5",
          methodOrder: [],
          window: { sequence: 1, startsAt: NOW.toISOString(), endsAt: NOW.toISOString() },
          state: "open",
          createdAt: NOW.toISOString(),
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
