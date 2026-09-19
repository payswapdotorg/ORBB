/**
 * A45 — the care-team permission evaluator: a PURE, deny-by-default
 * evaluator deciding whether a practitioner may exercise a scope
 * permission over a person's data at a point in time.
 *
 * LAYERING (the point of A45): this evaluator sits ON TOP of the kernel's
 * deny-by-default access evaluation (`@orbb/domain` `access.ts`) — it
 * imports the REAL `AccessGrant` type and DELEGATES the grant-side
 * verdict to the REAL `evaluateAccess` (single-grant candidacy, state,
 * expiry, scope coverage, purpose match — with no policies and no
 * emergency override at this layer; break-glass remains a kernel/consent-
 * lane concern, never a clinical-lane bypass). The kernel's
 * `recipientId` — documented there as opaque "until the consent lane
 * models them as entities" — is resolved HERE: a recipient is known iff
 * the grant's `recipientId` equals the requesting practitioner's
 * canonical id (the clinical lane is what makes recipients entities).
 *
 * DENY-BY-DEFAULT IS ABSOLUTE. Unknown recipient, unconfirmed link,
 * suspended practitioner, dissolved organization, expired grant, missing
 * scope — every one denies, each with a DISTINCT TYPED reason
 * ({@link CareTeamDenyReason}, a frozen closed vocabulary). There is NO
 * allow-by-default path anywhere: the only path to ALLOW is through
 * every check in the recorded order below, and the kernel evaluation
 * itself must ALLOW first. An unconfirmed link confers NOTHING; an
 * unverified practitioner is treated exactly like a suspended one
 * (verification is explicit, never implied).
 *
 * Evaluation order (recorded assumption, mirroring the kernel's fixed-
 * order discipline — order is semantics, tests pin it):
 *   1. scope vocabulary  — the requested permission must be one of the
 *      frozen read-only care-team permissions (`unknown-scope-permission`)
 *   2. recipient         — grant.recipientId resolves to the requesting
 *      practitioner (`unknown-recipient`)
 *   3. subject           — grant.subjectId is the requested person
 *      (`subject-mismatch`)
 *   4. KERNEL evaluation — `evaluateAccess` over the single grant; a
 *      kernel DENY is classified into `revoked-grant`, `expired-grant`,
 *      `missing-scope`, or `purpose-mismatch` (kernel order: state ->
 *      expiry -> scope -> purpose)
 *   5. patient link      — the link connects THIS pair and is `confirmed`
 *      (`unconfirmed-patient-link` — requested/declined/revoked/mismatched
 *      all collapse here: they confer nothing)
 *   6. care team         — the team is this person's (`not-on-care-team`),
 *      is `active` (`inactive-care-team`), and lists the practitioner
 *      (`not-on-care-team`)
 *   7. practitioner      — is the requesting practitioner
 *      (`not-on-care-team`), is not suspended (`suspended-practitioner`)
 *      and not unverified (`unverified-practitioner`)
 *   8. organization      — not dissolved (`dissolved-organization`) and
 *      not suspended (`suspended-organization`)
 *   9. membership        — the snapshot's membership binds the requesting
 *      practitioner to the organization and is active
 *      (`inactive-membership`)
 *  10. clinic (optional) — when the snapshot carries a clinic: not
 *      dissolved (`dissolved-clinic`), not suspended
 *      (`suspended-clinic`)
 *  11. affiliation (optional) — when a clinic is present: the affiliation
 *      binds the practitioner to that clinic and is active
 *      (`inactive-affiliation`; a clinic without any affiliation also
 *      denies — clinic-scoped access demands an active affiliation)
 *
 * Every decision — ALLOW and DENY alike — carries a
 * {@link ClinicalAccessAuditRecord} (who/what/when/decision/reason),
 * shaped for the append-only `access_audits` table (db-integration
 * handoff recorded in `audit.ts`).
 *
 * RECORDED ASSUMPTIONS:
 *   - The evaluator is pure and deterministic: `request.at` IS the
 *     evaluation instant. The calling layer owns the clock (injected at
 *     the boundary — tests exercise expiry by moving the injected
 *     instant, never by sleeping).
 *   - Malformed INPUTS throw {@link DomainInvariantError} (data-integrity
 *     failures — kernel discipline); malformed AUTHORIZATION always
 *     denies, never throws and never allows.
 *   - Emergency/break-glass is deliberately NOT modeled here: the kernel
 *     owns the override; a clinical-layer bypass would be an
 *     allow-by-default path.
 */
import {
  DomainInvariantError,
  evaluateAccess,
  grantsOperation,
  isPersonId,
  parseScopePermission,
  type AccessGrant,
  type GrantId,
  type PersonId,
} from "@orbb/domain";
import {
  CLINICAL_ACCESS_ALLOW_REASON,
  type ClinicalAccessAuditRecord,
} from "./audit.js";
import { assertCareTeam, type CareTeam, type CareTeamRole } from "./careTeams.js";
import { isPractitionerId, type PractitionerId } from "./ids.js";
import { assertClinic, assertOrganization, type Clinic, type Organization } from "./organizations.js";
import { assertPatientLink, type PatientLink } from "./patientLinks.js";
import {
  assertPractitioner,
  assertPractitionerClinicAffiliation,
  assertPractitionerOrganizationMembership,
  type Practitioner,
  type PractitionerClinicAffiliation,
  type PractitionerOrganizationMembership,
} from "./practitioners.js";
import { isCareTeamScopePermission } from "./scopes.js";

// ---------------------------------------------------------------------------
// The frozen typed deny-reason vocabulary.
// ---------------------------------------------------------------------------

/**
 * Every way a care-team access request can be denied — a frozen, closed
 * vocabulary; each failure mode has exactly one typed reason. Extending
 * it is a reviewed change to this package, not a caller decision.
 */
export const CARE_TEAM_DENY_REASONS = [
  "unknown-scope-permission",
  "unknown-recipient",
  "subject-mismatch",
  "revoked-grant",
  "expired-grant",
  "missing-scope",
  "purpose-mismatch",
  "unconfirmed-patient-link",
  "inactive-care-team",
  "not-on-care-team",
  "suspended-practitioner",
  "unverified-practitioner",
  "dissolved-organization",
  "suspended-organization",
  "inactive-membership",
  "dissolved-clinic",
  "suspended-clinic",
  "inactive-affiliation",
] as const;

export type CareTeamDenyReason = (typeof CARE_TEAM_DENY_REASONS)[number];

export function isCareTeamDenyReason(value: unknown): value is CareTeamDenyReason {
  return (
    typeof value === "string" && (CARE_TEAM_DENY_REASONS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Request + snapshot.
// ---------------------------------------------------------------------------

/** The care-team access request — who is asking, for what, when. */
export interface CareTeamAccessRequest {
  /** The person whose data is targeted. */
  readonly subjectId: PersonId;
  /** The practitioner requesting access (the resolved grant recipient). */
  readonly practitionerId: PractitionerId;
  /** Stated purpose of use (consent-lane vocabulary, matched by the kernel). */
  readonly purpose: string;
  /** Requested care-team scope permission (frozen read-only vocabulary). */
  readonly permission: string;
  /** Request/evaluation instant (the calling layer injects the clock). */
  readonly at: Date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isCareTeamAccessRequest(value: unknown): value is CareTeamAccessRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CareTeamAccessRequest, unknown>>;
  if (!isPersonId(candidate.subjectId)) {
    return false;
  }
  if (!isPractitionerId(candidate.practitionerId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.purpose)) {
    return false;
  }
  if (!isNonEmptyString(candidate.permission)) {
    return false;
  }
  if (!isTimestamp(candidate.at)) {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link CareTeamAccessRequest}. */
export function assertCareTeamAccessRequest(
  candidate: unknown,
): asserts candidate is CareTeamAccessRequest {
  if (!isCareTeamAccessRequest(candidate)) {
    throw new DomainInvariantError(
      "Invalid care-team access request: expected { subjectId, practitionerId, purpose, permission, at } with a canonical prsn_ subject id, a canonical pract_ practitioner id, non-empty purpose/permission labels, and a valid request timestamp.",
    );
  }
}

/**
 * The clinical state snapshot the evaluator reasons over. The grant is
 * the REAL kernel {@link AccessGrant}; the clinical entities are the
 * A44/A45 aggregates. `organization` + `membership` are REQUIRED (a
 * practitioner practices within an organization — fail-closed); `clinic`
 * + `affiliation` are OPTIONAL (clinic-scoped access demands them, and
 * demands they be healthy, when present).
 */
export interface CareTeamAccessSnapshot {
  readonly grant: AccessGrant;
  readonly patientLink: PatientLink;
  readonly careTeam: CareTeam;
  readonly practitioner: Practitioner;
  readonly organization: Organization;
  readonly membership: PractitionerOrganizationMembership;
  /** When present: clinic-scoped access is additionally checked. */
  readonly clinic?: Clinic;
  /** When a clinic is present: an active affiliation is REQUIRED. */
  readonly affiliation?: PractitionerClinicAffiliation;
}

// ---------------------------------------------------------------------------
// Decision.
// ---------------------------------------------------------------------------

/** The ALLOW outcome — reachable only through every check. */
export interface CareTeamAccessAllowed {
  readonly kind: "ALLOW";
  readonly evaluatedAt: Date;
  /** The kernel grant that authorized the request. */
  readonly grantId: GrantId;
  /** The practitioner's care-team role label, when one is recorded. */
  readonly careTeamRole?: CareTeamRole;
  readonly audit: ClinicalAccessAuditRecord;
}

/** The DENY outcome — carries exactly one typed reason. */
export interface CareTeamAccessDenied {
  readonly kind: "DENY";
  readonly evaluatedAt: Date;
  readonly reason: CareTeamDenyReason;
  readonly audit: ClinicalAccessAuditRecord;
}

export type CareTeamAccessDecision = CareTeamAccessAllowed | CareTeamAccessDenied;

// ---------------------------------------------------------------------------
// The evaluator.
// ---------------------------------------------------------------------------

function auditFor(
  request: CareTeamAccessRequest,
  decision: "ALLOW" | "DENY",
  reason: string,
): ClinicalAccessAuditRecord {
  return {
    actor: request.practitionerId,
    subjectId: request.subjectId,
    permission: request.permission,
    at: request.at,
    decision,
    reason,
  };
}

function deny(request: CareTeamAccessRequest, reason: CareTeamDenyReason): CareTeamAccessDenied {
  return {
    kind: "DENY",
    reason,
    evaluatedAt: request.at,
    audit: auditFor(request, "DENY", reason),
  };
}

/**
 * Pure, deny-by-default care-team permission evaluation.
 *
 * Structural validation: the request and every snapshot entity are
 * validated up front (malformed input is a data-integrity failure and
 * throws {@link DomainInvariantError} — kernel discipline; the grant
 * itself is asserted by the kernel's `evaluateAccess` once it becomes a
 * candidacy match). Semantic failures always DENY with a distinct typed
 * reason; the ONLY allow path requires the kernel evaluation to ALLOW
 * and every clinical condition to hold.
 */
export function evaluateCareTeamAccess(
  request: CareTeamAccessRequest,
  snapshot: CareTeamAccessSnapshot,
): CareTeamAccessDecision {
  assertCareTeamAccessRequest(request);
  assertPatientLink(snapshot.patientLink);
  assertCareTeam(snapshot.careTeam);
  assertPractitioner(snapshot.practitioner);
  assertOrganization(snapshot.organization);
  assertPractitionerOrganizationMembership(snapshot.membership);
  if (snapshot.clinic !== undefined) {
    assertClinic(snapshot.clinic);
  }
  if (snapshot.affiliation !== undefined) {
    assertPractitionerClinicAffiliation(snapshot.affiliation);
  }

  // 1. Scope vocabulary: the frozen read-only care-team permissions.
  if (!isCareTeamScopePermission(request.permission)) {
    return deny(request, "unknown-scope-permission");
  }

  const grant = snapshot.grant;

  // 2. Recipient resolution: the clinical lane resolves the kernel's
  //    opaque recipientId — known iff it IS the requesting practitioner.
  if (grant.recipientId !== request.practitionerId) {
    return deny(request, "unknown-recipient");
  }

  // 3. Subject match.
  if (grant.subjectId !== request.subjectId) {
    return deny(request, "subject-mismatch");
  }

  // 4. KERNEL evaluation (layering: the real deny-by-default authority on
  //    the grant side — single grant, no policies, no emergency).
  const permission = parseScopePermission(request.permission);
  const kernelDecision = evaluateAccess(
    {
      subjectId: request.subjectId,
      recipientId: request.practitionerId,
      resource: { resourceKind: permission.resourceKind },
      purpose: request.purpose,
      operation: permission.operation,
      at: request.at,
    },
    [grant],
    [],
    [],
    { active: false },
  );
  if (kernelDecision.decision === "DENY") {
    return deny(request, classifyKernelDenial(grant, request, permission));
  }

  // 5. Patient link: confirmed AND connecting THIS pair — everything else
  //    (requested, declined, revoked, mismatched) confers nothing.
  const link = snapshot.patientLink;
  if (
    link.personId !== request.subjectId ||
    link.practitionerId !== request.practitionerId ||
    link.state !== "confirmed"
  ) {
    return deny(request, "unconfirmed-patient-link");
  }

  // 6. Care team: this person's team, active, listing the practitioner.
  const team = snapshot.careTeam;
  if (team.personId !== request.subjectId) {
    return deny(request, "not-on-care-team");
  }
  if (team.state !== "active") {
    return deny(request, "inactive-care-team");
  }
  const entry = team.entries.find(
    (candidate) => candidate.practitionerId === request.practitionerId,
  );
  if (entry === undefined) {
    return deny(request, "not-on-care-team");
  }

  // 7. Practitioner: is the requesting practitioner, never suspended,
  //    never unverified.
  const practitioner = snapshot.practitioner;
  if (practitioner.id !== request.practitionerId) {
    return deny(request, "not-on-care-team");
  }
  if (practitioner.state === "suspended-from-verified") {
    return deny(request, "suspended-practitioner");
  }
  if (practitioner.state === "unverified") {
    return deny(request, "unverified-practitioner");
  }

  // 8. Organization: never dissolved, never suspended.
  const organization = snapshot.organization;
  if (organization.state === "dissolved") {
    return deny(request, "dissolved-organization");
  }
  if (organization.state === "suspended") {
    return deny(request, "suspended-organization");
  }

  // 9. Membership: binds the requesting practitioner to the organization,
  //    and is active.
  const membership = snapshot.membership;
  if (
    membership.practitionerId !== request.practitionerId ||
    membership.organizationId !== organization.id ||
    membership.active !== true
  ) {
    return deny(request, "inactive-membership");
  }

  // 10/11. Clinic + affiliation (only when the snapshot is clinic-scoped).
  if (snapshot.clinic !== undefined) {
    const clinic = snapshot.clinic;
    if (clinic.state === "dissolved") {
      return deny(request, "dissolved-clinic");
    }
    if (clinic.state === "suspended") {
      return deny(request, "suspended-clinic");
    }
    const affiliation = snapshot.affiliation;
    if (
      affiliation === undefined ||
      affiliation.practitionerId !== request.practitionerId ||
      affiliation.clinicId !== clinic.id ||
      affiliation.active !== true
    ) {
      return deny(request, "inactive-affiliation");
    }
  }

  // ALLOW — the only path: kernel ALLOW plus every clinical condition.
  return {
    kind: "ALLOW",
    evaluatedAt: request.at,
    grantId: grant.id,
    ...(entry.role !== undefined ? { careTeamRole: entry.role } : {}),
    audit: auditFor(request, "ALLOW", CLINICAL_ACCESS_ALLOW_REASON),
  };
}

/**
 * Classifies a kernel DENY into the distinct typed clinical reason.
 * Kernel order mirrored: state -> expiry -> scope -> purpose. With a
 * single pre-matched candidacy grant, no policies, and no emergency,
 * these four checks are exhaustive; the final throw is an unreachable
 * internal-invariant guard (fail-closed even against itself).
 */
function classifyKernelDenial(
  grant: AccessGrant,
  request: CareTeamAccessRequest,
  permission: { resourceKind: string; operation: string },
): CareTeamDenyReason {
  if (grant.state !== "active") {
    return "revoked-grant";
  }
  if (!(grant.expiresAt > request.at)) {
    // Domain rule: a grant is valid strictly BEFORE its expiry instant.
    return "expired-grant";
  }
  if (!grantsOperation(grant.scope, permission.resourceKind, permission.operation)) {
    return "missing-scope";
  }
  if (grant.purpose !== request.purpose) {
    return "purpose-mismatch";
  }
  throw new DomainInvariantError(
    "Internal invariant violation: the kernel denied a grant-side request the clinical layer could not classify — failing closed.",
  );
}
