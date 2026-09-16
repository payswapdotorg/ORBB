/**
 * Observation + provenance view model (M6-B B5, Lane B) — types only.
 *
 * The frozen §Provenance UX drawer contract:
 *
 *   `Captured by → Method → Device/Person → Time → Quality → Validation
 *    → Transformations → Original evidence`
 *
 * Every field below maps onto that chain; the detail surface renders the
 * chain in order and TEACHES the measured-vs-estimated distinction
 * ("the product must teach users that 'measured' and 'estimated from an
 * image' are different states" — explicit text labels, never color alone).
 *
 * Vocabulary mirrors (frozen upstream):
 *   - evidence labels: MEASURED | ESTIMATED | IMPORTED | DERIVED (domain
 *     evidence vocabulary, mirrored by M4-B capture types);
 *   - validation states: pending | validated | superseded (domain
 *     Observation lifecycle; supersession is terminal with provenance
 *     intact — the M4 reconciliation invariant);
 *   - completion quality: complete | partial | low-quality (A31);
 *   - source kinds: manual | device-adapter | synthesized (the packet's
 *     provenance-source vocabulary: device adapter vs manual vs
 *     synthesized — the canonical reconciled observation is the
 *     `synthesized` case, DERIVED from its sources).
 */

// ---------------------------------------------------------------------------
// Vocabulary (runtime constants + guards).
// ---------------------------------------------------------------------------

export const OBSERVATION_EVIDENCE_LABELS = [
  "MEASURED",
  "ESTIMATED",
  "IMPORTED",
  "DERIVED",
] as const;

export type ObservationEvidenceLabel = (typeof OBSERVATION_EVIDENCE_LABELS)[number];

export const OBSERVATION_VALIDATION_STATES = [
  "pending",
  "validated",
  "superseded",
] as const;

export type ObservationValidationState = (typeof OBSERVATION_VALIDATION_STATES)[number];

export const OBSERVATION_SOURCE_KINDS = [
  "manual",
  "device-adapter",
  "synthesized",
] as const;

export type ObservationSourceKind = (typeof OBSERVATION_SOURCE_KINDS)[number];

/** Human labels for the source kinds (text is the carrier — WCAG 1.4.1). */
export const OBSERVATION_SOURCE_KIND_LABELS: Readonly<
  Record<ObservationSourceKind, string>
> = {
  manual: "Manual entry",
  "device-adapter": "Device adapter import",
  synthesized: "Synthesized by ORBB",
};

/** Human sentences for the evidence labels (the teaching vocabulary). */
export const OBSERVATION_EVIDENCE_LABEL_SENTENCES: Readonly<
  Record<ObservationEvidenceLabel, string>
> = {
  MEASURED: "Measured — read directly from the measuring device or method.",
  ESTIMATED:
    "Estimated — derived from an image or a recollection, not measured directly. It carries uncertainty.",
  IMPORTED: "Imported — captured by a device or app and synced into ORBB.",
  DERIVED:
    "Derived — computed by ORBB from other observations, with their provenance kept.",
};

/** One transformation step of the provenance chain (e.g. unit normalization). */
export interface ProvenanceTransformation {
  /** Stable transformation code (SYNTH-marked where fixture-specific). */
  readonly id: string;
  /** Human label (e.g. "Unit normalization"). */
  readonly label: string;
  /** What changed and where in the pipeline (e.g. "kPa → mmHg at the device-import seam"). */
  readonly detail: string;
}

/** The original-evidence link (the DataBox record behind the observation). */
export interface EvidenceLinkView {
  /** DataBox evidence id (SYNTH-marked). */
  readonly id: string;
  /** Human summary of the raw evidence record. */
  readonly summary: string;
  /** Media type label (image / waveform / document / audio). */
  readonly mediaTypeLabel: string;
}

/** The quality field of the chain (state + domain score in [0, 1]). */
export interface ObservationQualityView {
  readonly state: "complete" | "partial" | "low-quality";
  readonly score: number;
}

// ---------------------------------------------------------------------------
// The observation detail view (§Provenance UX chain, field for field).
// ---------------------------------------------------------------------------

export interface ObservationDetailView {
  /** Canonical observation id (`obs_SYNTH-…`). */
  readonly id: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  readonly value: number;
  readonly unit: string;
  /** Pre-formatted value ("118 mmHg"). */
  readonly valueLabel: string;
  readonly evidenceLabel: ObservationEvidenceLabel;
  readonly validationState: ObservationValidationState;

  // --- The §Provenance UX chain, in order. ---
  /** Captured by (e.g. "You (SYNTH-Person-1, self-tracking)"). */
  readonly capturedBy: string;
  readonly sourceKind: ObservationSourceKind;
  /** The method actually used. */
  readonly method: { readonly id: string; readonly label: string };
  /** Device or person that produced the raw signal. */
  readonly deviceOrPerson: string;
  /** Time: clinically-relevant capture time + record time (pre-formatted). */
  readonly time: {
    readonly capturedAtLabel: string;
    readonly recordedAtLabel: string;
  };
  readonly quality: ObservationQualityView;
  readonly transformations: readonly ProvenanceTransformation[];
  /**
   * The original evidence record (absent when the wiring has not landed —
   * honestly stated, never faked).
   */
  readonly evidence?: EvidenceLinkView;
  /**
   * The model version behind an ESTIMATED/DERIVED observation (the AI
   * boundary: estimates name their model; MEASURED/IMPORTED carry none).
   */
  readonly modelVersion?: string;
  /** Uncertainty sentence for ESTIMATED observations (teaching, honest). */
  readonly uncertainty?: string;
  /** Fixed ISO ordering timestamp (filtering; never wall-clock). */
  readonly capturedAtIso: string;
}

// ---------------------------------------------------------------------------
// The RECONCILED case — the M4 `CanonicalObservationView` mirror.
// ---------------------------------------------------------------------------

/** The role an original observation played (M4 `SourceRole` mirror). */
export type ReconciledSourceRole = "canonical-source" | "superseded-source";

/** One source's provenance inside the canonical view (M4 mirror, wire form). */
export interface ReconciledSourceProvenanceView {
  readonly observationId: string;
  readonly sourceKind: ObservationSourceKind;
  readonly sourceKindLabel: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly evidenceLabel: ObservationEvidenceLabel;
  readonly qualityScore: number;
  readonly role: ReconciledSourceRole;
  readonly roleLabel: string;
  readonly valueLabel: string;
  readonly capturedAtLabel: string;
  /** Link to the per-source observation detail (both stay inspectable). */
  readonly detailId: string;
}

export const RECONCILIATION_VERDICTS = ["concordant", "discordant"] as const;

export type ReconciliationVerdict = (typeof RECONCILIATION_VERDICTS)[number];

/** The ONE canonical view for a reconciled metric/window (M4 mirror). */
export interface CanonicalObservationDetailView {
  /** The canonical (replacement) observation id. */
  readonly id: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  readonly value: number;
  readonly unit: string;
  readonly valueLabel: string;
  readonly evidenceLabel: ObservationEvidenceLabel;
  readonly validationState: ObservationValidationState;
  readonly windowLabel: string;
  readonly verdict: ReconciliationVerdict;
  /** Per-source provenance for EVERY original (never discarded). */
  readonly sources: readonly ReconciledSourceProvenanceView[];
  readonly reconciledAtLabel: string;
  /** Provenance of the reconciliation act itself. */
  readonly reconciliationProvenanceId: string;
  /** The canonical observation's own detail view (chain render). */
  readonly detail: ObservationDetailView;
}

// ---------------------------------------------------------------------------
// Wire types (/api/observations).
// ---------------------------------------------------------------------------

export interface ObservationListResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly observations: readonly ObservationDetailView[];
  readonly canonical: CanonicalObservationDetailView | null;
  /** True while the SYNTH device-adapter import has not run yet. */
  readonly deviceImportAvailable: boolean;
}

export interface DeviceImportResponse {
  readonly synthetic: true;
  readonly imported: ObservationDetailView;
  readonly canonical: CanonicalObservationDetailView;
  /** The superseded original, with its provenance intact. */
  readonly superseded: ObservationDetailView;
  readonly observations: readonly ObservationDetailView[];
}

export interface ObservationErrorEnvelope {
  readonly error: {
    readonly code: "invalid-request" | "import-already-completed" | "internal-error";
    readonly message: string;
  };
}

export function isObservationListResponse(
  payload: unknown,
): payload is ObservationListResponse {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.synthetic === true &&
    Array.isArray(record.observations) &&
    (record.canonical === null || typeof record.canonical === "object")
  );
}

export function isDeviceImportResponse(payload: unknown): payload is DeviceImportResponse {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.synthetic === true &&
    typeof record.imported === "object" &&
    record.imported !== null &&
    typeof record.canonical === "object" &&
    record.canonical !== null &&
    typeof record.superseded === "object" &&
    record.superseded !== null &&
    Array.isArray(record.observations)
  );
}

export function isObservationErrorEnvelope(
  payload: unknown,
): payload is ObservationErrorEnvelope {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error !== "object" || record.error === null) {
    return false;
  }
  const error = record.error as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
}
