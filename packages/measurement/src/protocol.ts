/**
 * A29 — Authored protocol definitions: the PURE data structures the plan
 * compiler consumes. A protocol definition is data a human author (or a
 * later EvidencePack compiler) writes down: metric selectors + cadence +
 * windows + method preferences + fallback order. It contains no ids, no
 * clock reads, no I/O — determinism starts here.
 *
 * Recorded design decisions:
 *   - Cadence is plain UTC millisecond arithmetic (`intervalMs`,
 *     `windowDurationMs`) — DST-free by construction; the scheduler never
 *     consults a calendar (the packet's "DST-free UTC arithmetic via
 *     DeterministicClock").
 *   - A window never overlaps its neighbors: `windowDurationMs <=
 *     intervalMs` (validated by the compiler; the invariant is restated
 *     at the type level as a documented constraint because TS cannot
 *     express numeric relations).
 *   - `horizonMs` bounds how far past "now" the scheduler materializes
 *     windows; `missedWindowPolicy` records the policy applied to windows
 *     that were missed (fully in the past with no acceptable attempt).
 *   - `anchorAt` is optional: when omitted, the compiler anchors the
 *     schedule at compile time (the injected deterministic clock), which
 *     keeps compilation deterministic per clock state.
 */
export const MISSED_WINDOW_POLICIES = ["roll-forward", "backfill"] as const;

/**
 * What happens to missed windows (windows fully in the past with no
 * acceptable attempt):
 *   - `roll-forward` (default): missed windows do not spawn new tasks,
 *     and an existing open task for a missed window is re-anchored to the
 *     next unclaimed future window (the person is not punished with a
 *     backlog; the schedule rolls forward).
 *   - `backfill`: missed windows materialize tasks too (adherence review
 *     needs the historical record).
 */
export type MissedWindowPolicy = (typeof MISSED_WINDOW_POLICIES)[number];

export function isMissedWindowPolicy(value: unknown): value is MissedWindowPolicy {
  return (
    typeof value === "string" &&
    (MISSED_WINDOW_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * Cadence: how often a metric is measured and how long each capture
 * window stays open. Constraint: `1 <= windowDurationMs <= intervalMs`
 * (non-overlap); `intervalMs >= 1`.
 */
export interface CadenceSpec {
  readonly intervalMs: number;
  readonly windowDurationMs: number;
}

/** Fully-qualified schedule rules (defaults + per-selector overrides resolved). */
export interface ScheduleRules extends CadenceSpec {
  /**
   * How far past "now" windows are materialized. Constraint:
   * `horizonMs >= intervalMs` (at least one future window materializes).
   */
  readonly horizonMs: number;
  readonly missedWindowPolicy: MissedWindowPolicy;
  /** Window 0 starts here. Omitted => compile time (clock). */
  readonly anchorAt?: Date;
}

/** Per-selector schedule override, merged over the protocol defaults. */
export interface ScheduleOverride {
  readonly intervalMs?: number;
  readonly windowDurationMs?: number;
  readonly horizonMs?: number;
  readonly missedWindowPolicy?: MissedWindowPolicy;
}

/**
 * Metric selector: exactly one targeting mode — a specific metric id, OR
 * a category ("domain") grouping which expands to all of the category's
 * active metrics. An optional schedule override refines the cadence for
 * the selected metrics.
 */
export interface MetricSelector {
  readonly metricId?: string;
  readonly category?: string;
  readonly schedule?: ScheduleOverride;
}

/**
 * Method preference for one metric: the ordered method ids, preferred
 * first, fallback order after (the fallback chain A31 walks when the
 * preferred method is unavailable). All ids must be registered methods
 * legally bound to the metric (compiler-validated).
 */
export interface MethodPreference {
  readonly metricId: string;
  readonly orderedMethodIds: readonly string[];
}

/** An authored protocol definition (pure data). */
export interface ProtocolDefinition {
  /** Authoring identity — opaque non-empty string (correlation token for provenance). */
  readonly protocolId: string;
  readonly metricSelectors: readonly MetricSelector[];
  /** Default schedule for every selected metric unless overridden per selector. */
  readonly defaultSchedule: ScheduleRules;
  /**
   * Optional per-metric method preferences. Metrics without a preference
   * default to ALL registered methods for the metric, least-burden-first.
   */
  readonly methodPreferences?: readonly MethodPreference[];
}
