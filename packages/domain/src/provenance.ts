/**
 * Provenance primitive.
 *
 * Every observation and mutation in ORBB carries provenance (architecture
 * rule: "Every observation needs provenance"). Recorded assumptions:
 *   - `actor` is the person, device, or external measurement source that
 *     performed the action. Service-account actors would extend this union
 *     via tech-lead review, not unilaterally.
 *   - `subject` is always the person the record is about (PersonId).
 *   - `causationId` / `correlationId` are opaque correlation tokens
 *     (event ids / workflow ids) — deliberately unbranded strings in M0.
 *   - `occurredAt` is an in-process `Date`; ISO-8601 serialization is a
 *     transport-boundary concern, not a domain concern.
 */
import { DomainInvariantError } from "./errors.js";
import { isIdOf, type DeviceId, type PersonId, type ProvenanceId, type SourceId } from "./ids.js";

export type ProvenanceActor = PersonId | DeviceId | SourceId;

export interface Provenance {
  readonly provenanceId: ProvenanceId;
  readonly actor: ProvenanceActor;
  readonly subject: PersonId;
  readonly occurredAt: Date;
  readonly causationId?: string;
  readonly correlationId?: string;
}

export function isProvenanceActor(value: unknown): value is ProvenanceActor {
  return isIdOf("person", value) || isIdOf("device", value) || isIdOf("source", value);
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPresentButNotNonEmptyString(value: unknown): boolean {
  return value !== undefined && (typeof value !== "string" || value.length === 0);
}

export function isProvenance(value: unknown): value is Provenance {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Provenance, unknown>>;
  if (!isIdOf("provenance", candidate.provenanceId)) {
    return false;
  }
  if (!isProvenanceActor(candidate.actor)) {
    return false;
  }
  if (!isIdOf("person", candidate.subject)) {
    return false;
  }
  if (!isTimestamp(candidate.occurredAt)) {
    return false;
  }
  if (isPresentButNotNonEmptyString(candidate.causationId)) {
    return false;
  }
  if (isPresentButNotNonEmptyString(candidate.correlationId)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed {@link Provenance}.
 * Throws {@link DomainInvariantError} describing the expected shape —
 * received values are never echoed.
 */
export function assertProvenance(candidate: unknown): asserts candidate is Provenance {
  if (!isProvenance(candidate)) {
    throw new DomainInvariantError(
      "Invalid provenance record: expected { provenanceId, actor, subject, occurredAt, causationId?, correlationId? } with canonical ids, a person/device/source actor, a person subject, and a valid timestamp.",
    );
  }
}
