import { describe, expect, it } from "vitest";
import {
  applyUnitConversion,
  InMemoryUnitConversionTable,
  validateUnitConversionSpec,
  type UnitConversionSpec,
} from "./units.js";

const HEART_RATE_CONVERSION: UnitConversionSpec = {
  metricId: "SYNTH-metric-heart-rate",
  fromUnit: "count/min",
  toUnit: "beats/min",
  factor: 1,
};

const SLEEP_CONVERSION: UnitConversionSpec = {
  metricId: "SYNTH-metric-sleep-minutes",
  fromUnit: "s",
  toUnit: "min",
  factor: 1 / 60,
};

describe("validateUnitConversionSpec", () => {
  it("accepts a well-formed declaration", () => {
    const result = validateUnitConversionSpec(HEART_RATE_CONVERSION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fromUnit).toBe("count/min");
      expect(result.value.toUnit).toBe("beats/min");
      expect(result.value.factor).toBe(1);
    }
  });

  it("rejects malformed declarations with typed reasons (deny-by-default)", () => {
    expect(validateUnitConversionSpec(null)).toEqual({ ok: false, error: { kind: "invalid-metric" } });
    expect(
      validateUnitConversionSpec({ ...HEART_RATE_CONVERSION, metricId: "" }),
    ).toEqual({ ok: false, error: { kind: "invalid-metric" } });
    expect(
      validateUnitConversionSpec({ ...HEART_RATE_CONVERSION, fromUnit: "" }),
    ).toEqual({ ok: false, error: { kind: "invalid-from-unit" } });
    expect(
      validateUnitConversionSpec({ ...HEART_RATE_CONVERSION, toUnit: "" }),
    ).toEqual({ ok: false, error: { kind: "invalid-to-unit" } });
    expect(
      validateUnitConversionSpec({ ...HEART_RATE_CONVERSION, factor: 0 }),
    ).toEqual({ ok: false, error: { kind: "invalid-factor" } });
    expect(
      validateUnitConversionSpec({ ...HEART_RATE_CONVERSION, factor: Number.NaN }),
    ).toEqual({ ok: false, error: { kind: "invalid-factor" } });
    expect(
      validateUnitConversionSpec({ ...HEART_RATE_CONVERSION, factor: -1 }),
    ).toEqual({ ok: false, error: { kind: "invalid-factor" } });
  });
});

describe("applyUnitConversion — unit conversion correctness", () => {
  it("applies an identity conversion and reports applied=false", () => {
    const normalized = applyUnitConversion(8432, {
      metricId: "SYNTH-metric-step-count",
      fromUnit: "count",
      toUnit: "count",
      factor: 1,
    });
    expect(normalized.value).toBe(8432);
    expect(normalized.unit).toBe("count");
    expect(normalized.conversion.applied).toBe(false);
    expect(normalized.conversion.fromUnit).toBe("count");
    expect(normalized.conversion.toUnit).toBe("count");
  });

  it("applies a unit-name normalization (count/min -> beats/min, factor 1)", () => {
    const normalized = applyUnitConversion(62, HEART_RATE_CONVERSION);
    expect(normalized.value).toBe(62);
    expect(normalized.unit).toBe("beats/min");
    expect(normalized.conversion.applied).toBe(true);
  });

  it("applies the HealthKit sleep seconds -> minutes conversion", () => {
    const normalized = applyUnitConversion(28800, SLEEP_CONVERSION);
    expect(normalized.value).toBeCloseTo(480, 6);
    expect(normalized.unit).toBe("min");
    expect(normalized.conversion.applied).toBe(true);
    expect(normalized.conversion.factor).toBeCloseTo(1 / 60, 12);
  });

  it("applies an arbitrary linear factor (lb -> kg) without rounding", () => {
    const normalized = applyUnitConversion(150, {
      metricId: "SYNTH-metric-body-weight",
      fromUnit: "lb",
      toUnit: "kg",
      factor: 0.45359237,
    });
    expect(normalized.value).toBeCloseTo(68.0388555, 6);
    expect(normalized.unit).toBe("kg");
    expect(normalized.conversion.applied).toBe(true);
  });
});

describe("InMemoryUnitConversionTable", () => {
  it("resolves declared conversions by (metricId, fromUnit)", () => {
    const table = InMemoryUnitConversionTable.create([
      HEART_RATE_CONVERSION,
      SLEEP_CONVERSION,
    ]);
    expect(table.ok).toBe(true);
    if (table.ok) {
      expect(table.value.resolve("SYNTH-metric-heart-rate", "count/min")).toBeDefined();
      expect(table.value.resolve("SYNTH-metric-sleep-minutes", "s")).toBeDefined();
      expect(table.value.resolve("SYNTH-metric-heart-rate", "bpm")).toBeUndefined();
      expect(table.value.resolve("SYNTH-metric-step-count", "count")).toBeUndefined();
    }
  });

  it("rejects duplicate (metricId, fromUnit) declarations", () => {
    const table = InMemoryUnitConversionTable.create([
      HEART_RATE_CONVERSION,
      { ...HEART_RATE_CONVERSION, toUnit: "bpm" },
    ]);
    expect(table).toEqual({ ok: false, error: { kind: "duplicate-entry" } });
  });

  it("rejects malformed declarations at construction (typed, never thrown)", () => {
    const table = InMemoryUnitConversionTable.create([
      { ...HEART_RATE_CONVERSION, factor: 0 },
    ]);
    expect(table).toEqual({ ok: false, error: { kind: "invalid-spec" } });
  });
});
