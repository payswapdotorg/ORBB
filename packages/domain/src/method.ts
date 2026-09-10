/**
 * MeasurementMethod aggregate (M1, measurement lane vocabulary).
 *
 * A MeasurementMethod describes HOW a metric is measured: which metric it
 * applies to, the single evidence label it can produce, its typical quality
 * range, and its relative burden rank (for least-burden-first UX).
 *
 * Recorded assumptions:
 *   - `id` is an opaque method code string (e.g. "method-chest-strap-hrm")
 *     owned by the measurement lane. Like metric ids, it is deliberately
 *     NOT one of the frozen M0 canonical branded ids.
 *   - `metricId` references a {@link MetricDefinition} by its opaque id;
 *     cross-checking happens via {@link assertMethodForMetric} because the
 *     method record carries only the reference, not the metric aggregate.
 *   - Every method produces exactly ONE evidence label
 *     (MEASURED | ESTIMATED | IMPORTED | DERIVED). The type system enforces
 *     "exactly one" (a scalar field) and {@link parseEvidenceLabel} is the
 *     pure guard enforcing membership in the frozen vocabulary.
 *   - `relativeBurden` is a positive integer rank where lower = less burden
 *     (rank 1 = least burdensome). Ranks need not be contiguous; they only
 *     define a total order for least-burden-first suggestion UX.
 */
import type { EvidenceLabel } from "./evidence.js";
import { isEvidenceLabel } from "./evidence.js";
import type { PersonId } from "./ids.js";
import { isIdOf } from "./ids.js";
import type { Observation } from "./observation.js";
import type { QualityScore } from "./observation.js";
import { DomainInvariantError } from "./errors.js";
import type { MetricDefinition } from "./metric.js";

/** Inclusive typical-quality range within [0, 1] (min <= max). */
export interface QualityRange {
  readonly min: QualityScore;
  readonly max: QualityScore;
}

export interface MeasurementMethod {
  /** Opaque method code (measurement lane owns the vocabulary). */
  readonly id: string;
  /** The metric this method measures (references MetricDefinition.id). */
  readonly metricId: string;
  /** The single evidence label this method can produce. */
  readonly evidenceLabel: EvidenceLabel;
  readonly typicalQuality: QualityRange;
  /** Positive integer burden rank; lower = less burden. */
  readonly relativeBurden: number;
}

/**
 * MeasurementCapability association: what a person can currently do.
 * A capability links one person to one method with an active flag; the
 * measurement lane owns activation/deactivation events.
 */
export interface MeasurementCapability {
  readonly personId: PersonId;
  /** Opaque method code (references MeasurementMethod.id). */
  readonly methodId: string;
  readonly active: boolean;
}

export function isQualityRange(value: unknown): value is QualityRange {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof QualityRange, unknown>>;
  if (typeof candidate.min !== "number" || typeof candidate.max !== "number") {
    return false;
  }
  return (
    Number.isFinite(candidate.min) &&
    Number.isFinite(candidate.max) &&
    candidate.min >= 0 &&
    candidate.min <= 1 &&
    candidate.max >= 0 &&
    candidate.max <= 1 &&
    candidate.min <= candidate.max
  );
}

/**
 * Pure guard for {@link QualityRange}. Throws
 * {@link DomainInvariantError} describing the expected shape — received
 * values are never echoed.
 */
export function assertQualityRange(candidate: unknown): asserts candidate is QualityRange {
  if (!isQualityRange(candidate)) {
    throw new DomainInvariantError(
      "Invalid typical quality range: expected { min, max } with finite numbers in [0, 1] and min <= max.",
    );
  }
}

export function isRelativeBurdenRank(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function isMeasurementMethod(value: unknown): value is MeasurementMethod {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof MeasurementMethod, unknown>>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return false;
  }
  if (typeof candidate.metricId !== "string" || candidate.metricId.length === 0) {
    return false;
  }
  if (!isEvidenceLabel(candidate.evidenceLabel)) {
    return false;
  }
  if (!isQualityRange(candidate.typicalQuality)) {
    return false;
  }
  if (!isRelativeBurdenRank(candidate.relativeBurden)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link MeasurementMethod}. Throws {@link DomainInvariantError} describing
 * the expected shape — received values are never echoed.
 */
export function assertMeasurementMethod(candidate: unknown): asserts candidate is MeasurementMethod {
  if (!isMeasurementMethod(candidate)) {
    throw new DomainInvariantError(
      "Invalid measurement method: expected { id, metricId, evidenceLabel, typicalQuality, relativeBurden } with non-empty id/metricId, an evidence label of MEASURED|ESTIMATED|IMPORTED|DERIVED, a typical quality range in [0, 1], and a positive integer relative burden rank.",
    );
  }
}

export function isMeasurementCapability(value: unknown): value is MeasurementCapability {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof MeasurementCapability, unknown>>;
  if (!isIdOf("person", candidate.personId)) {
    return false;
  }
  if (typeof candidate.methodId !== "string" || candidate.methodId.length === 0) {
    return false;
  }
  if (typeof candidate.active !== "boolean") {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link MeasurementCapability}. Throws
 * {@link DomainInvariantError} describing the expected shape — received
 * values are never echoed.
 */
export function assertMeasurementCapability(
  candidate: unknown,
): asserts candidate is MeasurementCapability {
  if (!isMeasurementCapability(candidate)) {
    throw new DomainInvariantError(
      "Invalid measurement capability: expected { personId, methodId, active } with a canonical person id, a non-empty method code, and a boolean active flag.",
    );
  }
}

/**
 * Pure guard: asserts that a {@link MeasurementMethod} belongs to the given
 * {@link MetricDefinition} (method.metricId === metric.id). This is the
 * metric/method combo check — a method defined for one metric must never be
 * paired with another.
 */
export function assertMethodForMetric(
  method: MeasurementMethod,
  metric: MetricDefinition,
): void {
  if (method.metricId !== metric.id) {
    throw new DomainInvariantError(
      "Measurement method does not belong to the given metric (method.metricId does not match metric.id).",
    );
  }
}

/**
 * Pure guard: asserts that an {@link Observation} was produced by the given
 * {@link MeasurementMethod} — matching method code AND matching evidence
 * label (a method produces exactly one label, so an observation recorded
 * via that method must carry it).
 */
export function assertObservationUsesMethod(
  observation: Observation,
  method: MeasurementMethod,
): void {
  if (observation.methodId !== method.id) {
    throw new DomainInvariantError(
      "Observation method code does not match the given measurement method.",
    );
  }
  if (observation.evidenceLabel !== method.evidenceLabel) {
    throw new DomainInvariantError(
      "Observation evidence label does not match the label produced by the given measurement method.",
    );
  }
}

/**
 * Least-burden-first comparator for suggestion UX: sorts methods by
 * ascending {@link MeasurementMethod.relativeBurden} (lower rank = less
 * burden). Ties keep a stable relative order via `Array.prototype.sort`.
 */
export function compareMethodsByBurden(
  a: MeasurementMethod,
  b: MeasurementMethod,
): number {
  return a.relativeBurden - b.relativeBurden;
}
