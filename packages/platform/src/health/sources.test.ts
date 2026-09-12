import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { isIdOf, parseQualityScore, type PersonId, type SourceId } from "@orbb/domain";
import {
  applyDraftValidation,
  InMemoryMeasurementSourceRegistry,
  materializeDraft,
  normalizeSamplesForBinding,
  StructuralDraftValidator,
  type ObservationDraft,
  type RegisteredMeasurementSource,
} from "./sources.js";
import { err, ok } from "./result.js";

const PERSON_ID = "prsn_SYNTH-person-0001" as PersonId;
const SOURCE_ID = "src_SYNTH-source-manual-0001" as SourceId;
const OTHER_PERSON_ID = "prsn_SYNTH-person-0002" as PersonId;

const HK_SOURCE_ID = "src_SYNTH-source-healthkit-0001" as SourceId;

const HR_BINDING = {
  metricId: "SYNTH-metric-heart-rate",
  conceptCode: "SYNTH-8867-4",
  methodId: "SYNTH-method-hr-app",
  evidenceLabel: "IMPORTED" as const,
  quality: parseQualityScore(0.9),
};

function manualSource(overrides?: Partial<RegisteredMeasurementSource>): RegisteredMeasurementSource {
  return {
    sourceId: SOURCE_ID,
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
    ...overrides,
  };
}

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
    ],
    unitConversions: [
      { metricId: "SYNTH-metric-heart-rate", fromUnit: "count/min", toUnit: "beats/min", factor: 1 },
    ],
    active: true,
    ...overrides,
  };
}

describe("InMemoryMeasurementSourceRegistry — registration", () => {
  it("registers a well-formed source and echoes it back", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    const result = registry.register(manualSource());
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.sourceId).toBe(SOURCE_ID);
    expect(registry.find(SOURCE_ID)).toBeDefined();
    expect(registry.listForPerson(PERSON_ID)).toHaveLength(1);
  });

  it("rejects malformed registrations with typed reasons (never throws)", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    expect(
      registry.register(manualSource({ sourceId: "not-a-canonical-id" as SourceId })),
    ).toEqual({
      ok: false,
      error: { kind: "invalid-source" },
    });
    expect(
      registry.register(manualSource({ personId: "bad" as PersonId })),
    ).toEqual({
      ok: false,
      error: { kind: "invalid-source" },
    });
    expect(registry.register(manualSource({ kind: "mystery" as never }))).toEqual({
      ok: false,
      error: { kind: "invalid-source" },
    });
    expect(registry.register(manualSource({ capabilities: [] }))).toEqual({
      ok: false,
      error: { kind: "invalid-source" },
    });
    expect(
      registry.register(
        manualSource({
          capabilities: [
            { metricId: "SYNTH-metric-heart-rate", methodIds: [], direction: "pull" },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: { kind: "invalid-capability" } });
    expect(
      registry.register(
        manualSource({
          capabilities: [
            { metricId: "SYNTH-metric-heart-rate", methodIds: ["m"], direction: "sideways" as never },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: { kind: "invalid-capability" } });
    expect(
      registry.register(
        manualSource({
          capabilities: [
            { metricId: "SYNTH-metric-heart-rate", methodIds: ["a"], direction: "pull" },
            { metricId: "SYNTH-metric-heart-rate", methodIds: ["b"], direction: "pull" },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: { kind: "invalid-capability" } });
    expect(
      registry.register(
        manualSource({
          unitConversions: [
            { metricId: "SYNTH-metric-heart-rate", fromUnit: "count/min", toUnit: "beats/min", factor: 0 },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: { kind: "invalid-conversion" } });
  });

  it("re-registers the same source id for the same person (upsert)", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    expect(registry.register(manualSource()).ok).toBe(true);
    const updated = registry.register(manualSource({ active: false }));
    expect(updated.ok).toBe(true);
    expect(registry.find(SOURCE_ID)?.active).toBe(false);
  });

  it("rejects moving a source id to a different person (typed person-mismatch)", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    expect(registry.register(manualSource()).ok).toBe(true);
    const moved = registry.register(manualSource({ personId: OTHER_PERSON_ID }));
    expect(moved).toEqual({ ok: false, error: { kind: "person-mismatch" } });
    expect(registry.listForPerson(OTHER_PERSON_ID)).toHaveLength(0);
  });
});

describe("InMemoryMeasurementSourceRegistry — resolution is deny-by-default", () => {
  it("denies a person with no registered sources", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    expect(registry.resolve({ personId: PERSON_ID, metricId: "SYNTH-metric-heart-rate" })).toEqual({
      ok: false,
      error: { kind: "no-registered-source" },
    });
  });

  it("denies when sources exist but none is active", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(manualSource({ active: false }));
    expect(registry.resolve({ personId: PERSON_ID, metricId: "SYNTH-metric-heart-rate" })).toEqual({
      ok: false,
      error: { kind: "no-active-source" },
    });
  });

  it("denies when active sources exist but none supports the metric", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(manualSource());
    expect(registry.resolve({ personId: PERSON_ID, metricId: "SYNTH-metric-unknown" })).toEqual({
      ok: false,
      error: { kind: "metric-unsupported" },
    });
  });

  it("resolves active sources in registration order with their capabilities", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(manualSource());
    registry.register(hkSource());
    const result = registry.resolve({ personId: PERSON_ID, metricId: "SYNTH-metric-heart-rate" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((entry) => entry.source.sourceId)).toEqual([
        SOURCE_ID,
        HK_SOURCE_ID,
      ]);
      expect(result.value[1]?.capability.direction).toBe("pull");
    }
  });
});

describe("materializeDraft", () => {
  const clock = new DeterministicClock({ epochMs: 1_000_000 });
  const ids = new DeterministicIdFactory({ seed: "m4c" });

  function draft(overrides?: Partial<ObservationDraft>): ObservationDraft {
    return {
      personId: PERSON_ID,
      sourceId: SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      conceptCode: "SYNTH-8867-4",
      value: 68,
      unit: "beats/min",
      effectiveAt: new Date(990_000),
      observedAt: new Date(1_000_000),
      methodId: "SYNTH-method-hr-manual",
      evidenceLabel: "MEASURED",
      quality: parseQualityScore(0.7),
      validationState: "pending",
      provenance: {
        sourceId: SOURCE_ID,
        methodId: "SYNTH-method-hr-manual",
        nativeTimestamp: new Date(990_000),
        nativeSampleId: "SYNTH-MCAP-000001",
        unitConversion: { applied: false, fromUnit: "beats/min", toUnit: "beats/min", factor: 1 },
        sourceMetadata: { "manual.capture": "synthetic" },
      },
      ...overrides,
    };
  }

  it("mints canonical ids and produces a pending domain observation with linked provenance", () => {
    const materialized = materializeDraft(draft(), { ids, nowMs: () => clock.epochMs });
    expect(isIdOf("observation", materialized.observation.id)).toBe(true);
    expect(isIdOf("provenance", materialized.provenance.provenanceId)).toBe(true);
    expect(materialized.observation.provenanceId).toBe(materialized.provenance.provenanceId);
    expect(materialized.observation.validationState).toBe("pending");
    expect(materialized.observation.personId).toBe(PERSON_ID);
    expect(materialized.observation.sourceId).toBe(SOURCE_ID);
    expect(materialized.observation.methodId).toBe("SYNTH-method-hr-manual");
    expect(materialized.observation.quality).toBe(0.7);
    expect(materialized.provenance.actor).toBe(SOURCE_ID);
    expect(materialized.provenance.subject).toBe(PERSON_ID);
    expect(materialized.provenance.occurredAt.getTime()).toBe(990_000);
    expect(materialized.draft.provenance.nativeSampleId).toBe("SYNTH-MCAP-000001");
  });

  it("threads the correlation token onto the domain provenance when present", () => {
    const materialized = materializeDraft(draft(), {
      ids,
      nowMs: () => clock.epochMs,
      correlationId: "SYNTH-m4-exit",
    });
    expect(materialized.provenance.correlationId).toBe("SYNTH-m4-exit");
  });

  it("omits the correlation token when absent (exactOptionalPropertyTypes)", () => {
    const materialized = materializeDraft(draft(), { ids, nowMs: () => clock.epochMs });
    expect(materialized.provenance.correlationId).toBeUndefined();
    expect("correlationId" in materialized.provenance).toBe(false);
  });
});

describe("validation caller (pending -> validated | rejected)", () => {
  const clock = new DeterministicClock({ epochMs: 1_000_000 });
  const ids = new DeterministicIdFactory({ seed: "m4c" });
  const validator = new StructuralDraftValidator();

  function materialize(overrides?: Partial<ObservationDraft>) {
    const base: ObservationDraft = {
      personId: PERSON_ID,
      sourceId: SOURCE_ID,
      metricId: "SYNTH-metric-heart-rate",
      conceptCode: "SYNTH-8867-4",
      value: 68,
      unit: "beats/min",
      effectiveAt: new Date(990_000),
      observedAt: new Date(1_000_000),
      methodId: "SYNTH-method-hr-manual",
      evidenceLabel: "MEASURED",
      validationState: "pending",
      provenance: {
        sourceId: SOURCE_ID,
        methodId: "SYNTH-method-hr-manual",
        nativeTimestamp: new Date(990_000),
        nativeSampleId: "SYNTH-MCAP-000001",
        unitConversion: { applied: false, fromUnit: "beats/min", toUnit: "beats/min", factor: 1 },
        sourceMetadata: {},
      },
      ...overrides,
    };
    return materializeDraft(base, { ids, nowMs: () => clock.epochMs });
  }

  it("validates a structurally well-formed draft through the domain transition", () => {
    const materialized = materialize();
    const verdict = validator.decide(materialized.draft);
    expect(verdict.kind).toBe("validated");
    const outcome = applyDraftValidation(materialized, verdict);
    expect(outcome.kind).toBe("validated");
    if (outcome.kind === "validated") {
      expect(outcome.observation.validationState).toBe("validated");
      expect(outcome.observation.provenanceId).toBe(outcome.provenance.provenanceId);
    }
  });

  it("rejects drafts with invalid values, quality, timestamps, or identifiers (typed reasons)", () => {
    const badValue = materialize({ value: Number.NaN });
    expect(validator.decide(badValue.draft)).toEqual({
      kind: "rejected",
      reason: { kind: "invalid-value" },
    });

    const badQuality = materialize({ quality: parseQualityScore(0.7) });
    const forged = { ...badQuality.draft, quality: 1.5 } as ObservationDraft;
    expect(validator.decide(forged)).toEqual({
      kind: "rejected",
      reason: { kind: "invalid-quality" },
    });

    const badTimestamps = materialize({ effectiveAt: new Date(Number.NaN) });
    expect(validator.decide(badTimestamps.draft)).toEqual({
      kind: "rejected",
      reason: { kind: "invalid-timestamps" },
    });

    const badIds = materialize({ personId: "not-canonical" as never });
    expect(validator.decide(badIds.draft)).toEqual({
      kind: "rejected",
      reason: { kind: "invalid-identifiers" },
    });
  });

  it("a rejected outcome carries the terminal rejected state and intact provenance", () => {
    const materialized = materialize({ value: Number.NaN });
    const verdict = validator.decide(materialized.draft);
    const outcome = applyDraftValidation(materialized, verdict);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.observation.validationState).toBe("rejected");
      expect(outcome.reason).toEqual({ kind: "invalid-value" });
      expect(outcome.provenance.subject).toBe(PERSON_ID);
    }
  });
});

describe("normalizeSamplesForBinding — shared normalization core", () => {
  const clock = new DeterministicClock({ epochMs: 1_000_000 });

  it("normalizes raw samples through the source-declared conversions with full provenance", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(hkSource());
    const result = normalizeSamplesForBinding(
      {
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        samples: [
          {
            metricId: "SYNTH-metric-heart-rate",
            timestamp: new Date(990_000),
            value: 62,
            unit: "count/min",
            nativeId: "SYNTH-HK-hr-0001",
            sourceMetadata: { "hk.sourceName": "SYNTH-Watch" },
          },
        ],
      },
      registry,
      () => HR_BINDING,
      () => clock.epochMs,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const draft = result.value[0];
      expect(draft).toBeDefined();
      expect(draft?.value).toBe(62);
      expect(draft?.unit).toBe("beats/min");
      expect(draft?.conceptCode).toBe("SYNTH-8867-4");
      expect(draft?.methodId).toBe("SYNTH-method-hr-app");
      expect(draft?.validationState).toBe("pending");
      expect(draft?.provenance.unitConversion.applied).toBe(true);
      expect(draft?.provenance.nativeSampleId).toBe("SYNTH-HK-hr-0001");
      expect(draft?.provenance.nativeTimestamp.getTime()).toBe(990_000);
      expect(draft?.provenance.sourceMetadata["hk.sourceName"]).toBe("SYNTH-Watch");
    }
  });

  it("is all-or-nothing: one malformed sample rejects the whole batch (typed invalid-sample)", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(hkSource());
    const result = normalizeSamplesForBinding(
      {
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        samples: [
          {
            metricId: "SYNTH-metric-heart-rate",
            timestamp: new Date(990_000),
            value: 62,
            unit: "count/min",
            nativeId: "SYNTH-HK-hr-0001",
            sourceMetadata: {},
          },
          {
            metricId: "SYNTH-metric-heart-rate",
            timestamp: new Date(991_000),
            value: Number.NaN,
            unit: "count/min",
            nativeId: "SYNTH-HK-hr-0002",
            sourceMetadata: {},
          },
        ],
      },
      registry,
      () => HR_BINDING,
      () => clock.epochMs,
    );
    expect(result).toEqual({ ok: false, error: { kind: "invalid-sample" } });
  });

  it("rejects samples whose native unit has no declared conversion (typed missing-conversion)", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(hkSource());
    const result = normalizeSamplesForBinding(
      {
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        samples: [
          {
            metricId: "SYNTH-metric-heart-rate",
            timestamp: new Date(990_000),
            value: 62,
            unit: "bpm",
            nativeId: "SYNTH-HK-hr-0001",
            sourceMetadata: {},
          },
        ],
      },
      registry,
      () => HR_BINDING,
      () => clock.epochMs,
    );
    expect(result).toEqual({ ok: false, error: { kind: "missing-conversion" } });
  });

  it("rejects unregistered sources and unknown metrics (typed)", () => {
    const registry = new InMemoryMeasurementSourceRegistry();
    registry.register(hkSource());
    const unregistered = normalizeSamplesForBinding(
      { personId: PERSON_ID, sourceId: "src_SYNTH-source-unknown-01" as SourceId, samples: [] },
      registry,
      () => HR_BINDING,
      () => clock.epochMs,
    );
    expect(unregistered).toEqual({ ok: false, error: { kind: "source-not-registered" } });

    const unknownMetric = normalizeSamplesForBinding(
      {
        personId: PERSON_ID,
        sourceId: HK_SOURCE_ID,
        samples: [
          {
            metricId: "SYNTH-metric-unknown",
            timestamp: new Date(990_000),
            value: 1,
            unit: "count",
            nativeId: "SYNTH-x",
            sourceMetadata: {},
          },
        ],
      },
      registry,
      () => undefined,
      () => clock.epochMs,
    );
    expect(unknownMetric).toEqual({ ok: false, error: { kind: "metric-unsupported" } });
  });
});

describe("result helpers mirror the Lane A engine shape", () => {
  it("ok/err produce the { ok, value | error } discriminated union", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err({ kind: "no-registered-source" })).toEqual({
      ok: false,
      error: { kind: "no-registered-source" },
    });
  });
});
