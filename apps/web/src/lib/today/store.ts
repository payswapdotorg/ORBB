/**
 * In-memory Today task store (M6-B B4, Lane B): process-local module state
 * backing the `/api/tasks` route stub — the same stub-store pattern as the
 * M4-B capture store and the M6-A intent/plan store.
 *
 * Semantics:
 *   - Seeded ONCE per process from the deterministic SYNTH fixtures
 *     (resumable across client reloads inside the server session, like the
 *     capture store — no external persistence, no network beyond the local
 *     route stub).
 *   - The ONLY state transition is `open -> completed`, mirroring the A30
 *     scheduler's task states (a task completes when an acceptable-quality
 *     attempt lands — the A31 rule; the consumer surface's job is to route
 *     the person into a real capture path, never to fabricate a completion).
 *   - Completing an already-completed task is a typed rejection
 *     (`task-already-completed`) — idempotency stays the caller's retry
 *     discipline, the same convention as the M5-C review acts.
 *   - Progress is DERIVED (pure `computeIntentProgress` over the current
 *     views), never stored — conservative clinical states only, no streaks,
 *     no punitive framing (§Accessibility design rules).
 *
 * PHI-safety: completion stamps record only the route handler's "now" and
 * the fixture task id; no values, no notes, no person fields beyond the
 * SYNTH fixture person.
 */

import {
  TODAY_PERSON_ID,
  TODAY_REFERENCE_DATE_LABEL,
  TODAY_REFERENCE_NOW_ISO,
  TODAY_TASK_VIEWS,
  computeIntentProgress,
} from "./fixtures";
import { formatTimeLabel } from "../capture/format";
import type {
  TodayIntentProgress,
  TodayTaskView,
} from "./types";

/** The full Today board payload (wire form of GET /api/tasks). */
export interface TodayBoard {
  readonly synthetic: true;
  readonly personId: string;
  readonly referenceDateLabel: string;
  readonly tasks: readonly TodayTaskView[];
  readonly progress: readonly TodayIntentProgress[];
}

/** Typed completion rejections (PHI-safe, values never echoed). */
export type TodayCompleteError =
  | { readonly kind: "task-not-found" }
  | { readonly kind: "task-already-completed" };

export type TodayCompleteResult =
  | { readonly ok: true; readonly task: TodayTaskView; readonly progress: readonly TodayIntentProgress[] }
  | { readonly ok: false; readonly error: TodayCompleteError };

/** Mutable stored task state (fixtures cloned into it at seed time). */
interface StoredTask {
  view: TodayTaskView;
  completedAt: Date | undefined;
}

const storedTasks = new Map<string, StoredTask>();

function cloneView(view: TodayTaskView): TodayTaskView {
  return {
    ...view,
    task: {
      ...view.task,
      window: {
        sequence: view.task.window.sequence,
        startsAt: new Date(view.task.window.startsAt.getTime()),
        endsAt: new Date(view.task.window.endsAt.getTime()),
      },
      createdAt: new Date(view.task.createdAt.getTime()),
    },
  };
}

function referenceNow(): Date {
  return new Date(TODAY_REFERENCE_NOW_ISO);
}

function storedViewToView(stored: StoredTask): TodayTaskView {
  const view = cloneView(stored.view);
  if (stored.completedAt !== undefined) {
    return {
      ...view,
      task: { ...view.task, state: "completed" },
      windowPhase: "completed",
      completedAt: stored.completedAt.toISOString(),
      completedLabel: `Completed today at ${formatTimeLabel(stored.completedAt)}`,
    };
  }
  return view;
}

// Seed once at module load (deterministic; test reset below).
for (const view of TODAY_TASK_VIEWS) {
  storedTasks.set(view.task.id, { view: cloneView(view), completedAt: undefined });
}

/** Resets the store to the seeded fixtures (test-only). */
export function resetTodayStore(): void {
  storedTasks.clear();
  for (const view of TODAY_TASK_VIEWS) {
    storedTasks.set(view.task.id, { view: cloneView(view), completedAt: undefined });
  }
}

/** The current board: task views (fixture order) + derived progress. */
export function listTodayBoard(): TodayBoard {
  const tasks = [...storedTasks.values()].map(storedViewToView);
  const progress = computeIntentProgress(tasks, referenceNow());
  return {
    synthetic: true,
    personId: TODAY_PERSON_ID,
    referenceDateLabel: TODAY_REFERENCE_DATE_LABEL,
    tasks,
    progress,
  };
}

/**
 * Marks a task completed at `now` (the route handler's clock). The single
 * legal transition (open -> completed — A30 vocabulary); typed rejections
 * for unknown ids and repeat completions. Pure store mutation, no values
 * recorded.
 */
export function completeTodayTask(taskId: string, now: Date): TodayCompleteResult {
  const stored = storedTasks.get(taskId);
  if (stored === undefined) {
    return { ok: false, error: { kind: "task-not-found" } };
  }
  if (stored.completedAt !== undefined || stored.view.task.state === "completed") {
    return { ok: false, error: { kind: "task-already-completed" } };
  }
  stored.completedAt = now;
  const board = listTodayBoard();
  const task = board.tasks.find((candidate) => candidate.task.id === taskId);
  if (task === undefined) {
    return { ok: false, error: { kind: "task-not-found" } };
  }
  return { ok: true, task, progress: board.progress };
}

/** Finds a single task view by id (the capture-context lookup). */
export function findTodayTask(taskId: string): TodayTaskView | undefined {
  const stored = storedTasks.get(taskId);
  return stored === undefined ? undefined : storedViewToView(stored);
}
