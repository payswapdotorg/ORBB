import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import { parseObservationId, parsePersonId, parseProvenanceId, parseSourceId } from "./ids.js";
import { parseEvidenceLabel } from "./evidence.js";
import {
  assertMeasurementCapability,
  assertMeasurementMethod,
  assertMethodForMetric,
  assertObservationUsesMethod,
  assertQualityRange,
  compareMethodsByBurden,
  isMeasurementCapability,
  isMeasurementMethod,
  isQualityRange,
  isRelativeBurdenRank,
  type MeasurementCapability,
  type MeasurementMethod,
} from "./method.js";
import type { MetricDefinition } from "./metric.js";
import type { Observation } from "./observation.js";
import { parseQualityScore } from "./observation.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

const heartRateMetric: MetricDefinition = {
  id: "metric-resting-heart-rate",
  displayName: "Resting heart rate",
  unitDomain: ["beats/min"],
  valueType: "quantity",
  conceptCode: "8867-4",
  category: "vital-signs",
};

const chestStrapMethod: MeasurementMethod = {
  id: "method-chest-strap-hrm",
  metricId: "metric-resting-heart-rate",
  evidenceLabel: "MEASURED",
  typicalQuality: { min: parseQualityScore(0.9), max: parseQualityScore(0.99) },
  relativeBurden: 2,
};

const selfReportMethod: MeasurementMethod = {
  id: "method-self-report",
  metricId: "metric-resting-heart-rate",
  evidenceLabel: "ESTIMATED",
  typicalQuality: { min: parseQualityScore(0.3), max: parseQualityScore(0.6) },
  relativeBurden: 1,
};

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: parseObservationId(`obs_${BODY}`),
    personId: parsePersonId(`prsn_${BODY}`),
    conceptCode: "8867-4",
    value: 62,
    unit: "beats/min",
    effectiveAt: new Date("2025-01-15T07:45:00.000Z"),
    observedAt: new Date("2025-01-15T08:00:00.000Z"),
    sourceId: parseSourceId(`src_${BODY}`),
    methodId: "method-chest-strap-hrm",
    validationState: "pending",
    provenanceId: parseProvenanceId(`prov_${BODY}`),
    evidenceLabel: parseEvidenceLabel("MEASURED"),
    ...overrides,
  };
}

describe("typical quality range", () => {
  it("accepts inclusive ranges within [0, 1] with min <= max", () => {
    expect(isQualityRange({ min: 0, max: 1 })).toBe(true);
    expect(isQualityRange({ min: 0.9, max: 0.99 })).toBe(true);
    expect(isQualityRange({ min: 0.5, max: 0.5 })).toBe(true);
    expect(() => assertQualityRange({ min: 0.9, max: 0.99 })).not.toThrow();
  });

  it("rejects inverted, out-of-range, and malformed ranges", () => {
    expect(isQualityRange({ min: 0.8, max: 0.2 })).toBe(false);
    expect(isQualityRange({ min: -0.1, max: 0.5 })).toBe(false);
    expect(isQualityRange({ min: 0.5, max: 1.1 })).toBe(false);
    expect(isQualityRange({ min: Number.NaN, max: 1 })).toBe(false);
    expect(isQualityRange({ min: "0.5", max: "1" })).toBe(false);
    expect(isQualityRange(null)).toBe(false);
    expect(() => assertQualityRange({ min: 0.8, max: 0.2 })).toThrow(DomainInvariantError);
    expect(() => assertQualityRange(null)).toThrow(DomainInvariantError);
  });
});

describe("relative burden rank", () => {
  it("accepts positive integers", () => {
    expect(isRelativeBurdenRank(1)).toBe(true);
    expect(isRelativeBurdenRank(10)).toBe(true);
    expect(isRelativeBurdenRank(1_000)).toBe(true);
  });

  it("rejects zero, negatives, non-integers, and non-numbers", () => {
    expect(isRelativeBurdenRank(0)).toBe(false);
    expect(isRelativeBurdenRank(-1)).toBe(false);
    expect(isRelativeBurdenRank(1.5)).toBe(false);
    expect(isRelativeBurdenRank("1")).toBe(false);
  });
});

describe("measurement method guard", () => {
  it("accepts a well-formed method", () => {
    expect(isMeasurementMethod(chestStrapMethod)).toBe(true);
    expect(() => assertMeasurementMethod(chestStrapMethod)).not.toThrow();
    expect(() => assertMeasurementMethod(selfReportMethod)).not.toThrow();
  });

  it("accepts every legal evidence label (each method produces exactly one)", () => {
    for (const label of ["MEASURED", "ESTIMATED", "IMPORTED", "DERIVED"] as const) {
      const method: MeasurementMethod = {
        ...chestStrapMethod,
        evidenceLabel: parseEvidenceLabel(label),
      };
      expect(isMeasurementMethod(method)).toBe(true);
    }
  });

  it("rejects an illegal evidence label (pure guard)", () => {
    const method = {
      ...chestStrapMethod,
      evidenceLabel: "GUESSED" as unknown as MeasurementMethod["evidenceLabel"],
    };
    expect(isMeasurementMethod(method)).toBe(false);
    expect(() => assertMeasurementMethod(method)).toThrow(DomainInvariantError);
  });

  it("rejects empty ids and metric ids", () => {
    expect(isMeasurementMethod({ ...chestStrapMethod, id: "" })).toBe(false);
    expect(isMeasurementMethod({ ...chestStrapMethod, metricId: "" })).toBe(false);
    expect(() => assertMeasurementMethod({ ...chestStrapMethod, id: "" })).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects malformed typical quality and burden rank", () => {
    expect(
      isMeasurementMethod({ ...chestStrapMethod, typicalQuality: { min: 0.9, max: 0.2 } }),
    ).toBe(false);
    expect(isMeasurementMethod({ ...chestStrapMethod, relativeBurden: 0 })).toBe(false);
    expect(isMeasurementMethod({ ...chestStrapMethod, relativeBurden: 1.5 })).toBe(false);
    expect(
      () => assertMeasurementMethod({ ...chestStrapMethod, relativeBurden: 0 }),
    ).toThrow(DomainInvariantError);
    expect(isMeasurementMethod(null)).toBe(false);
  });
});

describe("method/metric combo guard", () => {
  it("accepts a method paired with the metric it references", () => {
    expect(() => assertMethodForMetric(chestStrapMethod, heartRateMetric)).not.toThrow();
  });

  it("rejects a method paired with a different metric", () => {
    const otherMetric: MetricDefinition = {
      ...heartRateMetric,
      id: "metric-body-weight",
      conceptCode: "29463-7",
    };
    expect(() => assertMethodForMetric(chestStrapMethod, otherMetric)).toThrow(
      DomainInvariantError,
    );
  });
});

describe("observation/method consistency", () => {
  it("accepts an observation produced by the given method", () => {
    expect(() => assertObservationUsesMethod(makeObservation(), chestStrapMethod)).not.toThrow();
  });

  it("rejects an observation with a different method code", () => {
    const observation = makeObservation({ methodId: "method-self-report" });
    expect(() => assertObservationUsesMethod(observation, chestStrapMethod)).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects an observation whose evidence label disagrees with the method's label", () => {
    const observation = makeObservation({ evidenceLabel: parseEvidenceLabel("ESTIMATED") });
    expect(() => assertObservationUsesMethod(observation, chestStrapMethod)).toThrow(
      DomainInvariantError,
    );
  });
});

describe("measurement capability", () => {
  it("accepts a well-formed capability", () => {
    const capability: MeasurementCapability = {
      personId: parsePersonId(`prsn_${BODY}`),
      methodId: "method-chest-strap-hrm",
      active: true,
    };
    expect(isMeasurementCapability(capability)).toBe(true);
    expect(() => assertMeasurementCapability(capability)).not.toThrow();
  });

  it("rejects malformed person ids, method ids, and active flags", () => {
    expect(
      isMeasurementCapability({
        personId: "not-a-person-id",
        methodId: "method-chest-strap-hrm",
        active: true,
      }),
    ).toBe(false);
    expect(
      isMeasurementCapability({ personId: parsePersonId(`prsn_${BODY}`), methodId: "", active: true }),
    ).toBe(false);
    expect(
      isMeasurementCapability({
        personId: parsePersonId(`prsn_${BODY}`),
        methodId: "method-chest-strap-hrm",
        active: "yes",
      }),
    ).toBe(false);
    expect(isMeasurementCapability(null)).toBe(false);
    expect(() => assertMeasurementCapability(null)).toThrow(DomainInvariantError);
  });
});

describe("least-burden-first ordering", () => {
  it("sorts methods by ascending relative burden", () => {
    const methods = [chestStrapMethod, selfReportMethod];
    const ordered = [...methods].sort(compareMethodsByBurden);
    expect(ordered[0]?.id).toBe("method-self-report");
    expect(ordered[1]?.id).toBe("method-chest-strap-hrm");
    expect(compareMethodsByBurden(selfReportMethod, chestStrapMethod)).toBeLessThan(0);
    expect(compareMethodsByBurden(chestStrapMethod, selfReportMethod)).toBeGreaterThan(0);
    expect(compareMethodsByBurden(chestStrapMethod, chestStrapMethod)).toBe(0);
  });
});
