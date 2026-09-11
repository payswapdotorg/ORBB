import { describe, expect, it } from "vitest";
import { parseTaskId } from "@orbb/domain";
import { DeterministicClock } from "@orbb/testkit";
import {
  buildEngineHarness,
  compileActivePlan,
  harnessIntentId,
  harnessPersonId,
  hrProtocol,
  MS_PER_DAY,
  MS_PER_HOUR,
} from "./testsupport.js";
import { SEEDED_METHOD_IDS } from "./seed.js";
import { InMemoryMeasurementTaskStore, TaskScheduler, type MeasurementTask } from "./scheduler.js";

const PERSON = harnessPersonId();
const INTENT = harnessIntentId();

describe("A30 task scheduler — expansion and window math", () => {
  it("expands an active plan into tasks with anchored, non-overlapping windows", async () => {
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    const result = await harness.scheduler.schedule({ plan, planMetrics });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const { tasks, created } = result.value;
    // horizon 2 days, daily cadence, now = 0 => windows 0,1,2.
    expect(tasks).toHaveLength(3);
    expect(created).toHaveLength(3);
    for (const [index, task] of tasks.entries()) {
      expect(task.state).toBe("open");
      expect(task.planId).toBe(plan.id);
      expect(task.personId).toBe(plan.personId);
      expect(task.metricId).toBe(planMetrics[0]?.metricId);
      expect(task.methodOrder[0]).toBe(SEEDED_METHOD_IDS.heartRateWearable);
      expect(task.window.sequence).toBe(index);
      expect(task.window.startsAt.getTime()).toBe(index * MS_PER_DAY);
      expect(task.window.endsAt.getTime()).toBe(index * MS_PER_DAY + MS_PER_HOUR);
      expect(task.rollCount).toBe(0);
      // Canonical domain TaskId grammar.
      expect(() => parseTaskId(task.id)).not.toThrow();
    }
    // Windows do not overlap: each window ends before the next starts.
    for (let i = 0; i + 1 < tasks.length; i += 1) {
      const current = tasks[i] as MeasurementTask;
      const next = tasks[i + 1] as MeasurementTask;
      expect(current.window.endsAt.getTime() <= next.window.startsAt.getTime()).toBe(true);
    }
  });

  it("uses pure UTC arithmetic — window starts are exact multiples across a DST boundary", async () => {
    // Anchor the day before the 2024 US spring-forward (2024-03-10);
    // daily windows must stay anchored in absolute UTC ms.
    const dstAnchorMs = Date.UTC(2024, 2, 9, 0, 0, 0);
    const harness = buildEngineHarness({ epochMs: dstAnchorMs });
    const { plan, planMetrics } = compileActivePlan(
      harness,
      hrProtocol({ anchorAt: new Date(dstAnchorMs) }),
    );
    const result = await harness.scheduler.schedule({ plan, planMetrics });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.tasks.map((task) => task.window.startsAt.toISOString())).toEqual([
      "2024-03-09T00:00:00.000Z",
      "2024-03-10T00:00:00.000Z",
      "2024-03-11T00:00:00.000Z",
    ]);
    expect(result.value.tasks.map((task) => task.window.endsAt.toISOString())).toEqual([
      "2024-03-09T01:00:00.000Z",
      "2024-03-10T01:00:00.000Z",
      "2024-03-11T01:00:00.000Z",
    ]);
  });

  it("rejects scheduling for plans that are not active or have no plan metrics", async () => {
    const harness = buildEngineHarness();
    const compiled = harness.compiler.compile({
      personId: PERSON,
      intentId: INTENT,
      protocol: hrProtocol(),
    });
    if (!compiled.ok) {
      throw new Error("expected compilation to succeed");
    }
    const draft = compiled.value.plan;
    const notActive = await harness.scheduler.schedule({
      plan: draft,
      planMetrics: compiled.value.planMetrics,
    });
    expect(notActive).toEqual({ ok: false, error: { kind: "plan-not-active" } });
    const active = compileActivePlan(harness, hrProtocol());
    const empty = await harness.scheduler.schedule({ plan: active.plan, planMetrics: [] });
    expect(empty).toEqual({ ok: false, error: { kind: "no-plan-metrics" } });
  });

  it("rejects plan metrics that do not belong to the plan or its concept codes", async () => {
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    // A DIFFERENT seed produces a different plan id, so its plan metrics
    // do not belong to this plan.
    const other = compileActivePlan(buildEngineHarness({ seed: "other-plan" }), hrProtocol());
    expect(other.plan.id).not.toBe(plan.id);
    const mismatch = await harness.scheduler.schedule({ plan, planMetrics: other.planMetrics });
    expect(mismatch).toEqual({ ok: false, error: { kind: "plan-metric-mismatch" } });
    const wrongConcept = await harness.scheduler.schedule({
      plan: { ...plan, metrics: ["SYNTH-9999-9"] },
      planMetrics,
    });
    expect(wrongConcept).toEqual({ ok: false, error: { kind: "concept-mismatch" } });
  });
});

describe("A30 task scheduler — idempotency per (plan, window)", () => {
  it("re-running at the same clock instant produces the identical task set and creates nothing new", async () => {
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    const first = await harness.scheduler.schedule({ plan, planMetrics });
    if (!first.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const second = await harness.scheduler.schedule({ plan, planMetrics });
    if (!second.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(second.value.tasks).toEqual(first.value.tasks);
    expect(second.value.created).toEqual([]);
    expect(second.value.rolledForward).toEqual([]);
  });

  it("produces the same deterministic task ids against a FRESH store (content-derived ids)", async () => {
    const harnessA = buildEngineHarness({ seed: "idem" });
    const harnessB = buildEngineHarness({ seed: "idem" });
    const a = compileActivePlan(harnessA, hrProtocol());
    const b = compileActivePlan(harnessB, hrProtocol());
    const first = await harnessA.scheduler.schedule({ plan: a.plan, planMetrics: a.planMetrics });
    const second = await harnessB.scheduler.schedule({ plan: b.plan, planMetrics: b.planMetrics });
    if (!first.ok || !second.ok) {
      throw new Error("expected scheduling to succeed");
    }
    // Same authored protocol + same id sequence => same plan id, so the
    // content-derived task ids match exactly.
    expect(b.plan.id).toBe(a.plan.id);
    expect(second.value.tasks.map((task) => task.id)).toEqual(
      first.value.tasks.map((task) => task.id),
    );
  });

  it("running later adds only new windows and never re-opens completed tasks", async () => {
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    const first = await harness.scheduler.schedule({ plan, planMetrics });
    if (!first.ok) {
      throw new Error("expected scheduling to succeed");
    }
    // Complete window 0's task.
    const completedTask = first.value.tasks[0];
    if (completedTask === undefined) {
      throw new Error("expected a first task");
    }
    await harness.taskStore.upsert({ ...completedTask, state: "completed" });
    // Advance the clock one day: window 0 is now missed but completed.
    harness.clock.advance(MS_PER_DAY);
    const second = await harness.scheduler.schedule({ plan, planMetrics });
    if (!second.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const windowZero = second.value.tasks.find((task) => task.window.sequence === 0);
    expect(windowZero?.state).toBe("completed");
    expect(windowZero?.id).toBe(completedTask.id);
    // Window 3 materialized; windows 1/2 untouched; nothing rolled.
    expect(second.value.created.map((task) => task.window.sequence)).toEqual([3]);
    expect(second.value.rolledForward).toEqual([]);
    expect(second.value.tasks).toHaveLength(4);
  });
});

describe("A30 task scheduler — missed window roll-forward", () => {
  it("rolls an open missed task forward to the next unclaimed future window (same task identity)", async () => {
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    const first = await harness.scheduler.schedule({ plan, planMetrics });
    if (!first.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const missedTask = first.value.tasks[0];
    if (missedTask === undefined) {
      throw new Error("expected a first task");
    }
    // Advance past window 0's end (missed); windows 1 and 2 still future
    // and already claimed by their own tasks, so the rolled task takes
    // the next UNCLAIMED window: sequence 3.
    harness.clock.advance(2 * MS_PER_HOUR);
    const second = await harness.scheduler.schedule({ plan, planMetrics });
    if (!second.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(second.value.rolledForward).toHaveLength(1);
    const rolled = second.value.rolledForward[0];
    expect(rolled?.id).toBe(missedTask.id);
    expect(rolled?.rollCount).toBe(1);
    expect(rolled?.window.sequence).toBe(3);
    // No fresh task was created; the target window is claimed by the roll.
    expect(second.value.created).toEqual([]);
    expect(second.value.tasks).toHaveLength(3);
    // Windows still do not overlap after the roll.
    const sorted = [...second.value.tasks].sort(
      (a, b) => a.window.startsAt.getTime() - b.window.startsAt.getTime(),
    );
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const current = sorted[i] as MeasurementTask;
      const next = sorted[i + 1] as MeasurementTask;
      expect(current.window.endsAt.getTime() <= next.window.startsAt.getTime()).toBe(true);
    }
  });

  it("re-running at the same clock does not roll again (idempotent roll)", async () => {
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    await harness.scheduler.schedule({ plan, planMetrics });
    harness.clock.advance(2 * MS_PER_HOUR);
    const rolled = await harness.scheduler.schedule({ plan, planMetrics });
    if (!rolled.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const again = await harness.scheduler.schedule({ plan, planMetrics });
    if (!again.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(again.value.rolledForward).toEqual([]);
    expect(again.value.created).toEqual([]);
    expect(again.value.tasks).toEqual(rolled.value.tasks);
  });

  it("rolls successive missed open tasks to successive unclaimed windows without overlap", async () => {
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    await harness.scheduler.schedule({ plan, planMetrics });
    // Miss windows 0 AND 1 (advance to 26h: window 1 ended at 25h, window 2
    // ends at 49h and is still future/claimed).
    harness.clock.advance(MS_PER_DAY + 2 * MS_PER_HOUR);
    const result = await harness.scheduler.schedule({ plan, planMetrics });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.rolledForward).toHaveLength(2);
    const targets = result.value.rolledForward.map((task) => task.window.sequence);
    // Windows 2 is claimed by its own future task; the two missed tasks
    // take windows 3 and 4 respectively.
    expect(targets).toEqual([3, 4]);
    expect(result.value.created).toEqual([]);
    const windows = result.value.tasks
      .map((task) => [task.window.startsAt.getTime(), task.window.endsAt.getTime()] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < windows.length; i += 1) {
      expect(windows[i]?.[1] as number).toBeLessThanOrEqual(windows[i + 1]?.[0] as number);
    }
  });

  it("materializes missed windows as tasks under the backfill policy (bounded lookback)", async () => {
    const backfillHarness = buildEngineHarness();
    const backfill = compileActivePlan(
      backfillHarness,
      hrProtocol({ missedWindowPolicy: "backfill" }),
    );
    // First run happens 3 days after the anchor: backfill lookback
    // (= horizon = 2 days) materializes missed windows 1 and 2; window 0
    // is outside the lookback; windows 3-5 are current/future.
    backfillHarness.clock.advance(3 * MS_PER_DAY);
    const result = await backfillHarness.scheduler.schedule({
      plan: backfill.plan,
      planMetrics: backfill.planMetrics,
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.created.map((task) => task.window.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(result.value.rolledForward).toEqual([]);

    // Contrast: roll-forward spawns nothing for the missed windows.
    const rollHarness = buildEngineHarness();
    const roll = compileActivePlan(rollHarness, hrProtocol({ missedWindowPolicy: "roll-forward" }));
    rollHarness.clock.advance(3 * MS_PER_DAY);
    const contrast = await rollHarness.scheduler.schedule({
      plan: roll.plan,
      planMetrics: roll.planMetrics,
    });
    if (!contrast.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(contrast.value.created.map((task) => task.window.sequence)).toEqual([3, 4, 5]);
  });
});

describe("A30 task scheduler — store port", () => {
  it("upserts through the injected store port (in-memory double defensive copies)", async () => {
    const clock = new DeterministicClock({ epochMs: 0 });
    const store = new InMemoryMeasurementTaskStore();
    const scheduler = new TaskScheduler({ clock, store });
    const harness = buildEngineHarness();
    const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
    const result = await scheduler.schedule({ plan, planMetrics });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const first = result.value.tasks[0];
    if (first === undefined) {
      throw new Error("expected a first task");
    }
    const stored = await store.findById(first.id);
    expect(stored?.id).toBe(first.id);
    // Mutating the returned copy must not corrupt the store.
    stored?.window.startsAt.setTime(99);
    const pristine = await store.findById(first.id);
    expect(pristine?.window.startsAt.getTime()).toBe(first.window.startsAt.getTime());
  });
});
