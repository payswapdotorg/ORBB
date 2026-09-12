import { describe, expect, it } from "vitest";
import { DeterministicClock } from "@orbb/testkit";
import type { PersonId, SourceId } from "@orbb/domain";
import { createLogger, InMemorySink } from "@orbb/observability";
import {
  HealthConnectAdapter,
  HEALTH_CONNECT_METRIC_BINDINGS,
  HEALTH_CONNECT_PERMISSIONS,
  SyntheticHealthConnectNativeModule,
  type HCHeartRateRecord,
  type HCStepsRecord,
  type HCSleepSessionRecord,
} from "./healthconnect.js";
import {
  InMemoryMeasurementSourceRegistry,
  type RegisteredMeasurementSource,
} from "./sources.js";

const PERSON_ID = "prsn_SYNTH-person-0001" as PersonId;
const HC_SOURCE_ID = "src_SYNTH-source-hc-00000001" as SourceId;

const PERSON_DISPLAY_NAME = "SYNTH-Person-00000001";

const DAY = new Date("2026-09-10T00:00:00.000Z").getTime();
const WINDOW = {
  startsAt: new Date(DAY + 8 * 3_600_000),
  endsAt: new Date(DAY + 12 * 3_600_000),
};

function hcSource(overrides?: Partial<RegisteredMeasurementSource>): RegisteredMeasurementSource {
  return {
    sourceId: HC_SOURCE_ID,
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
      { metricId: "SYNTH-metric-heart-rate", fromUnit: "bpm", toUnit: "beats/min", factor: 1 },
      { metricId: "SYNTH-metric-step-count", fromUnit: "count", toUnit: "count", factor: 1 },
      { metricId: "SYNTH-metric-sleep-minutes", fromUnit: "min", toUnit: "min", factor: 1 },
    ],
    active: true,
    ...overrides,
  };
}

const HEART_RATE_RECORD: HCHeartRateRecord = {
  recordId: "SYNTH-HC-hr-000001",
  recordType: "HeartRateRecord",
  startTime: new Date(DAY + 9 * 3_600_000),
  endTime: new Date(DAY + 9 * 3_600_000 + 60_000),
  samples: [
    { time: new Date(DAY + 9 * 3_600_000), beatsPerMinute: 61 },
    { time: new Date(DAY + 9 * 3_600_000 + 30_000), beatsPerMinute: 63 },
  ],
};

const STEPS_RECORD: HCStepsRecord = {
  recordId: "SYNTH-HC-steps-000001",
  recordType: "StepsRecord",
  startTime: new Date(DAY + 8 * 3_600_000),
  endTime: new Date(DAY + 9 * 3_600_000),
  count: 4211,
};

const SLEEP_RECORD: HCSleepSessionRecord = {
  recordId: "SYNTH-HC-sleep-000001",
  recordType: "SleepSessionRecord",
  startTime: new Date(DAY),
  endTime: new Date(DAY + 8 * 3_600_000),
  minutes: 472,
};

function buildAdapter(
  options?: ConstructorParameters<typeof SyntheticHealthConnectNativeModule>[0],
  registry?: InMemoryMeasurementSourceRegistry,
) {
  const registry_ = registry ?? new InMemoryMeasurementSourceRegistry();
  registry_.register(hcSource());
  const sink = new InMemorySink();
  const clock = new DeterministicClock({ epochMs: DAY + 12 * 3_600_000 });
  const logger = createLogger({ service: "platform-health", environment: "local" }, {
    sink,
    nowMs: () => clock.epochMs,
  });
  const native = new SyntheticHealthConnectNativeModule(options);
  const adapter = new HealthConnectAdapter(HC_SOURCE_ID, {
    native,
    registry: registry_,
    logger,
    nowMs: () => clock.epochMs,
  });
  return { adapter, sink, registry: registry_, clock };
}

describe("HealthConnectAdapter — permissions-gated fetch", () => {
  it("returns a typed EMPTY result while permissions are not granted (never throws)", async () => {
    const { adapter } = buildAdapter({ records: [HEART_RATE_RECORD] });
    expect(await adapter.authorizationStatus("SYNTH-metric-heart-rate")).toBe("denied");
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(false);
      expect(result.value.samples).toEqual([]);
    }
  });

  it("serves samples only after an explicit requestPermissions grant", async () => {
    const { adapter } = buildAdapter({ records: [HEART_RATE_RECORD] });
    expect(await adapter.requestAuthorization()).toBe(true);
    expect(await adapter.authorizationStatus("SYNTH-metric-heart-rate")).toBe("authorized");
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(true);
      expect(result.value.samples).toHaveLength(2);
    }
  });

  it("requestAuthorization reports a denial and keeps the gate closed", async () => {
    const { adapter } = buildAdapter({ records: [HEART_RATE_RECORD], grantOnRequest: false });
    expect(await adapter.requestAuthorization()).toBe(false);
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(false);
      expect(result.value.samples).toEqual([]);
    }
  });

  it("serves immediately when permissions were already granted", async () => {
    const { adapter } = buildAdapter({
      records: [HEART_RATE_RECORD],
      permissionsGranted: true,
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authorized).toBe(true);
      expect(result.value.samples).toHaveLength(2);
    }
  });
});

describe("HealthConnectAdapter — readRecords contract", () => {
  it("maps a HeartRateRecord to one raw sample per instantaneous bpm sample", async () => {
    const { adapter } = buildAdapter({
      records: [HEART_RATE_RECORD],
      permissionsGranted: true,
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.samples.map((sample) => sample.value)).toEqual([61, 63]);
      expect(result.value.samples.every((sample) => sample.unit === "bpm")).toBe(true);
      expect(result.value.samples[0]?.nativeId).toContain("SYNTH-HC-hr-000001");
      expect(result.value.samples[0]?.sourceMetadata["hc.recordType"]).toBe("HeartRateRecord");
    }
  });

  it("maps a StepsRecord aggregate at the record start time", async () => {
    const { adapter } = buildAdapter({ records: [STEPS_RECORD], permissionsGranted: true });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-step-count",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.samples).toHaveLength(1);
      expect(result.value.samples[0]?.value).toBe(4211);
      expect(result.value.samples[0]?.unit).toBe("count");
      expect(result.value.samples[0]?.timestamp.getTime()).toBe(DAY + 8 * 3_600_000);
    }
  });

  it("maps a SleepSessionRecord's minutes (units per Health Connect docs)", async () => {
    const { adapter } = buildAdapter({ records: [SLEEP_RECORD], permissionsGranted: true });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-sleep-minutes",
      window: { startsAt: new Date(DAY), endsAt: new Date(DAY + 12 * 3_600_000) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.samples).toHaveLength(1);
      expect(result.value.samples[0]?.value).toBe(472);
      expect(result.value.samples[0]?.unit).toBe("min");
    }
  });

  it("filters records by the half-open window on the record start time", async () => {
    const late: HCHeartRateRecord = {
      ...HEART_RATE_RECORD,
      recordId: "SYNTH-HC-hr-000002",
      startTime: new Date(DAY + 13 * 3_600_000),
      endTime: new Date(DAY + 13 * 3_600_000 + 60_000),
      samples: [{ time: new Date(DAY + 13 * 3_600_000), beatsPerMinute: 71 }],
    };
    const { adapter } = buildAdapter({
      records: [HEART_RATE_RECORD, late],
      permissionsGranted: true,
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.samples.map((sample) => sample.value)).toEqual([61, 63]);
    }
  });

  it("denies unregistered/inactive sources, registry denials, and invalid windows (typed)", async () => {
    const { adapter, registry } = buildAdapter({ permissionsGranted: true });
    expect(
      await adapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: "src_SYNTH-source-unknown-01" as SourceId,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
      }),
    ).toEqual({ ok: false, error: { kind: "source-not-registered" } });

    registry.register(hcSource({ active: false }));
    expect(
      await adapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: HC_SOURCE_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
      }),
    ).toEqual({ ok: false, error: { kind: "source-inactive" } });

    registry.register(hcSource());
    expect(
      await adapter.fetchSamples({
        personId: "prsn_SYNTH-person-0002" as PersonId,
        sourceId: HC_SOURCE_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
      }),
    ).toEqual({
      ok: false,
      error: { kind: "capability-denied", reason: { kind: "no-registered-source" } },
    });

    expect(
      await adapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: HC_SOURCE_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: { startsAt: WINDOW.endsAt, endsAt: WINDOW.startsAt },
      }),
    ).toEqual({ ok: false, error: { kind: "invalid-window" } });
  });

  it("converts native module failures into typed native-error results (never throws)", async () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(hcSource());
    const sink = new InMemorySink();
    const clock = new DeterministicClock({ epochMs: DAY });
    const exploding = {
      hasPermissions: async () => true,
      requestPermissions: async () => true,
      readRecords: async (): Promise<never> => {
        throw new Error("SYNTH native explosion");
      },
    };
    const adapter = new HealthConnectAdapter(HC_SOURCE_ID, {
      native: exploding,
      registry,
      logger: createLogger(undefined, { sink, nowMs: () => clock.epochMs }),
      nowMs: () => clock.epochMs,
    });
    const result = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(result).toEqual({ ok: false, error: { kind: "native-error" } });
  });
});

describe("HealthConnectAdapter — normalization + provenance", () => {
  it("normalizes bpm -> beats/min with the conversion recorded on provenance", async () => {
    const { adapter } = buildAdapter({
      records: [HEART_RATE_RECORD],
      permissionsGranted: true,
    });
    const fetched = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) {
      throw new Error("SYNTH setup failure");
    }
    const normalized = adapter.normalizeSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      samples: fetched.value.samples,
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.map((draft) => draft.value)).toEqual([61, 63]);
      expect(normalized.value.every((draft) => draft.unit === "beats/min")).toBe(true);
      expect(normalized.value.every((draft) => draft.provenance.unitConversion.applied)).toBe(true);
      expect(normalized.value.every((draft) => draft.provenance.unitConversion.fromUnit === "bpm")).toBe(true);
      expect(normalized.value[0]?.conceptCode).toBe("SYNTH-8867-4");
      expect(normalized.value[0]?.methodId).toBe("SYNTH-method-hr-app");
      expect(normalized.value[0]?.evidenceLabel).toBe("IMPORTED");
    }
  });

  it("keeps sleep minutes as identity conversion (applied=false)", async () => {
    const { adapter } = buildAdapter({ records: [SLEEP_RECORD], permissionsGranted: true });
    const fetched = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-sleep-minutes",
      window: { startsAt: new Date(DAY), endsAt: new Date(DAY + 12 * 3_600_000) },
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) {
      throw new Error("SYNTH setup failure");
    }
    const normalized = adapter.normalizeSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      samples: fetched.value.samples,
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const draft = normalized.value[0];
      expect(draft?.value).toBe(472);
      expect(draft?.unit).toBe("min");
      expect(draft?.provenance.unitConversion.applied).toBe(false);
    }
  });

  it("exposes the seeded metric surface and permission set", () => {
    const { adapter } = buildAdapter();
    expect(adapter.supportedMetrics).toEqual([
      "SYNTH-metric-heart-rate",
      "SYNTH-metric-step-count",
      "SYNTH-metric-sleep-minutes",
    ]);
    expect(HEALTH_CONNECT_PERMISSIONS).toContain("android.permission.health.READ_HEART_RATE");
    expect(HEALTH_CONNECT_PERMISSIONS).toContain("android.permission.health.READ_STEPS");
    expect(HEALTH_CONNECT_PERMISSIONS).toContain("android.permission.health.READ_SLEEP");
    for (const binding of HEALTH_CONNECT_METRIC_BINDINGS) {
      expect(binding.metricId.startsWith("SYNTH-")).toBe(true);
      expect(binding.nativeUnit === "bpm" || binding.nativeUnit === "count" || binding.nativeUnit === "min").toBe(true);
    }
  });
});

describe("HealthConnectAdapter — zero-PHI observability", () => {
  it("never lets synthetic person identifiers or record ids reach the sink", async () => {
    const { adapter, sink } = buildAdapter({
      records: [HEART_RATE_RECORD],
      permissionsGranted: true,
    });
    await adapter.requestAuthorization();
    const fetched = await adapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
    });
    if (fetched.ok) {
      adapter.normalizeSamples({
        personId: PERSON_ID,
        sourceId: HC_SOURCE_ID,
        samples: fetched.value.samples,
      });
    }
    expect(sink.records.length).toBeGreaterThan(0);
    const dump = JSON.stringify(sink.records);
    expect(dump).not.toContain(PERSON_ID);
    expect(dump).not.toContain(PERSON_DISPLAY_NAME);
    expect(dump).not.toContain("SYNTH-HC-hr-000001");
    const fetchLog = sink.records.find(
      (record) => record["event"] === "healthconnect.fetch.completed",
    );
    expect(fetchLog?.["personId"]).toBe("[REDACTED]");
    expect(fetchLog?.["sampleCount"]).toBe(2);
  });
});
