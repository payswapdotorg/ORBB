import { describe, expect, it } from "vitest";
import { parseQualityScore, type MetricDefinition } from "@orbb/domain";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import {
  buildEngineHarness,
  harnessPersonId,
  registerSource,
} from "./testsupport.js";
import { SEEDED_METRIC_IDS, SEEDED_METHOD_IDS } from "./seed.js";
import {
  InMemoryCapabilityIndex,
  type RegisteredMeasurementSource,
} from "./capabilities.js";
import { InMemoryMetricCatalog } from "./catalog.js";
import {
  InMemoryMeasurementMethodRegistry,
  type MeasurementMethodRegistry,
} from "./methods.js";

const PERSON = harnessPersonId();

function bareVocabulary(): {
  catalog: InMemoryMetricCatalog;
  methods: MeasurementMethodRegistry;
} {
  const catalog = new InMemoryMetricCatalog(new DeterministicClock());
  const methods = new InMemoryMeasurementMethodRegistry(catalog);
  return { catalog, methods };
}

const BARE_METRIC: MetricDefinition = {
  id: "SYNTH-metric-bare",
  displayName: "Bare Metric",
  unitDomain: ["mmHg"],
  valueType: "quantity",
  conceptCode: "SYNTH-0000-8",
  category: "vital-signs",
};

function syntheticSource(
  ids: DeterministicIdFactory,
  personId: ReturnType<typeof harnessPersonId>,
  methodIds: readonly string[],
  kind: RegisteredMeasurementSource["kind"],
  active = true,
): RegisteredMeasurementSource {
  return {
    sourceId: ids.next("src") as RegisteredMeasurementSource["sourceId"],
    personId,
    kind,
    supportedMethodIds: methodIds,
    active,
  };
}

describe("A28 method registry", () => {
  it("registers methods only for metrics that exist in the catalog", () => {
    const { catalog, methods } = bareVocabulary();
    const orphan = {
      id: "SYNTH-method-orphan",
      metricId: "SYNTH-metric-ghost",
      evidenceLabel: "MEASURED" as const,
      typicalQuality: { min: parseQualityScore(0.5), max: parseQualityScore(0.9) },
      relativeBurden: 1,
    };
    expect(methods.register(orphan)).toEqual({ ok: false, error: { kind: "unknown-metric" } });
    expect(catalog.register({ definition: BARE_METRIC }).ok).toBe(true);
    expect(methods.register({ ...orphan, metricId: BARE_METRIC.id }).ok).toBe(true);
  });

  it("rejects malformed methods via the frozen domain guard (typed, no throw)", () => {
    const harness = buildEngineHarness();
    const malformed = {
      id: "SYNTH-method-malformed",
      metricId: SEEDED_METRIC_IDS.heartRate,
      evidenceLabel: "MEASURED" as const,
      typicalQuality: { min: 5, max: 9 },
      relativeBurden: 1,
    };
    expect(harness.methods.register(malformed as unknown as Parameters<typeof harness.methods.register>[0])).toEqual({
      ok: false,
      error: { kind: "invalid-method" },
    });
  });

  it("rejects duplicate method ids (append-only registry)", () => {
    const harness = buildEngineHarness();
    const duplicate = {
      id: SEEDED_METHOD_IDS.heartRateWearable,
      metricId: SEEDED_METRIC_IDS.heartRate,
      evidenceLabel: "MEASURED" as const,
      typicalQuality: { min: parseQualityScore(0.9), max: parseQualityScore(0.98) },
      relativeBurden: 1,
    };
    expect(harness.methods.register(duplicate)).toEqual({
      ok: false,
      error: { kind: "duplicate-method" },
    });
  });

  it("lists methods for a metric least-burden-first (domain comparator order)", () => {
    const harness = buildEngineHarness();
    expect(harness.methods.listForMetric(SEEDED_METRIC_IDS.heartRate).map((m) => m.id)).toEqual([
      SEEDED_METHOD_IDS.heartRateWearable,
      SEEDED_METHOD_IDS.heartRateApp,
      SEEDED_METHOD_IDS.heartRateManual,
    ]);
  });
});

describe("A28 capability index — deny-by-default", () => {
  it("denies with a typed reason when the person has NO registered source", () => {
    const harness = buildEngineHarness();
    expect(
      harness.capabilityIndex.resolve({ personId: PERSON, metricId: SEEDED_METRIC_IDS.heartRate }),
    ).toEqual({ ok: false, error: { kind: "no-registered-source" } });
  });

  it("denies when the metric is unknown to the catalog", () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    expect(
      harness.capabilityIndex.resolve({ personId: PERSON, metricId: "SYNTH-metric-ghost" }),
    ).toEqual({ ok: false, error: { kind: "metric-not-found" } });
  });

  it("denies when the metric exists but has no registered methods", () => {
    const { catalog, methods } = bareVocabulary();
    expect(catalog.register({ definition: BARE_METRIC }).ok).toBe(true);
    const index = new InMemoryCapabilityIndex({ methods, catalog });
    // A source cannot even register without supporting a KNOWN method, so
    // the person has no source for this metric; resolving the bare metric
    // itself must report the no-methods reason.
    expect(index.resolve({ personId: PERSON, metricId: BARE_METRIC.id })).toEqual({
      ok: false,
      error: { kind: "no-methods-for-metric" },
    });
  });

  it("denies when sources exist but none supports a method for the metric", () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.bodyWeightScale]);
    expect(
      harness.capabilityIndex.resolve({ personId: PERSON, metricId: SEEDED_METRIC_IDS.heartRate }),
    ).toEqual({ ok: false, error: { kind: "no-capable-source" } });
  });

  it("excludes inactive sources from resolution", () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable], { active: false });
    expect(
      harness.capabilityIndex.resolve({ personId: PERSON, metricId: SEEDED_METRIC_IDS.heartRate }),
    ).toEqual({ ok: false, error: { kind: "no-registered-source" } });
  });

  it("rejects source registration with unknown supported methods", () => {
    const harness = buildEngineHarness();
    const bad = syntheticSource(
      harness.fixtures.ids,
      PERSON,
      ["SYNTH-method-ghost"],
      "device",
    );
    expect(harness.capabilityIndex.registerSource(bad)).toEqual({
      ok: false,
      error: { kind: "unknown-method" },
    });
  });

  it("rejects malformed source registrations (typed, no throw)", () => {
    const harness = buildEngineHarness();
    const malformed: RegisteredMeasurementSource = {
      sourceId: "not-a-source-id" as RegisteredMeasurementSource["sourceId"],
      personId: PERSON,
      kind: "device",
      supportedMethodIds: [SEEDED_METHOD_IDS.heartRateWearable],
      active: true,
    };
    expect(harness.capabilityIndex.registerSource(malformed)).toEqual({
      ok: false,
      error: { kind: "invalid-source" },
    });
  });
});

describe("A28 capability index — resolution", () => {
  it("resolves the ordered usable method set with via-source attribution and domain capability records", () => {
    const harness = buildEngineHarness();
    const wearableSource = registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const manualSource = registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateManual]);
    const resolution = harness.capabilityIndex.resolve({
      personId: PERSON,
      metricId: SEEDED_METRIC_IDS.heartRate,
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      throw new Error("expected resolution to succeed");
    }
    expect(resolution.value.map((capability) => capability.method.id)).toEqual([
      SEEDED_METHOD_IDS.heartRateWearable,
      SEEDED_METHOD_IDS.heartRateManual,
    ]);
    const wearable = resolution.value[0];
    expect(wearable?.viaSource.sourceId).toBe(wearableSource.sourceId);
    expect(wearable?.capability).toEqual({
      personId: PERSON,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
      active: true,
    });
    expect(resolution.value[1]?.viaSource.sourceId).toBe(manualSource.sourceId);
  });

  it("re-registering a source replaces its record (activation toggling)", () => {
    const harness = buildEngineHarness();
    const first = registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const reactivated = harness.capabilityIndex.registerSource({ ...first, active: false });
    expect(reactivated.ok).toBe(true);
    expect(
      harness.capabilityIndex.resolve({ personId: PERSON, metricId: SEEDED_METRIC_IDS.heartRate }),
    ).toEqual({ ok: false, error: { kind: "no-registered-source" } });
  });

  it("attributes a method to the FIRST registered active source when several support it", () => {
    const harness = buildEngineHarness();
    const firstSource = registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const resolution = harness.capabilityIndex.resolve({
      personId: PERSON,
      metricId: SEEDED_METRIC_IDS.heartRate,
    });
    expect(resolution.ok && resolution.value[0]?.viaSource.sourceId).toBe(firstSource.sourceId);
  });

  it("keeps resolutions isolated per person", () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const other = harness.fixtures.person().id;
    expect(
      harness.capabilityIndex.resolve({ personId: other, metricId: SEEDED_METRIC_IDS.heartRate }),
    ).toEqual({ ok: false, error: { kind: "no-registered-source" } });
  });
});
