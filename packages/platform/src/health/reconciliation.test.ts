import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { parseQualityScore, type MetricDefinition, type PersonId, type SourceId } from "@orbb/domain";
import {
  InMemoryObservationArchive,
  ReconciliationServiceDouble,
  type SourcedObservation,
} from "./reconciliation.js";
import { materializeDraft, type ObservationDraft } from "./sources.js";

const PERSON_ID = "prsn_SYNTH-person-0001" as PersonId;
const MANUAL_SOURCE_ID = "src_SYNTH-source-manual-0001" as SourceId;
const HK_SOURCE_ID = "src_SYNTH-source-healthkit-0001" as SourceId;

const DAY = new Date("2026-09-10T00:00:00.000Z").getTime();
const WINDOW = {
  startsAt: new Date(DAY + 8 * 3_600_000),
  endsAt: new Date(DAY + 12 * 3_600_000),
};

const HEART_RATE_METRIC: MetricDefinition = {
  id: "SYNTH-metric-heart-rate",
  displayName: "Heart Rate",
  unitDomain: ["beats/min"],
  valueType: "quantity",
  conceptCode: "SYNTH-8867-4",
  category: "vital-signs",
};

const STEP_METRIC: MetricDefinition = {
  id: "SYNTH-metric-step-count",
  displayName: "Step Count",
  unitDomain: ["count"],
  valueType: "quantity",
  conceptCode: "SYNTH-41950-7",
  category: "activity",
};

function manualDraft(value: number): ObservationDraft {
  return {
    personId: PERSON_ID,
    sourceId: MANUAL_SOURCE_ID,
    metricId: "SYNTH-metric-heart-rate",
    conceptCode: "SYNTH-8867-4",
    value,
    unit: "beats/min",
    effectiveAt: new Date(DAY + 9 * 3_600_000),
    observedAt: new Date(DAY + 9 * 3_600_000),
    methodId: "SYNTH-method-hr-manual",
    evidenceLabel: "MEASURED",
    quality: parseQualityScore(0.7),
    validationState: "pending",
    provenance: {
      sourceId: MANUAL_SOURCE_ID,
      methodId: "SYNTH-method-hr-manual",
      nativeTimestamp: new Date(DAY + 9 * 3_600_000),
      nativeSampleId: "SYNTH-MCAP-000001",
      unitConversion: { applied: false, fromUnit: "beats/min", toUnit: "beats/min", factor: 1 },
      sourceMetadata: { "manual.capture": "synthetic" },
    },
  };
}

function healthKitDraft(value: number): ObservationDraft {
  return {
    personId: PERSON_ID,
    sourceId: HK_SOURCE_ID,
    metricId: "SYNTH-metric-heart-rate",
    conceptCode: "SYNTH-8867-4",
    value,
    unit: "beats/min",
    effectiveAt: new Date(DAY + 9 * 3_600_000 + 30_000),
    observedAt: new Date(DAY + 10 * 3_600_000),
    methodId: "SYNTH-method-hr-app",
    evidenceLabel: "IMPORTED",
    quality: parseQualityScore(0.9),
    validationState: "pending",
    provenance: {
      sourceId: HK_SOURCE_ID,
      methodId: "SYNTH-method-hr-app",
      nativeTimestamp: new Date(DAY + 9 * 3_600_000 + 30_000),
      nativeSampleId: "SYNTH-HK-hr-0001",
      unitConversion: { applied: true, fromUnit: "count/min", toUnit: "beats/min", factor: 1 },
      sourceMetadata: { "hk.sourceName": "SYNTH-Watch" },
    },
  };
}

function buildDouble() {
  const clock = new DeterministicClock({ epochMs: DAY + 12 * 3_600_000 });
  const ids = new DeterministicIdFactory({ seed: "m4c" });
  const archive = new InMemoryObservationArchive();
  const service = new ReconciliationServiceDouble({
    metrics: [HEART_RATE_METRIC, STEP_METRIC],
    ids,
    nowMs: () => clock.epochMs,
    archive,
  });
  return { service, archive, clock, ids };
}

function materialize(draft: ObservationDraft, ids: DeterministicIdFactory, nowMs: () => number) {
  return materializeDraft(draft, { ids, nowMs });
}

describe("ReconciliationServiceDouble — happy path (contract semantics)", () => {
  it("reconciles two same-metric observations into one canonical view with per-source provenance", async () => {
    const { service, archive, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(68), ids, () => clock.epochMs);
    const healthKit = materialize(healthKitDraft(62), ids, () => clock.epochMs);
    const candidates: readonly SourcedObservation[] = [
      { observation: manual.observation, provenance: manual.provenance },
      { observation: healthKit.observation, provenance: healthKit.provenance },
    ];
    const result = await service.reconcile({
      personId: PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
      candidates,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("SYNTH setup failure");
    }
    const { view, pair, canonicalSource, supersededOriginal, canonical } = result.value;

    // The higher-quality HealthKit observation wins the deterministic ranking.
    expect(canonicalSource.sourceId).toBe(HK_SOURCE_ID);
    expect(view.value).toBe(62);
    expect(view.unit).toBe("beats/min");
    expect(view.conceptCode).toBe("SYNTH-8867-4");
    expect(view.verdict).toBe("discordant");
    expect(view.canonicalObservationId).toBe(canonical.id);

    // Both methods contributed, provenance for both is present and distinguishable.
    expect(view.sources).toHaveLength(2);
    const roles = view.sources.map((source) => source.role);
    expect(roles).toContain("canonical-source");
    expect(roles).toContain("superseded-source");
    const canonicalRecord = view.sources.find((source) => source.role === "canonical-source");
    const supersededRecord = view.sources.find((source) => source.role === "superseded-source");
    expect(canonicalRecord?.sourceId).toBe(HK_SOURCE_ID);
    expect(canonicalRecord?.methodId).toBe("SYNTH-method-hr-app");
    expect(canonicalRecord?.provenance.provenanceId).toBe(healthKit.observation.provenanceId);
    expect(supersededRecord?.sourceId).toBe(MANUAL_SOURCE_ID);
    expect(supersededRecord?.methodId).toBe("SYNTH-method-hr-manual");
    expect(supersededRecord?.provenance.provenanceId).toBe(manual.observation.provenanceId);

    // The loser is superseded through the domain function with provenance intact.
    expect(pair.superseded.id).toBe(manual.observation.id);
    expect(pair.superseded.validationState).toBe("superseded");
    expect(pair.superseded.provenanceId).toBe(manual.observation.provenanceId);
    expect(pair.replacement.supersedesId).toBe(manual.observation.id);
    expect(pair.replacement.validationState).toBe("validated");
    expect(supersededOriginal.id).toBe(manual.observation.id);

    // All three observations are archived — nothing is discarded.
    expect(archive.list().map((observation) => observation.id)).toEqual([
      pair.superseded.id,
      canonicalSource.id,
      canonical.id,
    ]);
    expect(await archive.findById(manual.observation.id)).toBeDefined();
    expect(await archive.findById(healthKit.observation.id)).toBeDefined();
    expect(await archive.findById(canonical.id)).toBeDefined();
  });

  it("reports concordant when the values agree (exact equality default)", async () => {
    const { service, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(62), ids, () => clock.epochMs);
    const healthKit = materialize(healthKitDraft(62), ids, () => clock.epochMs);
    const result = await service.reconcile({
      personId: PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
      candidates: [
        { observation: manual.observation, provenance: manual.provenance },
        { observation: healthKit.observation, provenance: healthKit.provenance },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.view.verdict).toBe("concordant");
    }
  });

  it("honors an injectable agreement tolerance for quantity values", async () => {
    const { service, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(61), ids, () => clock.epochMs);
    const healthKit = materialize(healthKitDraft(62), ids, () => clock.epochMs);
    const result = await service.reconcile({
      personId: PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
      candidates: [
        { observation: manual.observation, provenance: manual.provenance },
        { observation: healthKit.observation, provenance: healthKit.provenance },
      ],
      policy: { agreementTolerance: 1.5 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.view.verdict).toBe("concordant");
    }
  });

  it("ranks by quality first; preferred method order breaks quality ties", async () => {
    const { service, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(62), ids, () => clock.epochMs);
    const healthKit = materialize(healthKitDraft(62), ids, () => clock.epochMs);
    const qualityRanks = await service.reconcile({
      personId: PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
      candidates: [
        { observation: manual.observation, provenance: manual.provenance },
        { observation: healthKit.observation, provenance: healthKit.provenance },
      ],
      policy: { preferredMethodOrder: ["SYNTH-method-hr-manual"] },
    });
    expect(qualityRanks.ok).toBe(true);
    if (qualityRanks.ok) {
      // Quality dominates: HealthKit 0.9 beats manual 0.7 even though the
      // policy prefers the manual method.
      expect(qualityRanks.value.canonicalSource.sourceId).toBe(HK_SOURCE_ID);
    }

    const equalQualityService = buildDouble();
    const manualEq = materialize(
      { ...manualDraft(62), quality: parseQualityScore(0.8) },
      equalQualityService.ids,
      () => equalQualityService.clock.epochMs,
    );
    const healthKitEq = materialize(
      { ...healthKitDraft(62), quality: parseQualityScore(0.8) },
      equalQualityService.ids,
      () => equalQualityService.clock.epochMs,
    );
    const preferred = await equalQualityService.service.reconcile({
      personId: PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      window: WINDOW,
      candidates: [
        { observation: manualEq.observation, provenance: manualEq.provenance },
        { observation: healthKitEq.observation, provenance: healthKitEq.provenance },
      ],
      policy: { preferredMethodOrder: ["SYNTH-method-hr-manual"] },
    });
    expect(preferred.ok).toBe(true);
    if (preferred.ok) {
      // Quality tie: the preferred method order decides.
      expect(preferred.value.canonicalSource.sourceId).toBe(MANUAL_SOURCE_ID);
    }
  });
});

describe("ReconciliationServiceDouble — typed rejections (contract error kinds)", () => {
  it("rejects candidate counts other than exactly two", async () => {
    const { service, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(68), ids, () => clock.epochMs);
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [],
      }),
    ).toEqual({ ok: false, error: { kind: "candidate-count" } });
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: manual.observation, provenance: manual.provenance },
          { observation: manual.observation, provenance: manual.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "candidate-count" } });
  });

  it("rejects invalid windows and unknown metrics", async () => {
    const { service, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(68), ids, () => clock.epochMs);
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: { startsAt: WINDOW.endsAt, endsAt: WINDOW.startsAt },
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: manual.observation, provenance: manual.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "invalid-window" } });
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-unknown",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: manual.observation, provenance: manual.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "metric-not-found" } });
  });

  it("rejects duplicate candidates, person mismatches, and provenance mismatches", async () => {
    const { service, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(68), ids, () => clock.epochMs);
    const healthKit = materialize(healthKitDraft(62), ids, () => clock.epochMs);
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: manual.observation, provenance: manual.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "duplicate-candidate" } });

    expect(
      await service.reconcile({
        personId: "prsn_SYNTH-person-0002" as PersonId,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: healthKit.observation, provenance: healthKit.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "person-mismatch" } });

    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: healthKit.provenance },
          { observation: healthKit.observation, provenance: healthKit.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "provenance-mismatch" } });

    const wrongSubject = materialize(manualDraft(68), ids, () => clock.epochMs);
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          {
            observation: manual.observation,
            provenance: {
              ...wrongSubject.provenance,
              provenanceId: manual.observation.provenanceId,
              subject: "prsn_SYNTH-person-0002" as PersonId,
            },
          },
          { observation: healthKit.observation, provenance: healthKit.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "provenance-mismatch" } });
  });

  it("rejects nonconforming observations, terminal candidates, outside-window values, and identical method+source pairs", async () => {
    const { service, ids, clock } = buildDouble();
    const manual = materialize(manualDraft(68), ids, () => clock.epochMs);
    const healthKit = materialize(healthKitDraft(62), ids, () => clock.epochMs);

    // Nonconforming: wrong unit for the metric.
    const badUnit = materialize(
      { ...healthKitDraft(62), unit: "mmHg" },
      ids,
      () => clock.epochMs,
    );
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: badUnit.observation, provenance: badUnit.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "observation-nonconforming" } });

    // Terminal candidates: already superseded.
    const supersededPair = { ...healthKit.observation, validationState: "superseded" as const };
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: supersededPair, provenance: healthKit.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "terminal-candidate" } });

    // Outside window.
    const outside = materialize(
      { ...healthKitDraft(62), effectiveAt: new Date(DAY + 20 * 3_600_000) },
      ids,
      () => clock.epochMs,
    );
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: outside.observation, provenance: outside.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "outside-window" } });

    // Same method AND same source is not a two-method reconciliation.
    const manualClone = materialize(manualDraft(70), ids, () => clock.epochMs);
    expect(
      await service.reconcile({
        personId: PERSON_ID,
        metricId: "SYNTH-metric-heart-rate",
        window: WINDOW,
        candidates: [
          { observation: manual.observation, provenance: manual.provenance },
          { observation: manualClone.observation, provenance: manualClone.provenance },
        ],
      }),
    ).toEqual({ ok: false, error: { kind: "not-distinct-sources" } });
  });
});

describe("InMemoryObservationArchive", () => {
  it("stores defensive copies and lists in insertion order", async () => {
    const archive = new InMemoryObservationArchive();
    const { ids, clock } = buildDouble();
    const manual = materialize(manualDraft(68), ids, () => clock.epochMs);
    await archive.save(manual.observation);
    const loaded = await archive.findById(manual.observation.id);
    expect(loaded).toEqual(manual.observation);
    expect(archive.list()).toHaveLength(1);
  });
});
