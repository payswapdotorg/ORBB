/**
 * Audit-record shape for the SMART launch boundary.
 *
 * Architecture §7: "Every access produces an immutable audit event." The
 * SMART launch boundary produces one audit record for EVERY validation and
 * exchange outcome — allows AND denials — stamped through the injected
 * `Clock` and `IdFactory` seams, never the wall clock directly.
 *
 * PHI discipline (the @orbb/observability pattern, enforced by the
 * zero-PHI test in this package): audit records carry IDENTIFIERS AND
 * REASON CODES ONLY — the issuer HOST (never the full URL, never a query
 * string, never credentials), a typed decision, a typed reason code, the
 * boundary stage, and the timestamp. No patient names, no demographics,
 * no launch handles, no tokens, no scope strings.
 *
 * DB HANDOFF (recorded — NOT shipped in this package): these records are
 * designed for the @orbb/db `access_audits` table (append-only by
 * migration 0001; schema: `id audit_<body>`, `decisionId`, `subjectId
 * prsn_<body>`, `decision ALLOW|DENY`, `at`, `actor`, `requestDigest`).
 * The composition layer:
 *   1. derives `subjectId` via the clinical lane's PatientLink (M7-A A45
 *      maps the EHR patient identifier on the token record to an ORBB
 *      person id),
 *   2. derives `actor` from the launching client/principal,
 *   3. serializes this shape as the `requestDigest` payload (or keeps the
 *      typed fields), and
 *   4. appends through the audit repository (no update/delete path
 *      exists; the database trigger rejects mutations outright).
 */

/** Decision vocabulary — aligned with the @orbb/db `access_audits.decision` check. */
export const SMART_LAUNCH_DECISION_KINDS = ["ALLOW", "DENY"] as const;

/** Decision vocabulary — aligned with the @orbb/db `access_audits.decision` check. */
export type SmartLaunchDecisionKind = (typeof SMART_LAUNCH_DECISION_KINDS)[number];

/** Which boundary step produced the record. */
export const SMART_AUDIT_STAGES = [
  "launch-validation",
  "token-exchange",
  "token-verification",
] as const;

/** Which boundary step produced the record. */
export type SmartAuditStage = (typeof SMART_AUDIT_STAGES)[number];

/** Reason code recorded on ALLOW records (kept boring on purpose). */
export const SMART_AUDIT_ALLOW_REASON = "OK";

/**
 * The audit record for one SMART launch boundary outcome.
 *
 * Recorded assumptions:
 *   - `reason` is a TYPED CODE from this package's failure vocabularies
 *     (never a free-form message, never raw input). ALLOW records carry
 *     the constant {@link SMART_AUDIT_ALLOW_REASON}.
 *   - `issHost` is the launching EHR's host when one was extractable
 *     from a structurally parseable `iss`, else `null`. Hosts inside the
 *     SYNTH namespace are still recorded as-is (they are obviously
 *     synthetic; the reserved `.test` TLD guarantees no real PHI host).
 *   - `id` is minted through the injected `IdFactory` seam with the
 *     `smartaud` prefix; the persistence lane may re-key it to the
 *     `audit_` grammar on write (recorded db handoff).
 */
export interface SmartLaunchAuditRecord {
  /** Opaque audit-record id (`smartaud_<body>` from the IdFactory seam). */
  readonly id: string;
  /** Boundary step that produced the record. */
  readonly stage: SmartAuditStage;
  /** `ALLOW` for accepted launches/exchanges, `DENY` for every rejection. */
  readonly decision: SmartLaunchDecisionKind;
  /** Typed reason code (see module docs; `OK` when allowed). */
  readonly reason: string;
  /** Issuer host when extractable; `null` otherwise. Never a full URL. */
  readonly issHost: string | null;
  /** Outcome timestamp from the injected clock. */
  readonly at: Date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type guard: is `value` a well-formed {@link SmartLaunchAuditRecord}? */
export function isSmartLaunchAuditRecord(value: unknown): value is SmartLaunchAuditRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof SmartLaunchAuditRecord, unknown>>;
  if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.reason)) {
    return false;
  }
  if (!SMART_AUDIT_STAGES.includes(candidate.stage as SmartAuditStage)) {
    return false;
  }
  if (!SMART_LAUNCH_DECISION_KINDS.includes(candidate.decision as SmartLaunchDecisionKind)) {
    return false;
  }
  if (candidate.issHost !== null && !isNonEmptyString(candidate.issHost)) {
    return false;
  }
  return candidate.at instanceof Date && !Number.isNaN(candidate.at.getTime());
}

/**
 * Builds an audit record. `issHost`, when supplied, is reduced to the
 * HOST of a structurally parseable issuer URL — never a full URL, never
 * credentials, never a query string — and SYNTH-namespace hosts are
 * preserved as-is (obviously synthetic).
 */
export function toSmartLaunchAuditRecord(input: {
  readonly id: string;
  readonly stage: SmartAuditStage;
  readonly decision: SmartLaunchDecisionKind;
  readonly reason: string;
  readonly issHost: string | null;
  readonly at: Date;
}): SmartLaunchAuditRecord {
  if (!isNonEmptyString(input.id)) {
    throw new Error("SmartLaunchAuditRecord requires a non-empty id.");
  }
  if (!isNonEmptyString(input.reason)) {
    throw new Error("SmartLaunchAuditRecord requires a non-empty reason code.");
  }
  if (input.issHost !== null && !isNonEmptyString(input.issHost)) {
    throw new Error("SmartLaunchAuditRecord.issHost must be null or a non-empty host.");
  }
  if (!(input.at instanceof Date) || Number.isNaN(input.at.getTime())) {
    throw new Error("SmartLaunchAuditRecord requires a valid timestamp.");
  }
  return {
    id: input.id,
    stage: input.stage,
    decision: input.decision,
    reason: input.reason,
    issHost: input.issHost,
    at: input.at,
  };
}

/** Stable host extraction for audit records — `null` when not extractable. */
export function auditIssHostOf(iss: string): string | null {
  try {
    const url = new URL(iss);
    return url.host.length > 0 ? url.host : null;
  } catch {
    return null;
  }
}
