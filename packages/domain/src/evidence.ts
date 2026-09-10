/**
 * Evidence labels for observations (M0 baseline vocabulary).
 *
 * Recorded assumption: the 4-label vocabulary MEASURED | ESTIMATED |
 * IMPORTED | DERIVED is the M0 baseline per the architecture. Refinement
 * (e.g. adding SELF_REPORTED or CONFIRMED) happens only via tech-lead
 * review — workers must not extend it unilaterally.
 */
import { DomainInvariantError } from "./errors.js";

export const EVIDENCE_LABELS = ["MEASURED", "ESTIMATED", "IMPORTED", "DERIVED"] as const;

export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export function isEvidenceLabel(value: unknown): value is EvidenceLabel {
  return typeof value === "string" && (EVIDENCE_LABELS as readonly string[]).includes(value);
}

/**
 * Parses a raw value as an {@link EvidenceLabel}. Throws
 * {@link DomainInvariantError} naming the legal vocabulary without echoing
 * the offending value.
 */
export function parseEvidenceLabel(value: unknown): EvidenceLabel {
  if (!isEvidenceLabel(value)) {
    throw new DomainInvariantError(
      `Invalid evidence label: expected one of MEASURED | ESTIMATED | IMPORTED | DERIVED.`,
    );
  }
  return value;
}
