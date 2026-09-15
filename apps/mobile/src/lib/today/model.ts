/**
 * Mobile Today-surface model (M6-B B4, Lane B) — pure data + pure functions.
 *
 * The MIRROR of the web `apps/web/src/lib/today/{types,catalog,store}.ts`
 * (same field-for-field vocabularies, same fixed SYNTH task ids, same
 * method landscapes, same clinic/CHW fallback, same whole-day window
 * assumptions), adapted to the mobile discipline: instead of a route-stub
 * module store, the journey is CLIENT-LOCAL over an immutable
 * {@link TodaySession} record — the same discipline as `lib/intents/model.ts`
 * (createIntentSession/approveIntentSession) and the M4-B offline capture
 * queue. No React Native imports in this module — plain-node unit-testable.
 *
 * Why a local mirror instead of importing the web libs or
 * `@orbb/measurement`: `apps/mobile` declares only `@orbb/ui` as a workspace
 * dependency (plus the RN/Expo stack); adding anything else would change
 * `pnpm-lock.yaml`, which this packet must not touch (recorded handoff —
 * at engine wiring the mirrors swap for the real package exports with no
 * call-site changes).
 *
 * RECORDED ASSUMPTIONS (each mirrors the web store's recorded decision):
 *   - WHOLE-DAY due windows for the hour-independent golden journey (the
 *     architecture's example card says "due by 09:00"; a morning-anchored
 *     window would make the journey hour-dependent — the web fixtures made
 *     the same call). Window semantics keep the A30 half-open shape
 *     ([startsAt, endsAt) UTC ms), serialized as ISO strings.
 *   - The stored task records mirror the REAL A30 `MeasurementTask` /
 *     `MeasurementWindow` / `TaskState` scheduler shapes field-for-field
 *     (ISO-string wire form) because apps/mobile declares no
 *     `@orbb/measurement` dependency and adding one is out of scope for
 *     this packet — recorded handoff: the mirror swaps for the real types
 *     at engine wiring.
 *   - The missed-window fixture (body weight) represents a task whose
 *     window closed yesterday while the scheduler has not re-run since
 *     (no roll-forward yet) — the surface shows the missed state honestly
 *     and surfaces the clinic/CHW fallback explicitly.
 *   - COMPLETION is the ONLY state transition (open -> completed), and it
 *     happens ONLY through {@link completeTodayTask}. The mobile completion
 *     writes a synthetic capture link (`SYNTH-CAP-TODAY-…` +
 *     `obs_SYNTH-obs-today-…`) because the mobile shell has no shared
 *     capture store across tabs at this milestone — the Health tab owns
 *     live capture records in screen state. The engine wiring (A31 attempt
 *     recorder) becomes this seam (recorded handoff).
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; zero PHI; deterministic seeding relative to the supplied `now`
 * (fixed task ids — re-seeding reproduces the identical task set).
 */

import { CAPTURE_SHAPES, SYNTHETIC_PERSON_ID } from "../capture/model";

// ---------------------------------------------------------------------------
// Task-state vocabulary (A30 `TASK_STATES` runtime mirror).
// ---------------------------------------------------------------------------

/** Mirror of the frozen `TASK_STATES` vocabulary (`open` | `completed`). */
export const TODAY_TASK_STATES = ["open", "completed"] as const;

export type TodayTaskState = (typeof TODAY_TASK_STATES)[number];

export function isTodayTaskState(value: unknown): value is TodayTaskState {
  return (
    typeof value === "string" &&
    (TODAY_TASK_STATES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Scheduler-shape mirrors (the REAL A30 types, wire form — see header).
// ---------------------------------------------------------------------------

/**
 * Mirror of the REAL A30 `MeasurementWindow`: a half-open
 * `[startsAt, endsAt)` UTC interval. Mobile stores the wire form
 * (ISO-8601 strings) so the session record stays serializable.
 */
export interface MeasurementWindow {
  readonly sequence: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * Mirror of the REAL A30 `MeasurementTask` (field-for-field; wire form).
 * The scheduler's task-store port owns lifecycle at integration — this
 * mirror exists only because apps/mobile declares no
 * `@orbb/measurement` dependency (recorded handoff, see header).
 */
export interface MeasurementTask {
  readonly id: string;
  readonly planId: string;
  readonly personId: string;
  readonly metricId: string;
  readonly conceptCode: string;
  /** Acceptable methods in the plan's method order (least burden first). */
  readonly methodOrder: readonly string[];
  readonly window: MeasurementWindow;
  readonly state: TodayTaskState;
  readonly createdAt: string;
  readonly rollCount: number;
}

/** How a task was fulfilled (the manual-capture act that completed it). */
export interface TodayTaskCompletion {
  /** The capture record id (`SYNTH-CAP-…` — the mobile capture store's key). */
  readonly captureId: string;
  /** Observation ids the capture produced (one per captured field). */
  readonly observationIds: readonly string[];
  /** When the completion was recorded (ISO-8601). */
  readonly completedAt: string;
}

/** The stored task record (the mirrored scheduler task + completion link). */
export interface TodayTaskRecord {
  readonly task: MeasurementTask;
  /** Present once the task was fulfilled through the capture journey. */
  readonly completion?: TodayTaskCompletion;
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
  /** Burden rank (lower = less burden; device 1 < app 2 < manual 3). */
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
// Task view (the card's render shape — every frozen §Measurement task UX
// field: metric | due window | reason | acceptable methods | estimated
// effort | privacy impact | fallback).
// ---------------------------------------------------------------------------

/** The measurement window in wire form (ISO-8601 strings). */
export interface TodayWindowView {
  readonly sequence: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

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
// Session record (immutable; the client-local journey state).
// ---------------------------------------------------------------------------

/**
 * Creation-scoped completion-id counters (the same discipline as the
 * capture model's `CaptureIdCounters`): the session owns a running counter
 * so completion ids stay deterministic and testable.
 */
export interface TodayIdCounters {
  readonly capture: number;
  readonly observation: number;
}

export function initialTodayIdCounters(): TodayIdCounters {
  return { capture: 0, observation: 0 };
}

/** Test-determinism hook: a fresh zeroed counter set (re-seed anchor). */
export function resetTodayCounters(): TodayIdCounters {
  return initialTodayIdCounters();
}

/** The Today journey's session state (immutable — transitions return new). */
export interface TodaySession {
  /** The seeded task records (fixed SYNTH ids; deterministic per session). */
  readonly tasks: readonly TodayTaskRecord[];
  /** Running completion-id counters (advanced by each completion). */
  readonly counters: TodayIdCounters;
}

// ---------------------------------------------------------------------------
// Seeded vocabulary (mirrors the web today catalog, field-for-field).
// ---------------------------------------------------------------------------

/** The single synthetic person of the mobile shell (M4-B catalog). */
export const TODAY_PERSON_ID = SYNTHETIC_PERSON_ID;

/** The registered manual source (M4-B capture catalog). */
export const TODAY_MANUAL_SOURCE_ID = "src_SYNTH-source-manual";

/**
 * The registered device adapter source (the SYNTH wearable — consistent
 * with the M3-B evidence actors and the web B4/B5 fixtures).
 */
export const TODAY_DEVICE_SOURCE_ID = "src_SYNTH-source-device-a";

/** Display label of the device adapter (provenance UX). */
export const TODAY_DEVICE_SOURCE_LABEL = "SYNTH-Device-A (registered wearable)";

/** The registered source ids of the session (manual + device adapter). */
export const TODAY_REGISTERED_SOURCE_IDS: readonly string[] = [
  TODAY_MANUAL_SOURCE_ID,
  TODAY_DEVICE_SOURCE_ID,
];

/** Clinic/CHW fallback providers (existing SYNTH fixture vocabulary). */
export const TODAY_FALLBACK_PROVIDERS: readonly string[] = [
  "SYNTH-Clinic-A",
  "SYNTH-CHW-2",
];

/** The shared fallback view (surfaced explicitly on missed-window cards). */
export const TODAY_FALLBACK: TodayFallbackView = {
  providers: TODAY_FALLBACK_PROVIDERS,
  label: "Clinic/CHW fallback",
  detail:
    "A provider can capture this for you: an assisted reading at SYNTH-Clinic-A, or a visit from SYNTH-CHW-2. Fallback data reaches the same Observation model with its own provenance.",
};

/** One seeded active intent with its (active) measurement plan. */
export interface TodayIntentFixture {
  readonly intentId: string;
  /** Objective statement (the composer's composed shape, M6-A). */
  readonly objective: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  readonly planId: string;
  readonly planLabel: string;
  /** Plan lifecycle state — ACTIVE (scheduler precondition; see header). */
  readonly planState: "active";
  /** Cadence description (display only — the plan's compiled cadence). */
  readonly cadenceLabel: string;
}

/** The seeded active intents, in surface display order. */
export const TODAY_INTENT_FIXTURES: readonly TodayIntentFixture[] = [
  {
    intentId: "intent_SYNTH-today-bp-000001",
    objective: "Lower blood pressure (systolic) toward 120 mmHg",
    metricId: "SYNTH-metric-bp-systolic",
    metricLabel: "Blood Pressure Systolic",
    conceptCode: "SYNTH-8480-5",
    planId: "plan_SYNTH-today-bp-daily-0001",
    planLabel: "Daily blood pressure monitoring",
    planState: "active",
    cadenceLabel: "1 measurement per day",
  },
  {
    intentId: "intent_SYNTH-today-hr-000002",
    objective: "Keep resting heart rate steady near 60 beats/min",
    metricId: "SYNTH-metric-heart-rate",
    metricLabel: "Heart Rate",
    conceptCode: "SYNTH-8867-4",
    planId: "plan_SYNTH-today-hr-daily-0002",
    planLabel: "Daily resting heart rate check",
    planState: "active",
    cadenceLabel: "1 measurement per day",
  },
  {
    intentId: "intent_SYNTH-today-wt-000003",
    objective: "Lower body weight toward 68 kg",
    metricId: "SYNTH-metric-body-weight",
    metricLabel: "Body Weight",
    conceptCode: "SYNTH-29463-7",
    planId: "plan_SYNTH-today-wt-mornings-0003",
    planLabel: "Morning weight check",
    planState: "active",
    cadenceLabel: "1 measurement per morning",
  },
  {
    intentId: "intent_SYNTH-today-sleep-000004",
    objective: "Raise sleep duration toward 450 min per night",
    metricId: "SYNTH-metric-sleep-minutes",
    metricLabel: "Sleep Duration",
    conceptCode: "SYNTH-94641-0",
    planId: "plan_SYNTH-today-sleep-daily-0004",
    planLabel: "Daily sleep log",
    planState: "active",
    cadenceLabel: "1 measurement per day",
  },
];

/** Finds an intent fixture by id. */
export function findTodayIntentFixture(
  intentId: string,
): TodayIntentFixture | undefined {
  return TODAY_INTENT_FIXTURES.find((fixture) => fixture.intentId === intentId);
}

// ---------------------------------------------------------------------------
// Acceptable-method landscape per metric (burden-ordered fixtures).
// ---------------------------------------------------------------------------

/**
 * One acceptable method of a task's method landscape (the fixture shape
 * behind `TodayMethodView`; the session projects availability per source).
 */
export interface TodayMethodFixture {
  readonly methodId: string;
  readonly label: string;
  readonly kind: "manual" | "app" | "device";
  readonly relativeBurden: number;
  readonly estimatedEffortLabel: string;
  readonly privacyImpactLabel: string;
  /**
   * The source this method needs: "manual" (the M4-B registered source),
   * the device adapter, or a seam that is not connected yet.
   */
  readonly requiresSource: "manual" | "device-a" | "unregistered-seam";
  readonly availabilityNote: string;
}

/** Manual-entry method labels reused from the M4-B capture catalog. */
const manualMethod = (shapeId: string): string => {
  const shape = CAPTURE_SHAPES.find((candidate) => candidate.id === shapeId);
  return shape?.manualMethodOption.label ?? "Manual entry";
};

/**
 * The acceptable-method landscape per capture shape (the metric's method
 * chain, LEAST-BURDEN FIRST — the frozen ordering device < app < manual):
 * BP gets the not-connected cuff seam ahead of the manual route; HR gets
 * the REGISTERED wearable (SYNTH-Device-A); weight/sleep are manual-only.
 */
export const TODAY_METHOD_LANDSCAPES: Readonly<
  Record<string, readonly TodayMethodFixture[]>
> = {
  "SYNTH-shape-bp-panel": [
    {
      methodId: "SYNTH-method-cuff-bp-panel",
      label: "Automatic cuff sync",
      kind: "device",
      relativeBurden: 1,
      estimatedEffortLabel: "automatic — ~0 min",
      privacyImpactLabel:
        "Private — syncs from the cuff to your DataBox only; nothing is shared.",
      requiresSource: "unregistered-seam",
      availabilityNote:
        "Device seam — not connected yet (M4-C device integration).",
    },
    {
      methodId: "SYNTH-method-manual-bp-panel",
      label: manualMethod("SYNTH-shape-bp-panel"),
      kind: "manual",
      relativeBurden: 3,
      estimatedEffortLabel: "~2 min",
      privacyImpactLabel:
        "Private — typed on this device into your DataBox; nothing is shared.",
      requiresSource: "manual",
      availabilityNote: "Available now — the manual capture journey.",
    },
  ],
  "SYNTH-shape-heart-rate": [
    {
      methodId: "SYNTH-method-wearable-heart-rate",
      label: "Wearable sync — resting pulse",
      kind: "device",
      relativeBurden: 1,
      estimatedEffortLabel: "automatic — ~0 min",
      privacyImpactLabel:
        "Private — syncs from your registered wearable (SYNTH-Device-A) into your DataBox only.",
      requiresSource: "device-a",
      availabilityNote:
        "Available — your registered wearable (SYNTH-Device-A) covers this metric.",
    },
    {
      methodId: "SYNTH-method-manual-heart-rate",
      label: manualMethod("SYNTH-shape-heart-rate"),
      kind: "manual",
      relativeBurden: 3,
      estimatedEffortLabel: "~1 min",
      privacyImpactLabel:
        "Private — typed on this device into your DataBox; nothing is shared.",
      requiresSource: "manual",
      availabilityNote: "Available now — the manual capture journey.",
    },
  ],
  "SYNTH-shape-body-weight": [
    {
      methodId: "SYNTH-method-manual-body-weight",
      label: manualMethod("SYNTH-shape-body-weight"),
      kind: "manual",
      relativeBurden: 3,
      estimatedEffortLabel: "~1 min",
      privacyImpactLabel:
        "Private — typed on this device into your DataBox; nothing is shared.",
      requiresSource: "manual",
      availabilityNote: "Available now — the manual capture journey.",
    },
  ],
  "SYNTH-shape-sleep-minutes": [
    {
      methodId: "SYNTH-method-manual-sleep-minutes",
      label: manualMethod("SYNTH-shape-sleep-minutes"),
      kind: "manual",
      relativeBurden: 3,
      estimatedEffortLabel: "~1 min",
      privacyImpactLabel:
        "Private — typed on this device into your DataBox; nothing is shared.",
      requiresSource: "manual",
      availabilityNote:
        "Available now — the manual capture journey (recorded as an ESTIMATE).",
    },
  ],
};

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
 * the domain `isIdOf` precondition, applied before storing the fixture.
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

/** A window on the given day between fixed local hours (wire form). */
function windowForHours(at: Date, startHour: number, endHour: number): MeasurementWindow {
  const day = startOfDay(at);
  return {
    sequence: 0,
    startsAt: new Date(day.getTime() + startHour * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(day.getTime() + endHour * 60 * 60 * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Deterministic session seeding.
// ---------------------------------------------------------------------------

/**
 * Seeds the deterministic SYNTH fixture tasks relative to `now` (the same
 * seed set as the web store): due-today BP + HR (whole-day windows), the
 * missed-window weight task (yesterday 07:00–09:00), and the completed
 * sleep task (seeded capture link, completedAt clamped to never be future).
 */
export function initialTodaySession(now: Date): TodaySession {
  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - DAY_MS);

  const seed = (
    taskId: string,
    planId: string,
    metricId: string,
    conceptCode: string,
    methodOrder: readonly string[],
    window: MeasurementWindow,
    state: TodayTaskState,
    rollCount: number,
    completion?: TodayTaskCompletion,
  ): TodayTaskRecord => {
    assertCanonicalIdGrammar("task", taskId);
    assertCanonicalIdGrammar("plan", planId);
    assertCanonicalIdGrammar("prsn", TODAY_PERSON_ID);
    return {
      task: {
        id: taskId,
        planId,
        personId: TODAY_PERSON_ID,
        metricId,
        conceptCode,
        methodOrder,
        window,
        state,
        createdAt: yesterday.toISOString(),
        rollCount,
      },
      ...(completion !== undefined ? { completion } : {}),
    };
  };

  // 1. DUE TODAY — blood pressure (two acceptable methods; the manual
  //    route is the valid completion path — the cuff seam is not connected).
  //    Whole-day half-open window [00:00, end-of-day) — see header note.
  const wholeDay = (): MeasurementWindow => ({
    sequence: 0,
    startsAt: today.toISOString(),
    endsAt: new Date(endOfDay(now).getTime() - 1).toISOString(),
  });

  // 4. COMPLETED — sleep duration (logged from memory this morning — an
  //    ESTIMATED observation; completedAt stays inside today and never in
  //    the future: early-hours sessions see an early-morning instant).
  const sleepCompletedAt = new Date(
    Math.max(
      today.getTime() + 60 * 1000,
      Math.min(today.getTime() + 7 * 60 * 60 * 1000 + 12 * 60 * 1000, now.getTime() - 60 * 1000),
    ),
  );

  const tasks: readonly TodayTaskRecord[] = [
    seed(
      TODAY_TASK_BP_ID,
      "plan_SYNTH-today-bp-daily-0001",
      "SYNTH-metric-bp-systolic",
      "SYNTH-8480-5",
      ["SYNTH-method-cuff-bp-panel", "SYNTH-method-manual-bp-panel"],
      wholeDay(),
      "open",
      0,
    ),
    seed(
      TODAY_TASK_HR_ID,
      "plan_SYNTH-today-hr-daily-0002",
      "SYNTH-metric-heart-rate",
      "SYNTH-8867-4",
      ["SYNTH-method-wearable-heart-rate", "SYNTH-method-manual-heart-rate"],
      wholeDay(),
      "open",
      0,
    ),
    seed(
      TODAY_TASK_WEIGHT_ID,
      "plan_SYNTH-today-wt-mornings-0003",
      "SYNTH-metric-body-weight",
      "SYNTH-29463-7",
      ["SYNTH-method-manual-body-weight"],
      windowForHours(yesterday, 7, 9),
      "open",
      0,
    ),
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
    ),
  ];

  return { tasks, counters: initialTodayIdCounters() };
}

// ---------------------------------------------------------------------------
// View projection (pure).
// ---------------------------------------------------------------------------

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

/** Due-window label for a window at the given `now`. */
export function dueWindowLabel(
  window: MeasurementWindow,
  now: Date,
): { label: string; missed: boolean } {
  const endsAt = new Date(window.endsAt);
  const endsMs = endsAt.getTime();
  const nowMs = now.getTime();
  if (endsMs > nowMs) {
    // Whole-day windows (ending within the last minute of the day) read as
    // "Due by end of today"; tighter windows carry their clock time.
    const endsAtDayEnd = endOfDay(endsAt).getTime() - endsMs < 60 * 1000;
    if (endsAtDayEnd) {
      return { label: "Due by end of today", missed: false };
    }
    return { label: `Due by ${formatTimePart(endsAt)}`, missed: false };
  }
  return { label: `Window missed — was due ${formatDayTime(endsAt, now)}`, missed: true };
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
  const availability: TodayMethodAvailability =
    fixture.requiresSource === "unregistered-seam" ? "not-connected" : "available";
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

function findTodayIntentFixtureByPlan(planId: string): TodayIntentFixture | undefined {
  return TODAY_INTENT_FIXTURES.find((fixture) => fixture.planId === planId);
}

/** Projects a stored task record into the card's render view. */
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
      startsAt: task.window.startsAt,
      endsAt: task.window.endsAt,
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
// Read models (pure projections of the immutable session).
// ---------------------------------------------------------------------------

/** Lists the task views in display order (open due first, then completed). */
export function listTodayTasks(
  session: TodaySession,
  now: Date,
): readonly TodayTaskView[] {
  const records = session.tasks.map((record) => ({
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

/** Lists the active-intent summaries with per-intent progress. */
export function listTodayIntents(
  session: TodaySession,
  now: Date,
): readonly TodayIntentSummary[] {
  return TODAY_INTENT_FIXTURES.map((fixture) => {
    const owned = session.tasks.filter(
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
// Completion (the ONLY open -> completed transition; immutable).
// ---------------------------------------------------------------------------

/** Typed completion rejections (PHI-safe, values never echoed). */
export type TodayCompleteError =
  | { readonly kind: "task-not-found" }
  | { readonly kind: "task-not-open" };

/**
 * Applies a task completion (open -> completed) as a NEW session — the
 * original session record is never mutated. The completion writes the
 * mobile synthetic capture link (`SYNTH-CAP-TODAY-…` + one
 * `obs_SYNTH-obs-today-…` observation id) because the mobile shell keeps
 * live capture records in Health-tab screen state at this milestone; the
 * engine wiring (A31 attempt recorder) becomes this seam (recorded
 * handoff, see header).
 */
export function completeTodayTask(
  session: TodaySession,
  taskId: string,
  now: Date,
): {
  ok: true;
  session: TodaySession;
  task: TodayTaskView;
  intents: readonly TodayIntentSummary[];
} | { ok: false; error: TodayCompleteError } {
  const record = session.tasks.find((candidate) => candidate.task.id === taskId);
  if (record === undefined) {
    return { ok: false, error: { kind: "task-not-found" } };
  }
  if (record.task.state !== "open") {
    return { ok: false, error: { kind: "task-not-open" } };
  }

  const captureCounter = session.counters.capture + 1;
  const observationCounter = session.counters.observation + 1;
  const captureId = `SYNTH-CAP-TODAY-${String(captureCounter).padStart(6, "0")}`;
  const observationIds = [
    `obs_SYNTH-obs-today-${String(observationCounter).padStart(6, "0")}`,
  ];
  const completed: TodayTaskRecord = {
    task: { ...record.task, state: "completed" },
    completion: {
      captureId,
      observationIds,
      completedAt: now.toISOString(),
    },
  };
  const nextSession: TodaySession = {
    tasks: session.tasks.map((candidate) =>
      candidate.task.id === taskId ? completed : candidate,
    ),
    counters: { capture: captureCounter, observation: observationCounter },
  };
  return {
    ok: true,
    session: nextSession,
    task: toTodayTaskView(completed, now),
    intents: listTodayIntents(nextSession, now),
  };
}

// ---------------------------------------------------------------------------
// Catalog invariants (pure; a malformed fixture fails loudly).
// ---------------------------------------------------------------------------

/**
 * Catalog invariants (programming errors — the seed is a fixture):
 *   - every identity-like id is SYNTH-marked;
 *   - every method landscape is non-empty, unique by methodId, and ordered
 *     by ascending relativeBurden (least burden FIRST);
 *   - every method's requiresSource refers to a known source/seam;
 *   - the fallback providers are SYNTH-marked.
 */
export function assertTodayCatalogInvariants(): void {
  for (const fixture of TODAY_INTENT_FIXTURES) {
    if (!fixture.intentId.startsWith("intent_SYNTH-")) {
      throw new Error(`Today intent id is not SYNTH-marked: ${fixture.intentId}`);
    }
    if (!fixture.planId.startsWith("plan_SYNTH-")) {
      throw new Error(`Today plan id is not SYNTH-marked: ${fixture.planId}`);
    }
    if (fixture.planState !== "active") {
      throw new Error("Today plan fixtures must be ACTIVE (scheduler precondition).");
    }
    const shapeExists = CAPTURE_SHAPES.some(
      (shape) => shape.fields.some((field) => field.metric.id === fixture.metricId),
    );
    if (!shapeExists) {
      throw new Error(
        `Today intent metric has no capture shape: ${fixture.metricId}`,
      );
    }
  }
  for (const [shapeId, methods] of Object.entries(TODAY_METHOD_LANDSCAPES)) {
    if (!shapeId.startsWith("SYNTH-")) {
      throw new Error(`Method landscape key is not SYNTH-marked: ${shapeId}`);
    }
    if (methods.length === 0) {
      throw new Error(`Method landscape is empty: ${shapeId}`);
    }
    const seen = new Set<string>();
    let previousBurden = Number.NEGATIVE_INFINITY;
    for (const method of methods) {
      if (!method.methodId.startsWith("SYNTH-")) {
        throw new Error(`Method id is not SYNTH-marked: ${method.methodId}`);
      }
      if (seen.has(method.methodId)) {
        throw new Error(`Duplicate method in landscape: ${method.methodId}`);
      }
      seen.add(method.methodId);
      if (method.relativeBurden <= previousBurden) {
        throw new Error(
          `Method landscape is not least-burden-first: ${shapeId}`,
        );
      }
      previousBurden = method.relativeBurden;
      if (
        method.requiresSource !== "manual" &&
        method.requiresSource !== "device-a" &&
        method.requiresSource !== "unregistered-seam"
      ) {
        throw new Error(`Unknown source requirement: ${method.requiresSource}`);
      }
    }
  }
  for (const provider of TODAY_FALLBACK_PROVIDERS) {
    if (!provider.startsWith("SYNTH-")) {
      throw new Error(`Fallback provider is not SYNTH-marked: ${provider}`);
    }
  }
}
