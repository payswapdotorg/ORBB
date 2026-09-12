/**
 * M4 EXIT HARNESS (Lane C packet M4-C) — the executable proof of the
 * Milestone 4 exit criterion:
 *
 *   "a real supported metric can be acquired by at least two methods and
 *    reconciled with provenance."
 *
 * Metric: heart rate (SYNTH-marked metric id aligned with the Lane A
 * engine seed; the UNITS and concept-code shape are real).
 *   - Method 1 (A33 seam): the MANUAL capture path — a typed
 *     capture-session double producing an observation draft.
 *   - Method 2 (A34 seam): the HealthKit adapter over the synthetic
 *     HealthKit native double (authorization-gated fetch -> raw samples
 *     with native timestamps/units/metadata -> declared-conversion
 *     normalization).
 *   - Supplementary (A35 seam): the Health Connect adapter over its
 *     synthetic native double ALSO acquires the same metric through the
 *     same contract — the "at least two methods" bar is exceeded, proving
 *     both platform seams end-to-end.
 *
 * The drafts are materialized into domain Observations (pending), the
 * validation CALLER drives the domain validation state machine
 * (pending -> validated | rejected — the engine owns execution, handoff
 * recorded), and the reconciliation DOUBLE (interface matching the Lane A
 * ReconciliationService contract) assembles the canonical view.
 *
 * Placement recorded: `packages/platform` (this package owns the seam and
 * the harness — `pnpm --filter @orbb/platform test` runs the proof).
 * Zero PHI: all fixtures are SYNTH-marked; the adapters log through the
 * @orbb/observability logger and the sink dump is asserted PHI-free.
 */
import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { parseQualityScore, type MetricDefinition, type PersonId, type SourceId } from "@orbb/domain";
import { createLogger, InMemorySink } from "@orbb/observability";
import {
  applyDraftValidation,
  InMemoryMeasurementSourceRegistry,
  materializeDraft,
  StructuralDraftValidator,
  type MaterializedObservation,
  type ObservationDraft,
  type RegisteredMeasurementSource,
} from "./sources.js";
import {
  HealthKitAdapter,
  SyntheticHealthKitNativeModule,
  type HKQuantitySample,
} from "./healthkit.js";
import {
  HealthConnectAdapter,
  SyntheticHealthConnectNativeModule,
  type HCHeartRateRecord,
} from "./healthconnect.js";
import { SyntheticManualCaptureSession } from "./capture.js";
import {
  InMemoryObservationArchive,
  ReconciliationServiceDouble,
  type ReconciliationServiceContract,
  type SourcedObservation,
} from "./reconciliation.js";

// ---------------------------------------------------------------------------
// The SYNTH world (all ids SYNTH-marked; no real person data).
// ---------------------------------------------------------------------------

const PERSON_ID = "prsn_SYNTH-person-0001" as PersonId;
const MANUAL_SOURCE_ID = "src_SYNTH-source-manual-0001" as SourceId;
const HK_SOURCE_ID = "src_SYNTH-source-healthkit-0001" as SourceId;
const HC_SOURCE_ID = "src_SYNTH-source-hc-00000001" as SourceId;
const PERSON_DISPLAY_NAME = "SYNTH-Person-00000001";

const DAY = new Date("2026-09-10T00:00:00.000Z").getTime();
const MORNING_WINDOW = {
  startsAt: new Date(DAY + 8 * 3_600_000),
  endsAt: new Date(DAY + 12 * 3_600_000),
};
const CAPTURED_AT = new Date(DAY + 9 * 3_600_000);

const HEART_RATE_METRIC: MetricDefinition = {
  id: "SYNTH-metric-heart-rate",
  displayName: "Heart Rate",
  unitDomain: ["beats/min"],
  valueType: "quantity",
  conceptCode: "SYNTH-8867-4",
  category: "vital-signs",
};

const MANUAL_SOURCE: RegisteredMeasurementSource = {
  sourceId: MANUAL_SOURCE_ID,
  personId: PERSON_ID,
  kind: "manual",
  capabilities: [
    {
      metricId: "SYNTH-metric-heart-rate",
      methodIds: ["SYNTH-method-hr-manual"],
      direction: "push",
    },
  ],
  unitConversions: [],
  active: true,
};

const HEALTHKIT_SOURCE: RegisteredMeasurementSource = {
  sourceId: HK_SOURCE_ID,
  personId: PERSON_ID,
  kind: "app",
  capabilities: [
    {
      metricId: "SYNTH-metric-heart-rate",
      methodIds: ["SYNTH-method-hr-app"],
      direction: "pull",
    },
  ],
  unitConversions: [
    { metricId: "SYNTH-metric-heart-rate", fromUnit: "count/min", toUnit: "beats/min", factor: 1 },
  ],
  active: true,
};

const HEALTH_CONNECT_SOURCE: RegisteredMeasurementSource = {
  sourceId: HC_SOURCE_ID,
  personId: PERSON_ID,
  kind: "app",
  capabilities: [
    {
      metricId: "SYNTH-metric-heart-rate",
      methodIds: ["SYNTH-method-hr-app"],
      direction: "pull",
    },
  ],
  unitConversions: [
    { metricId: "SYNTH-metric-heart-rate", fromUnit: "bpm", toUnit: "beats/min", factor: 1 },
  ],
  active: true,
};

// The synthetic HealthKit native script: ONE in-window heart-rate sample
// (62 count/min at 09:01) plus contract-probing neighbors that must NOT
// be acquired for this metric+window (an out-of-window heart-rate sample
// and an in-window STEP sample — a different metric).
const HK_HEART_RATE_IN_WINDOW: HKQuantitySample = {
  uuid: "SYNTH-HK-hr-000001",
  sampleType: "HKQuantityTypeIdentifierHeartRate",
  quantityValue: 62,
  unit: "count/min",
  startDate: new Date(DAY + 9 * 3_600_000 + 60_000),
  endDate: new Date(DAY + 9 * 3_600_000 + 65_000),
  sourceRevision: {
    sourceName: "SYNTH-Watch",
    sourceBundleId: "com.synth.watch",
  },
};
const HK_HEART_RATE_OUT_OF_WINDOW: HKQuantitySample = {
  uuid: "SYNTH-HK-hr-000002",
  sampleType: "HKQuantityTypeIdentifierHeartRate",
  quantityValue: 71,
  unit: "count/min",
  startDate: new Date(DAY + 13 * 3_600_000),
  endDate: new Date(DAY + 13 * 3_600_000 + 5_000),
};
const HK_STEPS_IN_WINDOW: HKQuantitySample = {
  uuid: "SYNTH-HK-steps-000001",
  sampleType: "HKQuantityTypeIdentifierStepCount",
  quantityValue: 8432,
  unit: "count",
  startDate: new Date(DAY + 9 * 3_600_000),
  endDate: new Date(DAY + 10 * 3_600_000),
};

const HC_HEART_RATE_RECORD: HCHeartRateRecord = {
  recordId: "SYNTH-HC-hr-000001",
  recordType: "HeartRateRecord",
  startTime: new Date(DAY + 9 * 3_600_000 + 120_000),
  endTime: new Date(DAY + 9 * 3_600_000 + 180_000),
  samples: [{ time: new Date(DAY + 9 * 3_600_000 + 150_000), beatsPerMinute: 61 }],
};

describe("M4 exit harness — heart rate acquired by two methods, reconciled with provenance", () => {
  it("proves the exit criterion end-to-end over the platform seams (no engine import)", async () => {
    // ---------------------------------------------------------------------
    // Stage 0 — the world: registry, sources, logger, doubles.
    // ---------------------------------------------------------------------
    const registry = new InMemoryMeasurementSourceRegistry();
    const sink = new InMemorySink();
    const clock = new DeterministicClock({ epochMs: DAY + 12 * 3_600_000 });
    const ids = new DeterministicIdFactory({ seed: "m4-exit" });
    const logger = createLogger(
      { service: "platform-health", environment: "local" },
      { sink, nowMs: () => clock.epochMs },
    );
    const nowMs = (): number => clock.epochMs;

    // Stage 0a — deny-by-default precondition: with nothing registered,
    // the person resolves NO sources for the metric (typed reason).
    expect(registry.resolve({ personId: PERSON_ID, metricId: "SYNTH-metric-heart-rate" })).toEqual({
      ok: false,
      error: { kind: "no-registered-source" },
    });

    expect(registry.register(MANUAL_SOURCE).ok).toBe(true);
    expect(registry.register(HEALTHKIT_SOURCE).ok).toBe(true);
    expect(registry.register(HEALTH_CONNECT_SOURCE).ok).toBe(true);
    const resolved = registry.resolve({
      personId: PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.map((entry) => entry.source.sourceId)).toEqual([
        MANUAL_SOURCE_ID,
        HK_SOURCE_ID,
        HC_SOURCE_ID,
      ]);
    }

    const healthKitNative = new SyntheticHealthKitNativeModule({
      samples: [HK_HEART_RATE_IN_WINDOW, HK_HEART_RATE_OUT_OF_WINDOW, HK_STEPS_IN_WINDOW],
    });
    const healthKitAdapter = new HealthKitAdapter(HK_SOURCE_ID, {
      native: healthKitNative,
      registry,
      logger,
      nowMs,
    });
    const healthConnectNative = new SyntheticHealthConnectNativeModule({
      records: [HC_HEART_RATE_RECORD],
    });
    const healthConnectAdapter = new HealthConnectAdapter(HC_SOURCE_ID, {
      native: healthConnectNative,
      registry,
      logger,
      nowMs,
    });

    // Authorization gates start closed: both adapters return typed EMPTY.
    const gatedManualCheck = await healthKitAdapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: MORNING_WINDOW,
    });
    expect(gatedManualCheck.ok).toBe(true);
    if (gatedManualCheck.ok) {
      expect(gatedManualCheck.value.authorized).toBe(false);
      expect(gatedManualCheck.value.samples).toEqual([]);
    }
    expect(await healthKitAdapter.requestAuthorization()).toBe(true);
    expect(await healthConnectAdapter.requestAuthorization()).toBe(true);

    // ---------------------------------------------------------------------
    // Stage 1 — METHOD 1: the MANUAL capture path (capture-session double).
    // ---------------------------------------------------------------------
    const captureSession = new SyntheticManualCaptureSession({ nowMs });
    const manualCapture = captureSession.capture({
      personId: PERSON_ID,
      sourceId: MANUAL_SOURCE_ID,
      methodId: "SYNTH-method-hr-manual",
      capturedAt: CAPTURED_AT,
      fields: [{ metricId: "SYNTH-metric-heart-rate", value: 68 }],
      quality: parseQualityScore(0.7),
      correlationId: "SYNTH-M4EXIT-CAP",
    });
    expect(manualCapture.ok).toBe(true);
    if (!manualCapture.ok) {
      throw new Error("SYNTH setup failure: manual capture rejected");
    }
    const manualDrafts = manualCapture.value;
    expect(manualDrafts).toHaveLength(1);
    const manualDraft = manualDrafts[0] as ObservationDraft;
    expect(manualDraft.unit).toBe("beats/min");
    expect(manualDraft.value).toBe(68);
    expect(manualDraft.methodId).toBe("SYNTH-method-hr-manual");
    expect(manualDraft.provenance.unitConversion.applied).toBe(false);
    expect(manualDraft.provenance.nativeSampleId).toBe("SYNTH-MCAP-000001");
    expect(manualDraft.provenance.sourceMetadata["manual.correlationId"]).toBe("SYNTH-M4EXIT-CAP");

    // ---------------------------------------------------------------------
    // Stage 2 — METHOD 2: the HealthKit adapter over the synthetic double.
    // ---------------------------------------------------------------------
    const healthKitFetch = await healthKitAdapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: MORNING_WINDOW,
    });
    expect(healthKitFetch.ok).toBe(true);
    if (!healthKitFetch.ok) {
      throw new Error("SYNTH setup failure: HealthKit fetch rejected");
    }
    expect(healthKitFetch.value.authorized).toBe(true);
    const rawSamples = healthKitFetch.value.samples;
    // Exactly the ONE in-window heart-rate sample is acquired: the
    // out-of-window sample and the different-metric sample are excluded
    // by the fetch contract (window + metric binding), never lost mid-pipe.
    expect(rawSamples).toHaveLength(1);
    const rawSample = rawSamples[0];
    expect(rawSample?.unit).toBe("count/min");
    expect(rawSample?.value).toBe(62);
    expect(rawSample?.nativeId).toBe("SYNTH-HK-hr-000001");
    expect(rawSample?.sourceMetadata["hk.sourceBundleId"]).toBe("com.synth.watch");

    const healthKitNormalization = healthKitAdapter.normalizeSamples({
      personId: PERSON_ID,
      sourceId: HK_SOURCE_ID,
      samples: rawSamples,
    });
    expect(healthKitNormalization.ok).toBe(true);
    if (!healthKitNormalization.ok) {
      throw new Error("SYNTH setup failure: HealthKit normalization rejected");
    }
    const healthKitDrafts = healthKitNormalization.value;
    expect(healthKitDrafts).toHaveLength(1);
    const healthKitDraft = healthKitDrafts[0] as ObservationDraft;
    expect(healthKitDraft.value).toBe(62);
    expect(healthKitDraft.unit).toBe("beats/min");
    expect(healthKitDraft.conceptCode).toBe("SYNTH-8867-4");
    expect(healthKitDraft.methodId).toBe("SYNTH-method-hr-app");
    expect(healthKitDraft.evidenceLabel).toBe("IMPORTED");
    expect(healthKitDraft.provenance.unitConversion.applied).toBe(true);
    expect(healthKitDraft.provenance.unitConversion.fromUnit).toBe("count/min");
    expect(healthKitDraft.provenance.unitConversion.toUnit).toBe("beats/min");
    expect(healthKitDraft.provenance.nativeSampleId).toBe("SYNTH-HK-hr-000001");
    expect(healthKitDraft.provenance.nativeTimestamp.getTime()).toBe(
      DAY + 9 * 3_600_000 + 60_000,
    );

    // ---------------------------------------------------------------------
    // Stage 2b — supplementary: the Health Connect seam ALSO acquires the
    // metric through the same adapter contract ("at least two" exceeded).
    // ---------------------------------------------------------------------
    const healthConnectFetch = await healthConnectAdapter.fetchSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: MORNING_WINDOW,
    });
    expect(healthConnectFetch.ok).toBe(true);
    if (!healthConnectFetch.ok) {
      throw new Error("SYNTH setup failure: Health Connect fetch rejected");
    }
    expect(healthConnectFetch.value.authorized).toBe(true);
    expect(healthConnectFetch.value.samples).toHaveLength(1);
    const healthConnectNormalization = healthConnectAdapter.normalizeSamples({
      personId: PERSON_ID,
      sourceId: HC_SOURCE_ID,
      samples: healthConnectFetch.value.samples,
    });
    expect(healthConnectNormalization.ok).toBe(true);
    if (!healthConnectNormalization.ok) {
      throw new Error("SYNTH setup failure: Health Connect normalization rejected");
    }
    const healthConnectDraft = healthConnectNormalization.value[0] as ObservationDraft;
    expect(healthConnectDraft.value).toBe(61);
    expect(healthConnectDraft.unit).toBe("beats/min");
    expect(healthConnectDraft.provenance.unitConversion.fromUnit).toBe("bpm");
    expect(healthConnectDraft.provenance.unitConversion.applied).toBe(true);
    expect(healthConnectDraft.sourceId).toBe(HC_SOURCE_ID);

    // ---------------------------------------------------------------------
    // Stage 3 — the validation CALLER: drafts feed the domain observation
    // validation states (pending -> validated | rejected). The engine owns
    // execution; this harness models the caller.
    // ---------------------------------------------------------------------
    const validator = new StructuralDraftValidator();
    const materialize = (draft: ObservationDraft): MaterializedObservation =>
      materializeDraft(draft, { ids, nowMs, correlationId: "SYNTH-M4EXIT" });

    const manualMaterialized = materialize(manualDraft);
    const healthKitMaterialized = materialize(healthKitDraft);

    expect(manualMaterialized.observation.validationState).toBe("pending");
    expect(healthKitMaterialized.observation.validationState).toBe("pending");
    expect(manualMaterialized.provenance.correlationId).toBe("SYNTH-M4EXIT");

    const manualValidated = applyDraftValidation(
      manualMaterialized,
      validator.decide(manualDraft),
    );
    const healthKitValidated = applyDraftValidation(
      healthKitMaterialized,
      validator.decide(healthKitDraft),
    );
    expect(manualValidated.kind).toBe("validated");
    expect(healthKitValidated.kind).toBe("validated");
    if (manualValidated.kind !== "validated" || healthKitValidated.kind !== "validated") {
      throw new Error("SYNTH setup failure: draft validation rejected");
    }

    // The rejected leg of the same state machine: a structurally invalid
    // draft (quality outside [0, 1]) feeds pending -> rejected.
    const invalidDraft: ObservationDraft = {
      ...healthKitDraft,
      quality: 1.5 as never,
    };
    const invalidMaterialized = materialize(invalidDraft);
    const invalidOutcome = applyDraftValidation(
      invalidMaterialized,
      validator.decide(invalidDraft),
    );
    expect(invalidOutcome.kind).toBe("rejected");
    if (invalidOutcome.kind === "rejected") {
      expect(invalidOutcome.observation.validationState).toBe("rejected");
      expect(invalidOutcome.reason).toEqual({ kind: "invalid-quality" });
    }

    // ---------------------------------------------------------------------
    // Stage 4 — the reconciliation DOUBLE assembles the canonical view
    // (interface matching the Lane A ReconciliationService contract).
    // ---------------------------------------------------------------------
    const archive = new InMemoryObservationArchive();
    const reconciliation: ReconciliationServiceContract = new ReconciliationServiceDouble({
      metrics: [HEART_RATE_METRIC],
      ids,
      nowMs,
      archive,
    });
    const candidates: readonly SourcedObservation[] = [
      {
        observation: manualValidated.observation,
        provenance: manualValidated.provenance,
      },
      {
        observation: healthKitValidated.observation,
        provenance: healthKitValidated.provenance,
      },
    ];
    const reconciled = await reconciliation.reconcile({
      personId: PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: MORNING_WINDOW,
      candidates,
      correlationId: "SYNTH-M4EXIT-REC",
    });
    expect(reconciled.ok).toBe(true);
    if (!reconciled.ok) {
      throw new Error("SYNTH setup failure: reconciliation rejected");
    }
    const { view, pair, canonicalSource, supersededOriginal, canonical } = reconciled.value;

    // (a) BOTH METHODS CONTRIBUTED — the canonical view carries one source
    // record per method, with the manual path and the HealthKit path each
    // present, and the HealthKit record ranks canonical (quality 0.9 > 0.7).
    expect(view.sources).toHaveLength(2);
    const contributingMethodIds = view.sources
      .map((source) => source.methodId)
      .sort();
    expect(contributingMethodIds).toEqual(["SYNTH-method-hr-app", "SYNTH-method-hr-manual"]);
    expect(view.value).toBe(62);
    expect(view.unit).toBe("beats/min");
    expect(view.verdict).toBe("discordant");
    expect(canonicalSource.sourceId).toBe(HK_SOURCE_ID);
    expect(supersededOriginal.sourceId).toBe(MANUAL_SOURCE_ID);

    // (b) PROVENANCE FOR BOTH IS PRESENT AND DISTINGUISHABLE — distinct
    // source ids, distinct method ids, distinct provenance records linked
    // to their observations, and the draft-level provenance ledger
    // distinguishes the acquisition paths (native timestamps, native
    // sample ids, and unit-conversion flags differ).
    const canonicalRecord = view.sources.find((source) => source.role === "canonical-source");
    const supersededRecord = view.sources.find((source) => source.role === "superseded-source");
    expect(canonicalRecord).toBeDefined();
    expect(supersededRecord).toBeDefined();
    expect(canonicalRecord?.sourceId).not.toBe(supersededRecord?.sourceId);
    expect(canonicalRecord?.methodId).not.toBe(supersededRecord?.methodId);
    expect(canonicalRecord?.provenance.provenanceId).toBe(
      healthKitValidated.provenance.provenanceId,
    );
    expect(supersededRecord?.provenance.provenanceId).toBe(
      manualValidated.provenance.provenanceId,
    );
    expect(canonicalRecord?.provenance.occurredAt.getTime()).toBe(DAY + 9 * 3_600_000 + 60_000);
    expect(supersededRecord?.provenance.occurredAt.getTime()).toBe(DAY + 9 * 3_600_000);

    const ledger = new Map<string, ObservationDraft>([
      [manualDraft.provenance.nativeSampleId, manualDraft],
      [healthKitDraft.provenance.nativeSampleId, healthKitDraft],
      [healthConnectDraft.provenance.nativeSampleId, healthConnectDraft],
    ]);
    const manualLedger = ledger.get("SYNTH-MCAP-000001");
    const healthKitLedger = ledger.get("SYNTH-HK-hr-000001");
    const healthConnectLedger = ledger.get("SYNTH-HC-hr-000001:2026-09-10T09:02:30.000Z");
    expect(manualLedger?.provenance.unitConversion.applied).toBe(false);
    expect(healthKitLedger?.provenance.unitConversion.applied).toBe(true);
    expect(healthKitLedger?.provenance.unitConversion.fromUnit).toBe("count/min");
    expect(healthConnectLedger?.provenance.unitConversion.fromUnit).toBe("bpm");
    expect(manualLedger?.provenance.sourceMetadata).toEqual({
      "manual.capture": "synthetic",
      "manual.correlationId": "SYNTH-M4EXIT-CAP",
    });
    expect(healthKitLedger?.provenance.sourceMetadata["hk.sourceBundleId"]).toBe("com.synth.watch");

    // (c) NO RAW SAMPLE DISCARDED — every acquired heart-rate raw sample
    // became exactly one draft; every draft became a materialized domain
    // observation; both originals PLUS the canonical replacement are
    // retained in the archive (the superseded original keeps its
    // provenance id and its raw evidence linkage).
    expect(rawSamples.length).toBe(1);
    expect(healthKitDrafts.length).toBe(rawSamples.length);
    expect(manualDrafts.length).toBe(1);
    const archived = archive.list();
    expect(archived.map((observation) => observation.id)).toEqual([
      pair.superseded.id,
      canonicalSource.id,
      canonical.id,
    ]);
    expect(pair.superseded.validationState).toBe("superseded");
    expect(pair.superseded.id).toBe(manualValidated.observation.id);
    expect(pair.superseded.provenanceId).toBe(manualValidated.observation.provenanceId);
    expect(pair.replacement.supersedesId).toBe(manualValidated.observation.id);
    expect(pair.replacement.validationState).toBe("validated");
    expect(canonical.validationState).toBe("validated");
    expect(await archive.findById(manualValidated.observation.id)).toBeDefined();
    expect(await archive.findById(healthKitValidated.observation.id)).toBeDefined();
    // The rejected-leg observation was never discarded either: the caller
    // keeps it (the archive holds the reconciled set; the rejected record
    // stays with the validation caller for the engine's recording step).
    expect(invalidOutcome.observation.validationState).toBe("rejected");

    // ---------------------------------------------------------------------
    // Stage 5 — ZERO-PHI: the adapters logged through the observability
    // logger; no synthetic person data reached the sink.
    // ---------------------------------------------------------------------
    expect(sink.records.length).toBeGreaterThan(0);
    const dump = JSON.stringify(sink.records);
    expect(dump).not.toContain(PERSON_ID);
    expect(dump).not.toContain(PERSON_DISPLAY_NAME);
    expect(dump).not.toContain("SYNTH-HK-hr-000001");
    expect(dump).not.toContain("SYNTH-HC-hr-000001");
    const fetchLog = sink.records.find(
      (record) => record["event"] === "healthkit.fetch.completed",
    );
    expect(fetchLog?.["personId"]).toBe("[REDACTED]");
    expect(fetchLog?.["sampleCount"]).toBe(1);
    const unauthorizedLog = sink.records.find(
      (record) => record["event"] === "healthkit.fetch.unauthorized",
    );
    expect(unauthorizedLog?.["personId"]).toBe("[REDACTED]");
  });

  it("keeps the harness deterministic: identical inputs replay identical ids and views", async () => {
    const runOnce = async () => {
      const registry = new InMemoryMeasurementSourceRegistry();
      registry.register(MANUAL_SOURCE);
      registry.register(HEALTHKIT_SOURCE);
      const sink = new InMemorySink();
      const clock = new DeterministicClock({ epochMs: DAY + 12 * 3_600_000 });
      const ids = new DeterministicIdFactory({ seed: "m4-exit" });
      const logger = createLogger(undefined, { sink, nowMs: () => clock.epochMs });
      const adapter = new HealthKitAdapter(HK_SOURCE_ID, {
        native: new SyntheticHealthKitNativeModule({
          samples: [HK_HEART_RATE_IN_WINDOW],
          authorizationStatus: "sharingAuthorized",
        }),
        registry,
        logger,
        nowMs: () => clock.epochMs,
      });
      const session = new SyntheticManualCaptureSession({ nowMs: () => clock.epochMs });
      const manual = session.capture({
        personId: PERSON_ID,
        sourceId: MANUAL_SOURCE_ID,
        methodId: "SYNTH-method-hr-manual",
        capturedAt: CAPTURED_AT,
        fields: [{ metricId: "SYNTH-metric-heart-rate", value: 68 }],
        quality: parseQualityScore(0.7),
      });
      const fetch = await adapter.fetchSamples({
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: MORNING_WINDOW,
      });
      const normalized = adapter.normalizeSamples({
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        samples: fetch.ok ? fetch.value.samples : [],
      });
      const archive = new InMemoryObservationArchive();
      const service = new ReconciliationServiceDouble({
        metrics: [HEART_RATE_METRIC],
        ids,
        nowMs: () => clock.epochMs,
        archive,
      });
      const validator = new StructuralDraftValidator();
      const candidates: SourcedObservation[] = [];
      for (const draft of [
        ...(manual.ok ? manual.value : []),
        ...(normalized.ok ? normalized.value : []),
      ]) {
        const materialized = materializeDraft(draft, { ids, nowMs: () => clock.epochMs });
        const outcome = applyDraftValidation(materialized, validator.decide(draft));
        if (outcome.kind === "validated") {
          candidates.push({ observation: outcome.observation, provenance: outcome.provenance });
        }
      }
      const result = await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: MORNING_WINDOW,
        candidates,
      });
      return JSON.stringify(result.ok ? result.value.view : result.error);
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(first).toBe(second);
  });
});
