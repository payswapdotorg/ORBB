/**
 * Mobile observation/provenance model (M6-B B5, Lane B) — pure data +
 * module-local state mirroring the web
 * `apps/web/src/lib/observations/{types,catalog,store}.ts` field-for-field.
 *
 * Every observation — manual capture, device import, or synthesized
 * fixture — carries STRUCTURED PROVENANCE rendering the frozen §Provenance
 * UX chain:
 * `Captured by → Method → Device/Person → Time → Quality → Validation →
 * Transformations → Original evidence`.
 *
 * The product TEACHES the measured-vs-estimated distinction (§Provenance
 * UX): every view carries an explicit `evidenceState` label ("Measured" |
 * "Estimated" | "Imported" | "Derived") — states are carried by TEXT,
 * never color alone. Estimates are never presented as measurements.
 *
 * CONTENT MODEL (the web store's, adapted to the mobile shell):
 *   1. SYNTHESIZED corpus fixtures (the M3-B DataBox observation events,
 *      now with structured provenance + evidence links into the pinned
 *      DataBox corpus — the pinned reference world, 2026-09-10);
 *   2. a SEEDED MANUAL duplicate (resting heart rate, earlier today — the
 *      reconciliation partner of the device-import journey);
 *   3. DEVICE IMPORTS (the SYNTH device-adapter fixture: SYNTH-Device-A's
 *      latest resting-heart-rate sample, IMPORTED with the unit-
 *      normalization transformation at the M4-C seam);
 *   4. RECONCILED canonical views (the M4 `CanonicalObservationView`
 *      mirror — two same-metric sources in one window reconcile into ONE
 *      canonical value with PER-SOURCE provenance records; nothing is
 *      discarded: the loser moves to the terminal `superseded` validation
 *      state with provenance intact, exactly the domain semantics).
 * LIVE manual captures are NOT read through a shared store on mobile (the
 * Health tab owns capture records in screen state): the pure projection
 * {@link captureRecordToDetail} maps any `MobileCaptureRecord` into the
 * same provenance-detail shape so capture-history rows open details.
 *
 * RECONCILIATION MIRROR (frozen M4 semantics, mirrored field-by-field):
 * quality ranking DESC (device 0.92 > manual 0.7) decides the winner; the
 * verdict is `discordant` under the exact-equality agreement policy (no
 * clinical tolerance is invented); discordance never blocks reconciliation
 * — the divergence is flagged, never hidden; ONE reconciliation per window
 * (a second import records honestly, it never re-reconciles).
 *
 * Why a local mirror: `apps/mobile` declares only `@orbb/ui` as a
 * workspace dependency; importing the web libs or `@orbb/domain` would
 * change `pnpm-lock.yaml`, which this packet must not touch (recorded
 * handoff — at engine wiring the mirror swaps for the real package
 * exports). No React Native imports — plain-node unit-testable.
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; zero PHI; no real medical data.
 */

import {
  SYNTHETIC_PERSON_ID,
  SYNTHETIC_PERSON_LABEL,
  findCaptureShape,
  formatCapturedLabel,
  formatValueLabel,
  type MobileCaptureObservation,
  type MobileCaptureRecord,
} from "../capture/model";

// ---------------------------------------------------------------------------
// Provenance vocabulary (domain mirrors, same discipline as M4-B capture).
// ---------------------------------------------------------------------------

/** Mirror of the frozen domain evidence-label vocabulary. */
export const OBSERVATION_EVIDENCE_LABELS = [
  "MEASURED",
  "ESTIMATED",
  "IMPORTED",
  "DERIVED",
] as const;

export type ObservationEvidenceLabel = (typeof OBSERVATION_EVIDENCE_LABELS)[number];

/** The teaching state: how this value came to exist (explicit, never color-alone). */
export type ObservationEvidenceState = "measured" | "estimated" | "imported" | "derived";

/** Where an observation came from (the §Provenance UX "Captured by" field). */
export type ObservationSourceKind = "manual" | "device-adapter" | "synthesized";

/** Mirror of the domain validation-state vocabulary. */
export const OBSERVATION_VALIDATION_STATES = [
  "pending",
  "validated",
  "superseded",
] as const;

export type ObservationValidationState =
  (typeof OBSERVATION_VALIDATION_STATES)[number];

/** Mirror of the A31 completion-quality vocabulary. */
export const OBSERVATION_QUALITY_STATES = ["complete", "partial", "low-quality"] as const;

export type ObservationQualityState = (typeof OBSERVATION_QUALITY_STATES)[number];

/** One transformation applied to the raw source value before recording. */
export interface ObservationTransformationView {
  /** SYNTH-marked transformation id. */
  readonly id: string;
  /** Short label (e.g. "Unit normalization"). */
  readonly label: string;
  /** What was done and why (teaching copy — exact from/to units). */
  readonly description: string;
  /** When the transformation was applied (ISO-8601). */
  readonly appliedAt: string;
  /** The seam where it happened (e.g. "M4-C device-adapter seam"). */
  readonly seam: string;
}

/** The original evidence record affordance (DataBox link). */
export interface ObservationEvidenceLinkView {
  /** Evidence record id (`SYNTH-EV-…`). */
  readonly evidenceId: string;
  /** Human summary of the retained raw evidence. */
  readonly summary: string;
  /** Media type (image | audio | document | waveform). */
  readonly mediaType: "image" | "audio" | "document" | "waveform";
  /** Checksum prefix (SYNTH-marked). */
  readonly checksumPrefix: string;
  /** Retention class (SYNTH-marked). */
  readonly retentionClass: string;
  /**
   * Where the evidence lives: "databox-corpus" (in the pinned DataBox
   * timeline), or "session" (retained by the source this session; DataBox
   * ingestion arrives with the engine wiring — honestly labeled).
   */
  readonly location: "databox-corpus" | "session";
}

// ---------------------------------------------------------------------------
// The observation detail (the §Provenance UX chain, field by field).
// ---------------------------------------------------------------------------

/** The full provenance detail of one observation. */
export interface ObservationDetailView {
  readonly observationId: string;
  readonly personId: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  readonly value: number;
  readonly unit: string;
  /** Formatted value label (display). */
  readonly valueLabel: string;

  /** Captured by: the source kind + actor + source id. */
  readonly capturedBy: {
    readonly kind: ObservationSourceKind;
    /** Human label (e.g. "You (SYNTH-Person-1, self-tracking)"). */
    readonly actorLabel: string;
    /** Actor id (SYNTH-marked person/device id). */
    readonly actorId: string;
    readonly sourceId: string;
    /** Source display label (e.g. "SYNTH-Device-A (registered wearable)"). */
    readonly sourceLabel: string;
  };

  /** Method: how the metric was measured. */
  readonly method: {
    readonly methodId: string;
    readonly methodLabel: string;
    readonly kind: "manual" | "app" | "device";
  };

  /** Device/Person: who or what actually produced the value. */
  readonly deviceOrPerson: string;

  /** Time: clinically relevant time vs record time. */
  readonly time: {
    /** When the value applies (device clock / user-stated capture time). */
    readonly effectiveAt: string;
    /** When the record was created (server/import time). */
    readonly observedAt: string;
    readonly effectiveLabel: string;
    readonly observedLabel: string;
  };

  /** Quality: self-assessed state + derived score (never upgraded). */
  readonly quality: {
    readonly state: ObservationQualityState;
    readonly score: number;
    readonly stateLabel: string;
    readonly note: string;
  };

  /** Validation: lifecycle state + honest note. */
  readonly validation: {
    readonly state: ObservationValidationState;
    readonly note: string;
  };

  /** Evidence label + the teaching state (measured vs estimated, explicit). */
  readonly evidenceLabel: ObservationEvidenceLabel;
  readonly evidenceState: ObservationEvidenceState;
  /** Teaching copy for the measured-vs-estimated distinction. */
  readonly evidenceStateNote: string;

  /** Transformation chain (empty = recorded exactly as captured). */
  readonly transformations: readonly ObservationTransformationView[];

  /** Original evidence record affordance (null = no raw evidence object). */
  readonly evidence: ObservationEvidenceLinkView | null;

  /** Model version for estimated/derived values (null = no model involved). */
  readonly modelVersion: string | null;

  /** Reconciliation context when this observation participated in one. */
  readonly reconciliation?: {
    readonly role: "canonical-source" | "superseded-source" | "canonical";
    readonly canonicalObservationId: string;
    readonly verdict: "concordant" | "discordant";
    readonly note: string;
  };
}

// ---------------------------------------------------------------------------
// The reconciled view (the M4 `CanonicalObservationView` mirror).
// ---------------------------------------------------------------------------

/** Per-source provenance record (the M4 `SourceProvenanceRecord` mirror). */
export interface ObservationSourceProvenanceView {
  readonly observationId: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly evidenceLabel: ObservationEvidenceLabel;
  readonly evidenceState: ObservationEvidenceState;
  readonly quality?: number;
  /** The role this original played: winner or superseded. */
  readonly role: "canonical-source" | "superseded-source";
  /** Display label of the role (explicit text, never color alone). */
  readonly roleLabel: string;
}

/** The ONE canonical view for a reconciled metric/window. */
export interface ReconciledObservationView {
  readonly personId: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  readonly value: number;
  readonly unit: string;
  readonly valueLabel: string;
  /** The reconciliation window (ISO-8601, half-open). */
  readonly window: { readonly startsAt: string; readonly endsAt: string };
  /** concordant | discordant (the M4 verdict vocabulary). */
  readonly verdict: "concordant" | "discordant";
  /** The canonical (replacement) observation id. */
  readonly canonicalObservationId: string;
  /** Per-source provenance for EVERY original (never discarded). */
  readonly sources: readonly ObservationSourceProvenanceView[];
  readonly reconciledAt: string;
  readonly reconciliationProvenanceId: string;
  /** Teaching note about what the verdict means. */
  readonly verdictNote: string;
}

/** One row of the observations list (summaries; details by id). */
export interface ObservationSummaryView {
  readonly observationId: string;
  readonly metricLabel: string;
  readonly valueLabel: string;
  readonly evidenceLabel: ObservationEvidenceLabel;
  readonly evidenceState: ObservationEvidenceState;
  readonly sourceKind: ObservationSourceKind;
  readonly sourceLabel: string;
  readonly methodLabel: string;
  readonly validationState: ObservationValidationState;
  readonly effectiveLabel: string;
  readonly reconciled: boolean;
}

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
// Fixture ids + evidence-record vocabulary (stable, SYNTH-marked).
// ---------------------------------------------------------------------------

/** The synthesized corpus observation fixture ids (stable, SYNTH-marked). */
export const CORPUS_OBSERVATION_IDS = {
  restingHeartRate: "obs_SYNTH-corpus-hr-0001",
  bloodPressureManual: "obs_SYNTH-corpus-bp-0002",
  temperatureEstimated: "obs_SYNTH-corpus-temp-0003",
  weightScale: "obs_SYNTH-corpus-wt-0004",
} as const;

/** The seeded manual heart-rate duplicate (the import journey's partner). */
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

// ---------------------------------------------------------------------------
// Local-day helpers (the reconciliation window anchor).
// ---------------------------------------------------------------------------

/** Local start-of-day of the given instant. */
function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

/** Local end-of-day (exclusive). */
function endOfDay(at: Date): Date {
  return new Date(startOfDay(at).getTime() + 24 * 60 * 60 * 1000);
}

/** Maps a domain evidence label onto the teaching state. */
function evidenceStateOf(
  label: string,
): "measured" | "estimated" | "imported" | "derived" {
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
// The pinned corpus fixtures (M3-B events, full provenance chains).
// ---------------------------------------------------------------------------

/** The pinned reference "today" of the SYNTH corpus (M3-B design). */
function buildCorpusDetails(): ReadonlyMap<string, ObservationDetailView> {
  const pinnedTime = (label: string): string => label;
  const entries: readonly [string, ObservationDetailView][] = [
    // -- 1. Resting heart rate (wearable sync, DERIVED from the overnight
    //    series; validated; evidence = the raw waveform).
    [
      CORPUS_OBSERVATION_IDS.restingHeartRate,
      {
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
    ],
    // -- 2. Manual blood pressure log (MEASURED; pending validation;
    //    evidence = the scanned log page).
    [
      CORPUS_OBSERVATION_IDS.bloodPressureManual,
      {
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
    ],
    // -- 3. Temperature ESTIMATED from a thermometer photo (the teaching
    //    case; the model version is carried, the ESTIMATE label stays).
    [
      CORPUS_OBSERVATION_IDS.temperatureEstimated,
      {
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
    ],
    // -- 4. Body weight (scale sync, MEASURED, validated, lb→kg
    //    unit normalization at the M4-C seam).
    [
      CORPUS_OBSERVATION_IDS.weightScale,
      {
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
    ],
  ];
  return new Map<string, ObservationDetailView>(entries);
}

/** The pinned corpus fixtures (built once — pure, deterministic data). */
const CORPUS_DETAILS: ReadonlyMap<string, ObservationDetailView> = buildCorpusDetails();

/**
 * Finds a CORPUS fixture's full provenance detail by observation id (pure —
 * the pinned reference world needs no session instant). The DataBox
 * timeline's "View provenance" affordances resolve through this.
 */
export function corpusObservationDetail(
  observationId: string,
): ObservationDetailView | undefined {
  return CORPUS_DETAILS.get(observationId);
}

// ---------------------------------------------------------------------------
// Module state (process-local: the seeded manual duplicate + imports).
// ---------------------------------------------------------------------------

const observationsById = new Map<string, ObservationDetailView>();
const reconciledViews: ReconciledObservationView[] = [];

/** Reconciliation bookkeeping: window-start ISO -> reconciled view. */
const reconciledWindowStarts = new Set<string>();

let importCounter = 0;
let reconciledCounter = 0;
let provenanceCounter = 0;

let seeded = false;

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

/**
 * Seeds the session-world fixture (the manual duplicate). `now` anchors it
 * inside today and never in the future — early-hours sessions see an
 * early-morning instant.
 */
function seedObservations(now: Date): void {
  if (seeded) {
    return;
  }
  seeded = true;

  const todayStart = startOfDay(now).getTime();
  const manualEffectiveAt = new Date(
    Math.max(
      todayStart + 60 * 1000,
      Math.min(todayStart + 8 * 60 * 60 * 1000 + 5 * 60 * 1000, now.getTime() - 60 * 1000),
    ),
  );
  observationsById.set(SEEDED_MANUAL_HR_OBSERVATION_ID, {
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
  });
}

// ---------------------------------------------------------------------------
// Live manual captures -> observation details (the pure projection).
// ---------------------------------------------------------------------------

/**
 * The method label of one captured observation: the shape's manual method
 * option, suffixed with the field label for compound shapes (the same
 * vocabulary as the web corpus fixtures, e.g. "… · Systolic").
 */
function captureMethodLabel(
  record: MobileCaptureRecord,
  observation: MobileCaptureObservation,
): string {
  const shape = findCaptureShape(record.shapeId);
  const field = shape?.fields.find(
    (candidate) => candidate.metric.id === observation.metricId,
  );
  if (shape === undefined || field === undefined) {
    return "Manual entry";
  }
  return shape.fields.length > 1
    ? `${shape.manualMethodOption.label} · ${field.label}`
    : shape.manualMethodOption.label;
}

/**
 * Projects one capture record into the provenance-detail shape so the
 * capture-history rows can open details. The record is presented as ONE
 * detail: the headline observation's identity + the compound value label
 * (e.g. "124/78 mmHg"), the method actually used, the person as the
 * provenance actor, the self-assessed quality (never upgraded), pending
 * validation, no raw evidence object, no transformations, and "No model
 * involved — direct capture".
 *
 * RECORDED SIMPLIFICATION (vs. the web projection): the entry-guard
 * rounding transformation is not reconstructed here (the mobile capture
 * model records already-snapped values; the seam disclosure arrives with
 * the engine wiring). ESTIMATED labels DO travel: sleep/step captures
 * project as ESTIMATED — estimates are never presented as measurements.
 */
export function captureRecordToDetail(
  record: MobileCaptureRecord,
  now: Date,
): ObservationDetailView {
  const observation = record.observations[0];
  if (observation === undefined) {
    throw new Error("Capture record has no observations — cannot project provenance.");
  }
  const shape = findCaptureShape(record.shapeId);
  const values: Record<string, number> = {};
  for (const candidate of record.observations) {
    const field = shape?.fields.find(
      (option) => option.metric.id === candidate.metricId,
    );
    if (field !== undefined) {
      values[field.id] = candidate.value;
    }
  }
  const valueLabel =
    shape !== undefined
      ? formatValueLabel(shape, values)
      : record.observations
          .map((candidate) => `${candidate.value} ${candidate.unit}`)
          .join(" · ");
  const evidenceState = evidenceStateOf(observation.evidenceLabel);
  return {
    observationId: observation.id,
    personId: observation.personId,
    metricId: observation.metricId,
    metricLabel: observation.metricLabel,
    conceptCode: observation.conceptCode,
    value: observation.value,
    unit: observation.unit,
    valueLabel,
    capturedBy: {
      kind: "manual",
      actorLabel: OBSERVATION_MANUAL_SOURCE.actorLabel,
      actorId: observation.provenance.actor,
      sourceId: observation.sourceId,
      sourceLabel: OBSERVATION_MANUAL_SOURCE.sourceLabel,
    },
    method: {
      methodId: observation.methodId,
      methodLabel: captureMethodLabel(record, observation),
      kind: "manual",
    },
    deviceOrPerson: SYNTHETIC_PERSON_LABEL,
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
    evidenceState,
    evidenceStateNote: OBSERVATION_EVIDENCE_STATE_NOTES[evidenceState] ?? "",
    transformations: [],
    evidence: null,
    modelVersion: OBSERVATION_NO_MODEL,
  };
}

// ---------------------------------------------------------------------------
// Device import + the reconciliation mirror (the device journey).
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

/** Typed import/reconciliation rejections (PHI-safe). */
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
    manual.validation.state === "pending" &&
    new Date(manual.time.effectiveAt).getTime() >= windowStart.getTime() &&
    !reconciledWindowStarts.has(windowStartIso);

  if (!manualEligible || manual === undefined) {
    observationsById.set(observationId, { ...observation });
    const note = reconciledWindowStarts.has(windowStartIso)
      ? "Already reconciled for today's window — the import was recorded, but the window keeps its existing canonical view (one reconciliation per window; nothing is re-reconciled or discarded)."
      : "No duplicate manual source in today's window — the import was recorded without reconciliation.";
    return { ok: true, observation, reconciled: null, reconciliationNote: note };
  }

  // The M4 ranking mirror: quality DESC (device 0.92 > manual 0.7) — the
  // device import becomes the canonical source; the manual original is
  // superseded with provenance intact.
  const winner = observation;
  const loser = manual;
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

  observationsById.set(observationId, validatedImport);
  observationsById.set(supersededManual.observationId, supersededManual);
  observationsById.set(canonicalObservationId, canonical);
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

/** Lists every observation summary (fixtures, imports, reconciled views). */
export function listObservationSummaries(
  now: Date,
): readonly ObservationSummaryView[] {
  seedObservations(now);
  const summaries: ObservationSummaryView[] = [];
  const reconciledIds = new Set<string>();
  for (const view of reconciledViews) {
    reconciledIds.add(view.canonicalObservationId);
  }
  const pushSummary = (detail: ObservationDetailView): void => {
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
  };
  for (const detail of CORPUS_DETAILS.values()) {
    pushSummary(detail);
  }
  for (const detail of observationsById.values()) {
    pushSummary(detail);
  }
  return summaries;
}

/** Finds one observation's full provenance detail (fixtures + imports). */
export function findObservationDetail(
  observationId: string,
  now: Date,
): ObservationDetailView | undefined {
  seedObservations(now);
  const corpus = CORPUS_DETAILS.get(observationId);
  if (corpus !== undefined) {
    return corpus;
  }
  return observationsById.get(observationId);
}

/** Lists the reconciled canonical views (newest first). */
export function listReconciledViews(): readonly ReconciledObservationView[] {
  return [...reconciledViews].reverse();
}

/** Resets the module state (test-only; deterministic re-seeding of suites). */
export function resetObservationModel(): void {
  observationsById.clear();
  reconciledViews.length = 0;
  reconciledWindowStarts.clear();
  importCounter = 0;
  reconciledCounter = 0;
  provenanceCounter = 0;
  seeded = false;
}
