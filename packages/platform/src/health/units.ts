/**
 * Unit conversion declarations for measurement sources (A32, Lane C packet
 * M4-C).
 *
 * Architecture rule (packet): "unit conversions declared per source,
 * applied at normalization". Each registered measurement source DECLARES
 * the conversions from its native units into the canonical metric units;
 * the declaration is the single source of truth for how a raw native
 * sample's value becomes a canonical observation value. The canonical
 * TARGET unit itself is validated against the metric catalog by the
 * engine's domain guards (`assertObservationConformsToMetric`) at
 * validation time — this module only applies the declared arithmetic.
 *
 * Conversions are linear (`value * factor`) — every conversion in the
 * current platform surface (count/min → beats/min, bpm → beats/min,
 * seconds → minutes) is linear, and a non-linear conversion would need a
 * tech-lead review before entering the seam (recorded assumption).
 *
 * RECORDED SOURCE OF TRUTH for the seeded platform conversions (units per
 * the native platform documentation; metric ids and units align with the
 * Lane A engine seed `SEEDED_METRIC_IDS` / `SEEDED_METRIC_DEFINITIONS`):
 *   - HealthKit heart rate: native HKUnit string "count/min" → canonical
 *     "beats/min", factor 1 (unit-name normalization);
 *   - HealthKit step count: native "count" → canonical "count", factor 1
 *     (identity — declared explicitly so the native unit is documented);
 *   - HealthKit sleep: the adapter derives asleep-interval durations in
 *     SECONDS (native unit "s") → canonical "min", factor 1/60;
 *   - Health Connect heart rate: native "bpm" → canonical "beats/min",
 *     factor 1 (unit-name normalization);
 *   - Health Connect step count: native "count" → canonical "count",
 *     factor 1 (identity);
 *   - Health Connect sleep: native "min" → canonical "min", factor 1
 *     (identity — Health Connect expresses sleep durations in minutes).
 * Manual capture enters values directly in canonical units and declares NO
 * conversions (there is no native unit to convert from).
 */
import { err, ok, type HealthResult } from "./result.js";

/**
 * One declared unit conversion for a source: values of `metricId`
 * arriving in `fromUnit` are normalized to `toUnit` by multiplying with
 * `factor`.
 */
export interface UnitConversionSpec {
  readonly metricId: string;
  /** Native unit string exactly as the source platform reports it. */
  readonly fromUnit: string;
  /** Canonical metric unit the normalization produces. */
  readonly toUnit: string;
  /** Linear multiplier (finite, > 0). */
  readonly factor: number;
}

/** Typed rejections for a malformed conversion declaration. */
export type UnitConversionSpecError =
  | { readonly kind: "invalid-metric" }
  | { readonly kind: "invalid-from-unit" }
  | { readonly kind: "invalid-to-unit" }
  | { readonly kind: "invalid-factor" };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validates an unknown value as a well-formed {@link UnitConversionSpec}.
 * Never throws; never echoes the offending value.
 */
export function validateUnitConversionSpec(
  spec: unknown,
): HealthResult<UnitConversionSpec, UnitConversionSpecError> {
  if (typeof spec !== "object" || spec === null) {
    return err({ kind: "invalid-metric" });
  }
  const candidate = spec as Partial<Record<keyof UnitConversionSpec, unknown>>;
  if (!isNonEmptyString(candidate.metricId)) {
    return err({ kind: "invalid-metric" });
  }
  if (!isNonEmptyString(candidate.fromUnit)) {
    return err({ kind: "invalid-from-unit" });
  }
  if (!isNonEmptyString(candidate.toUnit)) {
    return err({ kind: "invalid-to-unit" });
  }
  const factor = candidate.factor;
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) {
    return err({ kind: "invalid-factor" });
  }
  return ok({
    metricId: candidate.metricId,
    fromUnit: candidate.fromUnit,
    toUnit: candidate.toUnit,
    factor,
  });
}

/** The outcome of applying a declared conversion to one raw value. */
export interface AppliedUnitConversion {
  /** True when a non-identity conversion was applied (renamed unit or factor ≠ 1). */
  readonly applied: boolean;
  readonly fromUnit: string;
  readonly toUnit: string;
  readonly factor: number;
}

/** The result of normalizing one raw sample's quantity. */
export interface NormalizedQuantity {
  readonly value: number;
  readonly unit: string;
  readonly conversion: AppliedUnitConversion;
}

/**
 * Applies a declared conversion to a raw native value. Pure: no rounding,
 * no clamping — clinical values are never silently altered (a value that
 * needs snapping is a validation-policy concern, owned by the engine).
 */
export function applyUnitConversion(
  value: number,
  spec: UnitConversionSpec,
): NormalizedQuantity {
  const applied = !(spec.fromUnit === spec.toUnit && spec.factor === 1);
  return {
    value: value * spec.factor,
    unit: spec.toUnit,
    conversion: {
      applied,
      fromUnit: spec.fromUnit,
      toUnit: spec.toUnit,
      factor: spec.factor,
    },
  };
}

/** Lookup port: the per-source conversion declaration, keyed by (metricId, fromUnit). */
export interface UnitConversionTable {
  /** The declared conversion for a metric arriving in `fromUnit`, if any. */
  resolve(metricId: string, fromUnit: string): UnitConversionSpec | undefined;
}

/** Typed rejections when building an {@link InMemoryUnitConversionTable}. */
export type UnitConversionTableError =
  | { readonly kind: "invalid-spec" }
  | { readonly kind: "duplicate-entry" };

/**
 * In-memory reference {@link UnitConversionTable}. Construct through
 * {@link InMemoryUnitConversionTable.create} so malformed declarations are
 * typed rejections (deny-by-default), never thrown errors.
 */
export class InMemoryUnitConversionTable implements UnitConversionTable {
  readonly #entries = new Map<string, UnitConversionSpec>();

  private constructor(entries: readonly UnitConversionSpec[]) {
    for (const entry of entries) {
      this.#entries.set(`${entry.metricId}\u0000${entry.fromUnit}`, entry);
    }
  }

  /** Builds a table from declared specs; duplicate (metricId, fromUnit) keys are rejected. */
  static create(
    specs: readonly UnitConversionSpec[],
  ): HealthResult<InMemoryUnitConversionTable, UnitConversionTableError> {
    if (!Array.isArray(specs)) {
      return err({ kind: "invalid-spec" });
    }
    const seen = new Set<string>();
    const validated: UnitConversionSpec[] = [];
    for (const spec of specs) {
      const result = validateUnitConversionSpec(spec);
      if (!result.ok) {
        return err({ kind: "invalid-spec" });
      }
      const key = `${result.value.metricId}\u0000${result.value.fromUnit}`;
      if (seen.has(key)) {
        return err({ kind: "duplicate-entry" });
      }
      seen.add(key);
      validated.push(result.value);
    }
    return ok(new InMemoryUnitConversionTable(validated));
  }

  resolve(metricId: string, fromUnit: string): UnitConversionSpec | undefined {
    return this.#entries.get(`${metricId}\u0000${fromUnit}`);
  }
}

/**
 * Builds the per-source conversion lookup used by the normalization step:
 * the source's declared {@link UnitConversionSpec} list (the source of
 * truth) reduced into a {@link UnitConversionTable} view.
 */
export function conversionTableFor(
  specs: readonly UnitConversionSpec[],
): UnitConversionTable {
  const result = InMemoryUnitConversionTable.create(specs);
  if (!result.ok) {
    // Malformed declarations are rejected at REGISTRATION time (typed
    // result); reaching here means the registry accepted a malformed
    // declaration — a programming invariant, not a domain rejection.
    throw new Error("Measurement source carried a malformed unit conversion declaration.");
  }
  return result.value;
}
