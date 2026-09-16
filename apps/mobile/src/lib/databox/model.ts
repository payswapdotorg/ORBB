/**
 * Mobile DataBox model (M6-B B5/B6, Lane B) — pure data + pure functions.
 *
 * Mirrors the web observation/provenance model (`apps/web/src/lib/
 * observations/**` + `lib/databox/search.ts`): structured provenance for
 * every observation (the §Provenance UX chain), the RECONCILED case
 * (two sources -> one canonical view with per-source provenance — the M4
 * mirror), the §DataBox UX search + the four filters (time, concept,
 * source, confidence/quality), collections, and the capture-observation
 * adapter. Why a local mirror: `apps/mobile` consumes only `@orbb/ui`
 * tokens + the RN stack (the M4-B mobile-mirror discipline; handoff
 * recorded).
 *
 * No React Native imports — plain-node unit-testable.
 */

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

export const EVIDENCE_LABELS = ["MEASURED", "ESTIMATED", "IMPORTED", "DERIVED"] as const;

export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export const SOURCE_KINDS = ["manual", "device-adapter", "synthesized"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Readonly<Record<SourceKind, string>> = {
  manual: "Manual entry",
  "device-adapter": "Device adapter import",
  synthesized: "Synthesized by ORBB",
};

/** The teaching sentences (measured vs estimated are different states). */
export const EVIDENCE_LABEL_SENTENCES: Readonly<Record<EvidenceLabel, string>> = {
  MEASURED: "Measured — read directly from the measuring device or method.",
  ESTIMATED:
    "Estimated — derived from an image or a recollection, not measured directly. It carries uncertainty.",
  IMPORTED: "Imported — captured by a device or app and synced into ORBB.",
  DERIVED: "Derived — computed by ORBB from other observations, with their provenance kept.",
};

// ---------------------------------------------------------------------------
// The observation view (§Provenance UX chain, field for field).
// ---------------------------------------------------------------------------

export interface ProvenanceTransformation {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface ObservationView {
  readonly id: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  readonly value: number;
  readonly unit: string;
  readonly valueLabel: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly validationState: "pending" | "validated" | "superseded";
  /** The §Provenance UX chain fields. */
  readonly capturedBy: string;
  readonly sourceKind: SourceKind;
  readonly method: { readonly id: string; readonly label: string };
  readonly deviceOrPerson: string;
  readonly time: { readonly capturedAtLabel: string; readonly recordedAtLabel: string };
  readonly quality: { readonly state: "complete" | "partial" | "low-quality"; readonly score: number };
  readonly transformations: readonly ProvenanceTransformation[];
  readonly evidenceId?: string;
  readonly evidenceSummary?: string;
  readonly modelVersion?: string;
  readonly uncertainty?: string;
  readonly capturedAtIso: string;
}

// ---------------------------------------------------------------------------
// The RECONCILED case (the M4 canonical-view mirror).
// ---------------------------------------------------------------------------

export type SourceRole = "canonical-source" | "superseded-source";

export interface ReconciledSourceProvenance {
  readonly observationId: string;
  readonly sourceKindLabel: string;
  readonly methodLabel: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly qualityScore: number;
  readonly role: SourceRole;
  readonly valueLabel: string;
  readonly capturedAtLabel: string;
}

export interface CanonicalObservationView {
  readonly id: string;
  readonly metricLabel: string;
  readonly valueLabel: string;
  readonly verdict: "concordant" | "discordant";
  readonly windowLabel: string;
  readonly reconciledAtLabel: string;
  readonly sources: readonly ReconciledSourceProvenance[];
  readonly detail: ObservationView;
}

// ---------------------------------------------------------------------------
// The seeded observations (mirroring the web fixtures).
// ---------------------------------------------------------------------------

export const DATABOX_REFERENCE_NOW_ISO = "2026-09-10T08:20:00.000Z";

const MANUAL_BP: ObservationView = {
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
  time: { capturedAtLabel: "Today, 07:42", recordedAtLabel: "Today, 07:43" },
  quality: { state: "complete", score: 0.9 },
  transformations: [],
  evidenceId: "SYNTH-EV-0002",
  evidenceSummary: "Manual blood pressure log page (document)",
  capturedAtIso: "2026-09-10T07:42:00.000Z",
};

const DEVICE_HR: ObservationView = {
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
  method: { id: "SYNTH-method-hr-wearable", label: "Wearable sync" },
  deviceOrPerson: "Device: SYNTH-Wearable-1 (wrist, firmware SYNTH-FW-2.1)",
  time: { capturedAtLabel: "Today, 08:06", recordedAtLabel: "Today, 08:07" },
  quality: { state: "complete", score: 0.92 },
  transformations: [
    {
      id: "SYNTH-transform-series-reduction",
      label: "Series reduction",
      detail:
        "Raw 60-second wrist samples reduced to one resting average by the device adapter (no units changed).",
    },
  ],
  evidenceId: "SYNTH-EV-0001",
  evidenceSummary: "Resting heart rate series (waveform)",
  capturedAtIso: "2026-09-10T08:06:00.000Z",
};

const ESTIMATED_TEMP: ObservationView = {
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
  deviceOrPerson:
    "Person: You (SYNTH-Person-1) · estimate model: SYNTH-thermo-estimator v0.3",
  time: { capturedAtLabel: "Yesterday, 20:31", recordedAtLabel: "Yesterday, 20:32" },
  quality: { state: "partial", score: 0.6 },
  transformations: [
    {
      id: "SYNTH-transform-photo-extraction",
      label: "Image extraction",
      detail:
        "The reading was ESTIMATED from a thermometer photo by SYNTH-thermo-estimator v0.3 — not read from the device.",
    },
  ],
  evidenceId: "SYNTH-EV-0003",
  evidenceSummary: "Thermometer reading photo (image)",
  modelVersion: "SYNTH-thermo-estimator v0.3",
  uncertainty:
    "Estimated from an image — the true reading may differ. This is NOT a direct measurement.",
  capturedAtIso: "2026-09-09T20:31:00.000Z",
};

const MANUAL_WEIGHT: ObservationView = {
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
  method: { id: "SYNTH-method-wt-manual", label: "Manual entry — scale reading" },
  deviceOrPerson: "Person: You (SYNTH-Person-1) with a bathroom scale",
  time: { capturedAtLabel: "Sep 8, 18:41", recordedAtLabel: "Sep 8, 18:42" },
  quality: { state: "complete", score: 0.85 },
  transformations: [],
  evidenceId: "SYNTH-EV-0005",
  evidenceSummary: "Weight scale note (document)",
  capturedAtIso: "2026-09-08T18:41:00.000Z",
};

export const SEEDED_OBSERVATIONS: readonly ObservationView[] = [
  DEVICE_HR,
  MANUAL_BP,
  ESTIMATED_TEMP,
  MANUAL_WEIGHT,
];

/** The SYNTH device-adapter BP import fixture (golden journey #2). */
export const DEVICE_BP_IMPORT: ObservationView = {
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
  method: { id: "SYNTH-method-cuff-bp-panel", label: "Automatic cuff sync" },
  deviceOrPerson: "Device: SYNTH-BP-Monitor-1 (upper arm, firmware SYNTH-FW-1.4)",
  time: { capturedAtLabel: "Today, 08:02", recordedAtLabel: "Today, 08:20" },
  quality: { state: "complete", score: 0.95 },
  transformations: [
    {
      id: "SYNTH-transform-unit-normalization",
      label: "Unit normalization",
      detail: "16.0 kPa → 120 mmHg at the device-import seam (the M4-C unit boundary).",
    },
  ],
  evidenceId: "SYNTH-EV-0009",
  evidenceSummary: "Automatic cuff batch — BP readings (device import, waveform)",
  capturedAtIso: "2026-09-10T08:02:00.000Z",
};

// ---------------------------------------------------------------------------
// The reconciliation (the M4 ranking/verdict mirror — pure).
// ---------------------------------------------------------------------------

/**
 * Reconciles the manual BP original with the imported device observation:
 * higher domain quality wins (0.95 > 0.9), the loser is superseded with
 * provenance intact, and ONE canonical DERIVED view carries per-source
 * provenance for BOTH originals. Verdict: DISCORDANT (118 vs 120 — flagged,
 * never hidden). Pure.
 */
export function importDeviceObservationForToday(): {
  readonly imported: ObservationView;
  readonly superseded: ObservationView;
  readonly canonical: CanonicalObservationView;
} {
  const imported = { ...DEVICE_BP_IMPORT };
  const superseded = { ...MANUAL_BP, validationState: "superseded" as const };
  const winner = imported;
  const canonicalDetail: ObservationView = {
    id: "obs_SYNTH-obs-bp-canonical-0006",
    metricId: winner.metricId,
    metricLabel: winner.metricLabel,
    conceptCode: winner.conceptCode,
    value: winner.value,
    unit: winner.unit,
    valueLabel: winner.valueLabel,
    evidenceLabel: "DERIVED",
    validationState: "validated",
    capturedBy: "ORBB reconciliation (two sources, one current value)",
    sourceKind: "synthesized",
    method: {
      id: "SYNTH-method-reconciliation",
      label: "Reconciliation of two sources",
    },
    deviceOrPerson:
      "Two sources: Automatic cuff sync and Manual entry — home BP cuff reading",
    time: { capturedAtLabel: winner.time.capturedAtLabel, recordedAtLabel: "Today, 08:20" },
    quality: winner.quality,
    transformations: [
      ...winner.transformations,
      {
        id: "reconciliation-supersession",
        label: "Reconciliation",
        detail:
          "Two observations of the same metric in one window reconciled into one current value; the superseded source keeps its provenance (verdict: discordant).",
      },
    ],
    ...(winner.evidenceId !== undefined ? { evidenceId: winner.evidenceId } : {}),
    ...(winner.evidenceSummary !== undefined
      ? { evidenceSummary: winner.evidenceSummary }
      : {}),
    uncertainty:
      "The two sources disagreed — the current value is the higher-quality source's reading, and the divergence is flagged, not hidden.",
    capturedAtIso: winner.capturedAtIso,
  };
  return {
    imported,
    superseded,
    canonical: {
      id: canonicalDetail.id,
      metricLabel: winner.metricLabel,
      valueLabel: winner.valueLabel,
      verdict: "discordant",
      windowLabel: "Today, 07:00–09:00",
      reconciledAtLabel: "Today, 08:20",
      sources: [
        {
          observationId: imported.id,
          sourceKindLabel: SOURCE_KIND_LABELS[imported.sourceKind],
          methodLabel: imported.method.label,
          evidenceLabel: imported.evidenceLabel,
          qualityScore: imported.quality.score,
          role: "canonical-source",
          valueLabel: imported.valueLabel,
          capturedAtLabel: imported.time.capturedAtLabel,
        },
        {
          observationId: superseded.id,
          sourceKindLabel: SOURCE_KIND_LABELS[superseded.sourceKind],
          methodLabel: superseded.method.label,
          evidenceLabel: superseded.evidenceLabel,
          qualityScore: superseded.quality.score,
          role: "superseded-source",
          valueLabel: superseded.valueLabel,
          capturedAtLabel: superseded.time.capturedAtLabel,
        },
      ],
      detail: canonicalDetail,
    },
  };
}

// ---------------------------------------------------------------------------
// Search + the four §DataBox UX filters (pure).
// ---------------------------------------------------------------------------

export const TIME_FILTERS = ["all", "today", "last-7-days"] as const;

export type TimeFilter = (typeof TIME_FILTERS)[number];

export const TIME_FILTER_LABELS: Readonly<Record<TimeFilter, string>> = {
  all: "All time",
  today: "Today (Sep 10)",
  "last-7-days": "Last 7 days",
};

export const QUALITY_FILTERS = ["all", "complete", "partial", "low-quality"] as const;

export type QualityFilter = (typeof QUALITY_FILTERS)[number];

export const QUALITY_FILTER_LABELS: Readonly<Record<QualityFilter, string>> = {
  all: "Any quality",
  complete: "Complete",
  partial: "Partial",
  "low-quality": "Low quality",
};

export interface DataboxFilters {
  readonly search: string;
  readonly time: TimeFilter;
  readonly concept: string;
  readonly source: string;
  readonly quality: QualityFilter;
}

export const EMPTY_FILTERS: DataboxFilters = {
  search: "",
  time: "all",
  concept: "all",
  source: "all",
  quality: "all",
};

function matchesTime(observation: ObservationView, time: TimeFilter): boolean {
  if (time === "all") {
    return true;
  }
  const day = observation.capturedAtIso.slice(0, 10);
  if (time === "today") {
    return day === DATABOX_REFERENCE_NOW_ISO.slice(0, 10);
  }
  const capturedMs = new Date(observation.capturedAtIso).getTime();
  const referenceMs = new Date(DATABOX_REFERENCE_NOW_ISO).getTime();
  return capturedMs >= referenceMs - 7 * 24 * 60 * 60 * 1000 && capturedMs <= referenceMs;
}

function matchesSearch(observation: ObservationView, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  const haystack = [
    observation.id,
    observation.metricLabel,
    observation.valueLabel,
    observation.method.label,
    observation.capturedBy,
    observation.evidenceLabel,
    observation.evidenceId ?? "",
    observation.modelVersion ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

/** Applies search + the four filters (pure; order preserved). */
export function filterObservations(
  observations: readonly ObservationView[],
  filters: DataboxFilters,
): readonly ObservationView[] {
  return observations.filter(
    (observation) =>
      matchesSearch(observation, filters.search) &&
      matchesTime(observation, filters.time) &&
      (filters.concept === "all" || observation.metricId === filters.concept) &&
      (filters.source === "all" || observation.sourceKind === filters.source) &&
      (filters.quality === "all" || observation.quality.state === filters.quality),
  );
}

/** One collection (concept grouping of the filtered set). */
export interface ObservationCollection {
  readonly metricId: string;
  readonly metricLabel: string;
  readonly count: number;
}

export function deriveCollections(
  observations: readonly ObservationView[],
): readonly ObservationCollection[] {
  const order: string[] = [];
  const counts = new Map<string, { label: string; count: number }>();
  for (const observation of observations) {
    const existing = counts.get(observation.metricId);
    if (existing === undefined) {
      counts.set(observation.metricId, { label: observation.metricLabel, count: 1 });
      order.push(observation.metricId);
      continue;
    }
    existing.count += 1;
  }
  return order.map((metricId) => {
    const entry = counts.get(metricId)!;
    return { metricId, metricLabel: entry.label, count: entry.count };
  });
}

// ---------------------------------------------------------------------------
// The capture-observation adapter (in-session manual captures).
// ---------------------------------------------------------------------------

import {
  formatCapturedLabel,
  type MobileCaptureObservation,
  type MobileCaptureRecord,
} from "../capture/model";

/**
 * Adapts an in-session manual capture observation to the §Provenance UX
 * view. Manual captures have no DataBox evidence record yet (the evidence
 * wiring lands at integration — handoff recorded; stated honestly).
 * Pure.
 */
export function observationViewFromMobileCapture(
  observation: MobileCaptureObservation,
  record: MobileCaptureRecord,
  now: Date,
): ObservationView {
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
      label: `Method actually used: ${observation.methodId}`,
    },
    deviceOrPerson: `Person: You (SYNTH-Person-1) · capture ${record.recordId}`,
    time: {
      capturedAtLabel: formatCapturedLabel(new Date(observation.effectiveAt), now),
      recordedAtLabel: formatCapturedLabel(new Date(record.recordedAt), now),
    },
    quality: { state: record.qualityState, score: observation.quality },
    transformations: [],
    capturedAtIso: observation.effectiveAt,
  };
}
