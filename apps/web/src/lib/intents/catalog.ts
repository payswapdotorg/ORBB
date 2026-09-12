/**
 * Intent journey catalog (M6-A, Lane B): the metric/method/source vocabulary
 * the guided intent composer and the plan compiler mirror consume.
 *
 * Pure data — no hooks, no DOM, no fetch — so server components, client
 * components, the API route handlers, and vitest can all import it (the
 * same discipline as the M4-B capture catalog).
 *
 * RECORDED DECISIONS (architecture-consistent; the engine wiring at
 * integration swaps these for the real read-models — handoff recorded):
 *   - GOAL METRIC OPTIONS derive from the M4-B SYNTH capture catalog
 *     (`../capture/catalog`): one goal option per domain metric (the blood
 *     pressure panel contributes its systolic metric — the compiler's
 *     `GoalMetric` is a single-metric commitment). Ids stay identical to the
 *     engine seed so integration is a drop-in swap.
 *   - SEAM METHODS: the device/app method ids reuse the M4-C seam vocabulary
 *     already visible in the capture catalog's `futureMethodOptions` (same
 *     ids, e.g. `SYNTH-method-wearable-heart-rate`). Device/app seams are
 *     DISPLAY-ONLY at this milestone: the registered source list contains
 *     exactly the manual source, so the matcher drops seam-method candidates
 *     with the typed `no-source` reason (the A40 semantics, mirrored).
 *   - BURDEN ORDERING mirrors the frozen M5-B default burden model's kind
 *     ordering (manual > app > device) via per-method relativeBurden ranks:
 *     manual 3, app 2, device 1 (the same rank the M4-B catalog assigns to
 *     manual methods).
 *   - CADENCE OPTIONS are the UI's cadence-window vocabulary: per-day rates
 *     (2, 1, 0.5, 1/7). They feed the safety mirror (domain floor/ceiling)
 *     and the burden summary.
 *   - DOMAIN CADENCE BOUNDS mirror the frozen M5-B DEFAULT_SAFETY_RULE_TABLE
 *     values for the four seeded metric categories (max 12 measurements/day
 *     overall; floors/ceilings per category) — the packet's SAFETY vocabulary.
 */

import { CAPTURE_SHAPES } from "../capture/catalog";
import type { IntentMethodKind } from "./types";

// ---------------------------------------------------------------------------
// Goal metric options (from the M4-B SYNTH catalog vocabulary).
// ---------------------------------------------------------------------------

/** One goal metric the composer offers (catalog-derived). */
export interface IntentGoalMetricOption {
  /** Domain metric id (SYNTH-marked; engine-seed aligned). */
  readonly metricId: string;
  readonly metricLabel: string;
  /** Terminology code (SYNTH-marked LOINC-shaped). */
  readonly conceptCode: string;
  /** Metric category (the safety "domain" table key). */
  readonly category: string;
  /** Display unit for the target input. */
  readonly unit: string;
  /** Target input guards (client clamp/snap semantics). */
  readonly targetMin: number;
  readonly targetMax: number;
  readonly targetStep: number;
  /** Suggested starting target inside the guards. */
  readonly defaultTarget: number;
  /** One-line description for the picker. */
  readonly summary: string;
}

/** All goal metric options, in picker display order. */
export const GOAL_METRIC_OPTIONS: readonly IntentGoalMetricOption[] =
  CAPTURE_SHAPES.flatMap((shape) =>
    shape.fields.map((field) => ({
      metricId: field.metric.id,
      metricLabel: field.metric.displayName,
      conceptCode: field.metric.conceptCode,
      category: field.metric.category,
      unit: field.metric.unitDomain[0] ?? "",
      targetMin: field.min,
      targetMax: field.max,
      targetStep: field.step,
      defaultTarget:
        Math.round(((field.min + field.max) / 2) / field.step) * field.step,
      summary: `${shape.displayName} — ${shape.summary}`,
    })),
  );

/** Finds a goal metric option by metric id. */
export function findGoalMetricOption(
  metricId: string,
): IntentGoalMetricOption | undefined {
  return GOAL_METRIC_OPTIONS.find((option) => option.metricId === metricId);
}

// ---------------------------------------------------------------------------
// Direction vocabulary.
// ---------------------------------------------------------------------------

/** Direction labels for the composer's radio group. */
export const INTENT_DIRECTION_OPTIONS: readonly {
  readonly value: "decrease" | "increase" | "maintain";
  readonly label: string;
  readonly description: string;
  readonly verb: string;
}[] = [
  {
    value: "decrease",
    label: "Lower",
    description: "Work the metric down toward the target.",
    verb: "Lower",
  },
  {
    value: "increase",
    label: "Raise",
    description: "Work the metric up toward the target.",
    verb: "Raise",
  },
  {
    value: "maintain",
    label: "Keep steady",
    description: "Hold the metric near the target.",
    verb: "Keep steady",
  },
];

/** Label of a direction (picker display). */
export function intentDirectionLabel(direction: string): string {
  return (
    INTENT_DIRECTION_OPTIONS.find((option) => option.value === direction)
      ?.label ?? direction
  );
}

/** Verb of a direction (objective statement composition). */
export function intentDirectionVerb(direction: string): string {
  return (
    INTENT_DIRECTION_OPTIONS.find((option) => option.value === direction)
      ?.verb ?? direction
  );
}

// ---------------------------------------------------------------------------
// Cadence window vocabulary (constraint entry).
// ---------------------------------------------------------------------------

/** One cadence-window option. */
export interface IntentCadenceOption {
  readonly id: string;
  readonly label: string;
  /** Measurements per day (finite, > 0; fractional allowed). */
  readonly cadencePerDay: number;
  readonly description: string;
}

export const INTENT_CADENCE_OPTIONS: readonly IntentCadenceOption[] = [
  {
    id: "SYNTH-cadence-twice-daily",
    label: "Twice a day",
    cadencePerDay: 2,
    description: "Two measurements per day — the densest window offered.",
  },
  {
    id: "SYNTH-cadence-daily",
    label: "Daily",
    cadencePerDay: 1,
    description: "One measurement per day.",
  },
  {
    id: "SYNTH-cadence-alternate-days",
    label: "Every other day",
    cadencePerDay: 0.5,
    description: "A measurement every second day.",
  },
  {
    id: "SYNTH-cadence-weekly",
    label: "Weekly",
    cadencePerDay: 1 / 7,
    description: "One measurement per week.",
  },
];

/** The default cadence option id. */
export const DEFAULT_CADENCE_OPTION_ID = "SYNTH-cadence-daily";

/** Finds a cadence option by id. */
export function findCadenceOption(
  cadenceId: string,
): IntentCadenceOption | undefined {
  return INTENT_CADENCE_OPTIONS.find((option) => option.id === cadenceId);
}

// ---------------------------------------------------------------------------
// Method preference vocabulary (constraint entry).
// ---------------------------------------------------------------------------

export const INTENT_METHOD_PREFERENCE_OPTIONS: readonly {
  readonly value: "any" | "measured-only";
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: "any",
    label: "Any available method",
    description:
      "Manual, device, and app routes may all be proposed (subject to source registration).",
  },
  {
    value: "measured-only",
    label: "Measured evidence only",
    description:
      "Exclude estimated-from-memory methods — plans must rest on MEASURED evidence.",
  },
];

/** The default method preference. */
export const DEFAULT_METHOD_PREFERENCE = "any" as const;

// ---------------------------------------------------------------------------
// Method index (manual from the M4-B catalog + the M4-C seam vocabulary).
// ---------------------------------------------------------------------------

/** One registered method the compiler mirror can expand over. */
export interface IntentMethodOption {
  readonly id: string;
  readonly metricId: string;
  readonly label: string;
  readonly kind: IntentMethodKind;
  readonly evidenceLabel: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  /** Burden rank (lower = less burden; manual 3, app 2, device 1). */
  readonly relativeBurden: number;
  /** True while the method has an active registered source behind it. */
  readonly sourceRegistered: boolean;
  /** Display note for the landscape/pickers. */
  readonly note: string;
}

/**
 * The method landscape: per goal metric, the manual method (from the M4-B
 * capture catalog — the only source-backed kind) plus the device/app seam
 * methods (the M4-C seam vocabulary, display-only: no registered source).
 */
export const INTENT_METHOD_OPTIONS: readonly IntentMethodOption[] =
  CAPTURE_SHAPES.flatMap((shape) => [
    ...shape.fields.map((field) => ({
      id: field.method.id,
      metricId: field.metric.id,
      label: `${shape.manualMethodOption.label} · ${field.label}`,
      kind: "manual" as const,
      evidenceLabel: field.method.evidenceLabel,
      relativeBurden: field.method.relativeBurden,
      sourceRegistered: true,
      note: "Manual · source registered (src_SYNTH-source-manual)",
    })),
    ...shape.futureMethodOptions.map((option) => ({
      id: option.id,
      metricId: shape.fields[0]?.metric.id ?? "",
      label: option.label,
      kind: (option.id.includes("app-") ? "app" : "device") as IntentMethodKind,
      evidenceLabel: "MEASURED" as const,
      relativeBurden: option.id.includes("app-") ? 2 : 1,
      sourceRegistered: false,
      note: option.meta,
    })),
  ]);

/** Methods registered for one metric, burden-ordered (least first). */
export function methodsForMetric(
  metricId: string,
): readonly IntentMethodOption[] {
  return INTENT_METHOD_OPTIONS.filter(
    (method) => method.metricId === metricId,
  ).sort(
    (a, b) => a.relativeBurden - b.relativeBurden || (a.id < b.id ? -1 : 1),
  );
}

/** Finds a method option by id. */
export function findIntentMethodOption(
  methodId: string,
): IntentMethodOption | undefined {
  return INTENT_METHOD_OPTIONS.find((method) => method.id === methodId);
}

// ---------------------------------------------------------------------------
// Registered sources (the A40 matcher's source registry mirror).
// ---------------------------------------------------------------------------

/** One registered measurement source (manual kind only at this milestone). */
export interface IntentRegisteredSource {
  readonly sourceId: string;
  readonly kind: IntentMethodKind;
  /** Methods this source can execute (capability list). */
  readonly capabilities: readonly string[];
}

/**
 * The registered-source list: exactly the M4-B manual source. The M4-C
 * device/app seams are DISPLAY-ONLY (no registered source), so the matcher
 * drops their candidates with the typed `no-source` reason.
 */
export const INTENT_REGISTERED_SOURCES: readonly IntentRegisteredSource[] = [
  {
    sourceId: "src_SYNTH-source-manual",
    kind: "manual",
    capabilities: INTENT_METHOD_OPTIONS.filter(
      (method) => method.kind === "manual",
    ).map((method) => method.id),
  },
];

/** True when a method id has an active registered source behind it. */
export function hasRegisteredSource(methodId: string): boolean {
  return INTENT_REGISTERED_SOURCES.some((source) =>
    source.capabilities.includes(methodId),
  );
}

// ---------------------------------------------------------------------------
// Safety domain bounds (the frozen M5-B DEFAULT rule table mirror).
// ---------------------------------------------------------------------------

/** Per-category cadence bounds (floor/ceiling per day). */
export interface IntentDomainCadenceBounds {
  readonly domain: string;
  readonly floorPerDay: number;
  readonly ceilingPerDay: number;
}

/** Metric-agnostic total guard (max measurements per day). */
export const INTENT_MAX_MEASUREMENTS_PER_DAY = 12;

/** Per-domain cadence bounds (the four seeded metric categories). */
export const INTENT_DOMAIN_CADENCE_BOUNDS: readonly IntentDomainCadenceBounds[] =
  [
    { domain: "vital-signs", floorPerDay: 1, ceilingPerDay: 4 },
    { domain: "body-composition", floorPerDay: 1 / 7, ceilingPerDay: 2 },
    { domain: "activity", floorPerDay: 1, ceilingPerDay: 24 },
    { domain: "sleep", floorPerDay: 1, ceilingPerDay: 4 },
  ];

/** Finds the cadence bounds for a metric category (undefined = unchecked). */
export function domainCadenceBounds(
  category: string,
): IntentDomainCadenceBounds | undefined {
  return INTENT_DOMAIN_CADENCE_BOUNDS.find(
    (bounds) => bounds.domain === category,
  );
}

// ---------------------------------------------------------------------------
// Burden model (the frozen M5-B default's kind-weight ordering mirror).
// ---------------------------------------------------------------------------

/** Kind weights ordered manual(3) > app(2) > device(1) — the frozen default. */
export const INTENT_METHOD_KIND_WEIGHTS: Readonly<
  Record<IntentMethodKind, number>
> = {
  manual: 3,
  app: 2,
  device: 1,
};

// ---------------------------------------------------------------------------
// Catalog invariants (pure, thrown as programming errors — the fixture must
// fail loudly, never reject users; the M4-B catalog discipline).
// ---------------------------------------------------------------------------

export function assertIntentCatalogInvariants(): void {
  const metricIds = new Set<string>();
  for (const option of GOAL_METRIC_OPTIONS) {
    if (!option.metricId.startsWith("SYNTH-")) {
      throw new Error(`Goal metric id is not SYNTH-marked: ${option.metricId}`);
    }
    if (metricIds.has(option.metricId)) {
      throw new Error(`Duplicate goal metric option: ${option.metricId}`);
    }
    metricIds.add(option.metricId);
    if (!(option.targetMin < option.targetMax) || !(option.targetStep > 0)) {
      throw new Error(`Goal target guards are invalid: ${option.metricId}`);
    }
  }
  const methodIds = new Set<string>();
  for (const method of INTENT_METHOD_OPTIONS) {
    if (!method.id.startsWith("SYNTH-")) {
      throw new Error(`Method id is not SYNTH-marked: ${method.id}`);
    }
    if (methodIds.has(method.id)) {
      throw new Error(`Duplicate method id: ${method.id}`);
    }
    methodIds.add(method.id);
    if (!metricIds.has(method.metricId)) {
      throw new Error(
        `Method ${method.id} does not belong to a goal metric ${method.metricId}.`,
      );
    }
    if (method.sourceRegistered !== hasRegisteredSource(method.id)) {
      throw new Error(`Source registration mismatch for method ${method.id}`);
    }
  }
  for (const source of INTENT_REGISTERED_SOURCES) {
    if (!source.sourceId.startsWith("src_")) {
      throw new Error(`Source id grammar violation: ${source.sourceId}`);
    }
    for (const capability of source.capabilities) {
      const method = INTENT_METHOD_OPTIONS.find(
        (candidate) => candidate.id === capability,
      );
      if (method === undefined || method.kind !== source.kind) {
        throw new Error(
          `Source ${source.sourceId} capability is not a ${source.kind} method: ${capability}`,
        );
      }
    }
  }
  const domains = new Set(
    INTENT_DOMAIN_CADENCE_BOUNDS.map((bounds) => bounds.domain),
  );
  if (domains.size !== INTENT_DOMAIN_CADENCE_BOUNDS.length) {
    throw new Error("Duplicate domain cadence bounds entry.");
  }
  for (const bounds of INTENT_DOMAIN_CADENCE_BOUNDS) {
    if (!(bounds.floorPerDay > 0) || !(bounds.ceilingPerDay >= bounds.floorPerDay)) {
      throw new Error(`Domain bounds are degenerate: ${bounds.domain}`);
    }
  }
}
