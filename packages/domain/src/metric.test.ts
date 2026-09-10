import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import {
  parseObservationId,
  parsePersonId,
  parseProvenanceId,
  parseSourceId,
} from "./ids.js";
import { parseEvidenceLabel } from "./evidence.js";
import {
  METRIC_VALUE_TYPES,
  assertMetricDefinition,
  assertObservationConformsToMetric,
  isMetricDefinition,
  isMetricValueType,
  isUnitAllowedForMetric,
  observationValueMatchesMetricValueType,
  parseMetricValueType,
  type MetricDefinition,
} from "./metric.js";
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

const smokingStatusMetric: MetricDefinition = {
  id: "metric-smoking-status",
  displayName: "Smoking status",
  unitDomain: [""],
  valueType: "code",
  conceptCode: "72166-2",
  category: "lifestyle",
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
    methodId: "manual-entry",
    validationState: "pending",
    provenanceId: parseProvenanceId(`prov_${BODY}`),
    evidenceLabel: parseEvidenceLabel("MEASURED"),
    quality: parseQualityScore(0.92),
    ...overrides,
  };
}

describe("metric value types", () => {
  it("accepts the four legal value types", () => {
    for (const valueType of METRIC_VALUE_TYPES) {
      expect(isMetricValueType(valueType)).toBe(true);
      expect(parseMetricValueType(valueType)).toBe(valueType);
    }
  });

  it("rejects unknown value types", () => {
    expect(isMetricValueType("ordinal")).toBe(false);
    expect(() => parseMetricValueType("ordinal")).toThrow(DomainInvariantError);
    expect(() => parseMetricValueType(null)).toThrow(DomainInvariantError);
  });
});

describe("metric definition guard", () => {
  it("accepts a well-formed quantity metric", () => {
    expect(isMetricDefinition(heartRateMetric)).toBe(true);
    expect(() => assertMetricDefinition(heartRateMetric)).not.toThrow();
  });

  it("accepts a well-formed non-quantitative metric with the empty unit domain", () => {
    expect(isMetricDefinition(smokingStatusMetric)).toBe(true);
    expect(() => assertMetricDefinition(smokingStatusMetric)).not.toThrow();
  });

  it("accepts a quantity metric with several allowed units", () => {
    const metric: MetricDefinition = {
      ...heartRateMetric,
      unitDomain: ["beats/min", "bpm"],
    };
    expect(isMetricDefinition(metric)).toBe(true);
  });

  it("rejects empty ids, display names, concept codes, and categories", () => {
    expect(isMetricDefinition({ ...heartRateMetric, id: "" })).toBe(false);
    expect(isMetricDefinition({ ...heartRateMetric, displayName: "" })).toBe(false);
    expect(isMetricDefinition({ ...heartRateMetric, conceptCode: "" })).toBe(false);
    expect(isMetricDefinition({ ...heartRateMetric, category: "" })).toBe(false);
    expect(isMetricDefinition(null)).toBe(false);
    expect(isMetricDefinition(42)).toBe(false);
    expect(() => assertMetricDefinition({ ...heartRateMetric, id: "" })).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects an empty unit domain", () => {
    const metric = { ...heartRateMetric, unitDomain: [] as string[] };
    expect(isMetricDefinition(metric)).toBe(false);
    expect(() => assertMetricDefinition(metric)).toThrow(DomainInvariantError);
  });

  it("rejects a quantity metric whose unit domain contains the empty unit", () => {
    const metric = { ...heartRateMetric, unitDomain: ["beats/min", ""] };
    expect(isMetricDefinition(metric)).toBe(false);
    expect(() => assertMetricDefinition(metric)).toThrow(DomainInvariantError);
  });

  it("rejects a non-quantitative metric whose unit domain is not exactly the empty unit", () => {
    const nonEmpty = { ...smokingStatusMetric, unitDomain: ["kg"] };
    expect(isMetricDefinition(nonEmpty)).toBe(false);
    const emptyList = { ...smokingStatusMetric, unitDomain: [] as string[] };
    expect(isMetricDefinition(emptyList)).toBe(false);
    const both = { ...smokingStatusMetric, unitDomain: ["", "kg"] };
    expect(isMetricDefinition(both)).toBe(false);
  });

  it("rejects duplicate units in the unit domain", () => {
    const metric = { ...heartRateMetric, unitDomain: ["beats/min", "beats/min"] };
    expect(isMetricDefinition(metric)).toBe(false);
    expect(() => assertMetricDefinition(metric)).toThrow(DomainInvariantError);
  });

  it("rejects non-string unit entries", () => {
    const metric = { ...heartRateMetric, unitDomain: ["beats/min", 42] };
    expect(isMetricDefinition(metric)).toBe(false);
  });

  it("rejects an illegal value type", () => {
    const metric = { ...heartRateMetric, valueType: "ordinal" };
    expect(isMetricDefinition(metric)).toBe(false);
    expect(() => assertMetricDefinition(metric)).toThrow(DomainInvariantError);
  });
});

describe("unit domain membership", () => {
  it("allows units within the domain and rejects units outside it", () => {
    expect(isUnitAllowedForMetric(heartRateMetric, "beats/min")).toBe(true);
    expect(isUnitAllowedForMetric(heartRateMetric, "bpm")).toBe(false);
    expect(isUnitAllowedForMetric(smokingStatusMetric, "")).toBe(true);
    expect(isUnitAllowedForMetric(smokingStatusMetric, "kg")).toBe(false);
  });
});

describe("observation/metric conformance", () => {
  it("value conformance follows the metric value type", () => {
    expect(observationValueMatchesMetricValueType(62, "quantity")).toBe(true);
    expect(observationValueMatchesMetricValueType("62", "quantity")).toBe(false);
    expect(observationValueMatchesMetricValueType(true, "boolean")).toBe(true);
    expect(observationValueMatchesMetricValueType("yes", "boolean")).toBe(false);
    expect(observationValueMatchesMetricValueType("smoker", "code")).toBe(true);
    expect(observationValueMatchesMetricValueType(62, "code")).toBe(false);
    expect(observationValueMatchesMetricValueType("note text", "text")).toBe(true);
    expect(observationValueMatchesMetricValueType(62, "text")).toBe(false);
  });

  it("accepts an observation that conforms to its metric", () => {
    expect(() =>
      assertObservationConformsToMetric(makeObservation(), heartRateMetric),
    ).not.toThrow();
  });

  it("rejects an observation for a different concept code", () => {
    const observation = makeObservation({ conceptCode: "85354-9" });
    expect(() => assertObservationConformsToMetric(observation, heartRateMetric)).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects an observation whose unit is outside the metric's unit domain", () => {
    const observation = makeObservation({ unit: "bpm" });
    expect(() => assertObservationConformsToMetric(observation, heartRateMetric)).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects an observation whose value type disagrees with the metric", () => {
    const numericValueForCodeMetric = makeObservation({
      conceptCode: "72166-2",
      unit: "",
      value: 1,
    });
    expect(() =>
      assertObservationConformsToMetric(numericValueForCodeMetric, smokingStatusMetric),
    ).toThrow(DomainInvariantError);

    const stringValueForQuantityMetric = makeObservation({ value: "62" });
    expect(() =>
      assertObservationConformsToMetric(stringValueForQuantityMetric, heartRateMetric),
    ).toThrow(DomainInvariantError);
  });
});
