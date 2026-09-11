/**
 * A30 — Task scheduler: expands an ACTIVE plan into `MeasurementTask`s
 * with `MeasurementWindow`s.
 *
 * RECORDED DESIGN DECISIONS:
 *
 * Idempotency per (plan, window): task ids are domain-separated hashes of
 * the semantic identity (planId, metricId, window sequence + bounds) —
 * see `ids.ts`. Re-running the scheduler at the same clock instant
 * produces the identical task set (same ids, same content); running it
 * later only ADDS the tasks for newly materialized windows and never
 * rewrites completed tasks (the store upsert + window-claim checks
 * guarantee no state clobbering).
 *
 * Window math: pure UTC millisecond arithmetic from the schedule anchor
 * (`anchorAt + n * intervalMs`, duration `windowDurationMs`) — DST-free
 * by construction; time is read exclusively from the injected clock (the
 * testkit `DeterministicClock` in tests). Windows never overlap:
 * `windowDurationMs <= intervalMs` is compiler-enforced and re-asserted
 * here.
 *
 * Missed windows (fully in the past, open task) roll forward per the
 * schedule's recorded `missedWindowPolicy`:
 *   - `roll-forward` (default): a missed OPEN task is re-anchored to the
 *     next unclaimed future window (task identity preserved — the id was
 *     derived from the ORIGINAL window; `rollCount` records the number of
 *     rolls). Missed windows with no task spawn nothing (no backlog
 *     punishment).
 *   - `backfill`: missed windows materialize tasks like future ones
 *     (adherence review needs the historical record). Backfill is bounded
 *     to a lookback of `horizonMs` before `now` so materialization stays
 *     finite (recorded assumption: symmetric materialization window
 *     [now - horizon, now + horizon]).
 *
 * The task store port is async (persistence-shaped for the future db
 * adapter — handoff recorded); the in-memory reference store is the
 * double used by tests and the Lane C E2E harness.
 */
import type { PersonId, PlanId, TaskId } from "@orbb/domain";
import { isIdOf } from "@orbb/domain";
import type { Clock } from "@orbb/testkit";
import { err, ok, type EngineResult } from "./result.js";
import { MeasurementEngineError } from "./errors.js";
import { deriveDeterministicId } from "./ids.js";
import type { PlanMetric } from "./compiler.js";
import type { MeasurementPlan } from "@orbb/domain";

/** Domain-separation tag for task id derivation. */
const TASK_ID_DOMAIN = "orbb/measurement/task-id/v1";

/** Task prefix from the frozen domain canonical id grammar. */
const TASK_ID_PREFIX = "task";

/** Lifecycle states of a measurement task. */
export const TASK_STATES = ["open", "completed"] as const;

export type TaskState = (typeof TASK_STATES)[number];

/**
 * A measurement window: `sequence` is the 0-based cadence index; windows
 * are half-open [startsAt, endsAt) and never overlap
 * (`windowDurationMs <= intervalMs`); the due instant is `endsAt`.
 */
export interface MeasurementWindow {
  readonly sequence: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * A measurement task: the executable unit the capture path fulfills.
 * `methodOrder` is the ordered method chain (preferred first, fallback
 * order after) compiled into the owning `PlanMetric`.
 */
export interface MeasurementTask {
  /** Canonical domain `TaskId`, deterministically derived per (plan, metric, window). */
  readonly id: TaskId;
  readonly planId: PlanId;
  readonly personId: PersonId;
  readonly metricId: string;
  readonly conceptCode: string;
  readonly methodOrder: readonly string[];
  /** The CURRENT window (advanced by roll-forwards). */
  readonly window: MeasurementWindow;
  readonly state: TaskState;
  readonly createdAt: Date;
  /** Number of times this task's window has been rolled forward after being missed. */
  readonly rollCount: number;
}

/**
 * Persistence port for tasks (async — the db adapter arrives in a later
 * integration packet; the in-memory store is the reference double).
 */
export interface MeasurementTaskStore {
  /**
   * Upserts by id: an existing record with different content is REPLACED
   * (roll-forward needs this); returns the stored record.
   */
  upsert(task: MeasurementTask): Promise<MeasurementTask>;
  findById(taskId: TaskId): Promise<MeasurementTask | undefined>;
  findByPlan(planId: PlanId): Promise<readonly MeasurementTask[]>;
}

/** In-memory reference `MeasurementTaskStore` (defensive copies in and out). */
export class InMemoryMeasurementTaskStore implements MeasurementTaskStore {
  readonly #tasks = new Map<string, MeasurementTask>();

  async upsert(task: MeasurementTask): Promise<MeasurementTask> {
    const stored = cloneTask(task);
    this.#tasks.set(task.id, stored);
    return cloneTask(stored);
  }

  async findById(taskId: TaskId): Promise<MeasurementTask | undefined> {
    const task = this.#tasks.get(taskId);
    return task === undefined ? undefined : cloneTask(task);
  }

  async findByPlan(planId: PlanId): Promise<readonly MeasurementTask[]> {
    const owned: MeasurementTask[] = [];
    for (const task of this.#tasks.values()) {
      if (task.planId === planId) {
        owned.push(cloneTask(task));
      }
    }
    return owned;
  }
}

/** Scheduler input: the plan (must be ACTIVE) + its compiled plan metrics. */
export interface ScheduleTasksInput {
  readonly plan: MeasurementPlan;
  readonly planMetrics: readonly PlanMetric[];
}

/** Scheduler outcome: the full task set after the run + what changed. */
export interface ScheduleTasksOutcome {
  /** All tasks of the plan after this run, deterministically ordered (metricId, window start, id). */
  readonly tasks: readonly MeasurementTask[];
  /** Tasks created by THIS run (idempotent re-runs create nothing). */
  readonly created: readonly MeasurementTask[];
  /** Open tasks whose missed windows were rolled forward by THIS run. */
  readonly rolledForward: readonly MeasurementTask[];
}

/** Typed scheduler rejections (PHID-safe, values never echoed). */
export type ScheduleTasksError =
  | { readonly kind: "plan-not-active" }
  | { readonly kind: "no-plan-metrics" }
  | { readonly kind: "plan-metric-mismatch" }
  | { readonly kind: "concept-mismatch" }
  | { readonly kind: "invalid-schedule" };

/** Constructor deps (clock + task store; all injectable). */
export interface TaskSchedulerDeps {
  readonly clock: Clock;
  readonly store: MeasurementTaskStore;
}

/** Expands ACTIVE plans into measurement tasks. Deterministic given (inputs, store state, clock). */
export class TaskScheduler {
  readonly #clock: Clock;
  readonly #store: MeasurementTaskStore;

  constructor(deps: TaskSchedulerDeps) {
    this.#clock = deps.clock;
    this.#store = deps.store;
  }

  async schedule(
    input: ScheduleTasksInput,
  ): Promise<EngineResult<ScheduleTasksOutcome, ScheduleTasksError>> {
    if (input.plan.state !== "active") {
      return err({ kind: "plan-not-active" });
    }
    if (!Array.isArray(input.planMetrics) || input.planMetrics.length === 0) {
      return err({ kind: "no-plan-metrics" });
    }
    for (const planMetric of input.planMetrics) {
      if (planMetric.planId !== input.plan.id) {
        return err({ kind: "plan-metric-mismatch" });
      }
      if (!input.plan.metrics.includes(planMetric.conceptCode)) {
        return err({ kind: "concept-mismatch" });
      }
      if (
        !Number.isInteger(planMetric.schedule.intervalMs) ||
        planMetric.schedule.intervalMs < 1 ||
        !Number.isInteger(planMetric.schedule.windowDurationMs) ||
        planMetric.schedule.windowDurationMs < 1 ||
        planMetric.schedule.windowDurationMs > planMetric.schedule.intervalMs
      ) {
        return err({ kind: "invalid-schedule" });
      }
    }

    const nowMs = this.#clock.now().getTime();
    const createdAt = this.#clock.now();
    const existing = await this.#store.findByPlan(input.plan.id);
    const created: MeasurementTask[] = [];
    const rolledForward: MeasurementTask[] = [];

    for (const planMetric of input.planMetrics) {
      const existingForMetric = existing.filter((task) => task.metricId === planMetric.metricId);
      const outcome = this.#scheduleMetric({
        plan: input.plan,
        planMetric,
        existingForMetric,
        nowMs,
        createdAt,
      });
      for (const task of outcome.rolled) {
        const stored = await this.#store.upsert(task);
        rolledForward.push(stored);
      }
      for (const task of outcome.fresh) {
        const stored = await this.#store.upsert(task);
        created.push(stored);
      }
    }

    const tasksAfter = await this.#store.findByPlan(input.plan.id);
    const tasks = [...tasksAfter].sort(compareTasks);
    return ok({ tasks, created, rolledForward });
  }

  #scheduleMetric(input: {
    plan: MeasurementPlan;
    planMetric: PlanMetric;
    existingForMetric: readonly MeasurementTask[];
    nowMs: number;
    createdAt: Date;
  }): { fresh: readonly MeasurementTask[]; rolled: readonly MeasurementTask[] } {
    const { plan, planMetric, existingForMetric, nowMs, createdAt } = input;
    const { anchorAt, intervalMs, windowDurationMs, horizonMs, missedWindowPolicy } =
      planMetric.schedule;
    const anchorMs = anchorAt.getTime();

    // Window n: starts at anchor + n*interval, duration windowDurationMs.
    const windowStart = (n: number): number => anchorMs + n * intervalMs;
    const windowEnd = (n: number): number => windowStart(n) + windowDurationMs;
    const makeWindow = (n: number): MeasurementWindow => ({
      sequence: n,
      startsAt: new Date(windowStart(n)),
      endsAt: new Date(windowEnd(n)),
    });

    // First window index whose end is strictly after a given instant.
    const firstEndingAfter = (instant: number): number =>
      Math.max(0, Math.floor((instant - anchorMs - windowDurationMs) / intervalMs) + 1);

    // Grid windows already claimed by an existing task (by sequence+start).
    const claimed = new Set<number>();
    for (const task of existingForMetric) {
      claimed.add(task.window.sequence);
    }

    if (missedWindowPolicy === "backfill") {
      // Materialize every window in [now - horizon, now + horizon]
      // (bounded lookback — recorded assumption).
      const first = firstEndingAfter(nowMs - horizonMs);
      const fresh: MeasurementTask[] = [];
      for (let n = first; windowStart(n) <= nowMs + horizonMs; n += 1) {
        if (claimed.has(n)) {
          continue;
        }
        fresh.push(this.#newTask(plan, planMetric, makeWindow(n), createdAt));
        claimed.add(n);
      }
      return { fresh, rolled: [] };
    }

    // roll-forward policy.
    const openMissed = existingForMetric
      .filter((task) => task.state === "open" && task.window.endsAt.getTime() <= nowMs)
      .sort((a, b) => a.window.startsAt.getTime() - b.window.startsAt.getTime() || (a.id < b.id ? -1 : 1));

    const rolled: MeasurementTask[] = [];
    let cursor = firstEndingAfter(nowMs);
    for (const task of openMissed) {
      // Find the next unclaimed future grid window for this rolled task.
      while (claimed.has(cursor)) {
        cursor += 1;
      }
      rolled.push({
        ...task,
        window: makeWindow(cursor),
        rollCount: task.rollCount + 1,
      });
      claimed.add(cursor);
      cursor += 1;
    }

    const fresh: MeasurementTask[] = [];
    for (let n = firstEndingAfter(nowMs); windowStart(n) <= nowMs + horizonMs; n += 1) {
      if (claimed.has(n)) {
        continue;
      }
      fresh.push(this.#newTask(plan, planMetric, makeWindow(n), createdAt));
      claimed.add(n);
    }
    return { fresh, rolled };
  }

  #newTask(
    plan: MeasurementPlan,
    planMetric: PlanMetric,
    window: MeasurementWindow,
    createdAt: Date,
  ): MeasurementTask {
    const id = deriveDeterministicId(TASK_ID_PREFIX, TASK_ID_DOMAIN, [
      plan.id,
      planMetric.metricId,
      window.sequence,
      window.startsAt.getTime(),
      window.endsAt.getTime(),
    ]) as TaskId;
    if (!isIdOf("task", id)) {
      throw new MeasurementEngineError(
        "invariant-violation",
        "Derived task id does not satisfy the canonical domain id grammar.",
      );
    }
    return {
      id,
      planId: plan.id,
      personId: plan.personId,
      metricId: planMetric.metricId,
      conceptCode: planMetric.conceptCode,
      methodOrder: planMetric.methodOrder,
      window,
      state: "open",
      createdAt,
      rollCount: 0,
    };
  }
}

/** Deterministic task ordering: metric id, then window start, then id. */
export function compareTasks(a: MeasurementTask, b: MeasurementTask): number {
  if (a.metricId !== b.metricId) {
    return a.metricId < b.metricId ? -1 : 1;
  }
  const byStart = a.window.startsAt.getTime() - b.window.startsAt.getTime();
  if (byStart !== 0) {
    return byStart;
  }
  return a.id < b.id ? -1 : 1;
}

function cloneTask(task: MeasurementTask): MeasurementTask {
  return {
    ...task,
    window: {
      sequence: task.window.sequence,
      startsAt: new Date(task.window.startsAt.getTime()),
      endsAt: new Date(task.window.endsAt.getTime()),
    },
    createdAt: new Date(task.createdAt.getTime()),
  };
}
