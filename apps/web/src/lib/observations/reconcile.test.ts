import { describe, expect, it } from "vitest";
import {
  applyReconciliationStates,
  buildCanonicalView,
  compareReconcileCandidates,
  reconcilePair,
  reconciliationVerdict,
  type ReconcileCandidate,
} from "./reconcile";
import type { ObservationDetailView } from "./types";

/**
 * Reconciliation mirror tests (M6-B B5): the M4-A ranking/verdict
 * semantics mirrored deterministically — quality desc, preferred-method
 * order, later observedAt, id asc; exact-equality default verdict; the
 * canonical view carries per-source provenance for BOTH originals and the
 * winner's value; supersession never discards.
 */

function observation(overrides: Partial<ObservationDetailView> = {}): ObservationDetailView {
  return {
    id: "obs_SYNTH-obs-a-0001",
    metricId: "SYNTH-metric-bp-systolic",
    metricLabel: "Blood Pressure Systolic",
    conceptCode: "SYNTH-8480-5",
    value: 118,
    unit: "mmHg",
    valueLabel: "118 mmHg",
    evidenceLabel: "MEASURED",
    validationState: "pending",
    capturedBy: "You (SYNTH-Person-1, self-tracking)",
    sourceKind: "manual",
    method: { id: "SYNTH-method-manual-bp-panel", label: "Manual entry — home BP cuff reading" },
    deviceOrPerson: "Person: You (SYNTH-Person-1)",
    time: { capturedAtLabel: "Today, 07:42", recordedAtLabel: "Today, 07:43" },
    quality: { state: "complete", score: 0.9 },
    transformations: [],
    capturedAtIso: "2026-09-10T07:42:00.000Z",
    ...overrides,
  };
}

function candidate(
  observationOverrides: Partial<ObservationDetailView> = {},
  extra: Partial<ReconcileCandidate> = {},
): ReconcileCandidate {
  const obs = observation(observationOverrides);
  return {
    observation: obs,
    qualityScore: obs.quality.score,
    observedAt: obs.capturedAtIso,
    ...extra,
  };
}

describe("compareReconcileCandidates (the M4 total order)", () => {
  it("ranks higher domain quality first", () => {
    const high = candidate({ id: "obs_SYNTH-obs-b-0002" }, { qualityScore: 0.95 });
    const low = candidate({}, { qualityScore: 0.9 });
    expect(compareReconcileCandidates(high, low, {})).toBeLessThan(0);
    expect(compareReconcileCandidates(low, high, {})).toBeGreaterThan(0);
  });

  it("breaks quality ties by the preferred method order (earlier wins)", () => {
    const a = candidate({
      id: "obs_SYNTH-obs-a-0001",
      method: { id: "SYNTH-method-cuff-bp-panel", label: "Automatic cuff sync" },
    });
    const b = candidate({
      id: "obs_SYNTH-obs-b-0002",
      method: { id: "SYNTH-method-manual-bp-panel", label: "Manual" },
    });
    const policy = {
      preferredMethodOrder: ["SYNTH-method-cuff-bp-panel", "SYNTH-method-manual-bp-panel"],
    };
    expect(compareReconcileCandidates(a, b, policy)).toBeLessThan(0);
    expect(compareReconcileCandidates(b, a, policy)).toBeGreaterThan(0);
  });

  it("breaks further ties by LATER observedAt, then id ascending", () => {
    const earlier = candidate({ id: "obs_SYNTH-obs-a-0001" }, { observedAt: "2026-09-10T07:00:00.000Z" });
    const later = candidate({ id: "obs_SYNTH-obs-b-0002" }, { observedAt: "2026-09-10T08:00:00.000Z" });
    expect(compareReconcileCandidates(earlier, later, {})).toBeGreaterThan(0);
    const idA = candidate({ id: "obs_SYNTH-obs-a-0001" }, { observedAt: "2026-09-10T08:00:00.000Z" });
    const idB = candidate({ id: "obs_SYNTH-obs-b-0002" }, { observedAt: "2026-09-10T08:00:00.000Z" });
    expect(compareReconcileCandidates(idA, idB, {})).toBeLessThan(0);
  });
});

describe("reconciliationVerdict", () => {
  it("defaults to exact equality (no invented clinical tolerances)", () => {
    expect(reconciliationVerdict(118, 118)).toBe("concordant");
    expect(reconciliationVerdict(118, 120)).toBe("discordant");
  });

  it("honors an injectable absolute tolerance", () => {
    expect(reconciliationVerdict(118, 120, 2)).toBe("concordant");
    expect(reconciliationVerdict(118, 121, 2)).toBe("discordant");
  });
});

describe("reconcilePair", () => {
  it("ranks the higher-quality source as the winner regardless of order", () => {
    const manual = candidate();
    const device = candidate(
      {
        id: "obs_SYNTH-obs-b-0002",
        value: 120,
        valueLabel: "120 mmHg",
        sourceKind: "device-adapter",
        evidenceLabel: "IMPORTED",
        method: { id: "SYNTH-method-cuff-bp-panel", label: "Automatic cuff sync" },
        quality: { state: "complete", score: 0.95 },
      },
      { qualityScore: 0.95 },
    );
    const forward = reconcilePair(manual, device);
    const backward = reconcilePair(device, manual);
    expect(forward.winner.observation.id).toBe("obs_SYNTH-obs-b-0002");
    expect(backward.winner.observation.id).toBe("obs_SYNTH-obs-b-0002");
    expect(forward.verdict).toBe("discordant");
    expect(backward.verdict).toBe("discordant");
  });
});

describe("buildCanonicalView", () => {
  const manual = candidate();
  const device = candidate(
    {
      id: "obs_SYNTH-obs-b-0002",
      value: 120,
      valueLabel: "120 mmHg",
      sourceKind: "device-adapter",
      evidenceLabel: "IMPORTED",
      method: { id: "SYNTH-method-cuff-bp-panel", label: "Automatic cuff sync" },
      quality: { state: "complete", score: 0.95 },
      transformations: [
        {
          id: "SYNTH-transform-unit-normalization",
          label: "Unit normalization",
          detail: "16.0 kPa → 120 mmHg at the device-import seam (the M4-C unit boundary).",
        },
      ],
    },
    { qualityScore: 0.95 },
  );

  it("builds ONE canonical view with per-source provenance for BOTH originals", () => {
    const pair = reconcilePair(manual, device);
    const view = buildCanonicalView(pair, {
      canonicalId: "obs_SYNTH-obs-bp-canonical-0006",
      windowLabel: "Today, 07:00–09:00",
      reconciledAtLabel: "Today, 08:20",
      reconciliationProvenanceId: "prov_SYNTH-prov-reconciliation-0001",
    });

    expect(view.id).toBe("obs_SYNTH-obs-bp-canonical-0006");
    expect(view.value).toBe(120);
    expect(view.valueLabel).toBe("120 mmHg");
    expect(view.evidenceLabel).toBe("DERIVED");
    expect(view.validationState).toBe("validated");
    expect(view.verdict).toBe("discordant");
    expect(view.sources).toHaveLength(2);

    const [canonicalSource, supersededSource] = view.sources;
    expect(canonicalSource?.observationId).toBe("obs_SYNTH-obs-b-0002");
    expect(canonicalSource?.role).toBe("canonical-source");
    expect(supersededSource?.observationId).toBe("obs_SYNTH-obs-a-0001");
    expect(supersededSource?.role).toBe("superseded-source");

    // The canonical detail: synthesized source kind, reconciliation method,
    // the winner's transformation chain + the reconciliation step.
    expect(view.detail.sourceKind).toBe("synthesized");
    expect(view.detail.method.id).toBe("SYNTH-method-reconciliation");
    expect(view.detail.transformations).toHaveLength(2);
    expect(view.detail.uncertainty).toContain("disagreed");
  });

  it("keeps the concordant case honest (no uncertainty alarmism)", () => {
    const agreeing = candidate(
      { id: "obs_SYNTH-obs-b-0002", value: 118 },
      { qualityScore: 0.95 },
    );
    const pair = reconcilePair(manual, agreeing);
    expect(pair.verdict).toBe("concordant");
    const view = buildCanonicalView(pair, {
      canonicalId: "obs_SYNTH-obs-bp-canonical-0006",
      windowLabel: "Today, 07:00–09:00",
      reconciledAtLabel: "Today, 08:20",
      reconciliationProvenanceId: "prov_SYNTH-prov-reconciliation-0001",
    });
    expect(view.detail.uncertainty).toBeUndefined();
  });
});

describe("applyReconciliationStates", () => {
  it("validates the winner, supersedes the loser, touches nothing else", () => {
    const winner = candidate({ id: "obs_SYNTH-obs-b-0002" }, { qualityScore: 0.95 });
    const loser = candidate({});
    const other = candidate({ id: "obs_SYNTH-obs-c-0003" });
    const pair = { winner, loser, verdict: "discordant" as const };
    const updated = applyReconciliationStates([winner.observation, loser.observation, other.observation], pair);
    expect(updated[0]?.validationState).toBe("validated");
    expect(updated[1]?.validationState).toBe("superseded");
    expect(updated[2]?.validationState).toBe("pending");
  });
});
