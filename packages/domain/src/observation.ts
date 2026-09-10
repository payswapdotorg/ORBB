/**
 * Observation aggregate (architecture §5) plus its validation state
 * machine and quality score.
 *
 * `Observation(id, personId, conceptCode, value, unit, effectiveAt,
 * observedAt, sourceId, methodId, evidenceId?, quality?,
 * validationState, provenanceId, evidenceLabel)`.
 *
 * Recorded assumptions:
 *   - `value` is a primitive quantity/code/text value (M0 union); the
 *     measurement lane may refine this later.
 *   - `unit` is a plain string; non-quantitative observations use the
 *     empty string "" (the §5 field list marks it as required).
 *   - `methodId` references a MeasurementMethod by opaque code — it is
 *     NOT one of the M0 canonical branded ids (the canonical id list is
 *     frozen), so it stays an opaque string until the measurement lane
 *     owns its vocabulary.
 *   - `quality` is a normalized confidence score in [0, 1].
 *
 * Validation state machine (frozen grammar):
 *   pending -> validated | rejected (validated/rejected are terminal)
 */
import type { EvidenceId, ObservationId, PersonId, ProvenanceId, SourceId } from "./ids.js";
import type { EvidenceLabel } from "./evidence.js";
import { DomainInvariantError } from "./errors.js";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  isState,
  parseState,
  type StateTransitionTable,
} from "./stateMachine.js";

declare const qualityScoreBrand: unique symbol;

/** Normalized quality/confidence score in the closed interval [0, 1]. */
export type QualityScore = number & { readonly [qualityScoreBrand]: "QualityScore" };

export function isQualityScore(value: unknown): value is QualityScore {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseQualityScore(value: unknown): QualityScore {
  if (!isQualityScore(value)) {
    throw new DomainInvariantError("Invalid quality score: expected a finite number in [0, 1].");
  }
  return value;
}

export const OBSERVATION_VALIDATION_STATES = ["pending", "validated", "rejected"] as const;

export type ObservationValidationState = (typeof OBSERVATION_VALIDATION_STATES)[number];

/** Legal validation transitions. `validated` and `rejected` are terminal. */
export const OBSERVATION_VALIDATION_TRANSITIONS: StateTransitionTable<ObservationValidationState> =
  {
    pending: ["validated", "rejected"],
    validated: [],
    rejected: [],
  };

/** Primitive observation value (quantity, code, or text) in M0. */
export type ObservationValue = string | number | boolean;

export interface Observation {
  readonly id: ObservationId;
  readonly personId: PersonId;
  /** Terminology concept code (e.g. LOINC "8867-4"). */
  readonly conceptCode: string;
  readonly value: ObservationValue;
  /** Unit of measure; empty string for non-quantitative values. */
  readonly unit: string;
  /** Clinically relevant time (when the value applies). */
  readonly effectiveAt: Date;
  /** Time the observation was recorded/reported. */
  readonly observedAt: Date;
  readonly sourceId: SourceId;
  /** Opaque MeasurementMethod code (measurement lane owns the vocabulary). */
  readonly methodId: string;
  readonly evidenceId?: EvidenceId;
  readonly quality?: QualityScore;
  readonly validationState: ObservationValidationState;
  readonly provenanceId: ProvenanceId;
  readonly evidenceLabel: EvidenceLabel;
}

export function isObservationValidationState(
  value: unknown,
): value is ObservationValidationState {
  return isState(OBSERVATION_VALIDATION_STATES, value);
}

export function parseObservationValidationState(value: unknown): ObservationValidationState {
  return parseState(OBSERVATION_VALIDATION_STATES, value, "observation validation state");
}

export function allowedObservationValidationTransitions(
  from: ObservationValidationState,
): readonly ObservationValidationState[] {
  return allowedTransitions(OBSERVATION_VALIDATION_TRANSITIONS, from);
}

export function canTransitionObservationValidation(
  from: ObservationValidationState,
  to: ObservationValidationState,
): boolean {
  return canTransition(OBSERVATION_VALIDATION_TRANSITIONS, from, to);
}

/** Throws {@link import("./errors.js").DomainInvariantError} on illegal transitions. */
export function assertObservationValidationTransition(
  from: ObservationValidationState,
  to: ObservationValidationState,
): void {
  assertTransition(OBSERVATION_VALIDATION_TRANSITIONS, from, to, "observation validation");
}
