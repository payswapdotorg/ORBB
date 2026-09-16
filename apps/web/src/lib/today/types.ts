/**
 * Today/measurement-task view model (M6-B B4, Lane B) — types only.
 *
 * The task lane is shaped by the REAL `@orbb/measurement` exports: the
 * engine's `MeasurementTask`, `MeasurementWindow` and task states
 * (`TASK_STATES`: open | completed — A30 scheduler vocabulary). The types
 * are imported TYPE-ONLY (`import type`) from the workspace package:
 * `apps/web` now declares `@orbb/measurement` as a workspace dependency,
 * and every import in this tree is type-only, so no runtime/dist coupling
 * exists (the engine wiring at integration can swap the store for the real
 * `TaskScheduler` + `InMemoryMeasurementTaskStore` without touching the
 * view — handoff recorded).
 *
 * The PRESENTATION layer (card fields) is lane-local: the frozen
 * §Measurement task UX card contract is
 *   `metric | due window | reason | acceptable methods | estimated effort
 *    | privacy impact | fallback`,
 * and those fields are derived from the plan/intent semantics, not from
 * the engine's task record — so this module defines view types that WRAP
 * the engine task, never re-shape it.
 *
 * Vocabulary mirrors (recorded, typed against the imported engine types so
 * drift fails typecheck):
 *   - task states: TASK_STATES (value) is engine-side; the local
 *     `TODAY_TASK_STATES` constant mirrors it for runtime use and is typed
 *     `readonly TaskState[]` so an upstream vocabulary change breaks the
 *     build, not the UI.
 *   - fallback vocabulary: the SYNTH catalog's clinic/CHW fallback
 *     (services vocabulary, §Measurement task UX example: "clinic/CHW
 *     fallback") — fixtures carry SYNTH-marked provider ids.
 */

import type {
  MeasurementTask,
  MeasurementWindow,
  TaskState,
} from "@orbb/measurement";

export type { MeasurementTask, MeasurementWindow, TaskState };

// ---------------------------------------------------------------------------
// Mirrored vocabulary (runtime constants typed against the engine types).
// ---------------------------------------------------------------------------

/**
 * Runtime mirror of the engine `TASK_STATES` (A30). Typed against the
 * imported `TaskState` so a vocabulary drift upstream fails typecheck
 * here. The engine constant itself is a value export and would create a
 * runtime (dist) dependency — deliberately avoided (recorded handoff).
 */
export const TODAY_TASK_STATES: readonly TaskState[] = ["open", "completed"];

export function isTodayTaskState(value: unknown): value is TaskState {
  return (
    typeof value === "string" &&
    (TODAY_TASK_STATES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Method options (the "acceptable methods" card field).
// ---------------------------------------------------------------------------

/**
 * How a method reaches the person. Mirrors the A28 capability-index
 * source kinds (manual | device | app) plus the SYNTH fixture seam
 * (`synthesized` — fixture-only observations that arrive pre-seeded, so
 * the DataBox/observation surfaces can teach provenance states the
 * capture path does not produce yet).
 */
export const TODAY_METHOD_KINDS = ["manual", "device", "app", "synthesized"] as const;

export type TodayMethodKind = (typeof TODAY_METHOD_KINDS)[number];

/** One acceptable method of a task, in burden order (least burden FIRST). */
export interface TodayMethodOption {
  /** Opaque method code (SYNTH-marked, M4-B capture-catalog vocabulary). */
  readonly id: string;
  /** Human label (e.g. "Manual entry — home BP cuff reading"). */
  readonly label: string;
  readonly kind: TodayMethodKind;
  /** The evidence label observations from this method carry (teach, never hide). */
  readonly evidenceLabel: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  /** Relative burden rank (lower = less burden; the A28 domain ordering). */
  readonly relativeBurden: number;
  /** One-line "why this is the easy way" note. */
  readonly hint: string;
  /**
   * Whether this method is actually completable in the current product.
   * Device/app seams exist in the landscape but are not wired yet
   * (M4-C future) — they render as visible-but-disabled so the least-burden
   * landscape is honest, never fake.
   */
  readonly available: boolean;
}

// ---------------------------------------------------------------------------
// Fallback (the missed-window / cannot-complete path).
// ---------------------------------------------------------------------------

/** The fallback option surfaced on a task card (§Measurement task UX). */
export interface TodayTaskFallback {
  /** True when a fallback is offered for this task at all. */
  readonly available: boolean;
  /** Human summary, e.g. "Clinic or CHW visit can record this for you". */
  readonly label: string;
  /** Short explanation of what the fallback does and what it costs. */
  readonly description: string;
  /** SYNTH-marked provider/service ids backing the fallback (vocabulary). */
  readonly providerIds: readonly string[];
}

// ---------------------------------------------------------------------------
// The task card view.
// ---------------------------------------------------------------------------

/**
 * What a due-window presentation looks like. `phase` classifies the task's
 * window against the SYNTH reference date; `label` is the pre-formatted,
 * timezone-free display string (fixtures pin the synthetic reference
 * date — the M3-B DataBox convention, no wall-clock values).
 */
export type TodayWindowPhase = "due-now" | "due-later-today" | "missed" | "completed";

export interface TodayTaskView {
  /** The engine-shaped task record (A30 vocabulary, ids SYNTH-marked). */
  readonly task: MeasurementTask;
  /** Intent + plan display labels ("what am I trying to accomplish"). */
  readonly intentLabel: string;
  readonly planLabel: string;
  /** Metric display (e.g. "Blood pressure (systolic + diastolic)"). */
  readonly metricLabel: string;
  /** M4-B capture-catalog shape that fulfills this task manually, if any. */
  readonly captureShapeId?: string;
  /** Due-window presentation. */
  readonly windowPhase: TodayWindowPhase;
  /** Pre-formatted due label, e.g. "Due by 09:00" / "Missed yesterday evening — rolled forward". */
  readonly dueLabel: string;
  /** Why this measurement is due (the plan's reason, human words). */
  readonly reason: string;
  /** Acceptable methods, LEAST BURDEN FIRST (§Measurement task UX). */
  readonly methods: readonly TodayMethodOption[];
  /** Estimated effort (e.g. "~2 min"). */
  readonly estimatedEffort: string;
  /** Privacy impact statement (conservative, human words). */
  readonly privacyImpact: string;
  /** The fallback option (explicit on missed-window cards). */
  readonly fallback: TodayTaskFallback;
  /** When the task completed (present iff state === "completed"). */
  readonly completedAt?: string;
  /** Pre-formatted completion label ("Completed today at 08:12"). */
  readonly completedLabel?: string;
}

// ---------------------------------------------------------------------------
// Per-intent progress (conservative clinical states — never gamified).
// ---------------------------------------------------------------------------

/**
 * Progress for ONE intent today: counts only, conservative wording, no
 * streaks, no punitive framing (§Accessibility/design rules). `dueToday`
 * counts the tasks whose window belongs to the SYNTH reference day
 * (including missed ones rolled into it); `completedToday` the ones done.
 */
export interface TodayIntentProgress {
  readonly intentLabel: string;
  readonly completedToday: number;
  readonly dueToday: number;
  /** Human sentence, e.g. "1 of 2 measurements completed today." */
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// Wire types (GET /api/tasks response bodies).
// ---------------------------------------------------------------------------

export interface TodayTaskListResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly referenceDateLabel: string;
  readonly tasks: readonly TodayTaskView[];
  readonly progress: readonly TodayIntentProgress[];
}

export interface TodayTaskCompleteRequest {
  readonly taskId: string;
}

export interface TodayTaskCompleteResponse {
  readonly synthetic: true;
  readonly task: TodayTaskView;
  readonly progress: readonly TodayIntentProgress[];
}

/** Error envelope (the app's M3-A error-envelope style, PHI-safe). */
export interface TodayTaskErrorEnvelope {
  readonly error: {
    readonly code: "invalid-request" | "task-not-found" | "task-already-completed" | "internal-error";
    readonly message: string;
  };
}

export function isTodayTaskListResponse(payload: unknown): payload is TodayTaskListResponse {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.synthetic === true &&
    typeof record.personId === "string" &&
    Array.isArray(record.tasks) &&
    Array.isArray(record.progress)
  );
}

export function isTodayTaskCompleteResponse(
  payload: unknown,
): payload is TodayTaskCompleteResponse {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.synthetic === true &&
    typeof record.task === "object" &&
    record.task !== null &&
    Array.isArray(record.progress)
  );
}

export function isTodayTaskErrorEnvelope(payload: unknown): payload is TodayTaskErrorEnvelope {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error !== "object" || record.error === null) {
    return false;
  }
  const error = record.error as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
}
