import { describe, expect, it } from "vitest";
import type { Observation, PersonId } from "@orbb/domain";
import {
  buildEngineHarness,
  harnessPersonId,
  hrObservation,
  MS_PER_DAY,
} from "./testsupport.js";
import { SEEDED_METRIC_IDS, SEEDED_METHOD_IDS } from "./seed.js";
import type { EngineHarness, HrObservationOverrides } from "./testsupport.js";
import type { SourcedObservation } from "./reconciliation.js";

const PERSON = harnessPersonId();
const WINDOW = { startsAt: new Date(0), endsAt: new Date(MS_PER_DAY) };

function sourced(
  harness: EngineHarness,
  overrides: HrObservationOverrides,
): SourcedObservation {
  const observation = hrObservation(harness, { personId: PERSON, ...overrides });
  return { observation, provenance: observation.provenance };
}

async function reconcilePair(
  harness: EngineHarness,
  first: SourcedObservation,
  second: SourcedObservation,
  policy?: Parameters<EngineHarness["reconciler"]["reconcile"]>[0]["policy"],
) {
  return harness.reconciler.reconcile({
    personId: PERSON,
    metricId: SEEDED_METRIC_IDS.heartRate,
    window: WINDOW,
    candidates: [first, second],
    ...(policy !== undefined ? { policy } : {}),
  });
}

describe("reconciliation — canonical view and provenance", () => {
  it("reconciles two same-metric observations into ONE canonical view with per-source provenance", async () => {
    const harness = buildEngineHarness();
    // Device capture (higher quality) vs manual entry, equal values.
    const device = sourced(harness, {
      value: 72,
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const manual = sourced(harness, {
      value: 72,
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const result = await reconcilePair(harness, device, manual);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected reconciliation to succeed");
    }
    const { view, pair, canonicalSource } = result.value;
    // Exactly ONE canonical observation.
    expect(view.canonicalObservationId).toBe(pair.replacement.id);
    expect(view.personId).toBe(PERSON);
    expect(view.metricId).toBe(SEEDED_METRIC_IDS.heartRate);
    expect(view.conceptCode).toBe("SYNTH-8867-4");
    expect(view.value).toBe(72);
    expect(view.unit).toBe("beats/min");
    expect(view.window).toEqual(WINDOW);
    // Quality verdict: equal values => concordant.
    expect(view.verdict).toBe("concordant");
    // Per-source provenance records for BOTH originals.
    expect(view.sources).toHaveLength(2);
    expect(view.sources.map((source) => source.role)).toEqual([
      "canonical-source",
      "superseded-source",
    ]);
    for (const source of view.sources) {
      expect(source.provenance.subject).toBe(PERSON);
    }
    const provenanceIds = view.sources.map((source) => source.provenance.provenanceId);
    expect(provenanceIds).toContain(device.observation.provenanceId);
    expect(provenanceIds).toContain(manual.observation.provenanceId);
    const observationIds = view.sources.map((source) => source.observationId);
    expect(observationIds).toContain(device.observation.id);
    expect(observationIds).toContain(manual.observation.id);
    // The domain supersession pair: replacement validated, loser terminal.
    expect(pair.replacement.validationState).toBe("validated");
    expect(pair.superseded.validationState).toBe("superseded");
    expect(pair.replacement.supersedesId).toBe(manual.observation.id);
    expect(canonicalSource.validationState).toBe("validated");
    expect(view.reconciliationProvenanceId).toBeDefined();
    expect(view.reconciledAt).toBeDefined();
  });

  it("never discards data — superseded originals keep value AND provenance; all three records persist", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      value: 72,
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const manual = sourced(harness, {
      value: 72,
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const result = await reconcilePair(harness, device, manual);
    if (!result.ok) {
      throw new Error("expected reconciliation to succeed");
    }
    // The superseded original is unchanged except its validation state.
    const superseded = result.value.supersededOriginal;
    expect(superseded.value).toBe(manual.observation.value);
    expect(superseded.unit).toBe(manual.observation.unit);
    expect(superseded.provenanceId).toBe(manual.observation.provenanceId);
    expect(superseded.methodId).toBe(manual.observation.methodId);
    expect(superseded.sourceId).toBe(manual.observation.sourceId);
    // The winning original is retained as validated, unchanged.
    expect(result.value.canonicalSource.value).toBe(device.observation.value);
    expect(result.value.canonicalSource.provenanceId).toBe(device.observation.provenanceId);
    // All three observations are persisted (loser, winner, canonical).
    const storedLoser = await harness.archive.findById(superseded.id);
    const storedWinner = await harness.archive.findById(result.value.canonicalSource.id);
    const storedCanonical = await harness.archive.findById(result.value.canonical.id);
    expect(storedLoser?.validationState).toBe("superseded");
    expect(storedWinner?.validationState).toBe("validated");
    expect(storedCanonical?.validationState).toBe("validated");
  });

  it("flags discordant values (default agreement policy is exact equality)", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      value: 72,
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const manual = sourced(harness, {
      value: 78,
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const result = await reconcilePair(harness, device, manual);
    if (!result.ok) {
      throw new Error("expected reconciliation to succeed");
    }
    expect(result.value.view.verdict).toBe("discordant");
    // The higher-quality value becomes canonical even when discordant.
    expect(result.value.view.value).toBe(72);
    expect(result.value.canonical.value).toBe(72);
  });

  it("treats near-equal quantity values as concordant under an injected tolerance", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      value: 72,
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const manual = sourced(harness, {
      value: 73,
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const result = await reconcilePair(harness, device, manual, { agreementTolerance: 1 });
    if (!result.ok) {
      throw new Error("expected reconciliation to succeed");
    }
    expect(result.value.view.verdict).toBe("concordant");
  });

  it("ranks by the policy's preferred method order when quality ties", async () => {
    const harness = buildEngineHarness();
    // Equal quality: the authored method preference breaks the tie.
    const manual = sourced(harness, {
      value: 70,
      quality: 0.9,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const device = sourced(harness, {
      value: 72,
      quality: 0.9,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const result = await reconcilePair(harness, device, manual, {
      preferredMethodOrder: [SEEDED_METHOD_IDS.heartRateManual],
    });
    if (!result.ok) {
      throw new Error("expected reconciliation to succeed");
    }
    expect(result.value.view.value).toBe(70);
    expect(result.value.canonicalSource.methodId).toBe(SEEDED_METHOD_IDS.heartRateManual);
    expect(result.value.supersededOriginal.methodId).toBe(SEEDED_METHOD_IDS.heartRateWearable);
  });

  it("is deterministic: same inputs + fresh harness replay identical canonical ids", async () => {
    const first = await reconcilePair(
      buildEngineHarness({ seed: "recon" }),
      sourced(buildEngineHarness({ seed: "recon" }), {
        value: 72,
        quality: 0.95,
        methodId: SEEDED_METHOD_IDS.heartRateWearable,
      }),
      sourced(buildEngineHarness({ seed: "recon" }), {
        value: 72,
        quality: 0.7,
        methodId: SEEDED_METHOD_IDS.heartRateManual,
      }),
    );
    const second = await reconcilePair(
      buildEngineHarness({ seed: "recon" }),
      sourced(buildEngineHarness({ seed: "recon" }), {
        value: 72,
        quality: 0.95,
        methodId: SEEDED_METHOD_IDS.heartRateWearable,
      }),
      sourced(buildEngineHarness({ seed: "recon" }), {
        value: 72,
        quality: 0.7,
        methodId: SEEDED_METHOD_IDS.heartRateManual,
      }),
    );
    expect(second).toEqual(first);
  });
});

describe("reconciliation — typed rejections", () => {
  it("rejects candidate sets that are not exactly two observations", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const one = await harness.reconciler.reconcile({
      personId: PERSON,
      metricId: SEEDED_METRIC_IDS.heartRate,
      window: WINDOW,
      candidates: [device],
    });
    expect(one).toEqual({ ok: false, error: { kind: "candidate-count" } });
  });

  it("rejects the same observation twice (duplicate candidate)", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const result = await reconcilePair(harness, device, device);
    expect(result).toEqual({ ok: false, error: { kind: "duplicate-candidate" } });
  });

  it("rejects observations outside the window", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const late = sourced(harness, {
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
      effectiveAt: new Date(MS_PER_DAY + 1),
    });
    const result = await reconcilePair(harness, device, late);
    expect(result).toEqual({ ok: false, error: { kind: "outside-window" } });
  });

  it("rejects person mismatches", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const otherPerson: PersonId = harness.fixtures.person().id;
    const otherPersonObservation: Observation = {
      ...sourced(harness, {
        quality: 0.7,
        methodId: SEEDED_METHOD_IDS.heartRateManual,
      }).observation,
      personId: otherPerson,
    };
    const result = await harness.reconciler.reconcile({
      personId: PERSON,
      metricId: SEEDED_METRIC_IDS.heartRate,
      window: WINDOW,
      candidates: [device, { observation: otherPersonObservation, provenance: device.provenance }],
    });
    expect(result).toEqual({ ok: false, error: { kind: "person-mismatch" } });
  });

  it("rejects nonconforming observations (domain guard)", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const wrongUnit = sourced(harness, {
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const result = await reconcilePair(harness, device, {
      observation: { ...wrongUnit.observation, unit: "kg" },
      provenance: wrongUnit.provenance,
    });
    expect(result).toEqual({ ok: false, error: { kind: "observation-nonconforming" } });
  });

  it("rejects candidates from the same method AND source (not distinct)", async () => {
    const harness = buildEngineHarness();
    const first = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const second = sourced(harness, {
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    // Force the same source id for both.
    const sameSource: Observation = { ...second.observation, sourceId: first.observation.sourceId };
    const result = await reconcilePair(harness, first, {
      observation: sameSource,
      provenance: second.provenance,
    });
    expect(result).toEqual({ ok: false, error: { kind: "not-distinct-sources" } });
  });

  it("rejects terminal candidates (already rejected or superseded)", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const rejectedManual = sourced(harness, {
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
      validationState: "rejected",
    });
    const result = await reconcilePair(harness, device, rejectedManual);
    expect(result).toEqual({ ok: false, error: { kind: "terminal-candidate" } });
  });

  it("rejects provenance records that do not link to their observation", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const manual = sourced(harness, {
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const unlinked = {
      observation: manual.observation,
      provenance: device.provenance,
    };
    const result = await reconcilePair(harness, device, unlinked);
    expect(result).toEqual({ ok: false, error: { kind: "provenance-mismatch" } });
  });

  it("rejects unknown metrics and invalid windows", async () => {
    const harness = buildEngineHarness();
    const device = sourced(harness, {
      quality: 0.95,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
    });
    const manual = sourced(harness, {
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
    });
    const unknownMetric = await harness.reconciler.reconcile({
      personId: PERSON,
      metricId: "SYNTH-metric-ghost",
      window: WINDOW,
      candidates: [device, manual],
    });
    expect(unknownMetric).toEqual({ ok: false, error: { kind: "metric-not-found" } });
    const invalidWindow = await harness.reconciler.reconcile({
      personId: PERSON,
      metricId: SEEDED_METRIC_IDS.heartRate,
      window: { startsAt: new Date(10), endsAt: new Date(0) },
      candidates: [device, manual],
    });
    expect(invalidWindow).toEqual({ ok: false, error: { kind: "invalid-window" } });
  });
});

describe("reconciliation — ranking determinism", () => {
  it("ranks equal-quality candidates by later observation time", async () => {
    const harness = buildEngineHarness();
    const early = sourced(harness, {
      value: 72,
      quality: 0.9,
      methodId: SEEDED_METHOD_IDS.heartRateWearable,
      observedAt: new Date(1_000),
    });
    const late = sourced(harness, {
      value: 71,
      quality: 0.9,
      methodId: SEEDED_METHOD_IDS.heartRateApp,
      observedAt: new Date(2_000),
    });
    const result = await reconcilePair(harness, early, late);
    if (!result.ok) {
      throw new Error("expected reconciliation to succeed");
    }
    expect(result.value.view.value).toBe(71);
    expect(result.value.canonicalSource.id).toBe(late.observation.id);
  });
});
