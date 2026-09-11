import { describe, expect, it } from "vitest";
import { isMetricDefinition, type MetricDefinition } from "@orbb/domain";
import { DeterministicClock } from "@orbb/testkit";
import { InMemoryMetricCatalog } from "./catalog.js";
import { SEEDED_METRIC_DEFINITIONS, SEEDED_METRIC_IDS, seedMeasurementVocabulary } from "./seed.js";

const BASE: MetricDefinition = {
  id: "SYNTH-metric-test",
  displayName: "Test Metric",
  unitDomain: ["mmHg"],
  valueType: "quantity",
  conceptCode: "SYNTH-0000-0",
  category: "vital-signs",
};

const REVISED: MetricDefinition = {
  ...BASE,
  displayName: "Test Metric (revised)",
  conceptCode: "SYNTH-0000-1",
};

function freshCatalog(): InMemoryMetricCatalog {
  return new InMemoryMetricCatalog(new DeterministicClock({ epochMs: 1_000 }));
}

describe("A27 metric catalog — registration and lookup", () => {
  it("registers a fresh metric as version 1, active", () => {
    const catalog = freshCatalog();
    const result = catalog.register({ definition: BASE });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record.version).toBe(1);
      expect(result.value.record.state).toBe("active");
      expect(result.value.pair).toBeUndefined();
    }
  });

  it("resolves the ACTIVE version by id (lookup by id)", () => {
    const catalog = freshCatalog();
    catalog.register({ definition: BASE });
    expect(catalog.resolveActive(BASE.id)).toEqual(BASE);
    expect(catalog.resolveActive("SYNTH-metric-unknown")).toBeUndefined();
  });

  it("rejects a malformed definition via the frozen domain guard (typed, no throw)", () => {
    const catalog = freshCatalog();
    const result = catalog.register({ definition: { ...BASE, unitDomain: [] } as unknown as MetricDefinition });
    expect(result).toEqual({ ok: false, error: { kind: "invalid-definition" } });
  });

  it("requires explicit supersession when the metric already exists", () => {
    const catalog = freshCatalog();
    catalog.register({ definition: BASE });
    const result = catalog.register({ definition: REVISED });
    expect(result).toEqual({ ok: false, error: { kind: "supersede-required" } });
  });

  it("rejects supersession of an unknown version or an unregistered metric", () => {
    const catalog = freshCatalog();
    expect(catalog.register({ definition: BASE, supersedes: 1 })).toEqual({
      ok: false,
      error: { kind: "unknown-supersede-target" },
    });
    catalog.register({ definition: BASE });
    expect(catalog.register({ definition: REVISED, supersedes: 7 })).toEqual({
      ok: false,
      error: { kind: "unknown-supersede-target" },
    });
  });
});

describe("A27 metric catalog — versioned supersession (domain mirror)", () => {
  it("installs a replacement as active and moves the target to terminal superseded", () => {
    const catalog = freshCatalog();
    catalog.register({ definition: BASE });
    const result = catalog.register({ definition: REVISED, supersedes: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected supersession to succeed");
    }
    // Domain SupersededPair shape: { superseded, replacement }.
    expect(result.value.pair?.superseded).toMatchObject({
      version: 1,
      state: "superseded",
      supersededAt: new Date(1_000),
    });
    expect(result.value.pair?.replacement).toMatchObject({
      version: 2,
      state: "active",
      supersedesVersion: 1,
    });
    // Lookup by id resolves to the ACTIVE version.
    expect(catalog.resolveActive(BASE.id)).toEqual(REVISED);
  });

  it("never discards superseded versions — they stay resolvable with their definition intact", () => {
    const catalog = freshCatalog();
    catalog.register({ definition: BASE });
    catalog.register({ definition: REVISED, supersedes: 1 });
    const superseded = catalog.resolveVersion(BASE.id, 1);
    expect(superseded?.state).toBe("superseded");
    expect(superseded?.definition).toEqual(BASE);
    expect(catalog.resolveVersion(BASE.id, 2)?.definition).toEqual(REVISED);
  });

  it("rejects re-superseding an already-superseded version (only ACTIVE can be superseded)", () => {
    const catalog = freshCatalog();
    catalog.register({ definition: BASE });
    catalog.register({ definition: REVISED, supersedes: 1 });
    const again = catalog.register({
      definition: { ...REVISED, conceptCode: "SYNTH-0000-2" },
      supersedes: 1,
    });
    expect(again).toEqual({ ok: false, error: { kind: "target-not-active" } });
  });

  it("supports a three-version chain where each lookup resolves the latest active version", () => {
    const catalog = freshCatalog();
    catalog.register({ definition: BASE });
    catalog.register({ definition: REVISED, supersedes: 1 });
    const v3 = catalog.register({
      definition: { ...REVISED, conceptCode: "SYNTH-0000-3" },
      supersedes: 2,
    });
    expect(v3.ok).toBe(true);
    expect(catalog.resolveActive(BASE.id)?.conceptCode).toBe("SYNTH-0000-3");
    expect(catalog.resolveVersion(BASE.id, 2)?.state).toBe("superseded");
    expect(catalog.resolveVersion(BASE.id, 1)?.state).toBe("superseded");
  });

  it("lists active definitions by category (lookup by domain), excluding superseded versions", () => {
    const catalog = freshCatalog();
    catalog.register({ definition: BASE });
    catalog.register({
      definition: { ...BASE, id: "SYNTH-metric-other", conceptCode: "SYNTH-0001-0" },
    });
    expect(catalog.listActiveByCategory("vital-signs")).toHaveLength(2);
    expect(catalog.listActiveByCategory("activity")).toHaveLength(0);
    catalog.register({ definition: REVISED, supersedes: 1 });
    const vital = catalog.listActiveByCategory("vital-signs");
    expect(vital).toHaveLength(2);
    expect(vital.map((definition) => definition.conceptCode)).not.toContain("SYNTH-0000-0");
    expect(catalog.listActive()).toHaveLength(2);
  });
});

describe("A27 seeded catalog — real metric shapes, synthetic ids", () => {
  it("seeds the five real metric shapes with real units and domains", () => {
    const { catalog } = seedMeasurementVocabulary();
    const systolic = catalog.resolveActive(SEEDED_METRIC_IDS.bloodPressureSystolic);
    expect(systolic?.unitDomain).toEqual(["mmHg"]);
    expect(systolic?.category).toBe("vital-signs");
    expect(systolic?.valueType).toBe("quantity");
    const diastolic = catalog.resolveActive(SEEDED_METRIC_IDS.bloodPressureDiastolic);
    expect(diastolic?.unitDomain).toEqual(["mmHg"]);
    const heartRate = catalog.resolveActive(SEEDED_METRIC_IDS.heartRate);
    expect(heartRate?.unitDomain).toEqual(["beats/min"]);
    const bodyWeight = catalog.resolveActive(SEEDED_METRIC_IDS.bodyWeight);
    expect(bodyWeight?.unitDomain).toEqual(["kg"]);
    const stepCount = catalog.resolveActive(SEEDED_METRIC_IDS.stepCount);
    expect(stepCount?.unitDomain).toEqual(["count"]);
    const sleepMinutes = catalog.resolveActive(SEEDED_METRIC_IDS.sleepMinutes);
    expect(sleepMinutes?.unitDomain).toEqual(["min"]);
  });

  it("seeds definitions that satisfy the frozen domain guard", () => {
    for (const definition of SEEDED_METRIC_DEFINITIONS) {
      expect(isMetricDefinition(definition)).toBe(true);
    }
  });

  it("marks every seeded id and concept code as obviously synthetic (zero PHI)", () => {
    for (const definition of SEEDED_METRIC_DEFINITIONS) {
      expect(definition.id.startsWith("SYNTH-")).toBe(true);
      expect(definition.conceptCode.startsWith("SYNTH-")).toBe(true);
    }
  });

  it("resolves every seeded metric by id and groups by domain (category)", () => {
    const { catalog } = seedMeasurementVocabulary();
    expect(catalog.listActive()).toHaveLength(SEEDED_METRIC_DEFINITIONS.length);
    expect(catalog.listActiveByCategory("vital-signs")).toHaveLength(3);
    expect(catalog.listActiveByCategory("body-composition")).toHaveLength(1);
    expect(catalog.listActiveByCategory("activity")).toHaveLength(1);
    expect(catalog.listActiveByCategory("sleep")).toHaveLength(1);
  });
});
