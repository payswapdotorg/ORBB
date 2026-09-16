/**
 * Today fixtures (M6-B B4, Lane B) — deterministic SYNTH task fixtures.
 *
 * Agent-protocol test-data rules (binding):
 *   - Zero PHI. Every identity-like string is SYNTH-marked; values are
 *     obviously synthetic numbers from the M4-B catalog guard ranges.
 *   - No wall-clock values: the synthetic session pins a FIXED reference
 *     instant (2026-09-10T08:20Z — the M3-B DataBox convention, whose
 *     fixtures label 2026-09-10 as "Today"). Due labels are pre-formatted
 *     and timezone-free so e2e journeys stay byte-stable.
 *
 * Fixture contract (the packet's required coverage):
 *   1. a DUE-TODAY task (blood pressure, morning window, in-window at the
 *      reference instant);
 *   2. a MISSED-WINDOW task (body weight, yesterday evening's window
 *      missed under the A30 default roll-forward policy — rollCount 1,
 *      the card surfaces the clinic/CHW fallback explicitly);
 *   3. tasks with 2+ ACCEPTABLE METHODS (blood pressure: manual entry +
 *      automatic cuff sync; least-burden VALID option first);
 *   4. a COMPLETED task (resting heart rate, completed this morning via
 *      the wearable-sync device route, mirroring the M3-B DataBox
 *      evidence SYNTH-EV-0001 "Resting heart rate series — wearable sync").
 *
 * Engine-shape fidelity: the embedded task records satisfy the REAL
 * `MeasurementTask` type imported type-only from `@orbb/measurement`
 * (A30 scheduler), and their ids satisfy the canonical domain id grammar
 * (`task_<body>`, body 16–128 chars of [A-Za-z0-9_-] — see
 * `packages/measurement/src/ids.ts`). One engine task per PLAN METRIC:
 * the blood-pressure panel fulfills the systolic plan task (the plan
 * metric); the diastolic observation rides the same capture act in the
 * M4-B store (recorded assumption, mirrors the M6-A intent vocabulary
 * where the seeded intent is on bp-systolic).
 */

import type {
  MeasurementTask,
  PlanId,
  TaskId,
} from "@orbb/measurement";

/** PersonId as carried by the engine task record (not re-exported directly). */
type PersonId = MeasurementTask["personId"];
import type {
  TodayIntentProgress,
  TodayMethodOption,
  TodayTaskFallback,
  TodayTaskView,
  TodayWindowPhase,
} from "./types";

/** The fixed synthetic reference instant (the session's "now"). */
export const TODAY_REFERENCE_NOW_ISO = "2026-09-10T08:20:00.000Z";

/** Human label of the reference date (timeline/day labels). */
export const TODAY_REFERENCE_DATE_LABEL = "Sep 10, 2026";

/** The synthetic person of the web session (the M4-B capture-catalog id). */
export const TODAY_PERSON_ID = "prsn_SYNTH-person-0001";

// ---------------------------------------------------------------------------
// Method options (mirroring the M4-B capture-catalog vocabulary).
// ---------------------------------------------------------------------------

const BP_MANUAL_METHOD: TodayMethodOption = {
  id: "SYNTH-method-manual-bp-panel",
  label: "Manual entry — home BP cuff reading",
  kind: "manual",
  evidenceLabel: "MEASURED",
  relativeBurden: 3,
  hint: "Type the reading from your cuff display",
  available: true,
};

const BP_DEVICE_METHOD: TodayMethodOption = {
  id: "SYNTH-method-cuff-bp-panel",
  label: "Automatic cuff sync",
  kind: "device",
  evidenceLabel: "IMPORTED",
  relativeBurden: 2,
  hint: "Device · not available yet (device integration)",
  available: false,
};

const HR_MANUAL_METHOD: TodayMethodOption = {
  id: "SYNTH-method-manual-heart-rate",
  label: "Manual pulse check",
  kind: "manual",
  evidenceLabel: "MEASURED",
  relativeBurden: 3,
  hint: "Count your pulse for a minute",
  available: true,
};

const HR_DEVICE_METHOD: TodayMethodOption = {
  id: "SYNTH-method-wearable-heart-rate",
  label: "Wearable sync",
  kind: "device",
  evidenceLabel: "IMPORTED",
  relativeBurden: 1,
  hint: "Device · not available yet (device integration)",
  available: false,
};

const WEIGHT_MANUAL_METHOD: TodayMethodOption = {
  id: "SYNTH-method-manual-body-weight",
  label: "Manual entry — scale reading",
  kind: "manual",
  evidenceLabel: "MEASURED",
  relativeBurden: 3,
  hint: "Type the reading from your bathroom scale",
  available: true,
};

const WEIGHT_DEVICE_METHOD: TodayMethodOption = {
  id: "SYNTH-method-scale-body-weight",
  label: "Scale sync",
  kind: "device",
  evidenceLabel: "IMPORTED",
  relativeBurden: 2,
  hint: "Device · not available yet (device integration)",
  available: false,
};

// ---------------------------------------------------------------------------
// Fallbacks (the SYNTH clinic/CHW services vocabulary).
// ---------------------------------------------------------------------------

const CLINIC_CHW_FALLBACK: TodayTaskFallback = {
  available: true,
  label: "Clinic or CHW fallback",
  description:
    "If you cannot complete this measurement yourself, a clinic visit or a community health worker (CHW) can record it for you — the observation keeps full provenance of who captured it.",
  providerIds: ["SYNTH-Clinic-A", "SYNTH-CHW-2"],
};

const NO_FALLBACK: TodayTaskFallback = {
  available: false,
  label: "No fallback needed",
  description:
    "This measurement only makes sense captured by you at home — there is no clinic/CHW fallback for it.",
  providerIds: [],
};

// ---------------------------------------------------------------------------
// The engine-shaped task records (A30 vocabulary, canonical id grammar).
// ---------------------------------------------------------------------------

/**
 * Hand-crafted SYNTH ids that satisfy the canonical domain id grammar
 * (`<prefix>_<body>`, body 16–128 chars of [A-Za-z0-9_-] — the A30
 * deterministic-id grammar). The casts only widen the string literal to
 * the branded id type; grammar compliance is unit-tested.
 */
function synthTaskId(body: string): TaskId {
  return `task_${body}` as TaskId;
}

function synthPlanId(body: string): PlanId {
  return `plan_${body}` as PlanId;
}

function synthPersonId(body: string): PersonId {
  return `prsn_${body}` as PersonId;
}

const BP_TASK_RECORD: MeasurementTask = {
  id: synthTaskId("SYNTH-task-today-bp-0001"),
  planId: synthPlanId("SYNTH-bp-systolic-bpsys-manual-2x-day"),
  personId: synthPersonId("SYNTH-person-0001"),
  metricId: "SYNTH-metric-bp-systolic",
  conceptCode: "SYNTH-8480-5",
  methodOrder: [
    "SYNTH-method-manual-bp-panel",
    "SYNTH-method-cuff-bp-panel",
  ],
  window: {
    sequence: 0,
    startsAt: new Date("2026-09-10T07:00:00.000Z"),
    endsAt: new Date("2026-09-10T09:00:00.000Z"),
  },
  state: "open",
  createdAt: new Date("2026-09-09T12:00:00.000Z"),
  rollCount: 0,
};

const BP_EVENING_TASK_RECORD: MeasurementTask = {
  id: synthTaskId("SYNTH-task-bp-evening-0002"),
  planId: synthPlanId("SYNTH-bp-systolic-bpsys-manual-2x-day"),
  personId: synthPersonId("SYNTH-person-0001"),
  metricId: "SYNTH-metric-bp-systolic",
  conceptCode: "SYNTH-8480-5",
  methodOrder: [
    "SYNTH-method-manual-bp-panel",
    "SYNTH-method-cuff-bp-panel",
  ],
  window: {
    sequence: 1,
    startsAt: new Date("2026-09-10T19:00:00.000Z"),
    endsAt: new Date("2026-09-10T21:00:00.000Z"),
  },
  state: "open",
  createdAt: new Date("2026-09-09T12:00:00.000Z"),
  rollCount: 0,
};

const WEIGHT_TASK_RECORD: MeasurementTask = {
  id: synthTaskId("SYNTH-task-weight-0003"),
  planId: synthPlanId("SYNTH-weight-scale-manual-1x-day"),
  personId: synthPersonId("SYNTH-person-0001"),
  metricId: "SYNTH-metric-body-weight",
  conceptCode: "SYNTH-29463-7",
  methodOrder: [
    "SYNTH-method-manual-body-weight",
    "SYNTH-method-scale-body-weight",
  ],
  // The ORIGINAL window (Sep 9, 19:00–21:00 UTC) was missed; under the
  // A30 default roll-forward policy the task re-anchored to today's grid
  // window (sequence 1). rollCount records the miss.
  window: {
    sequence: 1,
    startsAt: new Date("2026-09-10T19:00:00.000Z"),
    endsAt: new Date("2026-09-10T21:00:00.000Z"),
  },
  state: "open",
  createdAt: new Date("2026-09-08T12:00:00.000Z"),
  rollCount: 1,
};

const HR_TASK_RECORD: MeasurementTask = {
  id: synthTaskId("SYNTH-task-hr-morning-0004"),
  planId: synthPlanId("SYNTH-hr-rhr-watch-1x-day"),
  personId: synthPersonId("SYNTH-person-0001"),
  metricId: "SYNTH-metric-heart-rate",
  conceptCode: "SYNTH-8867-4",
  methodOrder: [
    "SYNTH-method-wearable-heart-rate",
    "SYNTH-method-manual-heart-rate",
  ],
  window: {
    sequence: 0,
    startsAt: new Date("2026-09-10T06:00:00.000Z"),
    endsAt: new Date("2026-09-10T09:00:00.000Z"),
  },
  state: "completed",
  createdAt: new Date("2026-09-09T12:00:00.000Z"),
  rollCount: 0,
};

// ---------------------------------------------------------------------------
// The task card views.
// ---------------------------------------------------------------------------

const BP_INTENT_LABEL = "Lower blood pressure";
const BP_PLAN_LABEL = "Blood pressure monitoring — 2 readings a day";

const WEIGHT_INTENT_LABEL = "Maintain a steady weight";
const WEIGHT_PLAN_LABEL = "Weight tracking — 1 reading a day";

const HR_INTENT_LABEL = "Keep an eye on resting heart rate";
const HR_PLAN_LABEL = "Resting heart rate — 1 reading a day";

export const TODAY_TASK_VIEWS: readonly TodayTaskView[] = [
  {
    task: BP_TASK_RECORD,
    intentLabel: BP_INTENT_LABEL,
    planLabel: BP_PLAN_LABEL,
    metricLabel: "Blood pressure (systolic + diastolic)",
    captureShapeId: "SYNTH-shape-bp-panel",
    windowPhase: "due-now",
    dueLabel: "Due by 09:00",
    reason: "Supports your blood-pressure monitoring plan",
    methods: [BP_MANUAL_METHOD, BP_DEVICE_METHOD],
    estimatedEffort: "~2 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: CLINIC_CHW_FALLBACK,
  },
  {
    task: BP_EVENING_TASK_RECORD,
    intentLabel: BP_INTENT_LABEL,
    planLabel: BP_PLAN_LABEL,
    metricLabel: "Blood pressure (systolic + diastolic)",
    captureShapeId: "SYNTH-shape-bp-panel",
    windowPhase: "due-later-today",
    dueLabel: "Due by 21:00 tonight",
    reason: "Supports your blood-pressure monitoring plan",
    methods: [BP_MANUAL_METHOD, BP_DEVICE_METHOD],
    estimatedEffort: "~2 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: CLINIC_CHW_FALLBACK,
  },
  {
    task: WEIGHT_TASK_RECORD,
    intentLabel: WEIGHT_INTENT_LABEL,
    planLabel: WEIGHT_PLAN_LABEL,
    metricLabel: "Body weight",
    captureShapeId: "SYNTH-shape-body-weight",
    windowPhase: "missed",
    dueLabel: "Missed yesterday 21:00 — rolled forward to today 21:00",
    reason: "Supports your weight-tracking plan",
    methods: [WEIGHT_MANUAL_METHOD, WEIGHT_DEVICE_METHOD],
    estimatedEffort: "~1 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: CLINIC_CHW_FALLBACK,
  },
  {
    task: HR_TASK_RECORD,
    intentLabel: HR_INTENT_LABEL,
    planLabel: HR_PLAN_LABEL,
    metricLabel: "Resting heart rate",
    captureShapeId: "SYNTH-shape-heart-rate",
    windowPhase: "completed",
    dueLabel: "Was due by 09:00",
    reason: "Supports your resting-heart-rate plan",
    // Presentation order: least-burden VALID option first (§Measurement
    // task UX) — the manual pulse check is the completable route today;
    // the engine's methodOrder above still prefers the wearable chain.
    methods: [HR_MANUAL_METHOD, HR_DEVICE_METHOD],
    estimatedEffort: "~1 min",
    privacyImpact: "Private — stays in your DataBox",
    fallback: NO_FALLBACK,
    completedAt: "2026-09-10T08:05:00.000Z",
    completedLabel: "Completed today at 08:05 — wearable sync (IMPORTED)",
  },
];

// ---------------------------------------------------------------------------
// Deterministic presentation derivations (pure, unit-tested).
// ---------------------------------------------------------------------------

/**
 * Classifies a task's window phase against a reference instant.
 * Pure: completed tasks report "completed"; open tasks with a recorded
 * roll-forward report "missed" (the card leads with the miss); an open
 * task inside (or past) its window reports "due-now"; a later window on
 * the same day reports "due-later-today".
 */
export function classifyWindowPhase(
  task: MeasurementTask,
  referenceNow: Date,
): TodayWindowPhase {
  if (task.state === "completed") {
    return "completed";
  }
  if (task.rollCount > 0) {
    return "missed";
  }
  const nowMs = referenceNow.getTime();
  if (task.window.startsAt.getTime() <= nowMs) {
    return "due-now";
  }
  return "due-later-today";
}

/** True when a task's CURRENT window falls on the reference instant's day (UTC). */
export function isWindowToday(task: MeasurementTask, referenceNow: Date): boolean {
  const dayOf = (value: Date): string => value.toISOString().slice(0, 10);
  return dayOf(task.window.endsAt) === dayOf(referenceNow);
}

/**
 * Per-intent progress over the fixture views (conservative clinical
 * states — counts only, never gamified). Pure.
 */
export function computeIntentProgress(
  views: readonly TodayTaskView[],
  referenceNow: Date,
): readonly TodayIntentProgress[] {
  const order: string[] = [];
  const byIntent = new Map<string, { due: number; completed: number }>();
  for (const view of views) {
    if (!isWindowToday(view.task, referenceNow)) {
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
