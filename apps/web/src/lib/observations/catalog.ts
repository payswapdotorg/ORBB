/**
 * Seeded observation/provenance catalog (M6-B B5, Lane B): the SYNTH
 * observation fixtures that carry STRUCTURED PROVENANCE — synthesized
 * corpus observations (the M3-B DataBox events, now with full chains), a
 * seeded manual duplicate (the reconciliation partner of golden journey
 * #2), the device-adapter sample fixture (SYNTH-Device-A), transformation
 * vocabulary (unit normalization at the M4-C seam), and model-version
 * vocabulary for estimated values.
 *
 * Pure data — no hooks, no DOM, no fetch (the catalog/store discipline).
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; zero PHI; the metric/method ids reuse the M4-B capture catalog
 * and the M4-A engine seed vocabulary (drop-in swap at integration).
 */

import { SYNTHETIC_PERSON_LABEL } from "../capture/catalog";

// ---------------------------------------------------------------------------
// Vocabulary: quality states, labels, notes (explicit text, never color).
// ---------------------------------------------------------------------------

/** Human labels for the A31 completion-quality states. */
export const OBSERVATION_QUALITY_LABELS: Readonly<
  Record<string, string>
> = {
  complete: "Complete",
  partial: "Partial",
  "low-quality": "Low quality",
};

/** Teaching notes per quality state (recorded as-is, never upgraded). */
export const OBSERVATION_QUALITY_NOTES: Readonly<Record<string, string>> = {
  complete: "Self-assessed as fully usable — everything the method typically delivers.",
  partial: "Self-assessed as partially usable — recorded as partial, never upgraded.",
  "low-quality":
    "Self-assessed as barely usable — recorded as low quality, never upgraded.",
};

/** Evidence-state labels (the measured-vs-estimated teaching states). */
export const OBSERVATION_EVIDENCE_STATE_LABELS: Readonly<
  Record<string, string>
> = {
  measured: "Measured",
  estimated: "Estimated",
  imported: "Imported",
  derived: "Derived",
};

/** Teaching copy per evidence state (§Provenance UX: teach the difference). */
export const OBSERVATION_EVIDENCE_STATE_NOTES: Readonly<Record<string, string>> = {
  measured:
    "Measured — a device or direct reading produced this value. It is not an estimate.",
  estimated:
    "Estimated — this value was derived from a recollection or an image, not measured directly. 'Estimated' and 'measured' are different states; the provenance keeps that distinction.",
  imported:
    "Imported — synced from an external source (a registered device or app) with its own raw sample retained as evidence.",
  derived:
    "Derived — computed from other recorded values (a series summary, a calculation), not a direct reading.",
};

/** The registered device adapter (the SYNTH wearable). */
export const OBSERVATION_DEVICE_SOURCE = {
  sourceId: "src_SYNTH-source-device-a",
  sourceLabel: "SYNTH-Device-A (registered wearable)",
  actorId: "dev_SYNTH-Device-A",
  actorLabel: "SYNTH-Device-A (automatic sync)",
} as const;

/** The registered manual source (M4-B capture catalog vocabulary). */
export const OBSERVATION_MANUAL_SOURCE = {
  sourceId: "src_SYNTH-source-manual",
  sourceLabel: "Manual entry (this device)",
  actorId: "prsn_SYNTH-person-0001",
  actorLabel: SYNTHETIC_PERSON_LABEL,
} as const;

/** The synthesized-fixture source (the M3-B corpus stand-in). */
export const OBSERVATION_SYNTHESIZED_SOURCE = {
  sourceId: "src_SYNTH-source-fixture",
  sourceLabel: "Synthesized fixture (SYNTH corpus)",
  actorId: "prsn_SYNTH-person-0001",
  actorLabel: "SYNTH-Person-1 (synthesized corpus fixture)",
} as const;

// ---------------------------------------------------------------------------
// Transformation vocabulary (real seams, SYNTH-marked ids).
// ---------------------------------------------------------------------------

/**
 * The unit-normalization transformation applied at the M4-C device-adapter
 * seam: the wearable's raw export reports instantaneous rate in beats per
 * SECOND; the adapter normalizes to the metric's canonical unit (beats/min)
 * before recording. A REAL normalization seam — the recorded value is the
 * normalized one, and the provenance chain shows the step.
 */
export const TRANSFORMATION_UNIT_NORMALIZATION = {
  id: "xf_SYNTH-unit-normalization-hr-0001",
  label: "Unit normalization",
  description:
    "Raw wearable sample 1.03 beats/s → 61.8 beats/min (×60), rounded to the nearest integer (62 beats/min) at the device-adapter seam before recording.",
  seam: "M4-C device-adapter seam",
} as const;

/** Rounding applied by the manual-entry guard (5-minute steps). */
export const TRANSFORMATION_MANUAL_ROUNDING = {
  id: "xf_SYNTH-manual-rounding-sleep-0001",
  label: "Entry-guard rounding",
  description:
    "Typed sleep duration snapped to the manual-entry guard's 5-minute step (the value you typed was adjusted to the nearest valid step before recording).",
  seam: "M4-B manual-entry guard",
} as const;

/** Series-summary derivation for resting values (a DERIVED fixture). */
export const TRANSFORMATION_SERIES_SUMMARY = {
  id: "xf_SYNTH-series-summary-hr-0001",
  label: "Resting-window summary",
  description:
    "The wearable's overnight sample series (10 samples) was summarized into one resting value (the mean of the resting window) — a DERIVED value, not a single direct reading.",
  seam: "Device-side resting analysis",
} as const;

// ---------------------------------------------------------------------------
// Model-version vocabulary (estimated values carry their model versions).
// ---------------------------------------------------------------------------

/** The thermometer-photo estimation model (the ESTIMATED temperature fixture). */
export const OBSERVATION_THERMOMETER_MODEL =
  "SYNTH-ThermoVision v2.1 (thermometer-photo estimation)";

/** No-model marker for direct readings (explicit, never silent). */
export const OBSERVATION_NO_MODEL = "No model involved — direct capture";

// ---------------------------------------------------------------------------
// The synthesized corpus observation fixtures (M3-B events, full chains).
// ---------------------------------------------------------------------------

/** The synthesized corpus observation fixture ids (stable, SYNTH-marked). */
export const CORPUS_OBSERVATION_IDS = {
  restingHeartRate: "obs_SYNTH-corpus-hr-0001",
  bloodPressureManual: "obs_SYNTH-corpus-bp-0002",
  temperatureEstimated: "obs_SYNTH-corpus-temp-0003",
  weightScale: "obs_SYNTH-corpus-wt-0004",
} as const;

/** The seeded manual heart-rate duplicate (journey #2's partner). */
export const SEEDED_MANUAL_HR_OBSERVATION_ID = "obs_SYNTH-seed-hr-manual-0001";

/** The device-import observation id prefix (per-import counter). */
export const DEVICE_IMPORT_OBSERVATION_PREFIX = "obs_SYNTH-import-hr-";

/** The canonical (reconciled) observation id prefix (per-reconciliation). */
export const RECONCILED_OBSERVATION_PREFIX = "obs_SYNTH-recon-hr-";

/** Evidence-record vocabulary for corpus observations (M3-B ids). */
export const OBSERVATION_EVIDENCE_LINKS = {
  restingHeartRate: {
    evidenceId: "SYNTH-EV-0001",
    summary: "Resting heart rate series (the wearable's raw overnight waveform)",
    mediaType: "waveform",
    checksumPrefix: "sha256-SYNTH-7c4a8d09",
    retentionClass: "SYNTH-RT-2Y",
  },
  bloodPressureManual: {
    evidenceId: "SYNTH-EV-0002",
    summary: "Manual blood pressure log page",
    mediaType: "document",
    checksumPrefix: "sha256-SYNTH-1f2e9b04",
    retentionClass: "SYNTH-RT-90D",
  },
  temperatureEstimated: {
    evidenceId: "SYNTH-EV-0003",
    summary: "Thermometer reading photo",
    mediaType: "image",
    checksumPrefix: "sha256-SYNTH-0aa3cd17",
    retentionClass: "SYNTH-RT-90D",
  },
  weightScale: {
    evidenceId: "SYNTH-EV-0005",
    summary: "Weight scale note",
    mediaType: "document",
    checksumPrefix: "sha256-SYNTH-9d1f47be",
    retentionClass: "SYNTH-RT-7Y",
  },
} as const;
