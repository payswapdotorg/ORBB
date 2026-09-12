/**
 * Capture session model (M4-B, Lane B) — types only.
 *
 * These are the "thin local interfaces" over the frozen domain measurement
 * plane (`packages/domain`: MetricDefinition, MeasurementMethod, Observation,
 * Provenance, QualityScore, EvidenceLabel). They are STRUCTURAL MIRRORS:
 * field-for-field, same vocabularies and semantics, with the branded ids
 * widened to plain strings at this boundary.
 *
 * Why mirrors instead of direct `@orbb/domain` imports: `apps/web` declares
 * only `@orbb/ui` as a workspace dependency at this base; adding
 * `@orbb/domain` would change `pnpm-lock.yaml`, which this packet must not
 * touch ("dependencies added — expect none"). At integration the engine
 * wiring (Lane A, M4-A) adds `"@orbb/domain": "workspace:*"` to
 * `apps/web/package.json` and swaps these mirrors for the domain types —
 * the call sites are already shaped for that (recorded handoff).
 */

// ---------------------------------------------------------------------------
// Quality states — the completion-quality vocabulary (domain vocabulary
// mirrored exactly; mirrors COMPLETION_QUALITY_STATES of the measurement
// engine's A31 attempt recorder: complete | partial | low-quality).
// ---------------------------------------------------------------------------

export const CAPTURE_QUALITY_STATES = ["complete", "partial", "low-quality"] as const;

export type CaptureQualityState = (typeof CAPTURE_QUALITY_STATES)[number];

export function isCaptureQualityState(value: unknown): value is CaptureQualityState {
  return (
    typeof value === "string" &&
    (CAPTURE_QUALITY_STATES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Domain-plane mirrors (packages/domain measurement family).
// ---------------------------------------------------------------------------

/**
 * Mirror of the domain evidence-label vocabulary (MEASURED | ESTIMATED |
 * IMPORTED | DERIVED) — frozen in `packages/domain/src/evidence.ts`.
 */
export const CAPTURE_EVIDENCE_LABELS = [
  "MEASURED",
  "ESTIMATED",
  "IMPORTED",
  "DERIVED",
] as const;

export type CaptureEvidenceLabel = (typeof CAPTURE_EVIDENCE_LABELS)[number];

export function isCaptureEvidenceLabel(value: unknown): value is CaptureEvidenceLabel {
  return (
    typeof value === "string" &&
    (CAPTURE_EVIDENCE_LABELS as readonly string[]).includes(value)
  );
}

/**
 * Mirror of the domain `MetricDefinition` (metric lane vocabulary): WHAT can
 * be measured — identity, display, unit domain, value type, terminology
 * code, category.
 */
export interface CaptureMetricDefinition {
  /** Opaque metric concept-code string (SYNTH-prefixed in this catalog). */
  readonly id: string;
  readonly displayName: string;
  /** Closed set of allowed units (quantity metrics: exactly one here). */
  readonly unitDomain: readonly string[];
  readonly valueType: "quantity";
  /** Terminology code (SYNTH-marked LOINC-shaped, e.g. "SYNTH-8867-4"). */
  readonly conceptCode: string;
  readonly category: string;
}

/**
 * Mirror of the domain `MeasurementMethod` (measurement lane vocabulary):
 * HOW a metric is measured — which metric it belongs to, the single evidence
 * label it produces, its typical quality range, and its relative burden
 * rank (lower = less burden).
 */
export interface CaptureMeasurementMethod {
  /** Opaque method code (SYNTH-prefixed in this catalog). */
  readonly id: string;
  /** The metric this method measures (references CaptureMetricDefinition.id). */
  readonly metricId: string;
  readonly evidenceLabel: CaptureEvidenceLabel;
  /** Inclusive typical-quality range in [0, 1] (min <= max, min > 0 here). */
  readonly typicalQuality: { readonly min: number; readonly max: number };
  /** Positive integer burden rank; lower = less burden. */
  readonly relativeBurden: number;
}

// ---------------------------------------------------------------------------
// Capture shapes (the manual-capture UX grouping).
// ---------------------------------------------------------------------------

/**
 * One value field of a capture shape. Each field is backed by its own
 * domain metric + manual method: a compound shape (blood pressure panel)
 * captures one observation PER field, each recorded against its own metric
 * with the method actually used.
 */
export interface CaptureFieldSpec {
  /** Field id within the shape (e.g. "systolic"). */
  readonly id: string;
  /** Visible field label (e.g. "Systolic"). */
  readonly label: string;
  readonly metric: CaptureMetricDefinition;
  /** The manual method that actually produces this field's observation. */
  readonly method: CaptureMeasurementMethod;
  /** Guard bounds for the numeric input (client clamp/snap semantics). */
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * A capture shape: one manual capture act in the UI (e.g. one blood
 * pressure reading = systolic + diastolic fields).
 *
 * The shape-level manual method option is what the method picker exposes;
 * on submit it resolves to the per-field methods (the methods actually
 * used, recorded on every observation).
 */
export interface CaptureShape {
  /** Shape id (SYNTH-prefixed, e.g. "SYNTH-shape-bp-panel"). */
  readonly id: string;
  readonly displayName: string;
  /** One-line summary for the metric picker description. */
  readonly summary: string;
  readonly fields: readonly CaptureFieldSpec[];
  /**
   * The single enabled (manual-entry) method option of this packet.
   * Its id is the `methodOptionId` submitted to the API.
   */
  readonly manualMethodOption: {
    readonly id: string;
    readonly label: string;
    readonly meta: string;
  };
  /**
   * Future capture routes (device/app seams, M4-C), shown disabled in the
   * method picker so the least-burden landscape is visible but not choosable.
   */
  readonly futureMethodOptions: readonly {
    readonly id: string;
    readonly label: string;
    readonly meta: string;
  }[];
  /**
   * Honest-method note shown when the shape's manual methods produce
   * ESTIMATED (not MEASURED) observations — the product must teach that
   * "measured" and "estimated from memory" are different states.
   */
  readonly evidenceNote?: string;
}

// ---------------------------------------------------------------------------
// Submission wire types (client form -> POST /api/capture).
// ---------------------------------------------------------------------------

/** A validated manual-capture submission (values already numbers). */
export interface CaptureSubmission {
  readonly shapeId: string;
  /** The method option the user actually chose (manual-only in this packet). */
  readonly methodOptionId: string;
  /** Field values keyed by CaptureFieldSpec.id. */
  readonly fieldValues: Readonly<Record<string, number>>;
  readonly qualityState: CaptureQualityState;
  /** User-stated capture time as ISO-8601 (maps to domain effectiveAt). */
  readonly capturedAtIso: string;
  /** Optional free-text notes (trimmed; absent when empty). */
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Stored record DTOs (in-memory store -> GET /api/capture). Domain
// Observation semantics, one record per captured field.
// ---------------------------------------------------------------------------

/**
 * Mirror of the domain `Provenance` record: for manual capture the ACTOR is
 * the person (self-tracking) — actor === subject === the synthetic person.
 */
export interface CaptureProvenanceDto {
  readonly provenanceId: string;
  /** Actor: the person who performed the capture (self-tracking). */
  readonly actor: string;
  readonly subject: string;
  readonly occurredAt: string;
  /** Correlation token tying one capture act's observations together. */
  readonly correlationId: string;
}

/**
 * One stored observation (domain Observation shape mirrored; ids follow the
 * canonical grammar with SYNTH-marked bodies, e.g. `obs_SYNTH-obs-000001`).
 */
export interface CaptureObservationDto {
  readonly id: string;
  readonly personId: string;
  readonly conceptCode: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly value: number;
  readonly unit: string;
  /** Clinically relevant time (the user-stated capture time). */
  readonly effectiveAt: string;
  /** Time the observation was recorded (server time). */
  readonly observedAt: string;
  readonly sourceId: string;
  /** The method ACTUALLY used (per-field manual method code). */
  readonly methodId: string;
  readonly methodLabel: string;
  readonly evidenceLabel: CaptureEvidenceLabel;
  /** Domain quality score in [0, 1] derived from the self-assessed state. */
  readonly quality: number;
  readonly validationState: "pending";
  readonly provenance: CaptureProvenanceDto;
}

/** One manual capture act as stored (observations share capture metadata). */
export interface CaptureRecordDto {
  /** Display/session id (`SYNTH-CAP-000001`; rides correlationId). */
  readonly captureId: string;
  readonly personId: string;
  readonly shapeId: string;
  readonly shapeLabel: string;
  /** The method option actually chosen in the picker. */
  readonly methodOptionId: string;
  /** Self-assessed quality state — recorded as-is, never upgraded. */
  readonly qualityState: CaptureQualityState;
  readonly capturedAt: string;
  readonly recordedAt: string;
  readonly notes?: string;
  readonly observations: readonly CaptureObservationDto[];
}

/** `GET /api/capture` response body. */
export interface CaptureListResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly captures: readonly CaptureRecordDto[];
}

/** `POST /api/capture` success body. */
export interface CaptureSubmitResponse {
  readonly synthetic: true;
  readonly capture: CaptureRecordDto;
}

// ---------------------------------------------------------------------------
// Error envelope (the app's error-envelope style — M3-A `{ error: { code,
// message, details?, requestId } }` shape, PHI-safe by construction:
// messages and issues describe the violated invariant, never echo values).
// ---------------------------------------------------------------------------

export type CaptureErrorCode = "invalid-request" | "validation-failed" | "internal-error";

/** Field-level validation issue (field PATH + problem; values never echoed). */
export interface CaptureIssue {
  readonly field: string;
  readonly problem: string;
}

export interface CaptureErrorEnvelope {
  readonly error: {
    readonly code: CaptureErrorCode;
    readonly message: string;
    readonly details?: { readonly issues: readonly CaptureIssue[] };
    readonly requestId: string;
  };
}

// ---------------------------------------------------------------------------
// Client-side payload guards (untrusted JSON from our own route — same
// defensive pattern as the M3-B capture form).
// ---------------------------------------------------------------------------

export function isCaptureSubmitResponse(payload: unknown): payload is CaptureSubmitResponse {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.synthetic === true &&
    typeof record.capture === "object" &&
    record.capture !== null &&
    Array.isArray((record.capture as Record<string, unknown>).observations)
  );
}

export function isCaptureErrorEnvelope(payload: unknown): payload is CaptureErrorEnvelope {
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
