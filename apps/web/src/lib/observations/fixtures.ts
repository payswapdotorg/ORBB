/**
 * Observation + provenance fixtures (M6-B B5, Lane B) — deterministic SYNTH
 * observation fixtures with FULL structured provenance.
 *
 * Agent-protocol test-data rules: zero PHI; every identity-like string is
 * SYNTH-marked; the pinned reference date is 2026-09-10 (the M3-B DataBox
 * convention); no wall-clock values (labels are pre-formatted; ISO
 * timestamps exist only for ordering/filtering against the fixed
 * reference instant).
 *
 * Coverage contract (the packet):
 *   - a MANUAL observation (blood pressure, this morning's plan window,
 *     pending validation — fresh manual captures are never silently
 *     pre-validated);
 *   - a DEVICE-ADAPTER observation (resting heart rate series, IMPORTED,
 *     validated, with a transformation chain — the series reduction);
 *   - an ESTIMATED observation (temperature from a thermometer photo —
 *     the §Provenance UX teaching case: "estimated from an image" is a
 *     different state than "measured", carried by explicit text labels
 *     and an uncertainty sentence + the model version behind the
 *     estimate);
 *   - a manual weight observation backed by a DataBox evidence document;
 *   - the DEVICE-ADAPTER IMPORT fixture (golden journey #2): a second BP
 *     source for the same window, which the store reconciles with the
 *     manual original into ONE canonical view (per-source provenance for
 *     both, verdict honest).
 *
 * The fixtures align with the M3-B DataBox evidence records (SYNTH-EV
 * ids) so the "original evidence" links are real cross-surface
 * references.
 */

import type { ObservationDetailView } from "./types";
import type {
  CaptureObservationDto,
  CaptureRecordDto,
} from "../capture/types";
import { formatCapturedLabel } from "../capture/format";

export const OBSERVATION_REFERENCE_NOW_ISO = "2026-09-10T08:20:00.000Z";

export const OBSERVATION_PERSON_ID = "prsn_SYNTH-person-0001";

/** The window label of the BP plan (the Today fixture's morning window). */
export const BP_WINDOW_LABEL = "Today, 07:00–09:00";

// ---------------------------------------------------------------------------
// The seeded observations.
// ---------------------------------------------------------------------------

const MANUAL_BP_OBSERVATION: ObservationDetailView = {
  id: "obs_SYNTH-obs-bp-manual-0001",
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
  method: {
    id: "SYNTH-method-bpsys-manual",
    label: "Manual entry — home BP cuff reading",
  },
  deviceOrPerson: "Person: You (SYNTH-Person-1) with a home BP cuff",
  time: {
    capturedAtLabel: "Today, 07:42",
    recordedAtLabel: "Today, 07:43",
  },
  quality: { state: "complete", score: 0.9 },
  transformations: [],
  evidence: {
    id: "SYNTH-EV-0002",
    summary: "Manual blood pressure log page",
    mediaTypeLabel: "document",
  },
  capturedAtIso: "2026-09-10T07:42:00.000Z",
};

const DEVICE_HR_OBSERVATION: ObservationDetailView = {
  id: "obs_SYNTH-obs-hr-device-0002",
  metricId: "SYNTH-metric-heart-rate",
  metricLabel: "Heart Rate",
  conceptCode: "SYNTH-8867-4",
  value: 62,
  unit: "beats/min",
  valueLabel: "62 beats/min",
  evidenceLabel: "IMPORTED",
  validationState: "validated",
  capturedBy: "SYNTH device adapter (SYNTH-Wearable-1)",
  sourceKind: "device-adapter",
  method: {
    id: "SYNTH-method-hr-wearable",
    label: "Wearable sync",
  },
  deviceOrPerson: "Device: SYNTH-Wearable-1 (wrist, firmware SYNTH-FW-2.1)",
  time: {
    capturedAtLabel: "Today, 08:06",
    recordedAtLabel: "Today, 08:07",
  },
  quality: { state: "complete", score: 0.92 },
  transformations: [
    {
      id: "SYNTH-transform-series-reduction",
      label: "Series reduction",
      detail:
        "Raw 60-second wrist samples reduced to one resting average by the device adapter (no units changed).",
    },
  ],
  evidence: {
    id: "SYNTH-EV-0001",
    summary: "Resting heart rate series",
    mediaTypeLabel: "waveform",
  },
  capturedAtIso: "2026-09-10T08:06:00.000Z",
};

const ESTIMATED_TEMPERATURE_OBSERVATION: ObservationDetailView = {
  id: "obs_SYNTH-obs-temp-photo-0003",
  metricId: "SYNTH-metric-body-temp",
  metricLabel: "Body Temperature",
  conceptCode: "SYNTH-8310-5",
  value: 36.8,
  unit: "°C",
  valueLabel: "36.8 °C",
  evidenceLabel: "ESTIMATED",
  validationState: "validated",
  capturedBy: "You (SYNTH-Person-1, self-tracking)",
  sourceKind: "manual",
  method: {
    id: "SYNTH-method-temp-photo",
    label: "Photo estimate — thermometer picture",
  },
  deviceOrPerson: "Person: You (SYNTH-Person-1) · estimate model: SYNTH-thermo-estimator v0.3",
  time: {
    capturedAtLabel: "Yesterday, 20:31",
    recordedAtLabel: "Yesterday, 20:32",
  },
  quality: { state: "partial", score: 0.6 },
  transformations: [
    {
      id: "SYNTH-transform-photo-extraction",
      label: "Image extraction",
      detail:
        "The reading was ESTIMATED from a thermometer photo by SYNTH-thermo-estimator v0.3 — not read from the device.",
    },
  ],
  evidence: {
    id: "SYNTH-EV-0003",
    summary: "Thermometer reading photo",
    mediaTypeLabel: "image",
  },
  modelVersion: "SYNTH-thermo-estimator v0.3",
  uncertainty:
    "Estimated from an image — the true reading may differ. This is NOT a direct measurement.",
  capturedAtIso: "2026-09-09T20:31:00.000Z",
};

const MANUAL_WEIGHT_OBSERVATION: ObservationDetailView = {
  id: "obs_SYNTH-obs-weight-manual-0004",
  metricId: "SYNTH-metric-body-weight",
  metricLabel: "Body Weight",
  conceptCode: "SYNTH-29463-7",
  value: 70.5,
  unit: "kg",
  valueLabel: "70.5 kg",
  evidenceLabel: "MEASURED",
  validationState: "validated",
  capturedBy: "You (SYNTH-Person-1, self-tracking)",
  sourceKind: "manual",
  method: {
    id: "SYNTH-method-wt-manual",
    label: "Manual entry — scale reading",
  },
  deviceOrPerson: "Person: You (SYNTH-Person-1) with a bathroom scale",
  time: {
    capturedAtLabel: "Sep 8, 18:41",
    recordedAtLabel: "Sep 8, 18:42",
  },
  quality: { state: "complete", score: 0.85 },
  transformations: [],
  evidence: {
    id: "SYNTH-EV-0005",
    summary: "Weight scale note",
    mediaTypeLabel: "document",
  },
  capturedAtIso: "2026-09-08T18:41:00.000Z",
};

/** The seeded observation set (deterministic order — most recent first). */
export const SEEDED_OBSERVATIONS: readonly ObservationDetailView[] = [
  DEVICE_HR_OBSERVATION,
  MANUAL_BP_OBSERVATION,
  ESTIMATED_TEMPERATURE_OBSERVATION,
  MANUAL_WEIGHT_OBSERVATION,
];

// ---------------------------------------------------------------------------
// The device-adapter import fixture (golden journey #2).
// ---------------------------------------------------------------------------

/**
 * The SYNTH device-adapter BP import: a second source for the SAME metric
 * and window as the manual BP observation above. Importing it triggers the
 * reconciliation (the store runs the pure mirror) — quality 0.95 ranks
 * above the manual 0.9, so the device reading becomes the canonical value
 * and the manual original is superseded with provenance intact. The values
 * differ (118 vs 120 mmHg) so the verdict is honest: DISCORDANT.
 */
export const DEVICE_BP_IMPORT_OBSERVATION: ObservationDetailView = {
  id: "obs_SYNTH-obs-bp-device-0005",
  metricId: "SYNTH-metric-bp-systolic",
  metricLabel: "Blood Pressure Systolic",
  conceptCode: "SYNTH-8480-5",
  value: 120,
  unit: "mmHg",
  valueLabel: "120 mmHg",
  evidenceLabel: "IMPORTED",
  validationState: "validated",
  capturedBy: "SYNTH device adapter (SYNTH-BP-Monitor-1)",
  sourceKind: "device-adapter",
  method: {
    id: "SYNTH-method-cuff-bp-panel",
    label: "Automatic cuff sync",
  },
  deviceOrPerson: "Device: SYNTH-BP-Monitor-1 (upper arm, firmware SYNTH-FW-1.4)",
  time: {
    capturedAtLabel: "Today, 08:02",
    recordedAtLabel: "Today, 08:20",
  },
  quality: { state: "complete", score: 0.95 },
  transformations: [
    {
      id: "SYNTH-transform-unit-normalization",
      label: "Unit normalization",
      detail: "16.0 kPa → 120 mmHg at the device-import seam (the M4-C unit boundary).",
    },
  ],
  evidence: {
    id: "SYNTH-EV-0009",
    summary: "Automatic cuff batch — BP readings (device import)",
    mediaTypeLabel: "waveform",
  },
  capturedAtIso: "2026-09-10T08:02:00.000Z",
};

/** Deterministic labels for the canonical view built by the store. */
export const CANONICAL_BP_VIEW_INPUT = {
  canonicalId: "obs_SYNTH-obs-bp-canonical-0006",
  windowLabel: BP_WINDOW_LABEL,
  reconciledAtLabel: "Today, 08:20",
  reconciliationProvenanceId: "prov_SYNTH-prov-reconciliation-0001",
} as const;

// ---------------------------------------------------------------------------
// The capture-observation adapter (in-session manual captures -> detail view).
// ---------------------------------------------------------------------------

/**
 * Adapts an in-session manual capture observation (the M4-B store record)
 * to the §Provenance UX detail view. Manual captures have no DataBox
 * evidence record yet (the evidence wiring lands at integration — recorded
 * handoff): the view states that honestly instead of faking a link.
 * Pure (takes the formatting `now` as a parameter).
 */
export function observationViewFromCapture(
  observation: CaptureObservationDto,
  record: CaptureRecordDto,
  now: Date,
): ObservationDetailView {
  return {
    id: observation.id,
    metricId: observation.metricId,
    metricLabel: observation.metricLabel,
    conceptCode: observation.conceptCode,
    value: observation.value,
    unit: observation.unit,
    valueLabel: `${observation.value} ${observation.unit}`,
    evidenceLabel: observation.evidenceLabel,
    validationState: observation.validationState,
    capturedBy: "You (SYNTH-Person-1, self-tracking)",
    sourceKind: "manual",
    method: {
      id: observation.methodId,
      label: observation.methodLabel,
    },
    deviceOrPerson: `Person: You (SYNTH-Person-1) · capture ${record.captureId}`,
    time: {
      capturedAtLabel: formatCapturedLabel(new Date(observation.effectiveAt), now),
      recordedAtLabel: formatCapturedLabel(new Date(record.recordedAt), now),
    },
    quality: { state: record.qualityState, score: observation.quality },
    transformations: [],
    capturedAtIso: observation.effectiveAt,
  };
}
