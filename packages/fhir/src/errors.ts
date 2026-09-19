/**
 * Typed mapping failure for @orbb/fhir — the fail-closed error surface.
 *
 * The mapper NEVER emits a silent partial resource: any malformed input,
 * unknown vocabulary value, unresolved terminology binding, or missing
 * provenance linkage surfaces as a {@link FhirMappingError} with a
 * machine-checkable `kind` and a PHI-safe message (the message describes
 * the violated rule; offending values are never echoed — the same
 * discipline as @orbb/domain `DomainInvariantError`).
 */

/** The typed mapping failure kinds (fail-closed, exhaustive). */
export type FhirMappingErrorKind =
  /** A domain object failed its structural guard (shape/id grammar/timestamps). */
  | "invalid-input"
  /** The mapping context itself is malformed (bad namespace, duplicate vocabulary keys, bad port). */
  | "invalid-context"
  /** A frozen domain vocabulary value is not one of the legal members. */
  | "unknown-vocabulary"
  /** A concept code could not be resolved against the context's metric vocabulary. */
  | "unresolved-concept-code"
  /** A metric id could not be resolved against the context's metric vocabulary. */
  | "unresolved-metric"
  /** No health-focus entry is registered for the intent being mapped. */
  | "intent-focus-unknown"
  /**
   * The intent commits to more than one focus metric. Binding doctrine:
   * a FHIR Condition.code is ONE clinical concept; a multi-focus intent
   * would assert comorbidity that does not exist, so the mapper refuses
   * (future-milestone handoff: per-focus Condition resources).
   */
  | "multi-focus-intent"
  /**
   * A domain object that carries a provenanceId was mapped without its
   * provenance record being present in the context — the mapper-internal
   * enforcement of "every observation needs provenance".
   */
  | "missing-provenance"
  /** The world-level provenance-linkage invariant failed (resource not targeted). */
  | "provenance-coverage"
  /** The canonical serializer encountered a value outside plain JSON. */
  | "non-canonical-value";

/** Fail-closed, PHI-safe mapping failure. */
export class FhirMappingError extends Error {
  /** Machine-checkable failure kind. */
  readonly kind: FhirMappingErrorKind;

  constructor(kind: FhirMappingErrorKind, message: string) {
    super(message);
    this.name = "FhirMappingError";
    this.kind = kind;
  }
}

/** Convenience constructor: an `invalid-input` failure with a PHI-safe message. */
export function invalidInput(message: string): FhirMappingError {
  return new FhirMappingError("invalid-input", message);
}
