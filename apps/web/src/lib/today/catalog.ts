/**
 * Seeded Today-surface catalog (M6-B B4, Lane B): the SYNTH intent/plan/
 * method/fallback vocabulary the task fixtures are built from.
 *
 * Pure data — no hooks, no DOM, no fetch — so server components, client
 * components, the API route handler and vitest can all import it (the same
 * discipline as the M4-B capture catalog and the M6-A intent catalog).
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; the metric/method vocabulary intentionally reuses the M4-B
 * capture catalog and the M4-A engine seed ids (SYNTH-metric-bp-systolic,
 * SYNTH-method-bpsys-manual, …) so engine wiring is a drop-in swap.
 *
 * RECORDED ASSUMPTIONS (architecture-consistent; each mirrors a frozen
 * upstream decision rather than inventing one):
 *   - PLAN LIFECYCLE: fixtures carry ACTIVE plans — the scheduler's
 *     precondition (A30 refuses non-active plans). The fixtures represent
 *     plans that completed the full draft -> published -> active lifecycle
 *     through review + activation; the review stub (M6-A) writes only the
 *     `published` state, and activation is the engine-wiring seam (the
 *     domain transition `published -> active` is mirrored in the M6-A
 *     store's ALLOWED_PLAN_TRANSITIONS). Recorded handoff.
 *   - REGISTERED SOURCES: the SYNTH session registers the manual source
 *     (src_SYNTH-source-manual, active since M4-B) AND one device adapter
 *     (src_SYNTH-source-device-a — "SYNTH-Device-A", the wearable whose
 *     automatic-sync evidence already populates the M3-B DataBox fixtures).
 *     This is consistent with the existing synthetic corpus (wearable-sync
 *     heart-rate series, overnight oximetry from SYNTH-Device-A) and with
 *     golden journey #2 (import a device observation through the SYNTH
 *     device-adapter seam).
 *   - FALLBACK VOCABULARY: clinic/CHW providers reuse the SYNTH catalog
 *     names already present in the repo fixtures — SYNTH-Clinic-A (the
 *     consent-share recipient) and SYNTH-CHW-2 (the assisted-capture
 *     actor). No new provider vocabulary is invented.
 *   - EFFORT/PRIVACY labels are UX projections of the frozen burden model
 *     (device 1 < app 2 < manual 3) and the DataBox privacy stance
 *     (nothing leaves the DataBox without a reviewed share).
 */

import { CAPTURE_SHAPES } from "../capture/catalog";

// ---------------------------------------------------------------------------
// The synthetic person + sources (existing vocabulary, never invented).
// ---------------------------------------------------------------------------

/** The single synthetic person of the web-shell session (M4-B catalog). */
export const TODAY_PERSON_ID = "prsn_SYNTH-person-0001";

/** The registered manual source (M4-B capture catalog). */
export const TODAY_MANUAL_SOURCE_ID = "src_SYNTH-source-manual";

/**
 * The registered device adapter source (the SYNTH wearable — consistent
 * with the M3-B evidence actors "SYNTH-Person-1 · wearable sync" and
 * "SYNTH-Device-A · automatic sync").
 */
export const TODAY_DEVICE_SOURCE_ID = "src_SYNTH-source-device-a";

/** Display label of the device adapter (provenance UX). */
export const TODAY_DEVICE_SOURCE_LABEL = "SYNTH-Device-A (registered wearable)";

// ---------------------------------------------------------------------------
// Fallback vocabulary (clinic/CHW from the SYNTH catalog).
// ---------------------------------------------------------------------------

/** Clinic/CHW fallback providers (existing SYNTH fixture vocabulary). */
export const TODAY_FALLBACK_PROVIDERS: readonly string[] = [
  "SYNTH-Clinic-A",
  "SYNTH-CHW-2",
];

/** The shared fallback view (surfaced explicitly on missed-window cards). */
export const TODAY_FALLBACK = {
  providers: TODAY_FALLBACK_PROVIDERS,
  label: "Clinic/CHW fallback",
  detail:
    "A provider can capture this for you: an assisted reading at SYNTH-Clinic-A, or a visit from SYNTH-CHW-2. Fallback data reaches the same Observation model with its own provenance.",
} as const;

// ---------------------------------------------------------------------------
// Active intents + plans (the "what am I trying to accomplish" fixtures).
// ---------------------------------------------------------------------------

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
 * behind `TodayMethodView`; the store projects availability per session).
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
 * chain, LEAST-BURDEN FIRST — the frozen ordering device < app < manual).
 *
 * - Blood pressure: the automatic cuff device seam (not connected yet —
 *   display-first, honestly labeled) ahead of the available manual route.
 * - Heart rate: the REGISTERED wearable (SYNTH-Device-A — least burden,
 *   valid and available: it is the source golden journey #2 imports from)
 *   ahead of the manual pulse check.
 * - Weight / sleep: manual-only landscapes (sleep is an ESTIMATED method —
 *   the honest evidence note travels with the fixture).
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
      (shape) =>
        shape.fields.some((field) => field.metric.id === fixture.metricId),
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
