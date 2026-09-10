/**
 * MetricDefinition aggregate (M1, measurement lane vocabulary).
 *
 * A MetricDefinition describes WHAT can be measured: identity, display,
 * unit domain, value type, terminology code, and category.
 *
 * Recorded assumptions:
 *   - `id` is an opaque metric concept-code string owned by the measurement
 *     lane (e.g. "metric-resting-heart-rate"). It is deliberately NOT one of
 *     the frozen M0 canonical branded ids — the canonical id list is frozen,
 *     and metric/method codes stay opaque strings until the measurement lane
 *     owns their vocabulary.
 *   - `unitDomain` is the closed set of allowed units for the metric.
 *     Quantity metrics carry a non-empty set of non-empty unit strings
 *     (e.g. ["beats/min"]); non-quantitative metrics (code/text/boolean)
 *     carry exactly [""] — the empty unit — mirroring the M0 Observation
 *     convention that non-quantitative observations use unit "".
 *   - `conceptCode` is a terminology code (e.g. LOINC "8867-4"); `category`
 *     is a loose grouping label (e.g. "vital-signs"). Both are non-empty
 *     strings; vocabulary curation is a measurement-lane concern.
 */
import type { Observation, ObservationValue } from "./observation.js";
import { DomainInvariantError } from "./errors.js";

export const METRIC_VALUE_TYPES = ["quantity", "code", "text", "boolean"] as const;

export type MetricValueType = (typeof METRIC_VALUE_TYPES)[number];

export interface MetricDefinition {
  /** Opaque metric concept-code string (measurement lane owns the vocabulary). */
  readonly id: string;
  readonly displayName: string;
  /**
   * Closed set of allowed units. Quantity metrics: non-empty units only.
   * Non-quantitative metrics: exactly [""] (the empty unit).
   */
  readonly unitDomain: readonly string[];
  readonly valueType: MetricValueType;
  /** Terminology code (e.g. LOINC "8867-4"). */
  readonly conceptCode: string;
  /** Metric category label (e.g. "vital-signs"). */
  readonly category: string;
}

export function isMetricValueType(value: unknown): value is MetricValueType {
  return (
    typeof value === "string" && (METRIC_VALUE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Parses a raw value as a {@link MetricValueType}. Throws
 * {@link DomainInvariantError} naming the legal vocabulary without echoing
 * the offending value.
 */
export function parseMetricValueType(value: unknown): MetricValueType {
  if (!isMetricValueType(value)) {
    throw new DomainInvariantError(
      `Invalid metric value type: expected one of ${METRIC_VALUE_TYPES.join(" | ")}.`,
    );
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasDuplicate(entries: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry)) {
      return true;
    }
    seen.add(entry);
  }
  return false;
}

function isUnitDomainFor(valueType: MetricValueType, unitDomain: unknown): boolean {
  if (!Array.isArray(unitDomain)) {
    return false;
  }
  if (unitDomain.length === 0) {
    return false;
  }
  for (const unit of unitDomain) {
    if (typeof unit !== "string") {
      return false;
    }
  }
  const units = unitDomain as readonly string[];
  if (hasDuplicate(units)) {
    return false;
  }
  if (valueType === "quantity") {
    return units.every((unit) => isNonEmptyString(unit));
  }
  // Non-quantitative metrics allow exactly the empty unit "".
  return units.length === 1 && units[0] === "";
}

export function isMetricDefinition(value: unknown): value is MetricDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof MetricDefinition, unknown>>;
  if (!isNonEmptyString(candidate.id)) {
    return false;
  }
  if (!isNonEmptyString(candidate.displayName)) {
    return false;
  }
  if (!isMetricValueType(candidate.valueType)) {
    return false;
  }
  if (!isUnitDomainFor(candidate.valueType, candidate.unitDomain)) {
    return false;
  }
  if (!isNonEmptyString(candidate.conceptCode)) {
    return false;
  }
  if (!isNonEmptyString(candidate.category)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link MetricDefinition}. Throws {@link DomainInvariantError} describing
 * the expected shape — received values are never echoed.
 */
export function assertMetricDefinition(candidate: unknown): asserts candidate is MetricDefinition {
  if (!isMetricDefinition(candidate)) {
    throw new DomainInvariantError(
      'Invalid metric definition: expected { id, displayName, unitDomain, valueType, conceptCode, category } with non-empty id/displayName/conceptCode/category, a value type of quantity|code|text|boolean, and a unit domain of non-empty, unduplicated units (quantity) or exactly [""] (non-quantitative).',
    );
  }
}

/** Is `unit` within the metric's closed unit domain? */
export function isUnitAllowedForMetric(metric: MetricDefinition, unit: string): boolean {
  return metric.unitDomain.includes(unit);
}

/**
 * Does an observation value conform to the metric's value type?
 * `quantity` requires a number, `boolean` a boolean, and `code`/`text` a
 * string (the metric, not the runtime type, distinguishes code from text).
 */
export function observationValueMatchesMetricValueType(
  value: ObservationValue,
  valueType: MetricValueType,
): boolean {
  switch (valueType) {
    case "quantity":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "code":
    case "text":
      return typeof value === "string";
  }
}

/**
 * Pure guard: asserts that an {@link Observation} conforms to a
 * {@link MetricDefinition} — same terminology concept code, a unit within
 * the metric's unit domain, and a value matching the metric's value type.
 * Throws {@link DomainInvariantError} naming the violated rule — received
 * values are never echoed.
 */
export function assertObservationConformsToMetric(
  observation: Observation,
  metric: MetricDefinition,
): void {
  if (observation.conceptCode !== metric.conceptCode) {
    throw new DomainInvariantError(
      "Observation concept code does not match the metric's concept code.",
    );
  }
  if (!isUnitAllowedForMetric(metric, observation.unit)) {
    throw new DomainInvariantError(
      "Observation unit is outside the metric's unit domain.",
    );
  }
  if (!observationValueMatchesMetricValueType(observation.value, metric.valueType)) {
    throw new DomainInvariantError(
      "Observation value does not match the metric's value type.",
    );
  }
}
