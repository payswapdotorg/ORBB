/**
 * A45 — the clinical access audit record shape.
 *
 * Every care-team permission decision carries one of these
 * ({@link evaluateCareTeamAccess} embeds it in the returned decision).
 * The shape is WHO / WHAT / WHEN / DECISION / REASON:
 *
 *   who        — `actor` (the requesting practitioner's canonical id; the
 *                kernel `AccessAudit` treats actors as opaque labels —
 *                the persistence lane may widen this to service actors)
 *   what       — `subjectId` + `permission` (labels only — never data
 *                values, mirroring the kernel's reason discipline)
 *   when       — `at` (the request/evaluation instant; the evaluator is
 *                pure — the calling layer stamps wall-clock time into the
 *                persisted record)
 *   decision   — `ALLOW` | `DENY` (the exact vocabulary the
 *                `access_audits.decision` check constraint enforces)
 *   reason     — the typed deny reason, or the allow label
 *                `care-team-access-granted`
 *
 * DB-INTEGRATION HANDOFF (recorded, not performed here — the @orbb/db
 * schema is out of this packet's changed-path fence): the
 * `access_audits` table (append-only at three levels — repository
 * surface, migration 0001 trigger, no cascade path) stores
 * { id, decisionId, subjectId, decision, at, actor, requestDigest,
 * createdAt }. Mapping: `actor` -> actor, `subjectId` -> subject_id,
 * `decision` -> decision, `at` -> at; `permission` + `reason` ride inside
 * `requestDigest` (kernel precedent: `digestAccessRequest` packs the
 * request's identity labels into a structural digest) OR the migration
 * that promotes the clinical lane adds explicit `permission`/`reason`
 * columns — either way the record is append-only and never echoed with
 * data values. `id`/`decisionId` are assigned by the persistence lane.
 */
import { DomainInvariantError, isPersonId, type PersonId } from "@orbb/domain";

/** The decision vocabulary (mirrors the access_audits check constraint). */
export const CLINICAL_ACCESS_DECISIONS = ["ALLOW", "DENY"] as const;

export type ClinicalAccessDecisionKind = (typeof CLINICAL_ACCESS_DECISIONS)[number];

/** The allow-side reason label (labels only — never data values). */
export const CLINICAL_ACCESS_ALLOW_REASON = "care-team-access-granted" as const;

/**
 * The audit record of a single clinical permission decision — who asked,
 * for what, when, the decision, and the typed reason.
 */
export interface ClinicalAccessAuditRecord {
  /** Who: the requesting practitioner (canonical pract_ id label). */
  readonly actor: string;
  /** What: the person whose data was requested. */
  readonly subjectId: PersonId;
  /** What: the requested scope permission (label, never a data value). */
  readonly permission: string;
  /** When: the request/evaluation instant. */
  readonly at: Date;
  /** Decision: ALLOW | DENY. */
  readonly decision: ClinicalAccessDecisionKind;
  /** Reason: the typed deny reason or the allow label. */
  readonly reason: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isClinicalAccessAuditRecord(
  value: unknown,
): value is ClinicalAccessAuditRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ClinicalAccessAuditRecord, unknown>>;
  if (!isNonEmptyString(candidate.actor)) {
    return false;
  }
  if (!isPersonId(candidate.subjectId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.permission)) {
    return false;
  }
  if (!isTimestamp(candidate.at)) {
    return false;
  }
  if (
    typeof candidate.decision !== "string" ||
    !(CLINICAL_ACCESS_DECISIONS as readonly string[]).includes(candidate.decision)
  ) {
    return false;
  }
  if (!isNonEmptyString(candidate.reason)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link ClinicalAccessAuditRecord}. Throws
 * {@link DomainInvariantError} describing the expected shape — received
 * values are never echoed.
 */
export function assertClinicalAccessAuditRecord(
  candidate: unknown,
): asserts candidate is ClinicalAccessAuditRecord {
  if (!isClinicalAccessAuditRecord(candidate)) {
    throw new DomainInvariantError(
      "Invalid clinical access audit record: expected { actor, subjectId, permission, at, decision, reason } with non-empty actor/permission/reason labels, a canonical prsn_ subject id, a valid timestamp, and a decision of ALLOW|DENY.",
    );
  }
}
