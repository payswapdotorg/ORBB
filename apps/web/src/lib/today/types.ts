/**
 * Today-surface view model (M6-B B4, Lane B) — types only.
 *
 * The Today surface is intent-driven (frozen UI/UX architecture
 * §Navigation model): it answers what the person is trying to accomplish,
 * what matters today, which measurement is due, why it is due, and the
 * easiest valid way to complete it — NOT a dashboard of charts.
 *
 * REAL ENGINE TYPES: the stored task records are the REAL `@orbb/measurement`
 * scheduler exports (`MeasurementTask`, `MeasurementWindow`, `TaskState` —
 * A30) imported as TYPES from the workspace package (added to
 * apps/web dependencies for this packet; see `store.ts` for why the import
 * is type-only). The UX projections below (due-window labels, reason,
 * acceptable methods with burden ordering, estimated effort, privacy
 * impact, fallback) are Lane-B view fields layered on top — the frozen
 * §Measurement task UX card contract:
 * `metric | due window | reason | acceptable methods | estimated effort |
 * privacy impact | fallback`.
 *
 * Wire form (the M6-A discipline): Date windows are serialized as ISO-8601
 * strings at the `/api/today` boundary, exactly like the intent journey
 * types; branded domain ids stay widened to plain strings here.
 */

import type {
  MeasurementTask,
  MeasurementWindow,
  TaskState,
} from "@orbb/measurement";

// ---------------------------------------------------------------------------
// Task-state vocabulary (A30 `TASK_STATES` runtime mirror).
// ---------------------------------------------------------------------------

/**
 * Mirror of the frozen `TASK_STATES` vocabulary (`open` | `completed`).
 *
 * RECORDED HANDOFF: `@orbb/measurement` resolves at runtime to its compiled
 * `dist/` entry, which is not built during `next dev`/Playwright runs (the
 * package is read-only to this packet, so its `main` cannot be repointed at
 * source). Runtime VALUE imports would therefore break the dev server and
 * e2e harness — only `import type` is safe (erased at compile time). The
 * state vocabulary is mirrored here field-for-field; at engine wiring the
 * mirror swaps for the real export with no call-site changes.
 */
export const TODAY_TASK_STATES = ["open", "completed"] as const;

export type TodayTaskState = TaskState;

export function isTodayTaskState(value: unknown): value is TodayTaskState {
  return (
    typeof value === "string" &&
    (TODAY_TASK_STATES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Stored task record (the REAL scheduler shape + Lane-B completion record).
// ---------------------------------------------------------------------------

/**
 * The stored task record: the REAL A30 `MeasurementTask` (type import from
 * the workspace package — the scheduler's exact field set) plus the Lane-B
 * completion side-record (the capture that fulfilled it). The engine's
 * task-store port owns lifecycle; the completion link is the capture
 * journey's write (recorded handoff: at engine wiring the A31 attempt
 * recorder becomes this seam).
 */
export interface TodayTaskRecord {
  /** The REAL A30 scheduler task (id, plan, metric, window, state, rolls). */
  readonly task: MeasurementTask;
  /** Present once the task was fulfilled through the capture journey. */
  readonly completion?: TodayTaskCompletion;
}

/** How a task was fulfilled (the manual-capture act that completed it). */
export interface TodayTaskCompletion {
  /** The capture record id (`SYNTH-CAP-…`, the M4-B store's key). */
  readonly captureId: string;
  /** Observation ids the capture produced (one per captured field). */
  readonly observationIds: readonly string[];
  /** When the completion was recorded (ISO-8601). */
  readonly completedAt: string;
}

// ---------------------------------------------------------------------------
// Acceptable-method landscape (the card's "acceptable methods" field).
// ---------------------------------------------------------------------------

/** Availability of one acceptable method for the current session. */
export type TodayMethodAvailability = "available" | "not-connected";

/** One acceptable method of a task, ordered least-burden FIRST. */
export interface TodayMethodView {
  /** SYNTH-marked method id (M4-B catalog / M4-C seam vocabulary). */
  readonly methodId: string;
  /** Human label (e.g. "Manual entry — home BP cuff reading"). */
  readonly label: string;
  /** The method kind (M5-B burden-model vocabulary: manual | app | device). */
  readonly kind: "manual" | "app" | "device";
  /** Burden rank (lower = less burden; the frozen ordering device 1 < app 2 < manual 3). */
  readonly relativeBurden: number;
  /** Estimated effort label (e.g. "~2 min" or "automatic — ~0 min"). */
  readonly estimatedEffortLabel: string;
  /** Privacy impact label (what leaves the device, if anything). */
  readonly privacyImpactLabel: string;
  /** Availability for THIS session (device seams can be not-connected yet). */
  readonly availability: TodayMethodAvailability;
  /** Availability detail (never silent about seams). */
  readonly availabilityNote: string;
}

// ---------------------------------------------------------------------------
// Task view (the wire form the card renders).
// ---------------------------------------------------------------------------

/** The measurement window in wire form (ISO-8601 strings). */
export interface TodayWindowView {
  readonly sequence: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * The task card's wire form — every frozen §Measurement task UX field:
 * metric, due window, reason, acceptable methods (least-burden first),
 * estimated effort, privacy impact, fallback.
 */
export interface TodayTaskView {
  readonly taskId: string;
  readonly planId: string;
  readonly intentId: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  /** The M4-B capture shape that fulfills this task through the capture flow. */
  readonly captureShapeId: string;
  readonly state: TodayTaskState;
  readonly window: TodayWindowView;
  /** Due-window label (e.g. "Due by end of today" / "Window missed — was due …"). */
  readonly dueWindowLabel: string;
  /** Why the measurement is due (the owning intent + plan). */
  readonly reason: string;
  /** Missed-window marker (fully-past open window; the card surfaces the fallback). */
  readonly missedWindow: boolean;
  readonly rollCount: number;
  /** Acceptable methods, LEAST-BURDEN VALID OPTION FIRST. */
  readonly methods: readonly TodayMethodView[];
  /** Method-count label (e.g. "2 methods available"). */
  readonly methodCountLabel: string;
  /** Primary completion route label (the easiest valid way). */
  readonly primaryRouteLabel: string;
  /** The task-level estimated effort (the primary route's). */
  readonly estimatedEffortLabel: string;
  /** The task-level privacy impact (the primary route's). */
  readonly privacyImpactLabel: string;
  /** Fallback option (clinic/CHW vocabulary from the SYNTH catalog). */
  readonly fallback: TodayFallbackView;
  /** Present when completed (the capture link + provenance affordance). */
  readonly completion?: TodayTaskCompletion;
}

/** The fallback option surfaced on the card (explicit for missed windows). */
export interface TodayFallbackView {
  /** SYNTH-marked provider/organization vocabulary. */
  readonly providers: readonly string[];
  readonly label: string;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Intent summary (the "what am I trying to accomplish" header).
// ---------------------------------------------------------------------------

/**
 * Per-intent progress: conservative clinical states only — completed/due
 * counts, never streaks, scores, or punitive framing (§Design system).
 */
export interface TodayProgressView {
  /** Tasks of this intent completed today. */
  readonly completedToday: number;
  /** Tasks of this intent currently due (open, any window state). */
  readonly dueNow: number;
  /** Human label (e.g. "1 of 1 due today completed"). */
  readonly label: string;
}

/** One active intent the Today surface is serving. */
export interface TodayIntentSummary {
  readonly intentId: string;
  /** The objective statement (the person's own words, M6-A composer shape). */
  readonly objective: string;
  readonly metricLabel: string;
  /** Plan label (e.g. "Daily blood pressure monitoring"). */
  readonly planLabel: string;
  readonly planId: string;
  /** Plan lifecycle state (fixtures are ACTIVE — the scheduler's precondition). */
  readonly planState: "active";
  readonly progress: TodayProgressView;
}

// ---------------------------------------------------------------------------
// Wire types (client <-> /api/today).
// ---------------------------------------------------------------------------

/** `GET /api/today` response body. */
export interface TodayListResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly intents: readonly TodayIntentSummary[];
  readonly tasks: readonly TodayTaskView[];
  /** The reference instant the surface was computed at (ISO-8601). */
  readonly generatedAt: string;
}

/** `POST /api/today` request body (the task-completion act). */
export interface TodayCompleteRequest {
  readonly taskId: string;
  /** The capture record that fulfilled the task (must exist, any state). */
  readonly captureId: string;
}

/** `POST /api/today` success body. */
export interface TodayCompleteResponse {
  readonly synthetic: true;
  readonly task: TodayTaskView;
  readonly intents: readonly TodayIntentSummary[];
}

// ---------------------------------------------------------------------------
// Error envelope (the app's M3-A style, mirrored from the capture types:
// PHI-safe by construction — messages describe the violated invariant and
// never echo received values).
// ---------------------------------------------------------------------------

export type TodayErrorCode =
  | "invalid-request"
  | "validation-failed"
  | "not-found"
  | "conflict"
  | "internal-error";

/** Field-level validation issue (field PATH + problem; values never echoed). */
export interface TodayIssue {
  readonly field: string;
  readonly problem: string;
}

export interface TodayErrorEnvelope {
  readonly error: {
    readonly code: TodayErrorCode;
    readonly message: string;
    readonly details?: { readonly issues: readonly TodayIssue[] };
    readonly requestId: string;
  };
}

// ---------------------------------------------------------------------------
// Client-side payload guards (untrusted JSON from our own route).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type guard: is `payload` a successful today-list response? */
export function isTodayListResponse(payload: unknown): payload is TodayListResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true || !isNonEmptyString(payload.personId)) {
    return false;
  }
  return Array.isArray(payload.tasks) && Array.isArray(payload.intents);
}

/** Type guard: is `payload` a successful task-completion response? */
export function isTodayCompleteResponse(payload: unknown): payload is TodayCompleteResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true) {
    return false;
  }
  const task = payload.task;
  return isPlainObject(task) && isNonEmptyString(task.taskId) && Array.isArray(payload.intents);
}

/** Type guard: is `payload` a today error envelope? */
export function isTodayErrorEnvelope(payload: unknown): payload is TodayErrorEnvelope {
  if (!isPlainObject(payload)) {
    return false;
  }
  const error = payload.error;
  if (!isPlainObject(error)) {
    return false;
  }
  return isNonEmptyString(error.code) && isNonEmptyString(error.message);
}

// ---------------------------------------------------------------------------
// Re-exported engine types (the REAL shapes, for callers that want them).
// ---------------------------------------------------------------------------

export type { MeasurementTask, MeasurementWindow, TaskState };
