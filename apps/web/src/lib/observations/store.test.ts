import { afterEach, describe, expect, it } from "vitest";
import { resetCaptureStore, storeCapture } from "../capture/store";
import type { CaptureSubmission } from "../capture/types";
import {
  CORPUS_OBSERVATION_IDS,
  OBSERVATION_EVIDENCE_LINKS,
  SEEDED_MANUAL_HR_OBSERVATION_ID,
} from "./catalog";
import {
  findObservationDetail,
  importDeviceObservation,
  listObservationSummaries,
  listReconciledViews,
  resetObservationStore,
} from "./store";

/**
 * Observation/provenance store contract tests (M6-B B5): the §Provenance
 * UX chain on every fixture, the measured-vs-estimated teaching states,
 * the device-import journey, and the M4 reconciliation mirror
 * (per-source provenance, nothing discarded, one reconciliation per
 * window).
 */

const NOW = new Date("2025-09-15T14:00:00.000");

function submission(overrides: Partial<CaptureSubmission> = {}): CaptureSubmission {
  return {
    shapeId: "SYNTH-shape-heart-rate",
    methodOptionId: "SYNTH-method-manual-heart-rate",
    fieldValues: { heartRate: 64 },
    qualityState: "partial",
    capturedAtIso: "2025-09-15T08:05:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  resetObservationStore();
  resetCaptureStore();
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

  it("the seeded manual duplicate exists (journey #2's partner)", () => {
    const manual = findObservationDetail(SEEDED_MANUAL_HR_OBSERVATION_ID, NOW);
    expect(manual?.valueLabel).toBe("64 beats/min");
    expect(manual?.evidenceLabel).toBe("MEASURED");
    expect(manual?.capturedBy.kind).toBe("manual");
    expect(manual?.validation.state).toBe("pending");
    // Manual typed entry: no raw evidence object, honestly stated.
    expect(manual?.evidence).toBeNull();
    expect(manual?.modelVersion).toBe("No model involved — direct capture");
  });
});

describe("live manual captures project into provenance details", () => {
  it("reads every capture observation through the M4-B store", () => {
    const record = storeCapture(submission(), new Date("2025-09-15T14:01:00.000Z"));
    const observation = record.observations[0];
    expect(observation).toBeDefined();
    if (observation === undefined) {
      return;
    }
    const detail = findObservationDetail(observation.id, NOW);
    expect(detail?.capturedBy.kind).toBe("manual");
    expect(detail?.capturedBy.actorId).toBe("prsn_SYNTH-person-0001");
    expect(detail?.quality.state).toBe("partial");
    expect(detail?.quality.score).toBe(observation.quality);
    expect(detail?.validation.state).toBe("pending");
    expect(detail?.evidence).toBeNull();
    expect(detail?.transformations).toEqual([]);

    const summaries = listObservationSummaries(NOW);
    const summary = summaries.find((row) => row.observationId === observation.id);
    expect(summary?.sourceKind).toBe("manual");
    expect(summary?.evidenceState).toBe("measured");
  });

  it("sleep/step captures carry the entry-guard rounding transformation", () => {
    const record = storeCapture(
      submission({
        shapeId: "SYNTH-shape-sleep-minutes",
        methodOptionId: "SYNTH-method-manual-sleep-minutes",
        fieldValues: { sleepMinutes: 425 },
        capturedAtIso: "2025-09-15T07:12:00.000Z",
      }),
      new Date("2025-09-15T07:12:30.000Z"),
    );
    const observation = record.observations[0];
    if (observation === undefined) {
      throw new Error("fixture capture must produce an observation");
    }
    const detail = findObservationDetail(observation.id, NOW);
    expect(detail?.transformations[0]?.label).toBe("Entry-guard rounding");
    expect(detail?.evidenceLabel).toBe("ESTIMATED");
    expect(detail?.evidenceState).toBe("estimated");
  });
});

describe("device import + the reconciliation mirror (journey #2)", () => {
  it("imports the wearable sample and reconciles the duplicate manual source", () => {
    const outcome = importDeviceObservation(new Date("2025-09-15T14:00:00.000Z"));
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
    expect(supersededSource?.observationId).toBe(SEEDED_MANUAL_HR_OBSERVATION_ID);
    expect(supersededSource?.evidenceLabel).toBe("MEASURED");
    expect(view.verdictNote).toContain("never hidden");
  });

  it("supersedes the manual original with provenance intact (terminal state)", () => {
    importDeviceObservation(new Date("2025-09-15T14:00:00.000Z"));
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
    const first = importDeviceObservation(new Date("2025-09-15T14:00:00.000Z"));
    const second = importDeviceObservation(new Date("2025-09-15T14:05:00.000Z"));
    expect(first.ok && first.reconciled).toBeTruthy();
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.reconciled).toBeNull();
      expect(second.reconciliationNote).toContain("Already reconciled");
    }
    expect(listReconciledViews()).toHaveLength(1);
  });

  it("exposes the reconciled summary rows and the import in the list", () => {
    importDeviceObservation(new Date("2025-09-15T14:00:00.000Z"));
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
