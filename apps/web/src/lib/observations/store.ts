/**
 * In-memory observation/provenance store (M6-B B5, Lane B): process-local
 * module state backing the `/api/observations` route stub.
 *
 * CONTENT MODEL — every observation, whatever its source, resolves to ONE
 * `ObservationDetailView` carrying the full §Provenance UX chain:
 *   1. SYNTHESIZED corpus fixtures (the M3-B DataBox observation events,
 *      now with structured provenance + evidence links into the pinned
 *      DataBox corpus);
 *   2. a SEEDED MANUAL duplicate (resting heart rate, earlier today — the
 *      partner golden journey #2 reconciles against);
 *   3. LIVE manual captures (read from the M4-B capture store — every
 *      observation of every capture act, provenance actor = the person);
 *   4. DEVICE IMPORTS (the SYNTH device-adapter fixture: SYNTH-Device-A's
 *      latest resting-heart-rate sample, IMPORTED with the unit-
 *      normalization transformation at the M4-C seam);
 *   5. RECONCILED canonical views (the M4 `CanonicalObservationView`
 *      mirror — two same-metric sources in one window reconcile into ONE
 *      canonical value with PER-SOURCE provenance records; nothing is
 *      discarded: the loser moves to the terminal `superseded` validation
 *      state with provenance intact, exactly the domain semantics).
 *
 * RECONCILIATION MIRROR (frozen M4 semantics, mirrored field-by-field):
 *   - ranking: quality score DESC, then preferred-method order (the
 *     policy's manual-first preference list is empty here — quality
 *     decides), then later observedAt, then id ASC;
 *   - verdict: `concordant` under the agreement policy (default EXACT
 *     equality — no clinical tolerances are invented), else `discordant`;
 *   - discordance never blocks reconciliation — the higher-ranked value
 *     becomes canonical and the verdict flags the divergence;
 *   - idempotency: one reconciliation per (metric, window) — a second
 *     import into an already-reconciled window honestly reports "already
 *     reconciled" instead of re-reconciling.
 *
 * TIME MODEL: corpus fixtures stay pinned to the SYNTH reference date
 * (2026-09-10) so their labels are byte-stable; the seeded duplicate and
 * imports live in the REAL session clock (like the M4-B capture store).
 */

import { formatCapturedLabel } from "../capture/format";
import { SYNTHETIC_PERSON_ID, findCaptureShape } from "../capture/catalog";
import { listRecentCaptures } from "../capture/store";
import {
  CORPUS_OBSERVATION_IDS,
  DEVICE_IMPORT_OBSERVATION_PREFIX,
  OBSERVATION_DEVICE_SOURCE,
  OBSERVATION_EVIDENCE_LINKS,
  OBSERVATION_EVIDENCE_STATE_LABELS,
  OBSERVATION_EVIDENCE_STATE_NOTES,
  OBSERVATION_MANUAL_SOURCE,
  OBSERVATION_NO_MODEL,
  OBSERVATION_QUALITY_LABELS,
  OBSERVATION_QUALITY_NOTES,
  OBSERVATION_SYNTHESIZED_SOURCE,
  OBSERVATION_THERMOMETER_MODEL,
  RECONCILED_OBSERVATION_PREFIX,
  SEEDED_MANUAL_HR_OBSERVATION_ID,
  TRANSFORMATION_MANUAL_ROUNDING,
  TRANSFORMATION_SERIES_SUMMARY,
  TRANSFORMATION_UNIT_NORMALIZATION,
} from "./catalog";
import type { CaptureObservationDto, CaptureRecordDto } from "../capture/types";
import type {
  ObservationDetailView,
  ObservationSourceProvenanceView,
  ObservationSummaryView,
  ReconciledObservationView,
} from "./types";

// ---------------------------------------------------------------------------
// Module state (process-local).
// ---------------------------------------------------------------------------

interface StoredObservation {
  readonly detail: ObservationDetailView;
}

const observationsById = new Map<string, StoredObservation>();
const reconciledViews: ReconciledObservationView[] = [];

/** Reconciliation bookkeeping: window-start ISO -> reconciled view. */
const reconciledWindowStarts = new Set<string>();

let importCounter = 0;
let reconciledCounter = 0;
let provenanceCounter = 0;

let seeded = false;

/** Local start-of-day helper (the reconciliation window anchor). */
function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

/** Local end-of-day (exclusive). */
function endOfDay(at: Date): Date {
  return new Date(startOfDay(at).getTime() + 24 * 60 * 60 * 1000);
}

function nextImportObservationId(): string {
  importCounter += 1;
  return `${DEVICE_IMPORT_OBSERVATION_PREFIX}${String(importCounter).padStart(6, "0")}`;
}

function nextReconciledObservationId(): string {
  reconciledCounter += 1;
  return `${RECONCILED_OBSERVATION_PREFIX}${String(reconciledCounter).padStart(6, "0")}`;
}

function nextProvenanceId(): string {
  provenanceCounter += 1;
  return `prov_SYNTH-obs-store-${String(provenanceCounter).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Deterministic seed (corpus fixtures + the manual duplicate).
// ---------------------------------------------------------------------------

/**
 * Seeds the corpus fixtures + the manual duplicate. `now` anchors the
 * session-world fixtures (the manual duplicate stays inside today and
 * never in the future — early-hours sessions see an early-morning instant).
 */
function seedObservations(now: Date): void {
  if (seeded) {
    return;
  }
  seeded = true;

  const todayStart = startOfDay(now).getTime();
  const pinnedTime = (label: string): string => label;

  // -- 1. Corpus fixture: resting heart rate (wearable sync, DERIVED from
  //    the overnight series; validated; evidence = the raw waveform).
  observationsById.set(CORPUS_OBSERVATION_IDS.restingHeartRate, {
    detail: {
      observationId: CORPUS_OBSERVATION_IDS.restingHeartRate,
      personId: SYNTHETIC_PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      metricLabel: "Heart Rate",
      conceptCode: "SYNTH-8867-4",
      value: 62,
      unit: "beats/min",
      valueLabel: "62 beats/min",
      capturedBy: {
        kind: "synthesized",
        actorLabel: OBSERVATION_SYNTHESIZED_SOURCE.actorLabel,
        actorId: OBSERVATION_SYNTHESIZED_SOURCE.actorId,
        sourceId: OBSERVATION_SYNTHESIZED_SOURCE.sourceId,
        sourceLabel: OBSERVATION_SYNTHESIZED_SOURCE.sourceLabel,
      },
      method: {
        methodId: "SYNTH-method-wearable-heart-rate",
        methodLabel: "Wearable sync — resting pulse",
        kind: "device",
      },
      deviceOrPerson: "SYNTH-Device-A (registered wearable)",
      time: {
        effectiveAt: "2026-09-10T08:06:00.000Z",
        observedAt: "2026-09-10T08:06:00.000Z",
        effectiveLabel: pinnedTime("Sep 10 (reference), 08:06"),
        observedLabel: pinnedTime("Sep 10 (reference), 08:06"),
      },
      quality: {
        state: "complete",
        score: 0.9,
        stateLabel: OBSERVATION_QUALITY_LABELS.complete ?? "Complete",
        note: "Device-typical quality for a full resting window (0.9 of 1.0).",
      },
      validation: {
        state: "validated",
        note: "Validated — the resting-window summary passed the device-side checks.",
      },
      evidenceLabel: "DERIVED",
      evidenceState: "derived",
      evidenceStateNote: OBSERVATION_EVIDENCE_STATE_NOTES.derived ?? "",
      transformations: [
        {
          ...TRANSFORMATION_SERIES_SUMMARY,
          appliedAt: "2026-09-10T08:06:00.000Z",
        },
      ],
      evidence: {
        ...OBSERVATION_EVIDENCE_LINKS.restingHeartRate,
        location: "databox-corpus",
      },
      modelVersion: "SYNTH-RestWindow v4 (device-side resting analysis)",
    },
  });

  // -- 2. Corpus fixture: manual blood pressure log (MEASURED; pending
  //    validation; evidence = the scanned log page).
  observationsById.set(CORPUS_OBSERVATION_IDS.bloodPressureManual, {
    detail: {
      observationId: CORPUS_OBSERVATION_IDS.bloodPressureManual,
      personId: SYNTHETIC_PERSON_ID,
      metricId: "SYNTH-metric-bp-systolic",
      metricLabel: "Blood Pressure Systolic",
      conceptCode: "SYNTH-8480-5",
      value: 124,
      unit: "mmHg",
      valueLabel: "124 mmHg (systolic, with 78 mmHg diastolic)",
      capturedBy: {
        kind: "synthesized",
        actorLabel: OBSERVATION_SYNTHESIZED_SOURCE.actorLabel,
        actorId: OBSERVATION_SYNTHESIZED_SOURCE.actorId,
        sourceId: OBSERVATION_SYNTHESIZED_SOURCE.sourceId,
        sourceLabel: OBSERVATION_SYNTHESIZED_SOURCE.sourceLabel,
      },
      method: {
        methodId: "SYNTH-method-bpsys-manual",
        methodLabel: "Manual entry — home BP cuff reading · Systolic",
        kind: "manual",
      },
      deviceOrPerson: "You (SYNTH-Person-1, self-tracking)",
      time: {
        effectiveAt: "2026-09-10T07:42:00.000Z",
        observedAt: "2026-09-10T07:42:00.000Z",
        effectiveLabel: pinnedTime("Sep 10 (reference), 07:42"),
        observedLabel: pinnedTime("Sep 10 (reference), 07:42"),
      },
      quality: {
        state: "partial",
        score: 0.7,
        stateLabel: OBSERVATION_QUALITY_LABELS.partial ?? "Partial",
        note: OBSERVATION_QUALITY_NOTES.partial ?? "",
      },
      validation: {
        state: "pending",
        note: "Pending — a fresh manual capture awaits the validation layer.",
      },
      evidenceLabel: "MEASURED",
      evidenceState: "measured",
      evidenceStateNote: OBSERVATION_EVIDENCE_STATE_NOTES.measured ?? "",
      transformations: [],
      evidence: {
        ...OBSERVATION_EVIDENCE_LINKS.bloodPressureManual,
        location: "databox-corpus",
      },
      modelVersion: OBSERVATION_NO_MODEL,
    },
  });

  // -- 3. Corpus fixture: temperature ESTIMATED from a thermometer photo
  //    (the measured-vs-estimated teaching case; model version carried).
  observationsById.set(CORPUS_OBSERVATION_IDS.temperatureEstimated, {
    detail: {
      observationId: CORPUS_OBSERVATION_IDS.temperatureEstimated,
      personId: SYNTHETIC_PERSON_ID,
      metricId: "SYNTH-metric-body-temperature",
      metricLabel: "Body Temperature",
      conceptCode: "SYNTH-8310-5",
      value: 36.8,
      unit: "°C",
      valueLabel: "36.8 °C (estimated from an image)",
      capturedBy: {
        kind: "synthesized",
        actorLabel: OBSERVATION_SYNTHESIZED_SOURCE.actorLabel,
        actorId: OBSERVATION_SYNTHESIZED_SOURCE.actorId,
        sourceId: OBSERVATION_SYNTHESIZED_SOURCE.sourceId,
        sourceLabel: OBSERVATION_SYNTHESIZED_SOURCE.sourceLabel,
      },
      method: {
        methodId: "SYNTH-method-temp-photo-estimate",
        methodLabel: "Thermometer photo estimate",
        kind: "app",
      },
      deviceOrPerson: "SYNTH-ThermoVision v2.1 (estimation model) over your photo",
      time: {
        effectiveAt: "2026-09-09T20:31:00.000Z",
        observedAt: "2026-09-09T20:31:00.000Z",
        effectiveLabel: pinnedTime("Sep 9 (reference), 20:31"),
        observedLabel: pinnedTime("Sep 9 (reference), 20:31"),
      },
      quality: {
        state: "partial",
        score: 0.6,
        stateLabel: OBSERVATION_QUALITY_LABELS.partial ?? "Partial",
        note: "Estimation-typical quality (0.6 of 1.0) — an estimate, never a measurement.",
      },
      validation: {
        state: "validated",
        note: "Validated — the photo passed the readability checks; the ESTIMATE label stays.",
      },
      evidenceLabel: "ESTIMATED",
      evidenceState: "estimated",
      evidenceStateNote: OBSERVATION_EVIDENCE_STATE_NOTES.estimated ?? "",
      transformations: [
        {
          id: "xf_SYNTH-temp-photo-estimate-0001",
          label: "Image estimation",
          description:
            "The thermometer reading in the photo was estimated by the SYNTH-ThermoVision model (v2.1) — the value is an ESTIMATE derived from an image, not a direct measurement.",
          appliedAt: "2026-09-09T20:31:00.000Z",
          seam: "M9 extension sandbox (estimation seam)",
        },
      ],
      evidence: {
        ...OBSERVATION_EVIDENCE_LINKS.temperatureEstimated,
        location: "databox-corpus",
      },
      modelVersion: OBSERVATION_THERMOMETER_MODEL,
    },
  });

  // -- 4. Corpus fixture: body weight (scale sync, MEASURED, validated).
  observationsById.set(CORPUS_OBSERVATION_IDS.weightScale, {
    detail: {
      observationId: CORPUS_OBSERVATION_IDS.weightScale,
      personId: SYNTHETIC_PERSON_ID,
      metricId: "SYNTH-metric-body-weight",
      metricLabel: "Body Weight",
      conceptCode: "SYNTH-29463-7",
      value: 70.5,
      unit: "kg",
      valueLabel: "70.5 kg",
      capturedBy: {
        kind: "synthesized",
        actorLabel: OBSERVATION_SYNTHESIZED_SOURCE.actorLabel,
        actorId: OBSERVATION_SYNTHESIZED_SOURCE.actorId,
        sourceId: OBSERVATION_SYNTHESIZED_SOURCE.sourceId,
        sourceLabel: OBSERVATION_SYNTHESIZED_SOURCE.sourceLabel,
      },
      method: {
        methodId: "SYNTH-method-wt-scale",
        methodLabel: "Scale sync",
        kind: "device",
      },
      deviceOrPerson: "SYNTH-Scale-B (connected scale)",
      time: {
        effectiveAt: "2026-09-08T18:41:00.000Z",
        observedAt: "2026-09-08T18:41:00.000Z",
        effectiveLabel: pinnedTime("Sep 8 (reference), 18:41"),
        observedLabel: pinnedTime("Sep 8 (reference), 18:41"),
      },
      quality: {
        state: "complete",
        score: 0.9,
        stateLabel: OBSERVATION_QUALITY_LABELS.complete ?? "Complete",
        note: "Device-typical quality for a direct scale reading (0.9 of 1.0).",
      },
      validation: {
        state: "validated",
        note: "Validated — the scale's direct reading required no review.",
      },
      evidenceLabel: "MEASURED",
      evidenceState: "measured",
      evidenceStateNote: OBSERVATION_EVIDENCE_STATE_NOTES.measured ?? "",
      transformations: [
        {
          id: "xf_SYNTH-scale-unit-0001",
          label: "Unit normalization",
          description:
            "Raw scale export 155.6 lb → 70.5 kg (×0.45359237, rounded to 0.1 kg) at the device-adapter seam before recording.",
          appliedAt: "2026-09-08T18:41:00.000Z",
          seam: "M4-C device-adapter seam",
        },
      ],
      evidence: {
        ...OBSERVATION_EVIDENCE_LINKS.weightScale,
        location: "databox-corpus",
      },
      modelVersion: OBSERVATION_NO_MODEL,
    },
  });

  // -- 5. The SEEDED MANUAL duplicate: resting heart rate, earlier today
  //    (session world). Journey #2's device import reconciles against it.
  const manualEffectiveAt = new Date(
    Math.max(
      todayStart + 60 * 1000,
      Math.min(todayStart + 8 * 60 * 60 * 1000 + 5 * 60 * 1000, now.getTime() - 60 * 1000),
    ),
  );
  observationsById.set(SEEDED_MANUAL_HR_OBSERVATION_ID, {
    detail: {
      observationId: SEEDED_MANUAL_HR_OBSERVATION_ID,
      personId: SYNTHETIC_PERSON_ID,
      metricId: "SYNTH-metric-heart-rate",
      metricLabel: "Heart Rate",
      conceptCode: "SYNTH-8867-4",
      value: 64,
      unit: "beats/min",
      valueLabel: "64 beats/min",
      capturedBy: {
        kind: "manual",
        actorLabel: OBSERVATION_MANUAL_SOURCE.actorLabel,
        actorId: OBSERVATION_MANUAL_SOURCE.actorId,
        sourceId: OBSERVATION_MANUAL_SOURCE.sourceId,
        sourceLabel: OBSERVATION_MANUAL_SOURCE.sourceLabel,
      },
      method: {
        methodId: "SYNTH-method-hr-manual",
        methodLabel: "Manual pulse check",
        kind: "manual",
      },
      deviceOrPerson: "You (SYNTH-Person-1, self-tracking)",
      time: {
        effectiveAt: manualEffectiveAt.toISOString(),
        observedAt: manualEffectiveAt.toISOString(),
        effectiveLabel: formatCapturedLabel(manualEffectiveAt, now),
        observedLabel: formatCapturedLabel(manualEffectiveAt, now),
      },
      quality: {
        state: "partial",
        score: 0.7,
        stateLabel: OBSERVATION_QUALITY_LABELS.partial ?? "Partial",
        note: OBSERVATION_QUALITY_NOTES.partial ?? "",
      },
      validation: {
        state: "pending",
        note: "Pending — a fresh manual capture awaits the validation layer.",
      },
      evidenceLabel: "MEASURED",
      evidenceState: "measured",
      evidenceStateNote: OBSERVATION_EVIDENCE_STATE_NOTES.measured ?? "",
      transformations: [],
      evidence: null,
      modelVersion: OBSERVATION_NO_MODEL,
    },
  });
}

// ---------------------------------------------------------------------------
// Live manual captures -> observation details (read through the M4-B store).
// ---------------------------------------------------------------------------

/** Projects one capture observation into a provenance detail view. */
function captureObservationDetail(
  observation: CaptureObservationDto,
  record: CaptureRecordDto,
  now: Date,
): ObservationDetailView {
  return {
    observationId: observation.id,
    personId: observation.personId,
    metricId: observation.metricId,
    metricLabel: observation.metricLabel,
    conceptCode: observation.conceptCode,
    value: observation.value,
    unit: observation.unit,
    valueLabel: `${observation.value} ${observation.unit}`,
    capturedBy: {
      kind: "manual",
      actorLabel: OBSERVATION_MANUAL_SOURCE.actorLabel,
      actorId: observation.provenance.actor,
      sourceId: observation.sourceId,
      sourceLabel: OBSERVATION_MANUAL_SOURCE.sourceLabel,
    },
    method: {
      methodId: observation.methodId,
      methodLabel: observation.methodLabel,
      kind: "manual",
    },
    deviceOrPerson: "You (SYNTH-Person-1, self-tracking)",
    time: {
      effectiveAt: observation.effectiveAt,
      observedAt: observation.observedAt,
      effectiveLabel: formatCapturedLabel(new Date(observation.effectiveAt), now),
      observedLabel: formatCapturedLabel(new Date(observation.observedAt), now),
    },
    quality: {
      state: record.qualityState,
      score: observation.quality,
      stateLabel: OBSERVATION_QUALITY_LABELS[record.qualityState] ?? record.qualityState,
      note: OBSERVATION_QUALITY_NOTES[record.qualityState] ?? "",
    },
    validation: {
      state: "pending",
      note: "Pending — a fresh manual capture awaits the validation layer.",
    },
    evidenceLabel: observation.evidenceLabel,
    evidenceState: evidenceStateOf(observation.evidenceLabel),
    evidenceStateNote:
      OBSERVATION_EVIDENCE_STATE_NOTES[evidenceStateOf(observation.evidenceLabel)] ?? "",
    transformations:
      record.shapeId === "SYNTH-shape-sleep-minutes" || record.shapeId === "SYNTH-shape-step-count"
        ? [
            {
              ...TRANSFORMATION_MANUAL_ROUNDING,
              appliedAt: observation.observedAt,
            },
          ]
        : [],
    evidence: null,
    modelVersion: OBSERVATION_NO_MODEL,
  };
}

/** Maps a domain evidence label onto the teaching state. */
function evidenceStateOf(label: string): "measured" | "estimated" | "imported" | "derived" {
  switch (label) {
    case "MEASURED":
      return "measured";
    case "ESTIMATED":
      return "estimated";
    case "IMPORTED":
      return "imported";
    default:
      return "derived";
  }
}

// ---------------------------------------------------------------------------
// Device import (golden journey #2) + the reconciliation mirror.
// ---------------------------------------------------------------------------

/** The device-adapter sample fixture values (SYNTH-Device-A, heart rate). */
const DEVICE_SAMPLE = {
  /** The wearable's raw instantaneous rate (beats per SECOND). */
  rawBeatsPerSecond: 1.03,
  /** The normalized value the adapter records (beats/min). */
  normalizedBeatsPerMinute: 62,
  /** Typical device quality score. */
  qualityScore: 0.92,
} as const;

/** The import evidence record (session-retained; SYNTH-marked). */
const IMPORT_EVIDENCE = {
  evidenceId: "SYNTH-EV-IMPORT-0001",
  summary: "Resting heart rate raw sample batch (SYNTH-Device-A export)",
  mediaType: "waveform" as const,
  checksumPrefix: "sha256-SYNTH-3f9a61c2",
  retentionClass: "SYNTH-RT-2Y",
};

/** Typed import/reconciliation rejections (PHID-safe). */
export type ObservationImportError =
  | { readonly kind: "already-imported" };

/**
 * Imports the wearable's latest resting-heart-rate sample through the SYNTH
 * device-adapter fixture and reconciles duplicate sources in today's window.
 *
 * `observedAt` = the import moment (real clock); `effectiveAt` = the
 * wearable's own sample clock (5 minutes before the import) — the domain
 * semantics: the clinically relevant time is the DEVICE's, not the import's.
 */
export function importDeviceObservation(
  now: Date,
): {
  ok: true;
  observation: ObservationDetailView;
  reconciled: ReconciledObservationView | null;
  reconciliationNote: string;
} | { ok: false; error: ObservationImportError } {
  seedObservations(now);

  const observationId = nextImportObservationId();
  const effectiveAt = new Date(now.getTime() - 5 * 60 * 1000);
  const observation: ObservationDetailView = {
    observationId,
    personId: SYNTHETIC_PERSON_ID,
    metricId: "SYNTH-metric-heart-rate",
    metricLabel: "Heart Rate",
    conceptCode: "SYNTH-8867-4",
    value: DEVICE_SAMPLE.normalizedBeatsPerMinute,
    unit: "beats/min",
    valueLabel: `${DEVICE_SAMPLE.normalizedBeatsPerMinute} beats/min`,
    capturedBy: {
      kind: "device-adapter",
      actorLabel: OBSERVATION_DEVICE_SOURCE.actorLabel,
      actorId: OBSERVATION_DEVICE_SOURCE.actorId,
      sourceId: OBSERVATION_DEVICE_SOURCE.sourceId,
      sourceLabel: OBSERVATION_DEVICE_SOURCE.sourceLabel,
    },
    method: {
      methodId: "SYNTH-method-wearable-heart-rate",
      methodLabel: "Wearable sync — resting pulse",
      kind: "device",
    },
    deviceOrPerson: "SYNTH-Device-A (registered wearable)",
    time: {
      effectiveAt: effectiveAt.toISOString(),
      observedAt: now.toISOString(),
      effectiveLabel: formatCapturedLabel(effectiveAt, now),
      observedLabel: formatCapturedLabel(now, now),
    },
    quality: {
      state: "complete",
      score: DEVICE_SAMPLE.qualityScore,
      stateLabel: OBSERVATION_QUALITY_LABELS.complete ?? "Complete",
      note: "Device-typical quality for a direct wearable sample (0.92 of 1.0).",
    },
    validation: {
      state: "pending",
      note: "Pending — the import awaits the validation layer.",
    },
    evidenceLabel: "IMPORTED",
    evidenceState: "imported",
    evidenceStateNote: OBSERVATION_EVIDENCE_STATE_NOTES.imported ?? "",
    transformations: [
      {
        ...TRANSFORMATION_UNIT_NORMALIZATION,
        appliedAt: now.toISOString(),
      },
    ],
    evidence: {
      ...IMPORT_EVIDENCE,
      location: "session",
    },
    modelVersion: OBSERVATION_NO_MODEL,
  };

  // Reconciliation: the manual duplicate in TODAY's window (if still
  // non-terminal and not yet reconciled).
  const windowStart = startOfDay(now);
  const windowStartIso = windowStart.toISOString();
  const manual = observationsById.get(SEEDED_MANUAL_HR_OBSERVATION_ID);
  const manualEligible =
    manual !== undefined &&
    manual.detail.validation.state === "pending" &&
    new Date(manual.detail.time.effectiveAt).getTime() >= windowStart.getTime() &&
    !reconciledWindowStarts.has(windowStartIso);

  if (!manualEligible || manual === undefined) {
    observationsById.set(observationId, { detail: observation });
    const note = reconciledWindowStarts.has(windowStartIso)
      ? "Already reconciled for today's window — the import was recorded, but the window keeps its existing canonical view (one reconciliation per window; nothing is re-reconciled or discarded)."
      : "No duplicate manual source in today's window — the import was recorded without reconciliation.";
    return { ok: true, observation, reconciled: null, reconciliationNote: note };
  }

  // The M4 ranking mirror: quality DESC (device 0.92 > manual 0.7) — the
  // device import becomes the canonical source; the manual original is
  // superseded with provenance intact.
  const winner = observation;
  const loser = manual.detail;
  const verdict: "concordant" | "discordant" =
    winner.value === loser.value ? "concordant" : "discordant";
  const canonicalObservationId = nextReconciledObservationId();
  const reconciliationProvenanceId = nextProvenanceId();

  const canonical: ObservationDetailView = {
    observationId: canonicalObservationId,
    personId: SYNTHETIC_PERSON_ID,
    metricId: winner.metricId,
    metricLabel: winner.metricLabel,
    conceptCode: winner.conceptCode,
    value: winner.value,
    unit: winner.unit,
    valueLabel: winner.valueLabel,
    capturedBy: winner.capturedBy,
    method: winner.method,
    deviceOrPerson: winner.deviceOrPerson,
    time: winner.time,
    quality: winner.quality,
    validation: {
      state: "validated",
      note: "Validated — this is the single current value for the metric after reconciliation.",
    },
    evidenceLabel: winner.evidenceLabel,
    evidenceState: winner.evidenceState,
    evidenceStateNote: winner.evidenceStateNote,
    transformations: winner.transformations,
    evidence: winner.evidence,
    modelVersion: winner.modelVersion,
    reconciliation: {
      role: "canonical",
      canonicalObservationId,
      verdict,
      note: "The reconciled canonical value — it supersedes the duplicate manual source for this window; both originals keep their provenance.",
    },
  };

  // Supersede the losing manual original (terminal state, provenance intact)
  // and validate the winning import — the domain transition semantics.
  const supersededManual: ObservationDetailView = {
    ...loser,
    validation: {
      state: "superseded",
      note: "Superseded — a higher-quality source for the same window reconciled over this observation. Its provenance is retained and inspectable.",
    },
    reconciliation: {
      role: "superseded-source",
      canonicalObservationId,
      verdict,
      note: "This observation lost the reconciliation ranking (lower quality score). It is never deleted — the canonical view links back to it.",
    },
  };
  const validatedImport: ObservationDetailView = {
    ...winner,
    validation: {
      state: "validated",
      note: "Validated — the winning source of today's reconciliation (highest quality score).",
    },
    reconciliation: {
      role: "canonical-source",
      canonicalObservationId,
      verdict,
      note: "This observation won the reconciliation ranking for today's window (quality 0.92 over 0.7).",
    },
  };

  const sources: readonly ObservationSourceProvenanceView[] = [
    {
      observationId: validatedImport.observationId,
      sourceId: validatedImport.capturedBy.sourceId,
      sourceLabel: validatedImport.capturedBy.sourceLabel,
      methodId: validatedImport.method.methodId,
      methodLabel: validatedImport.method.methodLabel,
      evidenceLabel: validatedImport.evidenceLabel,
      evidenceState: validatedImport.evidenceState,
      quality: validatedImport.quality.score,
      role: "canonical-source",
      roleLabel: "Canonical source (won the ranking)",
    },
    {
      observationId: supersededManual.observationId,
      sourceId: supersededManual.capturedBy.sourceId,
      sourceLabel: supersededManual.capturedBy.sourceLabel,
      methodId: supersededManual.method.methodId,
      methodLabel: supersededManual.method.methodLabel,
      evidenceLabel: supersededManual.evidenceLabel,
      evidenceState: supersededManual.evidenceState,
      quality: supersededManual.quality.score,
      role: "superseded-source",
      roleLabel: "Superseded source (kept with provenance)",
    },
  ];

  const view: ReconciledObservationView = {
    personId: SYNTHETIC_PERSON_ID,
    metricId: winner.metricId,
    metricLabel: winner.metricLabel,
    conceptCode: winner.conceptCode,
    value: winner.value,
    unit: winner.unit,
    valueLabel: winner.valueLabel,
    window: {
      startsAt: windowStartIso,
      endsAt: endOfDay(now).toISOString(),
    },
    verdict,
    canonicalObservationId,
    sources,
    reconciledAt: now.toISOString(),
    reconciliationProvenanceId,
    verdictNote:
      verdict === "concordant"
        ? "Concordant — the two sources agree under the exact-equality policy."
        : "Discordant — the two sources disagree under the exact-equality policy (no clinical tolerance is invented); the higher-quality source became canonical and the divergence is flagged, never hidden.",
  };

  observationsById.set(observationId, { detail: validatedImport });
  observationsById.set(supersededManual.observationId, { detail: supersededManual });
  observationsById.set(canonicalObservationId, { detail: canonical });
  reconciledViews.push(view);
  reconciledWindowStarts.add(windowStartIso);

  return {
    ok: true,
    observation: validatedImport,
    reconciled: view,
    reconciliationNote: `Duplicate sources reconciled: the wearable import (quality ${DEVICE_SAMPLE.qualityScore}) and your manual pulse check (quality 0.7) reconciled into one canonical view — ${verdict}.`,
  };
}

// ---------------------------------------------------------------------------
// Read models.
// ---------------------------------------------------------------------------

/** Lists every observation summary (fixtures, imports, live captures). */
export function listObservationSummaries(
  now: Date,
): readonly ObservationSummaryView[] {
  seedObservations(now);
  const summaries: ObservationSummaryView[] = [];
  const reconciledIds = new Set<string>();
  for (const view of reconciledViews) {
    reconciledIds.add(view.canonicalObservationId);
  }
  for (const stored of observationsById.values()) {
    const detail = stored.detail;
    summaries.push({
      observationId: detail.observationId,
      metricLabel: detail.metricLabel,
      valueLabel: detail.valueLabel,
      evidenceLabel: detail.evidenceLabel,
      evidenceState: detail.evidenceState,
      sourceKind: detail.capturedBy.kind,
      sourceLabel: detail.capturedBy.sourceLabel,
      methodLabel: detail.method.methodLabel,
      validationState: detail.validation.state,
      effectiveLabel: detail.time.effectiveLabel,
      reconciled: reconciledIds.has(detail.observationId),
    });
  }
  for (const record of listRecentCaptures()) {
    for (const observation of record.observations) {
      const detail = captureObservationDetail(observation, record, now);
      summaries.push({
        observationId: detail.observationId,
        metricLabel: detail.metricLabel,
        valueLabel: detail.valueLabel,
        evidenceLabel: detail.evidenceLabel,
        evidenceState: detail.evidenceState,
        sourceKind: detail.capturedBy.kind,
        sourceLabel: detail.capturedBy.sourceLabel,
        methodLabel: detail.method.methodLabel,
        validationState: detail.validation.state,
        effectiveLabel: detail.time.effectiveLabel,
        reconciled: false,
      });
    }
  }
  return summaries;
}

/** Finds one observation's full provenance detail (fixtures + live). */
export function findObservationDetail(
  observationId: string,
  now: Date,
): ObservationDetailView | undefined {
  seedObservations(now);
  const stored = observationsById.get(observationId);
  if (stored !== undefined) {
    return stored.detail;
  }
  for (const record of listRecentCaptures()) {
    const observation = record.observations.find(
      (candidate) => candidate.id === observationId,
    );
    if (observation !== undefined) {
      return captureObservationDetail(observation, record, now);
    }
  }
  return undefined;
}

/** Lists the reconciled canonical views (newest first). */
export function listReconciledViews(): readonly ReconciledObservationView[] {
  return [...reconciledViews].reverse();
}

/** The capture shape label of a capture observation (display helper). */
export function captureShapeLabelOf(record: CaptureRecordDto): string {
  return findCaptureShape(record.shapeId)?.displayName ?? record.shapeLabel;
}

/** Resets the store (test-only; deterministic re-seeding of suites). */
export function resetObservationStore(): void {
  observationsById.clear();
  reconciledViews.length = 0;
  reconciledWindowStarts.clear();
  importCounter = 0;
  reconciledCounter = 0;
  provenanceCounter = 0;
  seeded = false;
}

// Re-export the corpus vocabulary for the route/component tests.
export { OBSERVATION_EVIDENCE_STATE_LABELS };
