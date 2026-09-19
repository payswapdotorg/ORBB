/**
 * Domain-shaped INPUT types for the mapper — local structural contracts.
 *
 * RECORDED DECISIONS:
 *
 * - The packet brief pins "@orbb/domain — types only": src/ never imports
 *   the domain package at runtime. These input types are the STRUCTURAL
 *   equivalents of the frozen domain aggregates, typed with plain
 *   strings (branded ids are assignable to plain strings, so real
 *   @orbb/domain / @orbb/measurement / @orbb/db objects satisfy these
 *   types directly). `compat.ts` locks that assignability AT COMPILE
 *   TIME (domain `Observation`, `HealthIntent`, `AccessGrant`,
 *   `Provenance`, measurement `MeasurementTask`, `MeasurementAttempt`
 *   each `extends` their mirror here), so the local shapes can never
 *   drift from the kernel without a build failure.
 * - Vocabulary fields are typed with the local frozen unions (mirrors of
 *   the domain unions — drift-guarded at runtime by tests): literals
 *   like `"pending"` assign directly, while smuggled malformed values
 *   are caught by the runtime guards and fail closed.
 * - Fields the mapper needs but the M0 domain aggregate does not carry
 *   are OPTIONAL and documented at the field (e.g. `issuedAt` on the
 *   grant input — the domain AccessGrant has no issued timestamp; the
 *   @orbb/db row does, and the boundary accepts it explicitly rather
 *   than inventing one).
 * - The EvidenceObject input follows the architecture §5 field list as
 *   realized by the @orbb/db `EvidenceObjectRecord` (capturedAt,
 *   sourceType, provenanceId, retentionClass, sizeBytes, state; optional
 *   M2-D upload-plane columns). The @orbb/databox finalize record is the
 *   PRE-publication session subset — the finalized db record is the
 *   canonical DocumentReference source. Encrypted envelope metadata is
 *   deliberately NOT part of the input type: envelope bytes never cross
 *   the boundary.
 */
import type {
  CompletionQualityValue,
  EvidenceLabelValue,
  EvidenceObjectStateValue,
  GrantStateValue,
  IntentStateValue,
  ObservationValidationStateValue,
  TaskStateValue,
} from "./vocabulary.js";

/** Primitive observation value (M0 union: quantity, code, text, boolean). */
export type ObservationValueInput = string | number | boolean;

/** The REAL domain Observation shape (structural mirror of @orbb/domain `Observation`). */
export interface ObservationInput {
  readonly id: string;
  readonly personId: string;
  /** Terminology concept code (resolved against the context's metric vocabulary — fail-closed). */
  readonly conceptCode: string;
  readonly value: ObservationValueInput;
  /** Unit of measure; empty string for non-quantitative values. */
  readonly unit: string;
  /** Clinically relevant time (when the value applies). */
  readonly effectiveAt: Date;
  /** Time the observation was recorded/reported. */
  readonly observedAt: Date;
  readonly sourceId: string;
  /** Opaque MeasurementMethod code (moved verbatim under the method-code vocabulary namespace). */
  readonly methodId: string;
  readonly evidenceId?: string;
  /** Normalized quality/confidence in [0, 1]. */
  readonly quality?: number;
  readonly validationState: ObservationValidationStateValue;
  readonly provenanceId: string;
  readonly evidenceLabel: EvidenceLabelValue;
  /** The observation this one supersedes (amendment chain). */
  readonly supersedesId?: string;
}

/** The REAL domain HealthIntent shape (structural mirror). */
export interface HealthIntentInput {
  readonly id: string;
  readonly personId: string;
  /**
   * Free-text objective. VALIDATED for shape but NEVER MAPPED — the
   * PHI-free boundary moves vocabulary labels, not free text (tested:
   * objective strings must not appear anywhere in mapped output).
   */
  readonly objective: string;
  readonly state: IntentStateValue;
  readonly createdAt: Date;
  readonly evidencePackVersion?: number;
  readonly planId?: string;
}

/**
 * AccessGrant input (structural mirror of @orbb/domain `AccessGrant`) plus
 * the optional issued instant. RECORDED DECISION: the domain grant
 * carries only `expiresAt`; the @orbb/db row carries `createdAt` (the
 * grant's issued time). Callers with the db record pass it as
 * `issuedAt` explicitly; the mapper NEVER invents a period start.
 */
export interface ConsentGrantInput {
  readonly id: string;
  readonly subjectId: string;
  /** Opaque recipient identifier (consent lane owns the vocabulary). */
  readonly recipientId: string;
  /** Purpose-of-use label (moved verbatim under the purpose-of-use vocabulary namespace). */
  readonly purpose: string;
  /** Granted permission identifiers ("<kind>:<operation>", grammar-validated). */
  readonly scope: readonly string[];
  readonly state: GrantStateValue;
  readonly expiresAt: Date;
  /** Optional issued instant (db row createdAt); absent -> no period start, no dateTime. */
  readonly issuedAt?: Date;
}

/**
 * EvidenceObject input — architecture §5 field list as realized by the
 * @orbb/db `EvidenceObjectRecord` (structural mirror; the encrypted
 * envelope is deliberately out of type).
 */
export interface EvidenceObjectInput {
  readonly id: string;
  readonly personId: string;
  /** Opaque content-addressed object key (`evidence/v1/<id>/<sha256>`). */
  readonly objectKey: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly capturedAt: Date;
  readonly sourceType: string;
  readonly provenanceId: string;
  readonly retentionClass: string;
  readonly state: EvidenceObjectStateValue;
  /** EvidenceObject creation time (M2-D column; optional on the db record). */
  readonly createdAt?: Date;
  /** The upload session that produced this object (optional). */
  readonly sessionId?: string;
}

/** Measurement window (structural mirror of @orbb/measurement `MeasurementWindow`). */
export interface MeasurementWindowInput {
  /** 0-based cadence index; windows are half-open [startsAt, endsAt). */
  readonly sequence: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Measurement task (structural mirror of @orbb/measurement `MeasurementTask`). */
export interface MeasurementTaskInput {
  readonly id: string;
  readonly planId: string;
  readonly personId: string;
  readonly metricId: string;
  readonly conceptCode: string;
  readonly methodOrder: readonly string[];
  readonly window: MeasurementWindowInput;
  readonly state: TaskStateValue;
  readonly createdAt: Date;
  readonly rollCount: number;
}

/** Measurement attempt (structural mirror of @orbb/measurement `MeasurementAttempt`). */
export interface MeasurementAttemptInput {
  readonly id: string;
  readonly taskId: string;
  readonly personId: string;
  readonly metricId: string;
  /** The observation this attempt produced/linked. */
  readonly observationId: string;
  /** The method ACTUALLY used. */
  readonly methodId: string;
  /** The preferred method that was unavailable (present exactly on fallback attempts). */
  readonly preferredMethodId?: string;
  /** Domain quality score of the observation (confidence seam). */
  readonly quality: number;
  readonly completionState: CompletionQualityValue;
  readonly recordedAt: Date;
  readonly evidenceId?: string;
  /** Provenance of the attempt act itself. */
  readonly provenanceId: string;
}

/**
 * DiagnosticReport grouping input (RECORDED GROUPING ASSUMPTION): one
 * report per task attempt set — a `MeasurementTask` plus EVERY
 * `MeasurementAttempt` recorded against it (data is never discarded:
 * partial and low-quality attempts are included; supersession status
 * lives on each mapped Observation, not the report). Zero attempts are
 * legal (a scheduler-materialized open task maps to a `registered`
 * report with no results).
 */
export interface DiagnosticReportInput {
  readonly task: MeasurementTaskInput;
  readonly attempts: readonly MeasurementAttemptInput[];
}

/** Provenance record (structural mirror of @orbb/domain `Provenance`). */
export interface ProvenanceRecordInput {
  readonly provenanceId: string;
  /** Actor: PersonId | DeviceId | SourceId (entity-kind derived from the id grammar). */
  readonly actor: string;
  readonly subject: string;
  readonly occurredAt: Date;
  readonly causationId?: string;
  readonly correlationId?: string;
}
