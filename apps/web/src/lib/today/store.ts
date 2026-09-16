/**
 * In-memory Today-surface store (M6-B B4, Lane B): process-local module
 * state backing the `/api/today` route stub — the same stub-store pattern
 * as the M4-B capture store and the M6-A intent store.
 *
 * STORED SHAPE: every task record embeds the REAL A30 `MeasurementTask`
 * (type-only import from `@orbb/measurement` — see `types.ts` for the
 * recorded reason) plus the Lane-B completion side-record.
 *
 * DETERMINISTIC SEEDING (the packet's requirement: "deterministic SYNTH
 * fixtures, resumable, no network"):
 *   - Task ids are fixed SYNTH strings (no clock hashing) — re-seeding
 *     reproduces the identical task set (same ids, same semantic content).
 *   - Windows are anchored to the LOCAL calendar day of the seeding
 *     instant (start-of-day / end-of-day / fixed morning hours). The
 *     golden journey stays completable at any hour of the day: the
 *     due-today windows span the whole day.
 *   - RECORDED ASSUMPTION: the architecture's example card says "due by
 *     09:00"; a morning-anchored window would make the due-today journey
 *     hour-dependent (missed after 09:00). The fixtures therefore use
 *     whole-day windows ("due by end of today") while keeping the A30
 *     window semantics ([startsAt, endsAt) UTC-ms half-open windows).
 *   - The missed-window fixture (body weight) represents a task whose
 *     window closed yesterday while the scheduler has not re-run since
 *     (A30 roll-forward happens on the next schedule run — the surface
 *     shows the missed window honestly and surfaces the fallback).
 *   - RESUMABLE: the store persists in-process across navigations and
 *     route reads; completions survive page reloads within the dev
 *     session (the same resumability level as the M4-B capture store —
 *     persistence beyond the process is the db-adapter handoff).
 *
 * COMPLETION SEMANTICS: the ONLY state transition is open -> completed
 * (A30's `TASK_STATES`), and it happens ONLY through
 * {@link completeTodayTask} with a REAL capture from the M4-B capture
 * store (the capture that fulfilled the task). A completed task can never
 * re-open; a second completion is a typed `conflict` rejection.
 */

import type { MeasurementTask, MeasurementWindow, TaskState } from "@orbb/measurement";
import { CAPTURE_SHAPES } from "../capture/catalog";
import { listRecentCaptures } from "../capture/store";
import {
  TODAY_FALLBACK,
  TODAY_INTENT_FIXTURES,
  TODAY_METHOD_LANDSCAPES,
  TODAY_DEVICE_SOURCE_ID,
  TODAY_MANUAL_SOURCE_ID,
  TODAY_PERSON_ID,
} from "./catalog";
import type {
  TodayIntentSummary,
  TodayMethodView,
  TodayProgressView,
  TodayTaskRecord,
  TodayTaskView,
} from "./types";

// ---------------------------------------------------------------------------
// Seeded task ids (fixed SYNTH identities — determinism anchors).
// ---------------------------------------------------------------------------

/** The seeded blood-pressure task (due today; 2 methods: cuff seam + manual). */
export const TODAY_TASK_BP_ID = "task_SYNTH-today-bp-000001";

/** The seeded heart-rate task (due today; 2 methods: wearable + manual). */
export const TODAY_TASK_HR_ID = "task_SYNTH-today-hr-000002";

/** The seeded body-weight task (missed window — fallback surfaced). */
export const TODAY_TASK_WEIGHT_ID = "task_SYNTH-today-wt-000003";

/** The seeded sleep task (completed earlier today via manual estimate). */
export const TODAY_TASK_SLEEP_ID = "task_SYNTH-today-sleep-000004";

// ---------------------------------------------------------------------------
// Local-day window math (deterministic per calendar day).
// ---------------------------------------------------------------------------

/** Milliseconds of one day (windows never span more than a day here). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local start-of-day of the given instant. */
function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

/** Local end-of-day (exclusive) of the given instant's day. */
function endOfDay(at: Date): Date {
  const start = startOfDay(at);
  return new Date(start.getTime() + DAY_MS);
}

/**
 * Asserts a fixture id satisfies the frozen canonical-id grammar
 * (`<prefix>_<body>` with a SYNTH-marked body of 16–128 id characters) —
 * the domain `isIdOf` precondition, applied before the branded narrowing.
 */
function assertCanonicalIdGrammar(prefix: string, id: string): void {
  const body = id.slice(prefix.length + 1);
  if (
    !id.startsWith(`${prefix}_`) ||
    body.length < 16 ||
    body.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(body)
  ) {
    throw new Error(`Fixture id violates the canonical id grammar: ${id}`);
  }
}

/** A window on the given day between fixed local hours. */
function windowForHours(at: Date, startHour: number, endHour: number): MeasurementWindow {
  const day = startOfDay(at);
  return {
    sequence: 0,
    startsAt: new Date(day.getTime() + startHour * 60 * 60 * 1000),
    endsAt: new Date(day.getTime() + endHour * 60 * 60 * 1000),
  };
}

// ---------------------------------------------------------------------------
// Module state (process-local, seeded once per process).
// ---------------------------------------------------------------------------

/** Insertion-ordered task records. */
const taskRecords = new Map<string, TodayTaskRecord>();

/** True once the deterministic seed ran (idempotent re-seed guard). */
let seeded = false;

/** Seeds the deterministic SYNTH fixture tasks relative to `now`. */
function seedTasks(now: Date): void {
  if (seeded) {
    return;
  }
  seeded = true;

  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - DAY_MS);

  const seed = (
    taskId: string,
    planId: string,
    metricId: string,
    conceptCode: string,
    methodOrder: readonly string[],
    window: MeasurementWindow,
    state: TaskState,
    rollCount: number,
    completion?: TodayTaskRecord["completion"],
  ): void => {
    // The REAL A30 shape: branded canonical ids (grammar `task_|plan_|prsn_`
    // + SYNTH body) — asserted, then narrowed to the branded types via
    // indexed-access casts (the ids are fixture constants, checked below).
    assertCanonicalIdGrammar("task", taskId);
    assertCanonicalIdGrammar("plan", planId);
    assertCanonicalIdGrammar("prsn", TODAY_PERSON_ID);
    const task: MeasurementTask = {
      id: taskId as MeasurementTask["id"],
      planId: planId as MeasurementTask["planId"],
      personId: TODAY_PERSON_ID as MeasurementTask["personId"],
      metricId,
      conceptCode,
      methodOrder,
      window,
      state,
      createdAt: yesterday,
      rollCount,
    };
    taskRecords.set(taskId, { task, ...(completion !== undefined ? { completion } : {}) });
  };

  // 1. DUE TODAY — blood pressure (two acceptable methods; the manual
  //    route is the valid completion path — the cuff seam is not connected).
  //    Whole-day half-open window [00:00, 23:59:59.999) — see header note.
  seed(
    TODAY_TASK_BP_ID,
    "plan_SYNTH-today-bp-daily-0001",
    "SYNTH-metric-bp-systolic",
    "SYNTH-8480-5",
    ["SYNTH-method-cuff-bp-panel", "SYNTH-method-manual-bp-panel"],
    { sequence: 0, startsAt: today, endsAt: new Date(endOfDay(now).getTime() - 1) },
    "open",
    0,
  );

  // 2. DUE TODAY — heart rate (two acceptable methods; the registered
  //    wearable is the least-burden valid option — the source golden
  //    journey #2 imports from).
  seed(
    TODAY_TASK_HR_ID,
    "plan_SYNTH-today-hr-daily-0002",
    "SYNTH-metric-heart-rate",
    "SYNTH-8867-4",
    ["SYNTH-method-wearable-heart-rate", "SYNTH-method-manual-heart-rate"],
    { sequence: 0, startsAt: today, endsAt: new Date(endOfDay(now).getTime() - 1) },
    "open",
    0,
  );

  // 3. MISSED WINDOW — body weight (yesterday's 07:00–09:00 morning
  //    window; open task, scheduler has not re-run since it closed, so
  //    no roll-forward yet — the surface surfaces the missed state and
  //    the clinic/CHW fallback explicitly).
  seed(
    TODAY_TASK_WEIGHT_ID,
    "plan_SYNTH-today-wt-mornings-0003",
    "SYNTH-metric-body-weight",
    "SYNTH-29463-7",
    ["SYNTH-method-manual-body-weight"],
    windowForHours(yesterday, 7, 9),
    "open",
    0,
  );

  // 4. COMPLETED — sleep duration (logged from memory this morning —
  //    an ESTIMATED observation; the completion links to the seeded
  //    fixture capture id below, consistent with the observations store).
  //    completedAt stays inside today and never in the future (early-hours
  //    sessions see an early-morning completion instant instead).
  const sleepCompletedAt = new Date(
    Math.max(
      today.getTime() + 60 * 1000,
      Math.min(today.getTime() + 7 * 60 * 60 * 1000 + 12 * 60 * 1000, now.getTime() - 60 * 1000),
    ),
  );
  seed(
    TODAY_TASK_SLEEP_ID,
    "plan_SYNTH-today-sleep-daily-0004",
    "SYNTH-metric-sleep-minutes",
    "SYNTH-94641-0",
    ["SYNTH-method-manual-sleep-minutes"],
    windowForHours(now, 5, 9),
    "completed",
    0,
    {
      captureId: "SYNTH-CAP-SEED-SLEEP",
      observationIds: ["obs_SYNTH-obs-seed-sleep-0001"],
      completedAt: sleepCompletedAt.toISOString(),
    },
  );
}

// ---------------------------------------------------------------------------
// View projection (pure).
// ---------------------------------------------------------------------------

/** Due-window label for a window at the given `now`. */
export function dueWindowLabel(
  window: MeasurementWindow,
  now: Date,
): { label: string; missed: boolean } {
  const endsMs = window.endsAt.getTime();
  const nowMs = now.getTime();
  const timeLabel = formatTimePart(window.endsAt);
  if (endsMs > nowMs) {
    // Whole-day windows (ending within the last minute of the day) read as
    // "Due by end of today"; tighter windows carry their clock time.
    const endsAtDayEnd = endOfDay(window.endsAt).getTime() - endsMs < 60 * 1000;
    if (endsAtDayEnd) {
      return { label: "Due by end of today", missed: false };
    }
    return { label: `Due by ${timeLabel}`, missed: false };
  }
  return { label: `Window missed — was due ${formatDayTime(window.endsAt, now)}`, missed: true };
}

/** Formats a clock time as HH:MM (24h, deterministic). */
function formatTimePart(at: Date): string {
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Formats a past instant relative to `now` (yesterday/day label + time). */
function formatDayTime(at: Date, now: Date): string {
  const daysAgo = Math.round(
    (startOfDay(now).getTime() - startOfDay(at).getTime()) / DAY_MS,
  );
  const day =
    daysAgo === 1 ? "yesterday" : daysAgo === 0 ? "today" : `${daysAgo} days ago`;
  return `${day} at ${formatTimePart(at)}`;
}

/** Maps a method fixture to its view (availability per session sources). */
function methodView(
  shapeId: string,
  methodId: string,
): TodayMethodView | undefined {
  const landscape = TODAY_METHOD_LANDSCAPES[shapeId];
  const fixture = landscape?.find((candidate) => candidate.methodId === methodId);
  if (fixture === undefined) {
    return undefined;
  }
  const availability =
    fixture.requiresSource === "unregistered-seam"
      ? ("not-connected" as const)
      : ("available" as const);
  return {
    methodId: fixture.methodId,
    label: fixture.label,
    kind: fixture.kind,
    relativeBurden: fixture.relativeBurden,
    estimatedEffortLabel: fixture.estimatedEffortLabel,
    privacyImpactLabel: fixture.privacyImpactLabel,
    availability,
    availabilityNote: fixture.availabilityNote,
  };
}

/** The capture shape that fulfills a metric (the M4-B catalog's shape). */
function captureShapeIdForMetric(metricId: string): string | undefined {
  const shape = CAPTURE_SHAPES.find((candidate) =>
    candidate.fields.some((field) => field.metric.id === metricId),
  );
  return shape?.id;
}

/** Projects a stored task record into the card's wire view. */
export function toTodayTaskView(
  record: TodayTaskRecord,
  now: Date,
): TodayTaskView {
  const { task, completion } = record;
  const intent = findTodayIntentFixtureByPlan(task.planId);
  const shapeId = captureShapeIdForMetric(task.metricId) ?? "";
  const methods = task.methodOrder
    .map((methodId) => methodView(shapeId, methodId))
    .filter((view): view is TodayMethodView => view !== undefined);
  // Least-burden VALID (available) option first; not-connected seams stay
  // visible AFTER the valid options (never ahead of them).
  const ordered = [
    ...methods.filter((view) => view.availability === "available"),
    ...methods.filter((view) => view.availability !== "available"),
  ];
  const primary = ordered.find((view) => view.availability === "available");
  const window = dueWindowLabel(task.window, now);
  const metricLabel =
    CAPTURE_SHAPES.flatMap((shape) => shape.fields).find(
      (field) => field.metric.id === task.metricId,
    )?.metric.displayName ?? task.metricId;
  return {
    taskId: task.id,
    planId: task.planId,
    intentId: intent?.intentId ?? "",
    metricId: task.metricId,
    metricLabel,
    conceptCode: task.conceptCode,
    captureShapeId: shapeId,
    state: task.state,
    window: {
      sequence: task.window.sequence,
      startsAt: task.window.startsAt.toISOString(),
      endsAt: task.window.endsAt.toISOString(),
    },
    dueWindowLabel: window.label,
    missedWindow: window.missed,
    reason:
      intent !== undefined
        ? `Supports "${intent.objective}" — ${intent.planLabel} (${intent.planId})`
        : `Supports ${task.planId}`,
    rollCount: task.rollCount,
    methods: ordered,
    methodCountLabel:
      methods.length === 1 ? "1 method available" : `${methods.length} methods available`,
    primaryRouteLabel: primary?.label ?? "Manual entry",
    estimatedEffortLabel: primary?.estimatedEffortLabel ?? "~2 min",
    privacyImpactLabel:
      primary?.privacyImpactLabel ??
      "Private — stays in your DataBox; nothing is shared.",
    fallback: TODAY_FALLBACK,
    ...(completion !== undefined ? { completion } : {}),
  };
}

function findTodayIntentFixtureByPlan(planId: string) {
  return TODAY_INTENT_FIXTURES.find((fixture) => fixture.planId === planId);
}

// ---------------------------------------------------------------------------
// Progress (per-intent, conservative clinical states only).
// ---------------------------------------------------------------------------

/** Computes an intent's progress from its task records (pure). */
export function todayProgressOf(
  records: readonly TodayTaskRecord[],
  now: Date,
): TodayProgressView {
  const todayStart = startOfDay(now).getTime();
  let completedToday = 0;
  let dueNow = 0;
  for (const record of records) {
    if (record.task.state === "completed") {
      if (
        record.completion !== undefined &&
        new Date(record.completion.completedAt).getTime() >= todayStart
      ) {
        completedToday += 1;
      }
      continue;
    }
    dueNow += 1;
  }
  const label =
    dueNow === 0
      ? `${completedToday} completed — nothing due right now.`
      : `${completedToday} of ${completedToday + dueNow} due measurements completed.`;
  return { completedToday, dueNow, label };
}

// ---------------------------------------------------------------------------
// Read models.
// ---------------------------------------------------------------------------

/** Lists the task views in display order (open due first, then completed). */
export function listTodayTasks(now: Date): readonly TodayTaskView[] {
  seedTasks(now);
  const records = [...taskRecords.values()].map((record) => ({
    record,
    view: toTodayTaskView(record, now),
  }));
  const openRank = (view: TodayTaskView): number => {
    if (view.state !== "open") {
      return 2; // completed last
    }
    return view.missedWindow ? 1 : 0; // due-today first, missed after
  };
  return records
    .sort((a, b) => openRank(a.view) - openRank(b.view) || a.view.taskId.localeCompare(b.view.taskId))
    .map((entry) => entry.view);
}

/**
 * Lists the STORED task records (the REAL A30 scheduler snapshots plus
 * completion side-records), in insertion order — the read seam the M6-exit
 * reminder chain derives its fixture reminders from (the mirrored B8
 * engine consumes task snapshots the same way). Seeds deterministically
 * on first read; read-only projection: callers never mutate the records.
 */
export function listTodayTaskRecords(now: Date): readonly TodayTaskRecord[] {
  seedTasks(now);
  return [...taskRecords.values()];
}

/** Lists the active-intent summaries with per-intent progress. */
export function listTodayIntents(now: Date): readonly TodayIntentSummary[] {
  seedTasks(now);
  return TODAY_INTENT_FIXTURES.map((fixture) => {
    const owned = [...taskRecords.values()].filter(
      (record) => record.task.planId === fixture.planId,
    );
    return {
      intentId: fixture.intentId,
      objective: fixture.objective,
      metricLabel: fixture.metricLabel,
      planLabel: fixture.planLabel,
      planId: fixture.planId,
      planState: fixture.planState,
      progress: todayProgressOf(owned, now),
    };
  });
}

// ---------------------------------------------------------------------------
// Completion (the ONLY open -> completed transition).
// ---------------------------------------------------------------------------

/** Typed completion rejections (PHID-safe, values never echoed). */
export type TodayCompleteError =
  | { readonly kind: "task-not-found" }
  | { readonly kind: "task-not-open" }
  | { readonly kind: "capture-not-found" };

/** Applies a task completion (open -> completed) linked to a capture. */
export function completeTodayTask(
  taskId: string,
  captureId: string,
  now: Date,
): { ok: true; task: TodayTaskView; intents: readonly TodayIntentSummary[] } | { ok: false; error: TodayCompleteError } {
  seedTasks(now);
  const record = taskRecords.get(taskId);
  if (record === undefined) {
    return { ok: false, error: { kind: "task-not-found" } };
  }
  if (record.task.state !== "open") {
    return { ok: false, error: { kind: "task-not-open" } };
  }
  const capture = listRecentCaptures().find(
    (candidate) => candidate.captureId === captureId,
  );
  if (capture === undefined) {
    return { ok: false, error: { kind: "capture-not-found" } };
  }
  const completed: TodayTaskRecord = {
    task: { ...record.task, state: "completed" },
    completion: {
      captureId,
      observationIds: capture.observations.map((observation) => observation.id),
      completedAt: now.toISOString(),
    },
  };
  taskRecords.set(taskId, completed);
  return {
    ok: true,
    task: toTodayTaskView(completed, now),
    intents: listTodayIntents(now),
  };
}

/** The registered source ids of the session (manual + device adapter). */
export const TODAY_REGISTERED_SOURCE_IDS: readonly string[] = [
  TODAY_MANUAL_SOURCE_ID,
  TODAY_DEVICE_SOURCE_ID,
];

/** Resets the store (test-only; deterministic re-seeding of suites). */
export function resetTodayStore(): void {
  taskRecords.clear();
  seeded = false;
}
