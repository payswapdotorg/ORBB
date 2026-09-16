import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_BP_VIEW_INPUT,
  DEVICE_BP_IMPORT_OBSERVATION,
  OBSERVATION_REFERENCE_NOW_ISO,
  SEEDED_OBSERVATIONS,
  observationViewFromCapture,
} from "./fixtures";
import {
  findObservation,
  importDeviceObservation,
  isCanonicalObservationId,
  listObservationBoard,
  resetObservationStore,
} from "./store";

/**
 * Observation store + fixtures tests (M6-B B5): the deterministic seed
 * carries structured provenance for every §Provenance UX chain field; the
 * device import (golden journey #2) reconciles two sources into ONE
 * canonical view with per-source provenance, exactly once, never
 * discarding data.
 */

afterEach(() => {
  resetObservationStore();
});

describe("SEEDED_OBSERVATIONS (the provenance-fixture contract)", () => {
  it("carries every chain field on every observation", () => {
    expect(SEEDED_OBSERVATIONS).toHaveLength(4);
    for (const observation of SEEDED_OBSERVATIONS) {
      expect(observation.id.startsWith("obs_SYNTH-")).toBe(true);
      expect(observation.capturedBy.length).toBeGreaterThan(0);
      expect(observation.method.id.length).toBeGreaterThan(0);
      expect(observation.deviceOrPerson.length).toBeGreaterThan(0);
      expect(observation.time.capturedAtLabel.length).toBeGreaterThan(0);
      expect(observation.time.recordedAtLabel.length).toBeGreaterThan(0);
      expect(observation.quality.score).toBeGreaterThanOrEqual(0);
      expect(observation.quality.score).toBeLessThanOrEqual(1);
      expect(["pending", "validated", "superseded"]).toContain(
        observation.validationState,
      );
      expect(Array.isArray(observation.transformations)).toBe(true);
    }
  });

  it("covers the source kinds: manual, device-adapter (synthesized arrives with the import)", () => {
    const kinds = new Set(SEEDED_OBSERVATIONS.map((observation) => observation.sourceKind));
    expect(kinds.has("manual")).toBe(true);
    expect(kinds.has("device-adapter")).toBe(true);
  });

  it("covers the evidence labels MEASURED, IMPORTED, and the ESTIMATED teaching case", () => {
    const labels = new Set(
      SEEDED_OBSERVATIONS.map((observation) => observation.evidenceLabel),
    );
    expect(labels.has("MEASURED")).toBe(true);
    expect(labels.has("IMPORTED")).toBe(true);
    expect(labels.has("ESTIMATED")).toBe(true);
  });

  it("the ESTIMATED observation teaches: uncertainty sentence + model version", () => {
    const estimated = SEEDED_OBSERVATIONS.find(
      (observation) => observation.evidenceLabel === "ESTIMATED",
    )!;
    expect(estimated.uncertainty).toContain("Estimated from an image");
    expect(estimated.modelVersion).toBe("SYNTH-thermo-estimator v0.3");
    expect(estimated.evidence?.id).toBe("SYNTH-EV-0003");
    expect(estimated.transformations[0]?.label).toBe("Image extraction");
  });

  it("the device-adapter observation carries a transformation chain and evidence link", () => {
    const device = SEEDED_OBSERVATIONS.find(
      (observation) => observation.sourceKind === "device-adapter",
    )!;
    expect(device.evidenceLabel).toBe("IMPORTED");
    expect(device.transformations.length).toBe(1);
    expect(device.transformations[0]?.label).toBe("Series reduction");
    expect(device.evidence?.id).toBe("SYNTH-EV-0001");
  });

  it("manual observations link their DataBox evidence records (or state the honest gap)", () => {
    for (const observation of SEEDED_OBSERVATIONS) {
      if (observation.sourceKind === "manual") {
        // Every seeded manual observation has a real evidence record.
        expect(observation.evidence).toBeDefined();
      }
    }
  });
});

describe("observationViewFromCapture (the capture adapter)", () => {
  it("adapts an in-session manual capture to the chain view, stating the evidence gap honestly", () => {
    const view = observationViewFromCapture(
      {
        id: "obs_SYNTH-obs-000009",
        personId: "prsn_SYNTH-person-0001",
        conceptCode: "SYNTH-8480-5",
        metricId: "SYNTH-metric-bp-systolic",
        metricLabel: "Blood Pressure Systolic",
        value: 118,
        unit: "mmHg",
        effectiveAt: "2026-09-10T08:00:00.000Z",
        observedAt: "2026-09-10T08:01:00.000Z",
        sourceId: "src_SYNTH-source-manual",
        methodId: "SYNTH-method-bpsys-manual",
        methodLabel: "Manual entry — home BP cuff reading · Systolic",
        evidenceLabel: "MEASURED",
        quality: 0.9,
        validationState: "pending",
        provenance: {
          provenanceId: "prov_SYNTH-prov-000009",
          actor: "prsn_SYNTH-person-0001",
          subject: "prsn_SYNTH-person-0001",
          occurredAt: "2026-09-10T08:01:00.000Z",
          correlationId: "SYNTH-CAP-000005",
        },
      },
      {
        captureId: "SYNTH-CAP-000005",
        personId: "prsn_SYNTH-person-0001",
        shapeId: "SYNTH-shape-bp-panel",
        shapeLabel: "Blood pressure",
        methodOptionId: "SYNTH-method-manual-bp-panel",
        qualityState: "complete",
        capturedAt: "2026-09-10T08:00:00.000Z",
        recordedAt: "2026-09-10T08:01:00.000Z",
        observations: [],
      },
      new Date("2026-09-10T08:05:00.000Z"),
    );

    expect(view.id).toBe("obs_SYNTH-obs-000009");
    expect(view.sourceKind).toBe("manual");
    expect(view.evidenceLabel).toBe("MEASURED");
    expect(view.validationState).toBe("pending");
    expect(view.quality.state).toBe("complete");
    expect(view.evidence).toBeUndefined();
    expect(view.deviceOrPerson).toContain("SYNTH-CAP-000005");
  });
});

describe("importDeviceObservation (golden journey #2)", () => {
  it("imports, reconciles into ONE canonical view with per-source provenance, once-only", () => {
    const before = listObservationBoard();
    expect(before.canonical).toBeNull();
    expect(before.deviceImportAvailable).toBe(true);

    const result = importDeviceObservation();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // The imported observation is the winner (quality 0.95 > 0.9).
    expect(result.imported.id).toBe(DEVICE_BP_IMPORT_OBSERVATION.id);
    expect(result.imported.value).toBe(120);
    expect(result.superseded.id).toBe("obs_SYNTH-obs-bp-manual-0001");

    // The canonical view: DERIVED, validated, discordant (118 vs 120),
    // per-source provenance for BOTH originals.
    const canonical = result.canonical;
    expect(canonical.id).toBe(CANONICAL_BP_VIEW_INPUT.canonicalId);
    expect(canonical.evidenceLabel).toBe("DERIVED");
    expect(canonical.validationState).toBe("validated");
    expect(canonical.verdict).toBe("discordant");
    expect(canonical.value).toBe(120);
    expect(canonical.sources).toHaveLength(2);
    const roles = canonical.sources.map((source) => source.role);
    expect(roles).toContain("canonical-source");
    expect(roles).toContain("superseded-source");
    const canonicalSource = canonical.sources.find(
      (source) => source.role === "canonical-source",
    )!;
    expect(canonicalSource.observationId).toBe(DEVICE_BP_IMPORT_OBSERVATION.id);

    // The board reflects the states: winner validated, loser superseded,
    // canonical present, import no longer available.
    const after = listObservationBoard();
    expect(after.canonical?.id).toBe(canonical.id);
    expect(after.deviceImportAvailable).toBe(false);
    const winner = findObservation(DEVICE_BP_IMPORT_OBSERVATION.id);
    const loser = findObservation("obs_SYNTH-obs-bp-manual-0001");
    expect(winner?.validationState).toBe("validated");
    expect(loser?.validationState).toBe("superseded");
    // Nothing discarded: BOTH originals still resolve.
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(isCanonicalObservationId(canonical.id)).toBe(true);

    // Repeat import: typed rejection (once-only fixture batch).
    const repeat = importDeviceObservation();
    expect(repeat).toEqual({
      ok: false,
      error: { kind: "import-already-completed" },
    });
  });

  it("stores the canonical view in the observation list (timeline-visible)", () => {
    importDeviceObservation();
    const board = listObservationBoard();
    expect(board.observations[0]?.id).toBe(CANONICAL_BP_VIEW_INPUT.canonicalId);
    expect(
      board.observations.some(
        (observation) => observation.id === DEVICE_BP_IMPORT_OBSERVATION.id,
      ),
    ).toBe(true);
    // Ordering timestamps remain deterministic against the reference now.
    expect(board.observations.every((observation) => observation.capturedAtIso <= "2026-09-10T08:59:59.999Z")).toBe(true);
    expect(OBSERVATION_REFERENCE_NOW_ISO).toBe("2026-09-10T08:20:00.000Z");
  });
});
