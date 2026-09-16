import { afterEach, describe, expect, it } from "vitest";
import {
  createMobileCaptureRecord,
  initialCaptureIdCounters,
  type MobileCaptureSubmission,
} from "../capture/model";
import {
  CORPUS_OBSERVATION_IDS,
  OBSERVATION_EVIDENCE_LINKS,
  SEEDED_MANUAL_HR_OBSERVATION_ID,
  captureRecordToDetail,
  corpusObservationDetail,
  findObservationDetail,
  importDeviceObservation,
  listObservationSummaries,
  listReconciledViews,
  resetObservationModel,
} from "./model";

/**
 * Mobile observation/provenance model contract tests (M6-B B5): the web
 * observations-store assertions mirrored onto the mobile model — the
 * §Provenance UX chain on every fixture, the measured-vs-estimated teaching
 * states, the capture-record projection, the device-import journey, and
 * the M4 reconciliation mirror (per-source provenance, nothing discarded,
 * one reconciliation per window).
 */

const NOW = new Date(2026, 8, 10, 12, 0);

function submission(overrides: Partial<MobileCaptureSubmission> = {}): MobileCaptureSubmission {
  return {
    shapeId: "SYNTH-shape-heart-rate",
    methodOptionId: "SYNTH-method-manual-heart-rate",
    fieldValues: { heartRate: 64 },
    qualityState: "partial",
    capturedAtIso: new Date(2026, 8, 10, 8, 5).toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  resetObservationModel();
});

describe("corpus fixtures carry the full provenance chain", () => {
  it("every corpus fixture renders every §Provenance UX field", () => {
    for (const id of Object.values(CORPUS_OBSERVATION_IDS)) {
      const detail = findObservationDetail(id, NOW);
      expect(detail, id).toBeDefined();
      if (detail === undefined) {
        continue;
      }
      // Captured by -> Method -> Device/Person -> Time -> Quality ->
      // Validation -> Transformations -> Original evidence.
      expect(detail.capturedBy.kind).toBe("synthesized");
      expect(detail.method.methodId.startsWith("SYNTH-")).toBe(true);
      expect(detail.deviceOrPerson.length).toBeGreaterThan(0);
      expect(detail.time.effectiveLabel.length).toBeGreaterThan(0);
      expect(detail.quality.stateLabel.length).toBeGreaterThan(0);
      expect(["pending", "validated", "superseded"]).toContain(detail.validation.state);
      expect(Array.isArray(detail.transformations)).toBe(true);
      expect(detail.evidence?.evidenceId.startsWith("SYNTH-EV-")).toBe(true);
      expect(detail.evidence?.location).toBe("databox-corpus");
    }
  });

  it("exposes corpus details purely through corpusObservationDetail (DataBox links)", () => {
    for (const id of Object.values(CORPUS_OBSERVATION_IDS)) {
      expect(corpusObservationDetail(id)?.observationId).toBe(id);
    }
    // Unknown ids resolve to undefined — honestly, never faked.
    expect(corpusObservationDetail("obs_SYNTH-does-not-exist")).toBeUndefined();
    // The pure corpus lookup does not seed the session world.
    expect(corpusObservationDetail(SEEDED_MANUAL_HR_OBSERVATION_ID)).toBeUndefined();
  });

  it("teaches the measured-vs-estimated distinction with explicit states", () => {
    const temperature = findObservationDetail(
      CORPUS_OBSERVATION_IDS.temperatureEstimated,
      NOW,
    );
    expect(temperature?.evidenceLabel).toBe("ESTIMATED");
    expect(temperature?.evidenceState).toBe("estimated");
    expect(temperature?.evidenceStateNote).toContain("different states");
    expect(temperature?.modelVersion).toContain("SYNTH-ThermoVision");
    expect(temperature?.evidence?.evidenceId).toBe("SYNTH-EV-0003");

    const weight = findObservationDetail(CORPUS_OBSERVATION_IDS.weightScale, NOW);
    expect(weight?.evidenceLabel).toBe("MEASURED");
    expect(weight?.evidenceState).toBe("measured");
    expect(weight?.evidenceStateNote).toContain("not an estimate");
  });

  it("carries the unit-normalization transformation at the M4-C seam", () => {
    const weight = findObservationDetail(CORPUS_OBSERVATION_IDS.weightScale, NOW);
    expect(weight?.transformations[0]?.label).toBe("Unit normalization");
    expect(weight?.transformations[0]?.seam).toBe("M4-C device-adapter seam");
    expect(weight?.transformations[0]?.description).toContain("155.6 lb → 70.5 kg");
  });

  it("the seeded manual duplicate exists (the import journey's partner)", () => {
    const manual = findObservationDetail(SEEDED_MANUAL_HR_OBSERVATION_ID, NOW);
    expect(manual?.valueLabel).toBe("64 beats/min");
    expect(manual?.evidenceLabel).toBe("MEASURED");
    expect(manual?.capturedBy.kind).toBe("manual");
    expect(manual?.validation.state).toBe("pending");
    // Manual typed entry: no raw evidence object, honestly stated.
    expect(manual?.evidence).toBeNull();
    expect(manual?.modelVersion).toBe("No model involved — direct capture");
  });

  it("never places the seeded manual duplicate in the future (early hours)", () => {
    const early = new Date(2026, 8, 10, 0, 30);
    const manual = findObservationDetail(SEEDED_MANUAL_HR_OBSERVATION_ID, early);
    expect(new Date(manual?.time.effectiveAt ?? "").getTime()).toBeLessThanOrEqual(
      early.getTime(),
    );
  });
});

describe("capture records project into provenance details", () => {
  it("projects a manual capture with the person as the provenance actor", () => {
    const result = createMobileCaptureRecord(submission(), NOW, initialCaptureIdCounters());
    const detail = captureRecordToDetail(result.record, NOW);
    expect(detail.capturedBy.kind).toBe("manual");
    expect(detail.capturedBy.actorId).toBe("prsn_SYNTH-person-0001");
    expect(detail.capturedBy.sourceId).toBe("src_SYNTH-source-manual");
    expect(detail.method.methodLabel).toBe("Manual pulse check");
    expect(detail.quality.state).toBe("partial");
    expect(detail.quality.score).toBe(result.record.observations[0]?.quality);
    expect(detail.validation.state).toBe("pending");
    expect(detail.evidence).toBeNull();
    expect(detail.transformations).toEqual([]);
    expect(detail.modelVersion).toBe("No model involved — direct capture");
    expect(detail.valueLabel).toBe("64 beats/min");
  });

  it("projects compound captures with the compound value label", () => {
    const result = createMobileCaptureRecord(
      submission({
        shapeId: "SYNTH-shape-bp-panel",
        methodOptionId: "SYNTH-method-manual-bp-panel",
        fieldValues: { systolic: 124, diastolic: 78 },
        qualityState: "complete",
      }),
      NOW,
      initialCaptureIdCounters(),
    );
    const detail = captureRecordToDetail(result.record, NOW);
    expect(detail.valueLabel).toBe("124/78 mmHg");
    expect(detail.metricLabel).toBe("Blood Pressure Systolic");
    expect(detail.method.methodLabel).toBe("Manual entry — home BP cuff reading · Systolic");
    expect(detail.evidenceLabel).toBe("MEASURED");
    expect(detail.evidenceState).toBe("measured");
  });

  it("keeps ESTIMATED labels on estimate captures (never presented as measurements)", () => {
    const result = createMobileCaptureRecord(
      submission({
        shapeId: "SYNTH-shape-sleep-minutes",
        methodOptionId: "SYNTH-method-manual-sleep-minutes",
        fieldValues: { sleepMinutes: 425 },
      }),
      NOW,
      initialCaptureIdCounters(),
    );
    const detail = captureRecordToDetail(result.record, NOW);
    expect(detail.evidenceLabel).toBe("ESTIMATED");
    expect(detail.evidenceState).toBe("estimated");
    expect(detail.evidenceStateNote).toContain("different states");
  });
});

describe("device import + the reconciliation mirror", () => {
  it("imports the wearable sample and reconciles the duplicate manual source", () => {
    const outcome = importDeviceObservation(new Date(2026, 8, 10, 14, 0));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // The import itself: IMPORTED, unit-normalized, evidence retained.
    expect(outcome.observation.evidenceLabel).toBe("IMPORTED");
    expect(outcome.observation.evidenceState).toBe("imported");
    expect(outcome.observation.valueLabel).toBe("62 beats/min");
    expect(outcome.observation.capturedBy.kind).toBe("device-adapter");
    expect(outcome.observation.capturedBy.sourceId).toBe("src_SYNTH-source-device-a");
    expect(outcome.observation.transformations[0]?.label).toBe("Unit normalization");
    expect(outcome.observation.transformations[0]?.description).toContain("1.03 beats/s");
    expect(outcome.observation.evidence?.location).toBe("session");

    // The reconciliation: discordant (64 vs 62 under exact equality),
    // device canonical (higher quality), manual superseded, both kept.
    const view = outcome.reconciled;
    expect(view).not.toBeNull();
    if (view === null) {
      return;
    }
    expect(view.verdict).toBe("discordant");
    expect(view.value).toBe(62);
    expect(view.canonicalObservationId).toBe("obs_SYNTH-recon-hr-000001");
    expect(view.reconciliationProvenanceId.startsWith("prov_SYNTH-")).toBe(true);
    expect(view.sources).toHaveLength(2);
    const canonicalSource = view.sources.find((source) => source.role === "canonical-source");
    const supersededSource = view.sources.find((source) => source.role === "superseded-source");
    expect(canonicalSource?.methodId).toBe("SYNTH-method-wearable-heart-rate");
    expect(canonicalSource?.quality).toBe(0.92);
    expect(canonicalSource?.roleLabel).toBe("Canonical source (won the ranking)");
    expect(supersededSource?.observationId).toBe(SEEDED_MANUAL_HR_OBSERVATION_ID);
    expect(supersededSource?.evidenceLabel).toBe("MEASURED");
    expect(supersededSource?.roleLabel).toBe("Superseded source (kept with provenance)");
    expect(view.verdictNote).toContain("never hidden");
  });

  it("supersedes the manual original with provenance intact (terminal state)", () => {
    importDeviceObservation(new Date(2026, 8, 10, 14, 0));
    const manual = findObservationDetail(SEEDED_MANUAL_HR_OBSERVATION_ID, NOW);
    expect(manual?.validation.state).toBe("superseded");
    expect(manual?.validation.note).toContain("provenance is retained");
    expect(manual?.reconciliation?.role).toBe("superseded-source");
    expect(manual?.reconciliation?.canonicalObservationId).toBe("obs_SYNTH-recon-hr-000001");
    // The canonical view itself is validated and links the reconciliation.
    const canonical = findObservationDetail("obs_SYNTH-recon-hr-000001", NOW);
    expect(canonical?.validation.state).toBe("validated");
    expect(canonical?.reconciliation?.role).toBe("canonical");
    expect(canonical?.valueLabel).toBe("62 beats/min");
  });

  it("does NOT re-reconcile a second import into the same window (honest note)", () => {
    const first = importDeviceObservation(new Date(2026, 8, 10, 14, 0));
    const second = importDeviceObservation(new Date(2026, 8, 10, 14, 5));
    expect(first.ok && first.reconciled).toBeTruthy();
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.reconciled).toBeNull();
      expect(second.reconciliationNote).toContain("Already reconciled");
      // The second import still records its own observation id.
      expect(second.observation.observationId).toBe("obs_SYNTH-import-hr-000002");
    }
    expect(listReconciledViews()).toHaveLength(1);
  });

  it("exposes the reconciled summary rows and the import in the list", () => {
    importDeviceObservation(new Date(2026, 8, 10, 14, 0));
    const summaries = listObservationSummaries(NOW);
    const reconciledRow = summaries.find(
      (row) => row.observationId === "obs_SYNTH-recon-hr-000001",
    );
    expect(reconciledRow?.reconciled).toBe(true);
    expect(reconciledRow?.evidenceState).toBe("imported");
    const importRow = summaries.find((row) =>
      row.observationId.startsWith("obs_SYNTH-import-hr-"),
    );
    expect(importRow?.sourceKind).toBe("device-adapter");
    // The corpus fixtures and the seeded manual duplicate are listed too.
    expect(summaries.some((row) => row.observationId === CORPUS_OBSERVATION_IDS.restingHeartRate)).toBe(true);
    expect(summaries.some((row) => row.observationId === SEEDED_MANUAL_HR_OBSERVATION_ID)).toBe(true);
  });
});

describe("evidence-link vocabulary", () => {
  it("links corpus observations to their M3-B evidence records", () => {
    expect(OBSERVATION_EVIDENCE_LINKS.restingHeartRate.evidenceId).toBe("SYNTH-EV-0001");
    expect(OBSERVATION_EVIDENCE_LINKS.temperatureEstimated.mediaType).toBe("image");
    expect(OBSERVATION_EVIDENCE_LINKS.weightScale.checksumPrefix).toBe("sha256-SYNTH-9d1f47be");
    for (const link of Object.values(OBSERVATION_EVIDENCE_LINKS)) {
      expect(link.evidenceId.startsWith("SYNTH-EV-")).toBe(true);
      expect(link.checksumPrefix.startsWith("sha256-SYNTH-")).toBe(true);
      expect(link.retentionClass.startsWith("SYNTH-RT-")).toBe(true);
    }
  });
});
