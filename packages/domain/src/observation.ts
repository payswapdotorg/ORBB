/**
 * Observation aggregate (architecture §5) plus its validation state
 * machine, quality score, and M1 amendment (supersession) semantics.
 *
 * `Observation(id, personId, conceptCode, value, unit, effectiveAt,
 * observedAt, sourceId, methodId, evidenceId?, quality?,
 * validationState, provenanceId, evidenceLabel, supersedesId?)`.
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
 *   - M1 amendment semantics (FHIR-observation-style replace): a validated
 *     Observation may be SUPERSEDED by a new Observation carrying
 *     `supersedesId` pointing at it. The old observation moves to the
 *     terminal `superseded` validation state; its value is never mutated
 *     in place — provenance preserves the correction chain.
 *
 * Validation state machine (M1 grammar):
 *   pending -> validated | rejected
 *   validated -> superseded (only via a superseding observation — see
 *                {@link supersede}, which enforces the full invariant set)
 *   rejected / superseded are terminal.
 */
import type { EvidenceId, ObservationId, PersonId, ProvenanceId, SourceId } from "./ids.js";
import { isIdOf } from "./ids.js";
import type { EvidenceLabel } from "./evidence.js";
import { isEvidenceLabel } from "./evidence.js";
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

export const OBSERVATION_VALIDATION_STATES = [
  "pending",
  "validated",
  "rejected",
  "superseded",
] as const;

export type ObservationValidationState = (typeof OBSERVATION_VALIDATION_STATES)[number];

/**
 * Legal validation transitions. `rejected` and `superseded` are terminal;
 * `validated` may only move to `superseded` — and only via a superseding
 * observation (use {@link supersede}, which enforces the linkage).
 */
export const OBSERVATION_VALIDATION_TRANSITIONS: StateTransitionTable<ObservationValidationState> =
  {
    pending: ["validated", "rejected"],
    validated: ["superseded"],
    rejected: [],
    superseded: [],
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
  /**
   * The observation this observation supersedes (amendment chain), if any.
   * Present exactly on replacement observations created via
   * {@link supersede} semantics.
   */
  readonly supersedesId?: ObservationId;
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

// ---------------------------------------------------------------------------
// Structural guard (M1 gap review: the core aggregate had none, unlike the
// Provenance primitive — added additively, following the assertProvenance
// precedent; working code is unchanged).
// ---------------------------------------------------------------------------

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isObservationValue(value: unknown): value is ObservationValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function isObservation(value: unknown): value is Observation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Observation, unknown>>;
  if (!isIdOf("observation", candidate.id)) {
    return false;
  }
  if (!isIdOf("person", candidate.personId)) {
    return false;
  }
  if (typeof candidate.conceptCode !== "string" || candidate.conceptCode.length === 0) {
    return false;
  }
  if (!isObservationValue(candidate.value)) {
    return false;
  }
  if (typeof candidate.unit !== "string") {
    return false;
  }
  if (!isTimestamp(candidate.effectiveAt)) {
    return false;
  }
  if (!isTimestamp(candidate.observedAt)) {
    return false;
  }
  if (!isIdOf("source", candidate.sourceId)) {
    return false;
  }
  if (typeof candidate.methodId !== "string" || candidate.methodId.length === 0) {
    return false;
  }
  if (candidate.evidenceId !== undefined && !isIdOf("evidence", candidate.evidenceId)) {
    return false;
  }
  if (candidate.quality !== undefined && !isQualityScore(candidate.quality)) {
    return false;
  }
  if (!isObservationValidationState(candidate.validationState)) {
    return false;
  }
  if (!isIdOf("provenance", candidate.provenanceId)) {
    return false;
  }
  if (!isEvidenceLabel(candidate.evidenceLabel)) {
    return false;
  }
  if (candidate.supersedesId !== undefined && !isIdOf("observation", candidate.supersedesId)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed {@link Observation}.
 * Throws {@link DomainInvariantError} describing the expected shape —
 * received values are never echoed.
 */
export function assertObservation(candidate: unknown): asserts candidate is Observation {
  if (!isObservation(candidate)) {
    throw new DomainInvariantError(
      'Invalid observation: expected { id, personId, conceptCode, value, unit, effectiveAt, observedAt, sourceId, methodId, evidenceId?, quality?, validationState, provenanceId, evidenceLabel, supersedesId? } with canonical ids, a non-empty concept code and method code, a quantity/code/text/boolean value, valid timestamps, a legal validation state (pending|validated|rejected|superseded), a legal evidence label, and an optional quality in [0, 1].',
    );
  }
}

// ---------------------------------------------------------------------------
// Amendment (supersession) semantics — M1.
// ---------------------------------------------------------------------------

/** Result of a legal supersession: the pair of observations after replacement. */
export interface SupersededPair {
  /** The old observation, now in the terminal `superseded` state. */
  readonly superseded: Observation;
  /** The replacement, now `validated`, carrying supersedesId = old id. */
  readonly replacement: Observation;
}

/**
 * Pure amendment function (FHIR-observation-style replace semantics).
 *
 * Preconditions (each violation throws {@link DomainInvariantError}):
 *   - both observations are structurally well-formed;
 *   - `oldObservation` is in the `validated` state (only a validated
 *     observation can be superseded — pending must be validated or
 *     rejected first; rejected/superseded are terminal);
 *   - `next` is in the `pending` state (a replacement enters life pending
 *     and is atomically validated by taking the old value's place);
 *   - `next.supersedesId` is present and references `oldObservation.id`;
 *   - `next.id` differs from `oldObservation.id` (no self-supersession);
 *   - `next.personId` equals `oldObservation.personId` (an amendment never
 *     moves data between people);
 *   - `next.conceptCode` equals `oldObservation.conceptCode` (an amendment
 *     corrects a value, never re-tags it as a different concept).
 *
 * Neither input is mutated: the function returns a NEW pair — the old
 * observation with validation state `superseded`, and the replacement with
 * validation state `validated` (recorded assumption: the replacement
 * atomically assumes the superseded observation's validated status —
 * leaving it pending would create a window in which the person has no
 * current validated value). Value/unit/timestamps may legitimately differ:
 * an amendment exists precisely to correct them; provenance (via the
 * distinct provenance ids and the supersedesId chain) preserves the full
 * correction chain.
 */
export function supersede(oldObservation: Observation, next: Observation): SupersededPair {
  assertObservation(oldObservation);
  assertObservation(next);

  if (oldObservation.validationState !== "validated") {
    throw new DomainInvariantError(
      "Illegal supersession: only a validated observation can be superseded (pending must be validated or rejected first; rejected and superseded are terminal).",
    );
  }
  if (next.validationState !== "pending") {
    throw new DomainInvariantError(
      "Illegal supersession: the replacement observation must be in the pending state.",
    );
  }
  if (next.supersedesId === undefined) {
    throw new DomainInvariantError(
      "Illegal supersession: the replacement observation must carry a supersedesId referencing the superseded observation.",
    );
  }
  if (next.supersedesId !== oldObservation.id) {
    throw new DomainInvariantError(
      "Illegal supersession: the replacement's supersedesId does not reference the superseded observation.",
    );
  }
  if (next.id === oldObservation.id) {
    throw new DomainInvariantError(
      "Illegal supersession: an observation cannot supersede itself.",
    );
  }
  if (next.personId !== oldObservation.personId) {
    throw new DomainInvariantError(
      "Illegal supersession: the replacement belongs to a different person than the superseded observation.",
    );
  }
  if (next.conceptCode !== oldObservation.conceptCode) {
    throw new DomainInvariantError(
      "Illegal supersession: the replacement carries a different concept code than the superseded observation.",
    );
  }

  return {
    superseded: { ...oldObservation, validationState: "superseded" },
    replacement: { ...next, validationState: "validated" },
  };
}
