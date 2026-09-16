import { describe, expect, it } from "vitest";
import {
  DEVICE_BP_IMPORT,
  EMPTY_FILTERS,
  SEEDED_OBSERVATIONS,
  deriveCollections,
  filterObservations,
  importDeviceObservationForToday,
  observationViewFromMobileCapture,
} from "./model";
import type { MobileCaptureObservation, MobileCaptureRecord } from "../capture/model";

/**
 * Mobile DataBox model tests (M6-B B5/B6): the structured-provenance
 * fixtures (every §Provenance UX chain field, the ESTIMATED teaching
 * case, evidence links), the reconciliation (two sources -> one canonical
 * view, per-source provenance, nothing discarded), the §DataBox UX search
 * + four filters, collections, and the capture adapter.
 */

describe("SEEDED_OBSERVATIONS (the provenance fixtures)", () => {
  it("carries every chain field on every observation", () => {
    expect(SEEDED_OBSERVATIONS).toHaveLength(4);
    for (const observation of SEEDED_OBSERVATIONS) {
      expect(observation.id.startsWith("obs_SYNTH-")).toBe(true);
      expect(observation.capturedBy.length).toBeGreaterThan(0);
      expect(observation.method.id.length).toBeGreaterThan(0);
      expect(observation.deviceOrPerson.length).toBeGreaterThan(0);
      expect(observation.time.capturedAtLabel.length).toBeGreaterThan(0);
      expect(observation.quality.score).toBeGreaterThanOrEqual(0);
      expect(observation.quality.score).toBeLessThanOrEqual(1);
      expect(["pending", "validated", "superseded"]).toContain(
        observation.validationState,
      );
    }
  });

  it("covers the source kinds and evidence labels (incl. the ESTIMATED teaching case)", () => {
    const kinds = new Set(SEEDED_OBSERVATIONS.map((observation) => observation.sourceKind));
    expect(kinds.has("manual")).toBe(true);
    expect(kinds.has("device-adapter")).toBe(true);
    const labels = new Set(
      SEEDED_OBSERVATIONS.map((observation) => observation.evidenceLabel),
    );
    expect(labels.has("MEASURED")).toBe(true);
    expect(labels.has("IMPORTED")).toBe(true);
    expect(labels.has("ESTIMATED")).toBe(true);

    const estimated = SEEDED_OBSERVATIONS.find(
      (observation) => observation.evidenceLabel === "ESTIMATED",
    )!;
    expect(estimated.uncertainty).toContain("Estimated from an image");
    expect(estimated.modelVersion).toBe("SYNTH-thermo-estimator v0.3");
    expect(estimated.evidenceId).toBe("SYNTH-EV-0003");
  });
});

describe("importDeviceObservationForToday (golden journey #2)", () => {
  it("reconciles two sources into ONE canonical view with per-source provenance", () => {
    const result = importDeviceObservationForToday();
    expect(result.imported.id).toBe(DEVICE_BP_IMPORT.id);
    expect(result.imported.value).toBe(120);
    expect(result.superseded.id).toBe("obs_SYNTH-obs-bp-manual-0001");
    expect(result.superseded.validationState).toBe("superseded");

    const canonical = result.canonical;
    expect(canonical.id).toBe("obs_SYNTH-obs-bp-canonical-0006");
    expect(canonical.verdict).toBe("discordant");
    expect(canonical.valueLabel).toBe("120 mmHg");
    expect(canonical.sources).toHaveLength(2);
    expect(canonical.sources[0]?.role).toBe("canonical-source");
    expect(canonical.sources[1]?.role).toBe("superseded-source");
    expect(canonical.sources[0]?.observationId).toBe("obs_SYNTH-obs-bp-device-0005");
    expect(canonical.sources[1]?.observationId).toBe("obs_SYNTH-obs-bp-manual-0001");

    // The canonical detail: DERIVED, synthesized, reconciliation
    // transformation, uncertainty sentence for the discordance.
    expect(canonical.detail.evidenceLabel).toBe("DERIVED");
    expect(canonical.detail.sourceKind).toBe("synthesized");
    expect(canonical.detail.method.id).toBe("SYNTH-method-reconciliation");
    expect(canonical.detail.transformations).toHaveLength(2);
    expect(canonical.detail.uncertainty).toContain("disagreed");
  });

  it("is deterministic (pure — same inputs, same outputs)", () => {
    const first = importDeviceObservationForToday();
    const second = importDeviceObservationForToday();
    expect(second).toEqual(first);
  });
});

describe("filterObservations (search + the four filters)", () => {
  it("passes everything with the empty filter state", () => {
    expect(filterObservations(SEEDED_OBSERVATIONS, EMPTY_FILTERS)).toHaveLength(4);
  });

  it("filters by time (reference-day-relative)", () => {
    const today = filterObservations(SEEDED_OBSERVATIONS, {
      ...EMPTY_FILTERS,
      time: "today",
    });
    expect(today).toHaveLength(2);
    const last7 = filterObservations(SEEDED_OBSERVATIONS, {
      ...EMPTY_FILTERS,
      time: "last-7-days",
    });
    expect(last7).toHaveLength(4);
  });

  it("filters by source, quality, and concept", () => {
    expect(
      filterObservations(SEEDED_OBSERVATIONS, {
        ...EMPTY_FILTERS,
        source: "device-adapter",
      }),
    ).toHaveLength(1);
    expect(
      filterObservations(SEEDED_OBSERVATIONS, {
        ...EMPTY_FILTERS,
        quality: "partial",
      }),
    ).toHaveLength(1);
    expect(
      filterObservations(SEEDED_OBSERVATIONS, {
        ...EMPTY_FILTERS,
        concept: "SYNTH-metric-heart-rate",
      }),
    ).toHaveLength(1);
  });

  it("searches case-insensitively across the human-readable fields and ids", () => {
    expect(
      filterObservations(SEEDED_OBSERVATIONS, { ...EMPTY_FILTERS, search: "wearable" }),
    ).toHaveLength(1);
    expect(
      filterObservations(SEEDED_OBSERVATIONS, {
        ...EMPTY_FILTERS,
        search: "obs_SYNTH-obs-bp-manual-0001",
      }),
    ).toHaveLength(1);
    expect(
      filterObservations(SEEDED_OBSERVATIONS, { ...EMPTY_FILTERS, search: "nothing" }),
    ).toHaveLength(0);
  });
});

describe("deriveCollections", () => {
  it("groups by concept with counts", () => {
    const collections = deriveCollections(SEEDED_OBSERVATIONS);
    expect(collections).toHaveLength(4);
    expect(collections[0]?.metricLabel).toBe("Heart Rate");
    expect(collections.every((collection) => collection.count === 1)).toBe(true);
  });
});

describe("observationViewFromMobileCapture (the capture adapter)", () => {
  it("adapts an in-session capture observation, stating the evidence gap honestly", () => {
    const observation: MobileCaptureObservation = {
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
    };
    const record: MobileCaptureRecord = {
      recordId: "SYNTH-CAP-000005",
      personId: "prsn_SYNTH-person-0001",
      shapeId: "SYNTH-shape-bp-panel",
      shapeLabel: "Blood pressure",
      methodOptionId: "SYNTH-method-manual-bp-panel",
      qualityState: "complete",
      capturedAt: "2026-09-10T08:00:00.000Z",
      recordedAt: "2026-09-10T08:01:00.000Z",
      observations: [observation],
    };

    const view = observationViewFromMobileCapture(
      observation,
      record,
      new Date("2026-09-10T08:05:00.000Z"),
    );
    expect(view.id).toBe("obs_SYNTH-obs-000009");
    expect(view.sourceKind).toBe("manual");
    expect(view.evidenceLabel).toBe("MEASURED");
    expect(view.validationState).toBe("pending");
    expect(view.quality.state).toBe("complete");
    expect(view.evidenceId).toBeUndefined();
    expect(view.deviceOrPerson).toContain("SYNTH-CAP-000005");
    expect(view.time.capturedAtLabel).toBe("Today, 08:00");
  });
});
