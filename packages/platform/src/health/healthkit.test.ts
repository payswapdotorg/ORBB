import { describe, expect, it } from "vitest";
import { DeterministicClock } from "@orbb/testkit";
import type { PersonId, SourceId } from "@orbb/domain";
import { createLogger, InMemorySink } from "@orbb/observability";
import {
  HealthKitAdapter,
  HEALTHKIT_METRIC_BINDINGS,
  SyntheticHealthKitNativeModule,
  type HKQuantitySample,
  type HKCategorySample,
} from "./healthkit.js";
import {
  InMemoryMeasurementSourceRegistry,
  type RegisteredMeasurementSource,
} from "./sources.js";

const PERSON_ID = "prsn_SYNTH-person-0001" as PersonId;
const HK_SOURCE_ID = "src_SYNTH-source-healthkit-0001" as SourceId;

const PERSON_DISPLAY_NAME = "SYNTH-Person-00000001";

const DAY = new Date("2026-09-10T00:00:00.000Z").getTime();
const WINDOW = {
  startsAt: new Date(DAY + 8 * 3_600_000),
  endsAt: new Date(DAY + 12 * 3_600_000),
};

function hkSource(overrides?: Partial<RegisteredMeasurementSource>): RegisteredMeasurementSource {
  return {
    sourceId: HK_SOURCE_ID,
    personId: PERSON_ID,
    kind: "app",
    capabilities: [
      {
        metricId: "SYNTH-metric-heart-rate",
        methodIds: ["SYNTH-method-hr-app"],
        direction: "pull",
      },
      {
        metricId: "SYNTH-metric-step-count",
        methodIds: ["SYNTH-method-steps-app"],
        direction: "pull",
      },
      {
        metricId: "SYNTH-metric-sleep-minutes",
        methodIds: ["SYNTH-method-sleep-app"],
        direction: "pull",
      },
    ],
    unitConversions: [
      { metricId: "SYNTH-metric-heart-rate", fromUnit: "count/min", toUnit: "beats/min", factor: 1 },
      { metricId: "SYNTH-metric-step-count", fromUnit: "count", toUnit: "count", factor: 1 },
      { metricId: "SYNTH-metric-sleep-minutes", fromUnit: "s", toUnit: "min", factor: 1 / 60 },
    ],
    active: true,
    ...overrides,
  };
}

function heartRateSample(
  value: number,
  atMs: number,
  uuid: string,
): HKQuantitySample {
  return {
    uuid,
    sampleType: "HKQuantityTypeIdentifierHeartRate",
    quantityValue: value,
    unit: "count/min",
    startDate: new Date(atMs),
    endDate: new Date(atMs + 5_000),
    sourceRevision: {
      sourceName: "SYNTH-Watch",
      sourceBundleId: "com.synth.watch",
      operatingSystemVersion: "SYNTH-18.0",
    },
  };
}

function sleepInterval(
  categoryValue: string,
  startMs: number,
  endMs: number,
  uuid: string,
): HKCategorySample {
  return {
    uuid,
    sampleType: "HKCategoryTypeIdentifierSleepAnalysis",
    categoryValue,
    startDate: new Date(startMs),
    endDate: new Date(endMs),
  };
}

function buildAdapter(
  options?: ConstructorParameters<typeof SyntheticHealthKitNativeModule>[0],
  registry?: InMemoryMeasurementSourceRegistry,
) {
  const registry_ = registry ?? new InMemoryMeasurementSourceRegistry();
  registry_.register(hkSource());
  const sink = new InMemorySink();
  const clock = new DeterministicClock({ epochMs: DAY + 12 * 3_600_000 });
  const logger = createLogger({ service: "platform-health", environment: "local" }, {
    sink,
    nowMs: () => clock.epochMs,
  });
  const native = new SyntheticHealthKitNativeModule(options);
  const adapter = new HealthKitAdapter(HK_SOURCE_ID, {
    native,
    registry: registry_,
    logger,
    nowMs: () => clock.epochMs,
  });
  return { adapter, sink, registry: registry_, clock };
}

describe("HealthKitAdapter — authorization-gated fetch", () => {
  it("returns a typed EMPTY result while authorization is not determined (never throws)", async () => {
    const { adapter } = buildAdapter({
      samples: [heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001")],
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(false);
      expect(result.value.samples).toEqual([]);
    }
  });

  it("returns a typed EMPTY result when sharing is denied (never throws)", async () => {
    const { adapter } = buildAdapter({
      samples: [heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001")],
      authorizationStatus: "sharingDenied",
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(false);
      expect(result.value.samples).toEqual([]);
    }
  });

  it("reports the normalized authorization status per gate state", async () => {
    const { adapter } = buildAdapter({
      authorizationStatus: "sharingDenied",
    });
    expect(await adapter.authorizationStatus("SYNTH-metric-heart-rate")).toBe("denied");
    const fresh = buildAdapter({ authorizationStatus: "notDetermined" });
    expect(await fresh.adapter.authorizationStatus("SYNTH-metric-heart-rate")).toBe("not-determined");
    const granted = buildAdapter({ authorizationStatus: "sharingAuthorized" });
    expect(await granted.adapter.authorizationStatus("SYNTH-metric-heart-rate")).toBe("authorized");
    expect(await granted.adapter.authorizationStatus("SYNTH-metric-unknown")).toBe("not-determined");
  });

  it("serves samples only after an explicit requestAuthorization grant", async () => {
    const { adapter } = buildAdapter({
      samples: [heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001")],
    });
    expect(await adapter.requestAuthorization()).toBe(true);
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(true);
      expect(result.value.samples).toHaveLength(1);
      expect(result.value.samples[0]?.value).toBe(62);
    }
  });

  it("requestAuthorization reports a denial without changing the gate to authorized", async () => {
    const { adapter } = buildAdapter({ grantOnRequest: false });
    expect(await adapter.requestAuthorization()).toBe(false);
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(false);
      expect(result.value.samples).toEqual([]);
    }
  });
});

describe("HealthKitAdapter — fetch contract", () => {
  it("filters by the half-open window and orders samples by startDate then uuid", async () => {
    const { adapter } = buildAdapter({
      authorizationStatus: "sharingAuthorized",
      samples: [
        heartRateSample(66, DAY + 9 * 3_600_000 + 60_000, "SYNTH-HK-hr-0003"),
        heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001"),
        heartRateSample(64, DAY + 9 * 3_600_000 + 60_000, "SYNTH-HK-hr-0002"),
        heartRateSample(70, DAY + 13 * 3_600_000, "SYNTH-HK-hr-out"),
        heartRateSample(58, DAY + 7 * 3_600_000, "SYNTH-HK-hr-before"),
      ],
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.samples.map((sample) => sample.nativeId)).toEqual([
        "SYNTH-HK-hr-0001",
        "SYNTH-HK-hr-0002",
        "SYNTH-HK-hr-0003",
      ]);
    }
  });

  it("keeps the native unit, timestamp, and source metadata on raw samples", async () => {
    const { adapter } = buildAdapter({
      authorizationStatus: "sharingAuthorized",
      samples: [heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001")],
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sample = result.value.samples[0];
      expect(sample?.unit).toBe("count/min");
      expect(sample?.timestamp.getTime()).toBe(DAY + 9 * 3_600_000);
      expect(sample?.sourceMetadata["hk.sourceName"]).toBe("SYNTH-Watch");
      expect(sample?.sourceMetadata["hk.sourceBundleId"]).toBe("com.synth.watch");
    }
  });

  it("derives sleep seconds from asleep intervals and excludes non-asleep intervals auditable via logs", async () => {
    const { adapter, sink } = buildAdapter({
      authorizationStatus: "sharingAuthorized",
      samples: [
        sleepInterval("HKCategoryValueSleepAnalysisAsleep", DAY + 2 * 3_600_000, DAY + 5 * 3_600_000, "SYNTH-HK-sleep-0001"),
        sleepInterval("HKCategoryValueSleepAnalysisInBed", DAY + 1 * 3_600_000, DAY + 6 * 3_600_000, "SYNTH-HK-sleep-inbed"),
      ],
    });
    const sleepWindow = {
      startsAt: new Date(DAY),
      endsAt: new Date(DAY + 12 * 3_600_000),
    };
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-sleep-minutes",
      window: sleepWindow,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.samples).toHaveLength(1);
      expect(result.value.samples[0]?.value).toBe(3 * 3_600);
      expect(result.value.samples[0]?.unit).toBe("s");
    }
    const fetchLog = sink.records.find(
      (record) => record["event"] === "healthkit.fetch.completed",
    );
    expect(fetchLog?.["sampleCount"]).toBe(1);
    expect(fetchLog?.["excludedCount"]).toBe(1);
  });

  it("converts native module failures into typed native-error results (never throws)", async () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(hkSource());
    const sink = new InMemorySink();
    const clock = new DeterministicClock({ epochMs: DAY });
    const logger = createLogger(undefined, { sink, nowMs: () => clock.epochMs });
    const exploding = {
      authorizationStatusFor: async () => "sharingAuthorized" as const,
      requestAuthorization: async () => true,
      fetchSamples: async (): Promise<never> => {
        throw new Error("SYNTH native explosion");
      },
    };
    const adapter = new HealthKitAdapter(HK_SOURCE_ID, {
      native: exploding,
      registry,
      logger,
      nowMs: () => clock.epochMs,
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result).toEqual({ ok: false, error: { kind: "native-error" } });
  });

  it("denies unregistered sources, inactive sources, unsupported metrics, and invalid windows (typed)", async () => {
    const { adapter, registry } = buildAdapter({ authorizationStatus: "sharingAuthorized" });
    expect(
      await adapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: "src_SYNTH-source-unknown-01" as SourceId,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
      }),
    ).toEqual({ ok: false, error: { kind: "source-not-registered" } });

    registry.register(hkSource({ active: false }));
    expect(
      await adapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
      }),
    ).toEqual({ ok: false, error: { kind: "source-inactive" } });

    // Restore the source, then exercise the registry deny with a person
    // who has no registered sources at all.
    registry.register(hkSource());
    expect(
      await adapter.fetchSamples({
        personId: "prsn_SYNTH-person-0002" as PersonId,
        sourceId: HK_SOURCE_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
      }),
    ).toEqual({
      ok: false,
      error: { kind: "capability-denied", reason: { kind: "no-registered-source" } },
    });

    // The adapter's OWN surface check fires when the registry resolves a
    // capability the adapter's (reduced) bindings do not cover.
    const reducedSink = new InMemorySink();
    const reducedClock = new DeterministicClock({ epochMs: DAY });
    const reducedAdapter = new HealthKitAdapter(HK_SOURCE_ID, {
      native: new SyntheticHealthKitNativeModule({ authorizationStatus: "sharingAuthorized" }),
      registry,
      logger: createLogger(undefined, { sink: reducedSink, nowMs: () => reducedClock.epochMs }),
      bindings: [HEALTHKIT_METRIC_BINDINGS[0]!],
      nowMs: () => reducedClock.epochMs,
    });
    expect(
      await reducedAdapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        metricId: "SYNTH-metric-step-count",
        window: WINDOW,
      }),
    ).toEqual({ ok: false, error: { kind: "metric-unsupported" } });

    expect(
      await adapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: { startsAt: WINDOW.endsAt, endsAt: WINDOW.startsAt },
      }),
    ).toEqual({ ok: false, error: { kind: "invalid-window" } });
  });
});

describe("HealthKitAdapter — normalization + provenance", () => {
  it("normalizes heart rate count/min -> beats/min with the conversion recorded on provenance", async () => {
    const { adapter } = buildAdapter({
      authorizationStatus: "sharingAuthorized",
      samples: [heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001")],
    });
    const fetched = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) {
      throw new Error("SYNTH setup failure");
    }
    const normalized = adapter.normalizeSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      samples: fetched.value.samples,
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const draft = normalized.value[0];
      expect(draft?.value).toBe(62);
      expect(draft?.unit).toBe("beats/min");
      expect(draft?.conceptCode).toBe("SYNTH-8867-4");
      expect(draft?.methodId).toBe("SYNTH-method-hr-app");
      expect(draft?.evidenceLabel).toBe("IMPORTED");
      expect(draft?.provenance.unitConversion.applied).toBe(true);
      expect(draft?.provenance.unitConversion.fromUnit).toBe("count/min");
      expect(draft?.provenance.unitConversion.toUnit).toBe("beats/min");
      expect(draft?.provenance.nativeSampleId).toBe("SYNTH-HK-hr-0001");
    }
  });

  it("normalizes sleep seconds -> minutes through the declared 1/60 factor", async () => {
    const { adapter } = buildAdapter({
      authorizationStatus: "sharingAuthorized",
      samples: [
        sleepInterval("HKCategoryValueSleepAnalysisAsleep", DAY, DAY + 8 * 3_600_000, "SYNTH-HK-sleep-0001"),
      ],
    });
    const fetched = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-sleep-minutes",
      window: { startsAt: new Date(DAY), endsAt: new Date(DAY + 12 * 3_600_000) },
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) {
      throw new Error("SYNTH setup failure");
    }
    const normalized = adapter.normalizeSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      samples: fetched.value.samples,
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const draft = normalized.value[0];
      expect(draft?.value).toBeCloseTo(480, 6);
      expect(draft?.unit).toBe("min");
      expect(draft?.provenance.unitConversion.applied).toBe(true);
    }
  });

  it("declares identity conversion for step count (applied=false)", async () => {
    const { adapter } = buildAdapter({
      authorizationStatus: "sharingAuthorized",
      samples: [
        {
          uuid: "SYNTH-HK-steps-0001",
          sampleType: "HKQuantityTypeIdentifierStepCount",
          quantityValue: 8432,
          unit: "count",
          startDate: new Date(DAY + 9 * 3_600_000),
          endDate: new Date(DAY + 10 * 3_600_000),
        },
      ],
    });
    const fetched = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-step-count",
      window: WINDOW,
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) {
      throw new Error("SYNTH setup failure");
    }
    const normalized = adapter.normalizeSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      samples: fetched.value.samples,
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const draft = normalized.value[0];
      expect(draft?.value).toBe(8432);
      expect(draft?.unit).toBe("count");
      expect(draft?.provenance.unitConversion.applied).toBe(false);
    }
  });

  it("exposes the seeded metric surface", () => {
    const { adapter } = buildAdapter();
    expect(adapter.supportedMetrics).toEqual([
      "SYNTH-metric-heart-rate",
      "SYNTH-metric-step-count",
      "SYNTH-metric-sleep-minutes",
    ]);
    expect(adapter.sourceId).toBe(HK_SOURCE_ID);
    for (const binding of HEALTHKIT_METRIC_BINDINGS) {
      expect(binding.metricId.startsWith("SYNTH-")).toBe(true);
      expect(binding.conceptCode.startsWith("SYNTH-")).toBe(true);
      expect(binding.methodId.startsWith("SYNTH-")).toBe(true);
    }
  });
});

describe("HealthKitAdapter — zero-PHI observability", () => {
  it("never lets synthetic person identifiers or raw values reach the sink", async () => {
    const { adapter, sink } = buildAdapter({
      authorizationStatus: "sharingAuthorized",
      samples: [heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001")],
    });
    await adapter.requestAuthorization();
    const fetched = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    if (fetched.ok) {
      adapter.normalizeSamples({
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        samples: fetched.value.samples,
      });
    }
    expect(sink.records.length).toBeGreaterThan(0);
    const dump = JSON.stringify(sink.records);
    expect(dump).not.toContain(PERSON_ID);
    expect(dump).not.toContain(PERSON_DISPLAY_NAME);
    expect(dump).not.toContain("SYNTH-Watch");
    expect(dump).not.toContain("SYNTH-HK-hr-0001");
    const fetchLog = sink.records.find(
      (record) => record["event"] === "healthkit.fetch.completed",
    );
    expect(fetchLog?.["personId"]).toBe("[REDACTED]");
    expect(fetchLog?.["sampleCount"]).toBe(1);
  });

  it("keeps the unauthorized-fetch warning PHI-free too", async () => {
    const { adapter, sink } = buildAdapter({
      samples: [heartRateSample(62, DAY + 9 * 3_600_000, "SYNTH-HK-hr-0001")],
    });
    await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    const dump = JSON.stringify(sink.records);
    expect(dump).not.toContain(PERSON_ID);
    expect(dump).not.toContain(PERSON_DISPLAY_NAME);
    const unauthorized = sink.records.find(
      (record) => record["event"] === "healthkit.fetch.unauthorized",
    );
    expect(unauthorized).toBeDefined();
    expect(unauthorized?.["personId"]).toBe("[REDACTED]");
  });
});
