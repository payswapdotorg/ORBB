/**
 * B10 — Adherence evaluation: a PURE function from task-window outcomes
 * to per-task adherence states, with a full decision audit trail
 * (golden journey #7, Lane C packet M6-B).
 *
 * OBSERVE-ONLY BY DESIGN: this module COMPUTES adherence state. It never
 * restricts, notifies, or punishes anything — a missed task records
 * {@link AdherenceState} `"missed"` and nothing restrictive happens here.
 * Any restriction lives in `engine.ts`, and only under an explicit,
 * authorized, configured {@link AdherencePolicy}.
 *
 * Window semantics mirror the M4-A task scheduler (`@orbb/measurement`
 * scheduler.ts, the REAL task/window types — this package imports them,
 * it does not re-model them):
 *   - windows are half-open `[startsAt, endsAt)` in pure UTC milliseconds;
 *     the due instant is `endsAt`;
 *   - a window has ELAPSED at decision time `nowMs` iff
 *     `endsAt <= nowMs` (boundary inclusive: at exactly `endsAt` the
 *     window is closed — the same elapsed rule the scheduler's
 *     roll-forward uses);
 *   - `rollCount` records how many missed windows this task was rolled
 *     forward through (identity preserved).
 *
 * State derivation (deterministic, total over validated snapshots):
 *   - task completed:
 *       - `rollCount > 0`                 -> `recovered`
 *         (reason `completed-after-roll-forward`: missed, then completed
 *         in a later allowed window);
 *       - `completedAt > window.endsAt`   -> `recovered`
 *         (reason `completed-after-window`: late completion, e.g. of a
 *         backfill-materialized historical window);
 *       - otherwise                       -> `on-track`
 *         (reason `completed-in-window`).
 *     RECORDED ASSUMPTION: a completion recorded exactly AT the due
 *     instant (`completedAt === endsAt`) counts as within-window — the
 *     due instant belongs to the task it closes.
 *   - task open:
 *       - window elapsed                  -> `missed` (`window-elapsed`);
 *       - window not yet elapsed          -> `on-track` (`window-open`).
 *
 * The result is a typed {@link AdherenceResult} — expected rejections
 * (malformed snapshots) are typed errors, never throws. All error
 * details are PHID-safe structural field paths; values are never echoed.
 */
import { isIdOf, type PersonId, type PlanId, type TaskId } from "@orbb/domain";
import {
  TASK_STATES,
  type MeasurementTask,
  type MeasurementWindow,
  type TaskState,
} from "@orbb/measurement";
import { canonicalJsonStringify, sha256Hex } from "./canonical.js";
import { err, ok, type AdherenceResult } from "./result.js";
import {
  isAdherenceState,
  isAdherenceStateReason,
  type AdherenceState,
  type AdherenceStateReason,
} from "./states.js";

// ---------------------------------------------------------------------------
// Input: the task snapshot to evaluate.
// ---------------------------------------------------------------------------

/**
 * One task's adherence snapshot — the scheduler's `MeasurementTask`
 * shape plus the completion instant (which the capture pipeline's
 * attempt records carry; the scheduler's task record does not).
 */
export interface AdherenceTaskSnapshot {
  readonly taskId: TaskId;
  readonly planId: PlanId;
  readonly personId: PersonId;
  readonly metricId: string;
  /** The CURRENT window of the task record (after any roll-forwards). */
  readonly window: MeasurementWindow;
  readonly taskState: TaskState;
  /** How many missed windows this task was rolled forward through. */
  readonly rollCount: number;
  /** Completion instant — REQUIRED iff `taskState === "completed"`. */
  readonly completedAt?: Date;
}

/**
 * Bridges a scheduler `MeasurementTask` (plus the completion instant
 * derived from the capture pipeline's attempt records) into an
 * {@link AdherenceTaskSnapshot}. Pure; defensive copies of dates.
 */
export function adherenceSnapshotFromTask(
  task: MeasurementTask,
  completedAt?: Date,
): AdherenceTaskSnapshot {
  const base = {
    taskId: task.id,
    planId: task.planId,
    personId: task.personId,
    metricId: task.metricId,
    window: {
      sequence: task.window.sequence,
      startsAt: new Date(task.window.startsAt.getTime()),
      endsAt: new Date(task.window.endsAt.getTime()),
    },
    taskState: task.state,
    rollCount: task.rollCount,
  };
  if (completedAt !== undefined) {
    return { ...base, completedAt: new Date(completedAt.getTime()) };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Output: the evaluation + its audit trail.
// ---------------------------------------------------------------------------

/** One ordered decision step in the evaluation audit trail. */
export interface AdherenceEvaluationStep {
  /** Machine code of the step (e.g. "window-elapsed-check"). */
  readonly step: string;
  /** PHID-safe structural detail (field paths / enum outcomes only). */
  readonly detail?: string;
}

/** The adherence evaluation of one task. */
export interface AdherenceEvaluation {
  readonly taskId: TaskId;
  readonly state: AdherenceState;
  readonly reason: AdherenceStateReason;
  /** Ordered audit trail of how `state` was derived from the snapshot. */
  readonly steps: readonly AdherenceEvaluationStep[];
  /** Decision instant (from the injected clock at the caller boundary). */
  readonly evaluatedAtMs: number;
}

/** PHID-safe typed rejection kinds for malformed snapshots. */
export type AdherenceEvaluationError = {
  readonly kind: "invalid-snapshot";
  /** Structural field path of the violated invariant (never the value). */
  readonly field: string;
};

// ---------------------------------------------------------------------------
// The pure evaluator.
// ---------------------------------------------------------------------------

/**
 * Evaluates one task snapshot's adherence state at `nowMs` (UTC epoch
 * milliseconds). Deterministic: identical (snapshot, nowMs) pairs produce
 * identical evaluations, always. Never throws — malformed snapshots
 * resolve to the typed rejection `{ kind: "invalid-snapshot" }`.
 */
export function evaluateAdherenceSnapshot(
  snapshot: AdherenceTaskSnapshot,
  nowMs: number,
): AdherenceResult<AdherenceEvaluation, AdherenceEvaluationError> {
  const validation = validateSnapshot(snapshot, nowMs);
  if (validation !== undefined) {
    return err(validation);
  }

  const steps: AdherenceEvaluationStep[] = [];
  steps.push({ step: "task-state", detail: snapshot.taskState });

  if (snapshot.taskState === "completed") {
    const completedAtMs = snapshot.completedAt?.getTime() ?? 0;
    if (snapshot.rollCount > 0) {
      steps.push({ step: "roll-history", detail: "rollCount>0" });
      steps.push({ step: "completion", detail: "after-roll-forward" });
      return ok(
        finishEvaluation(snapshot, nowMs, "recovered", "completed-after-roll-forward", steps),
      );
    }
    if (completedAtMs > snapshot.window.endsAt.getTime()) {
      steps.push({ step: "completion", detail: "after-window-end" });
      return ok(
        finishEvaluation(snapshot, nowMs, "recovered", "completed-after-window", steps),
      );
    }
    steps.push({ step: "completion", detail: "in-window" });
    return ok(finishEvaluation(snapshot, nowMs, "on-track", "completed-in-window", steps));
  }

  const elapsed = snapshot.window.endsAt.getTime() <= nowMs;
  steps.push({
    step: "window-elapsed-check",
    detail: elapsed ? "endsAt<=now" : "endsAt>now",
  });
  if (elapsed) {
    return ok(finishEvaluation(snapshot, nowMs, "missed", "window-elapsed", steps));
  }
  return ok(finishEvaluation(snapshot, nowMs, "on-track", "window-open", steps));
}

/**
 * Deterministic digest of an evaluation (canonical JSON + SHA-256) —
 * the replay/idempotency proof token used by the determinism tests.
 */
export function adherenceEvaluationDigest(evaluation: AdherenceEvaluation): string {
  return sha256Hex(
    canonicalJsonStringify({
      state: evaluation.state,
      reason: evaluation.reason,
      steps: evaluation.steps,
      taskId: evaluation.taskId,
    }),
  );
}

function finishEvaluation(
  snapshot: AdherenceTaskSnapshot,
  nowMs: number,
  state: AdherenceState,
  reason: AdherenceStateReason,
  steps: readonly AdherenceEvaluationStep[],
): AdherenceEvaluation {
  const evaluation: AdherenceEvaluation = {
    taskId: snapshot.taskId,
    state,
    reason,
    steps: steps.map((step) => ({ ...step })),
    evaluatedAtMs: nowMs,
  };
  // Defensive: the derived vocabulary is closed over by construction.
  if (!isAdherenceState(state) || !isAdherenceStateReason(reason)) {
    throw new TypeError("Adherence evaluation produced an out-of-vocabulary state.");
  }
  return evaluation;
}

function validateSnapshot(
  snapshot: AdherenceTaskSnapshot,
  nowMs: number,
): AdherenceEvaluationError | undefined {
  if (typeof snapshot !== "object" || snapshot === null) {
    return { kind: "invalid-snapshot", field: "snapshot" };
  }
  if (!isIdOf("task", snapshot.taskId)) {
    return { kind: "invalid-snapshot", field: "taskId" };
  }
  if (!isIdOf("plan", snapshot.planId)) {
    return { kind: "invalid-snapshot", field: "planId" };
  }
  if (!isIdOf("person", snapshot.personId)) {
    return { kind: "invalid-snapshot", field: "personId" };
  }
  if (typeof snapshot.metricId !== "string" || snapshot.metricId.length === 0) {
    return { kind: "invalid-snapshot", field: "metricId" };
  }
  if (!isValidDate(snapshot.window?.startsAt) || !isValidDate(snapshot.window?.endsAt)) {
    return { kind: "invalid-snapshot", field: "window" };
  }
  if (snapshot.window.startsAt.getTime() >= snapshot.window.endsAt.getTime()) {
    return { kind: "invalid-snapshot", field: "window.bounds" };
  }
  if (
    !Number.isInteger(snapshot.window.sequence) ||
    snapshot.window.sequence < 0
  ) {
    return { kind: "invalid-snapshot", field: "window.sequence" };
  }
  if (!(TASK_STATES as readonly string[]).includes(snapshot.taskState)) {
    return { kind: "invalid-snapshot", field: "taskState" };
  }
  if (!Number.isInteger(snapshot.rollCount) || snapshot.rollCount < 0) {
    return { kind: "invalid-snapshot", field: "rollCount" };
  }
  if (snapshot.taskState === "completed") {
    if (!isValidDate(snapshot.completedAt)) {
      return { kind: "invalid-snapshot", field: "completedAt" };
    }
  } else if (snapshot.completedAt !== undefined) {
    return { kind: "invalid-snapshot", field: "completedAt.inconsistent" };
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    return { kind: "invalid-snapshot", field: "nowMs" };
  }
  return undefined;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
