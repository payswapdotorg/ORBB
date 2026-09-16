/**
 * Observation/provenance view model (M6-B B5, Lane B) — types only.
 *
 * Every observation — manual capture, device import, or synthesized
 * fixture — carries STRUCTURED PROVENANCE rendering the frozen §Provenance
 * UX chain:
 * `Captured by → Method → Device/Person → Time → Quality → Validation →
 * Transformations → Original evidence`.
 *
 * The product TEACHES the measured-vs-estimated distinction (§Provenance
 * UX: "'measured' and 'estimated from an image' are different states"):
 * every view carries an explicit `evidenceState` label ("Measured" |
 * "Estimated" | "Imported" | "Derived") — states are carried by TEXT,
 * never color alone.
 *
 * The RECONCILED case mirrors the frozen M4-A `CanonicalObservationView`
 * shape (`packages/measurement/src/reconciliation.ts`): one canonical view
 * for the same metric/window with PER-SOURCE provenance records for every
 * original (nothing discarded — the superseded original keeps its
 * provenance). Wire form: ISO-8601 strings, branded ids widened.
 */

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
   * timeline — linked), or "session" (retained by the source this session;
   * DataBox ingestion arrives with the engine wiring — honestly labeled).
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
// The reconciled view (the M4 `CanonicalObservationView` mirror, wire form).
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

// ---------------------------------------------------------------------------
// Wire types (client <-> /api/observations).
// ---------------------------------------------------------------------------

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

/** `GET /api/observations` response body. */
export interface ObservationListResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly observations: readonly ObservationSummaryView[];
  readonly reconciled: readonly ReconciledObservationView[];
}

/** `GET /api/observations/[id]` response body. */
export interface ObservationDetailResponse {
  readonly synthetic: true;
  readonly observation: ObservationDetailView;
}

/** `POST /api/observations` request body (the device-import act). */
export interface ObservationImportRequest {
  readonly action: "import-device";
}

/** `POST /api/observations` success body. */
export interface ObservationImportResponse {
  readonly synthetic: true;
  readonly observation: ObservationDetailView;
  /** Present when the import reconciled duplicate sources in the window. */
  readonly reconciled: ReconciledObservationView | null;
  /** Honest note when no reconciliation happened (never fake). */
  readonly reconciliationNote: string;
}

// ---------------------------------------------------------------------------
// Error envelope (the app's M3-A style — PHI-safe by construction).
// ---------------------------------------------------------------------------

export type ObservationErrorCode =
  | "invalid-request"
  | "validation-failed"
  | "not-found"
  | "conflict"
  | "internal-error";

export interface ObservationIssue {
  readonly field: string;
  readonly problem: string;
}

export interface ObservationErrorEnvelope {
  readonly error: {
    readonly code: ObservationErrorCode;
    readonly message: string;
    readonly details?: { readonly issues: readonly ObservationIssue[] };
    readonly requestId: string;
  };
}

// ---------------------------------------------------------------------------
// Client-side payload guards (untrusted JSON from our own routes).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type guard: is `payload` a successful observations list response? */
export function isObservationListResponse(
  payload: unknown,
): payload is ObservationListResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true || !isNonEmptyString(payload.personId)) {
    return false;
  }
  return Array.isArray(payload.observations) && Array.isArray(payload.reconciled);
}

/** Type guard: is `payload` a successful observation detail response? */
export function isObservationDetailResponse(
  payload: unknown,
): payload is ObservationDetailResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true) {
    return false;
  }
  const observation = payload.observation;
  return isPlainObject(observation) && isNonEmptyString(observation.observationId);
}

/** Type guard: is `payload` a successful device-import response? */
export function isObservationImportResponse(
  payload: unknown,
): payload is ObservationImportResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true) {
    return false;
  }
  const observation = payload.observation;
  return isPlainObject(observation) && isNonEmptyString(observation.observationId);
}

/** Type guard: is `payload` an observations error envelope? */
export function isObservationErrorEnvelope(
  payload: unknown,
): payload is ObservationErrorEnvelope {
  if (!isPlainObject(payload)) {
    return false;
  }
  const error = payload.error;
  if (!isPlainObject(error)) {
    return false;
  }
  return isNonEmptyString(error.code) && isNonEmptyString(error.message);
}
