/**
 * Mobile Today model (M6-B B4, Lane B) — pure data + pure functions.
 *
 * The task lane mirrors the REAL `@orbb/measurement` exports
 * (`MeasurementTask`, `MeasurementWindow`, TASK_STATES) — a STRUCTURAL
 * MIRROR, field-for-field with the same vocabularies and semantics, ids
 * satisfying the canonical domain grammar (`task_<body>` etc.). Why a
 * local mirror: `apps/mobile` declares only `@orbb/ui` + the RN/Expo
 * stack; the engine wiring at integration promotes this mirror to the
 * real types (handoff recorded — the same discipline as the M4-B/M6-A
 * mobile mirrors).
 *
 * Fixtures mirror the web Today fixtures exactly (same four tasks, same
 * windows, same SYNTH vocabulary) so the two surfaces teach one story:
 *   1. a due-today blood-pressure task (2 acceptable methods);
 *   2. a missed-window weight task (rolled forward, clinic/CHW fallback
 *      surfaced explicitly);
 *   3. a completed resting-heart-rate task (wearable import).
 *
 * No React Native imports in this module — plain-node unit-testable (the
 * `src/navigation/tabs.ts` discipline).
 */

// ---------------------------------------------------------------------------
// Mirrored engine types (A30 scheduler vocabulary).
// ---------------------------------------------------------------------------

/** Task lifecycle states (the engine `TaskState` mirror). */
export const TASK_STATES = ["open", "completed"] as const;

export type TaskState = (typeof TASK_STATES)[number];

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && (TASK_STATES as readonly string[]).includes(value);
}

/** A measurement window: half-open [startsAt, endsAt); the due instant is `endsAt`. */
export interface MeasurementWindow {
  readonly sequence: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * A measurement task: the engine `MeasurementTask` mirror (ISO strings for
 * the wire form; ids satisfy the canonical grammar, SYNTH-marked bodies).
 */
export interface MeasurementTask {
  readonly id: string;
  readonly planId: string;
  readonly personId: string;
  readonly metricId: string;
  readonly conceptCode: string;
  readonly methodOrder: readonly string[];
  readonly window: MeasurementWindow;
  readonly state: TaskState;
  readonly createdAt: string;
  readonly rollCount: number;
}

// ---------------------------------------------------------------------------
// Presentation vocabulary (the §Measurement task UX card fields).
// ---------------------------------------------------------------------------

export const METHOD_KINDS = ["manual", "device", "app"] as const;

export type MethodKind = (typeof METHOD_KINDS)[number];

/** One acceptable method, least-burden VALID option first. */
export interface TaskMethodOption {
  readonly id: string;
  readonly label: string;
  readonly kind: MethodKind;
  readonly evidenceLabel: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  readonly hint: string;
  readonly available: boolean;
}

export interface TaskFallback {
  readonly available: boolean;
  readonly label: string;
  readonly description: string;
  readonly providerIds: readonly string[];
}

export type TaskWindowPhase = "due-now" | "due-later-today" | "missed" | "completed";

export interface TodayTaskView {
  readonly task: MeasurementTask;
  readonly intentLabel: string;
  readonly planLabel: string;
  readonly metricLabel: string;
  readonly captureShapeId?: string;
  readonly windowPhase: TaskWindowPhase;
  readonly dueLabel: string;
  readonly reason: string;
  readonly methods: readonly TaskMethodOption[];
  readonly estimatedEffort: string;
  readonly privacyImpact: string;
  readonly fallback: TaskFallback;
  readonly completedLabel?: string;
}

export interface IntentProgress {
  readonly intentLabel: string;
  readonly completedToday: number;
  readonly dueToday: number;
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// The reference instant (the pinned SYNTH date — no wall clock).
// ---------------------------------------------------------------------------

export const TODAY_REFERENCE_NOW_ISO = "2026-09-10T08:20:00.000Z";

// ---------------------------------------------------------------------------
// The fixtures (mirroring the web lib/today/fixtures.ts exactly).
// ---------------------------------------------------------------------------

const BP_MANUAL: TaskMethodOption = {
  id: "SYNTH-method-manual-bp-panel",
  label: "Manual entry — home BP cuff reading",
  kind: "manual",
  evidenceLabel: "MEASURED",
  hint: "Type the reading from your cuff display",
  available: true,
};

const BP_DEVICE: TaskMethodOption = {
  id: "SYNTH-method-cuff-bp-panel",
  label: "Automatic cuff sync",
  kind: "device",
  evidenceLabel: "IMPORTED",
  hint: "Device · not available yet (device integration)",
  available: false,
};

const HR_MANUAL: TaskMethodOption = {
  id: "SYNTH-method-manual-heart-rate",
  label: "Manual pulse check",
  kind: "manual",
  evidenceLabel: "MEASURED",
  hint: "Count your pulse for a minute",
  available: true,
};

const HR_DEVICE: TaskMethodOption = {
  id: "SYNTH-method-wearable-heart-rate",
  label: "Wearable sync",
  kind: "device",
  evidenceLabel: "IMPORTED",
  hint: "Device · not available yet (device integration)",
  available: false,
};

const WEIGHT_MANUAL: TaskMethodOption = {
  id: "SYNTH-method-manual-body-weight",
  label: "Manual entry — scale reading",
  kind: "manual",
  evidenceLabel: "MEASURED",
  hint: "Type the reading from your bathroom scale",
  available: true,
};

const WEIGHT_DEVICE: TaskMethodOption = {
  id: "SYNTH-method-scale-body-weight",
  label: "Scale sync",
  kind: "device",
  evidenceLabel: "IMPORTED",
  hint: "Device · not available yet (device integration)",
  available: false,
};

const CLINIC_CHW_FALLBACK: TaskFallback = {
  available: true,
  label: "Clinic or CHW fallback",
  description:
    "If you cannot complete this measurement yourself, a clinic visit or a community health worker (CHW) can record it for you — the observation keeps full provenance of who captured it.",
  providerIds: ["SYNTH-Clinic-A", "SYNTH-CHW-2"],
};

const NO_FALLBACK: TaskFallback = {
  available: false,
  label: "No fallback needed",
  description:
    "This measurement only makes sense captured by you at home — there is no clinic/CHW fallback for it.",
  providerIds: [],
};

export const TODAY_TASKS: readonly TodayTaskView[] = [
  {
    task: {
      id: "task_SYNTH-task-today-bp-0001",
      planId: "plan_SYNTH-bp-systolic-bpsys-manual-2x-day",
      personId: "prsn_SYNTH-person-0001",
      metricId: "SYNTH-metric-bp-systolic",
      conceptCode: "SYNTH-8480-5",
      methodOrder: ["SYNTH-method-manual-bp-panel", "SYNTH-method-cuff-bp-panel"],
      window: {
        sequence: 0,
        startsAt: "2026-09-10T07:00:00.000Z",
        endsAt: "2026-09-10T09:00:00.000Z",
      },
      state: "open",
      createdAt: "2026-09-09T12:00:00.000Z",
      rollCount: 0,
    },
    intentLabel: "Lower blood pressure",
    planLabel: "Blood pressure monitoring — 2 readings a day",
    metricLabel: "Blood pressure (systolic + diastolic)",
    captureShapeId: "SYNTH-shape-bp-panel",
    windowPhase: "due-now",
    dueLabel: "Due by 09:00",
    reason: "Supports your blood-pressure monitoring plan",
    methods: [BP_MANUAL, BP_DEVICE],
    estimatedEffort: "~2 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: CLINIC_CHW_FALLBACK,
  },
  {
    task: {
      id: "task_SYNTH-task-bp-evening-0002",
      planId: "plan_SYNTH-bp-systolic-bpsys-manual-2x-day",
      personId: "prsn_SYNTH-person-0001",
      metricId: "SYNTH-metric-bp-systolic",
      conceptCode: "SYNTH-8480-5",
      methodOrder: ["SYNTH-method-manual-bp-panel", "SYNTH-method-cuff-bp-panel"],
      window: {
        sequence: 1,
        startsAt: "2026-09-10T19:00:00.000Z",
        endsAt: "2026-09-10T21:00:00.000Z",
      },
      state: "open",
      createdAt: "2026-09-09T12:00:00.000Z",
      rollCount: 0,
    },
    intentLabel: "Lower blood pressure",
    planLabel: "Blood pressure monitoring — 2 readings a day",
    metricLabel: "Blood pressure (systolic + diastolic)",
    captureShapeId: "SYNTH-shape-bp-panel",
    windowPhase: "due-later-today",
    dueLabel: "Due by 21:00 tonight",
    reason: "Supports your blood-pressure monitoring plan",
    methods: [BP_MANUAL, BP_DEVICE],
    estimatedEffort: "~2 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: CLINIC_CHW_FALLBACK,
  },
  {
    task: {
      id: "task_SYNTH-task-weight-0003",
      planId: "plan_SYNTH-weight-scale-manual-1x-day",
      personId: "prsn_SYNTH-person-0001",
      metricId: "SYNTH-metric-body-weight",
      conceptCode: "SYNTH-29463-7",
      methodOrder: ["SYNTH-method-manual-body-weight", "SYNTH-method-scale-body-weight"],
      window: {
        sequence: 1,
        startsAt: "2026-09-10T19:00:00.000Z",
        endsAt: "2026-09-10T21:00:00.000Z",
      },
      state: "open",
      createdAt: "2026-09-08T12:00:00.000Z",
      rollCount: 1,
    },
    intentLabel: "Maintain a steady weight",
    planLabel: "Weight tracking — 1 reading a day",
    metricLabel: "Body weight",
    captureShapeId: "SYNTH-shape-body-weight",
    windowPhase: "missed",
    dueLabel: "Missed yesterday 21:00 — rolled forward to today 21:00",
    reason: "Supports your weight-tracking plan",
    methods: [WEIGHT_MANUAL, WEIGHT_DEVICE],
    estimatedEffort: "~1 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: CLINIC_CHW_FALLBACK,
  },
  {
    task: {
      id: "task_SYNTH-task-hr-morning-0004",
      planId: "plan_SYNTH-hr-rhr-watch-1x-day",
      personId: "prsn_SYNTH-person-0001",
      metricId: "SYNTH-metric-heart-rate",
      conceptCode: "SYNTH-8867-4",
      methodOrder: ["SYNTH-method-wearable-heart-rate", "SYNTH-method-manual-heart-rate"],
      window: {
        sequence: 0,
        startsAt: "2026-09-10T06:00:00.000Z",
        endsAt: "2026-09-10T09:00:00.000Z",
      },
      state: "completed",
      createdAt: "2026-09-09T12:00:00.000Z",
      rollCount: 0,
    },
    intentLabel: "Keep an eye on resting heart rate",
    planLabel: "Resting heart rate — 1 reading a day",
    metricLabel: "Resting heart rate",
    captureShapeId: "SYNTH-shape-heart-rate",
    windowPhase: "completed",
    dueLabel: "Was due by 09:00",
    reason: "Supports your resting-heart-rate plan",
    methods: [HR_MANUAL, HR_DEVICE],
    estimatedEffort: "~1 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: NO_FALLBACK,
    completedLabel: "Completed today at 08:05 — wearable sync (IMPORTED)",
  },
];

// ---------------------------------------------------------------------------
// Pure derivations.
// ---------------------------------------------------------------------------

/** Classifies a window phase against the reference instant (pure). */
export function classifyWindowPhase(task: MeasurementTask): TaskWindowPhase {
  if (task.state === "completed") {
    return "completed";
  }
  if (task.rollCount > 0) {
    return "missed";
  }
  const nowMs = new Date(TODAY_REFERENCE_NOW_ISO).getTime();
  if (new Date(task.window.startsAt).getTime() <= nowMs) {
    return "due-now";
  }
  return "due-later-today";
}

/** Per-intent progress over the task views (counts only — never gamified). */
export function computeIntentProgress(
  views: readonly TodayTaskView[],
): readonly IntentProgress[] {
  const referenceDay = TODAY_REFERENCE_NOW_ISO.slice(0, 10);
  const order: string[] = [];
  const byIntent = new Map<string, { due: number; completed: number }>();
  for (const view of views) {
    if (view.task.window.endsAt.slice(0, 10) !== referenceDay) {
      continue;
    }
    let entry = byIntent.get(view.intentLabel);
    if (entry === undefined) {
      entry = { due: 0, completed: 0 };
      byIntent.set(view.intentLabel, entry);
      order.push(view.intentLabel);
    }
    entry.due += 1;
    if (view.task.state === "completed") {
      entry.completed += 1;
    }
  }
  return order.map((intentLabel) => {
    const entry = byIntent.get(intentLabel);
    const completed = entry?.completed ?? 0;
    const due = entry?.due ?? 0;
    return {
      intentLabel,
      completedToday: completed,
      dueToday: due,
      summary: `${completed} of ${due} measurements completed today.`,
    };
  });
}

/** The board state (the session's task store — pure derivation over it). */
export interface TodayBoard {
  readonly tasks: readonly TodayTaskView[];
  readonly progress: readonly IntentProgress[];
}

/**
 * Builds the Today board from the completion overlay (the ids completed
 * this session). Pure — the screen owns the overlay state.
 */
export function buildTodayBoard(
  completedTaskIds: readonly string[],
): TodayBoard {
  const completed = new Set(completedTaskIds);
  const tasks = TODAY_TASKS.map((view) => {
    if (!completed.has(view.task.id) || view.task.state === "completed") {
      return view;
    }
    return {
      ...view,
      task: { ...view.task, state: "completed" as const },
      windowPhase: "completed" as const,
      completedLabel:
        view.completedLabel ?? "Completed — recorded by you with full provenance",
    };
  });
  return { tasks, progress: computeIntentProgress(tasks) };
}
