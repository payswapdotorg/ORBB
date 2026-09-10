/**
 * Access/consent evaluation rules — the M1 centerpiece.
 *
 * A pure, deny-by-default evaluator that decides whether a recipient may
 * perform an operation on a person's data for a stated purpose at a point
 * in time, given the person's grants, the applicable consent policies, the
 * subject/recipient relationship graph, and the emergency (break-glass)
 * state.
 *
 * Recorded assumptions (evaluation order, fixed):
 *   1. Emergency override — an active emergency short-circuits the entire
 *      evaluation to ALLOW (break-glass: access is granted and audited,
 *      not pre-authorized). It bypasses grant validity, scope, purpose, and
 *      policy restrictions alike; the audit trail is the compensating
 *      control. "No grant -> DENY always" therefore governs the
 *      NON-emergency path only.
 *   2. Grant candidacy — only grants whose subjectId AND recipientId match
 *      the request are considered at all (cross-subject grants never
 *      apply, and are never even inspected further).
 *   3. Grant validity — state "active" AND not expired at request time
 *      (a grant is expired once request.at >= expiresAt — it is valid
 *      strictly before its expiry instant).
 *   4. Scope match — the requested resource kind AND operation must be
 *      within the grant's scope ("<kind>:<operation>" permission entries).
 *   5. Purpose match — the request purpose must equal the grant purpose.
 *   6. Policy rules — applicable policies can further RESTRICT but never
 *      widen a grant: they only add deny conditions, are evaluated only
 *      after a grant has already matched, and can never flip a grantless
 *      DENY into an ALLOW.
 *
 * Entity ownership: Purpose, Recipient, ConsentPolicy, Relationship and
 * EmergencyState reference opaque ids/labels owned by the consent lane —
 * this module evaluates rules over them, it does not model the entities.
 * Reasons carry names/labels only — never data values (and never the
 * granted/requested purpose strings, which are consent-lane vocabulary).
 */
import { DomainInvariantError } from "./errors.js";
import { isIdOf, parseProvenanceId, type PersonId, type ProvenanceId } from "./ids.js";
import { assertAccessGrant, type AccessGrant } from "./grant.js";

// ---------------------------------------------------------------------------
// Opaque vocabulary types (consent lane owns the entities).
// ---------------------------------------------------------------------------

/** Opaque purpose-of-use id (e.g. "CARE_MANAGEMENT"). */
export type Purpose = string;

/** Opaque recipient id (clinician, study, organization, or service). */
export type Recipient = string;

/** Opaque resource kind label (e.g. "observation", "intent", "plan"). */
export type ResourceKind = string;

/** Opaque data operation label (e.g. "read", "write"). */
export type DataOperation = string;

/** Convenience constants for the conventional operation vocabulary. */
export const READ_OPERATION: DataOperation = "read";
export const WRITE_OPERATION: DataOperation = "write";

// ---------------------------------------------------------------------------
// Data scope.
// ---------------------------------------------------------------------------

/** A single field/value constraint narrowing a resource set. */
export interface DataScopeFilter {
  /** Filter field label (e.g. "conceptCode"). */
  readonly field: string;
  /** Filter constraint (opaque label — not an observation data value). */
  readonly value: string;
}

/**
 * The resource a request or grant targets: a resource kind plus optional
 * filters. Recorded assumption: M1 grant scopes are kind+operation level
 * (the M0 AccessGrant scope format "<kind>:<operation>"), so filters do not
 * participate in grant matching — they are carried on requests for the
 * audit trail and for the consent lane's future field-level refinement.
 */
export interface DataScope {
  readonly resourceKind: ResourceKind;
  readonly filters?: readonly DataScopeFilter[];
}

export function isDataScopeFilter(value: unknown): value is DataScopeFilter {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof DataScopeFilter, unknown>>;
  return (
    typeof candidate.field === "string" &&
    candidate.field.length > 0 &&
    typeof candidate.value === "string" &&
    candidate.value.length > 0
  );
}

export function isDataScope(value: unknown): value is DataScope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof DataScope, unknown>>;
  if (typeof candidate.resourceKind !== "string" || candidate.resourceKind.length === 0) {
    return false;
  }
  if (candidate.filters !== undefined) {
    if (!Array.isArray(candidate.filters)) {
      return false;
    }
    for (const filter of candidate.filters) {
      if (!isDataScopeFilter(filter)) {
        return false;
      }
    }
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link DataScope}. */
export function assertDataScope(candidate: unknown): asserts candidate is DataScope {
  if (!isDataScope(candidate)) {
    throw new DomainInvariantError(
      "Invalid data scope: expected { resourceKind, filters? } with a non-empty resource kind and, if present, filters of { field, value } with non-empty strings.",
    );
  }
}

// ---------------------------------------------------------------------------
// Policies, relationships, emergency state.
// ---------------------------------------------------------------------------

/**
 * A consent policy: a rule set that can further restrict access.
 *
 * Recorded assumptions:
 *   - `purposes` scopes the policy: a policy with an absent/empty list
 *     governs ALL purposes; otherwise it governs only the listed purposes.
 *   - All rule fields are optional and purely restrictive (deny-side):
 *     required relationship types, denied operations, denied resource
 *     kinds. A policy with no rules is a no-op.
 */
export interface ConsentPolicy {
  /** Opaque policy id (consent lane owns the vocabulary). */
  readonly id: string;
  /** Human-readable policy label (may appear in decision reasons). */
  readonly label: string;
  /** Purposes this policy governs; absent/empty = all purposes. */
  readonly purposes?: readonly Purpose[];
  /** If non-empty: requires an active relationship of a listed type. */
  readonly requiredRelationshipTypes?: readonly string[];
  /** Operations this policy forbids. */
  readonly deniedOperations?: readonly DataOperation[];
  /** Resource kinds this policy forbids. */
  readonly deniedResourceKinds?: readonly ResourceKind[];
}

/**
 * A subject/recipient relationship (e.g. care-team membership).
 * Recorded assumption: `type` is an opaque relationship-type label and
 * `active` is the current flag — temporal validity of relationships is a
 * consent-lane concern (M1 evaluates against the snapshot given).
 */
export interface Relationship {
  readonly subjectId: PersonId;
  readonly recipientId: Recipient;
  /** Opaque relationship type label (e.g. "care-team"). */
  readonly type: string;
  readonly active: boolean;
}

/**
 * Emergency (break-glass) state. Recorded assumption: a single boolean
 * flag scoped to the evaluation call plus an optional context label; the
 * consent lane owns emergency sessions and their lifecycle.
 */
export interface EmergencyState {
  readonly active: boolean;
  /** Emergency context label (may appear in decision reasons). */
  readonly label?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalNonEmptyStringList(value: unknown): value is readonly string[] | undefined {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => isNonEmptyString(entry));
}

export function isConsentPolicy(value: unknown): value is ConsentPolicy {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ConsentPolicy, unknown>>;
  if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.label)) {
    return false;
  }
  if (!isOptionalNonEmptyStringList(candidate.purposes)) {
    return false;
  }
  if (!isOptionalNonEmptyStringList(candidate.requiredRelationshipTypes)) {
    return false;
  }
  if (!isOptionalNonEmptyStringList(candidate.deniedOperations)) {
    return false;
  }
  if (!isOptionalNonEmptyStringList(candidate.deniedResourceKinds)) {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link ConsentPolicy}. */
export function assertConsentPolicy(candidate: unknown): asserts candidate is ConsentPolicy {
  if (!isConsentPolicy(candidate)) {
    throw new DomainInvariantError(
      "Invalid consent policy: expected { id, label, purposes?, requiredRelationshipTypes?, deniedOperations?, deniedResourceKinds? } with non-empty id/label and, where present, lists of non-empty strings.",
    );
  }
}

export function isRelationship(value: unknown): value is Relationship {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Relationship, unknown>>;
  if (!isIdOf("person", candidate.subjectId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.recipientId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.type)) {
    return false;
  }
  if (typeof candidate.active !== "boolean") {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link Relationship}. */
export function assertRelationship(candidate: unknown): asserts candidate is Relationship {
  if (!isRelationship(candidate)) {
    throw new DomainInvariantError(
      "Invalid relationship: expected { subjectId, recipientId, type, active } with a canonical person id, non-empty recipient/type labels, and a boolean active flag.",
    );
  }
}

export function isEmergencyState(value: unknown): value is EmergencyState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof EmergencyState, unknown>>;
  if (typeof candidate.active !== "boolean") {
    return false;
  }
  if (candidate.label !== undefined && !isNonEmptyString(candidate.label)) {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link EmergencyState}. */
export function assertEmergencyState(candidate: unknown): asserts candidate is EmergencyState {
  if (!isEmergencyState(candidate)) {
    throw new DomainInvariantError(
      "Invalid emergency state: expected { active, label? } with a boolean active flag and, if present, a non-empty label.",
    );
  }
}

// ---------------------------------------------------------------------------
// Access request + decision.
// ---------------------------------------------------------------------------

/** An access request, evaluated at `at`. */
export interface AccessRequest {
  /** The person whose data is targeted. */
  readonly subjectId: PersonId;
  /** Who is asking for access. */
  readonly recipientId: Recipient;
  /** What resource (kind + optional filters). */
  readonly resource: DataScope;
  /** Stated purpose of use. */
  readonly purpose: Purpose;
  /** Requested operation. */
  readonly operation: DataOperation;
  /** Request/evaluation time. */
  readonly at: Date;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isAccessRequest(value: unknown): value is AccessRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof AccessRequest, unknown>>;
  if (!isIdOf("person", candidate.subjectId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.recipientId)) {
    return false;
  }
  if (!isDataScope(candidate.resource)) {
    return false;
  }
  if (!isNonEmptyString(candidate.purpose)) {
    return false;
  }
  if (!isNonEmptyString(candidate.operation)) {
    return false;
  }
  if (!isTimestamp(candidate.at)) {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link AccessRequest}. */
export function assertAccessRequest(candidate: unknown): asserts candidate is AccessRequest {
  if (!isAccessRequest(candidate)) {
    throw new DomainInvariantError(
      "Invalid access request: expected { subjectId, recipientId, resource, purpose, operation, at } with a canonical person id, non-empty recipient/purpose/operation labels, a well-formed data scope, and a valid request timestamp.",
    );
  }
}

export const ACCESS_DECISION_KINDS = ["ALLOW", "DENY"] as const;

export type AccessDecisionKind = (typeof ACCESS_DECISION_KINDS)[number];

/**
 * The result of {@link evaluateAccess}.
 *
 * Recorded assumptions:
 *   - `reasons` carries names/labels only — never data values. Grant ids,
 *     policy labels, operation and resource-kind labels may appear; the
 *     granted/requested purpose strings deliberately do not.
 *   - `evaluatedAt` is the request time (`request.at`): the evaluator is
 *     pure and deterministic; the calling layer stamps wall-clock time in
 *     the audit record.
 *   - `provenanceId` is a well-formed PLACEHOLDER sentinel: a pure function
 *     cannot mint real provenance ids. The persistence layer replaces it
 *     with a real provenance record id when the decision is recorded.
 */
export interface AccessDecision {
  readonly decision: AccessDecisionKind;
  readonly reasons: readonly string[];
  readonly evaluatedAt: Date;
  readonly provenanceId: ProvenanceId;
}

/** Placeholder provenance id carried by every decision from {@link evaluateAccess}. */
export const ACCESS_DECISION_PROVENANCE_PLACEHOLDER: ProvenanceId = parseProvenanceId(
  "prov_placeholder00000000",
);

// ---------------------------------------------------------------------------
// Grant scope permissions.
// ---------------------------------------------------------------------------

/** A parsed "<resourceKind>:<operation>" scope permission entry. */
export interface ScopePermission {
  readonly resourceKind: ResourceKind;
  readonly operation: DataOperation;
}

/**
 * Parses an AccessGrant scope entry of the form "<kind>:<operation>"
 * (exactly one colon; both segments non-empty). Throws
 * {@link DomainInvariantError} on malformed entries — scope format
 * violations are data-integrity failures, not authorization denials.
 */
export function parseScopePermission(entry: string): ScopePermission {
  const separatorIndex = entry.indexOf(":");
  if (
    separatorIndex < 1 ||
    separatorIndex !== entry.lastIndexOf(":") ||
    separatorIndex === entry.length - 1
  ) {
    throw new DomainInvariantError(
      'Invalid grant scope permission: expected "<resourceKind>:<operation>" with non-empty segments and exactly one colon.',
    );
  }
  return {
    resourceKind: entry.slice(0, separatorIndex),
    operation: entry.slice(separatorIndex + 1),
  };
}

/** Does the scope grant `operation` on `resourceKind`? Throws on malformed entries. */
export function grantsOperation(
  scope: readonly string[],
  resourceKind: ResourceKind,
  operation: DataOperation,
): boolean {
  return scope.some((entry) => {
    const permission = parseScopePermission(entry);
    return permission.resourceKind === resourceKind && permission.operation === operation;
  });
}

// ---------------------------------------------------------------------------
// Evaluation.
// ---------------------------------------------------------------------------

function allow(reasons: readonly string[], evaluatedAt: Date): AccessDecision {
  return {
    decision: "ALLOW",
    reasons,
    evaluatedAt,
    provenanceId: ACCESS_DECISION_PROVENANCE_PLACEHOLDER,
  };
}

function deny(reasons: readonly string[], evaluatedAt: Date): AccessDecision {
  return {
    decision: "DENY",
    reasons,
    evaluatedAt,
    provenanceId: ACCESS_DECISION_PROVENANCE_PLACEHOLDER,
  };
}

function policyApplies(policy: ConsentPolicy, request: AccessRequest): boolean {
  if (policy.purposes === undefined || policy.purposes.length === 0) {
    return true;
  }
  return policy.purposes.includes(request.purpose);
}

/**
 * Collects the deny reasons introduced by applicable policies (empty array
 * = no policy restriction applies). Policies can only restrict — this
 * returns deny-side reasons exclusively.
 */
function evaluatePolicyRestrictions(
  request: AccessRequest,
  policies: readonly ConsentPolicy[],
  relationships: readonly Relationship[],
): string[] {
  const denials: string[] = [];
  for (const policy of policies) {
    if (!policyApplies(policy, request)) {
      continue;
    }
    if (policy.deniedOperations?.includes(request.operation)) {
      denials.push(`policy "${policy.label}" denies operation "${request.operation}"`);
    }
    if (policy.deniedResourceKinds?.includes(request.resource.resourceKind)) {
      denials.push(
        `policy "${policy.label}" denies resource kind "${request.resource.resourceKind}"`,
      );
    }
    const requiredTypes = policy.requiredRelationshipTypes;
    if (requiredTypes !== undefined && requiredTypes.length > 0) {
      const satisfied = relationships.some(
        (relationship) =>
          relationship.active &&
          relationship.subjectId === request.subjectId &&
          relationship.recipientId === request.recipientId &&
          requiredTypes.includes(relationship.type),
      );
      if (!satisfied) {
        denials.push(
          `policy "${policy.label}" requires an active relationship of type ${requiredTypes.join(" | ")} between subject and recipient`,
        );
      }
    }
  }
  return denials;
}

/**
 * Pure, deny-by-default access evaluation.
 *
 * Evaluation order (recorded as an assumption, see module docs):
 *   emergency override -> grant candidacy -> grant validity -> scope match
 *   -> purpose match -> policy rules. No grant -> DENY always (non-emergency
 *   path). If several grants match the subject+recipient, ANY single grant
 *   that passes every stage authorizes the request (grants are independent
 *   authorizations); otherwise the decision is DENY with every collected
 *   failure reason.
 *
 * Throws {@link DomainInvariantError} on malformed inputs: the request,
 * policies, relationships, emergency state, and any CANDIDATE grant
 * (matching subject+recipient) are structurally validated. Non-candidate
 * grants are ignored entirely and never inspected.
 */
export function evaluateAccess(
  request: AccessRequest,
  grants: readonly AccessGrant[],
  policies: readonly ConsentPolicy[],
  relationships: readonly Relationship[],
  emergency: EmergencyState,
): AccessDecision {
  assertAccessRequest(request);
  assertEmergencyState(emergency);
  for (const policy of policies) {
    assertConsentPolicy(policy);
  }
  for (const relationship of relationships) {
    assertRelationship(relationship);
  }

  const evaluatedAt = request.at;

  // 1. Emergency override (break-glass): short-circuits to ALLOW.
  if (emergency.active) {
    const reasons = emergency.label
      ? ["emergency override active", `emergency context: ${emergency.label}`]
      : ["emergency override active"];
    return allow(reasons, evaluatedAt);
  }

  // 2. Grant candidacy: subject AND recipient must match (cross-subject
  //    grants never apply — and are never inspected beyond this check).
  const candidates = grants.filter(
    (grant) => grant.subjectId === request.subjectId && grant.recipientId === request.recipientId,
  );
  if (candidates.length === 0) {
    return deny(["no grant for subject and recipient"], evaluatedAt);
  }
  for (const grant of candidates) {
    assertAccessGrant(grant);
  }

  const policyDenials = evaluatePolicyRestrictions(request, policies, relationships);
  const applicablePolicyNotes = policies
    .filter((policy) => policyApplies(policy, request))
    .map((policy) => `policy "${policy.label}" satisfied`);

  const reasons: string[] = [];
  let policyDenialsRecorded = false;

  for (const grant of candidates) {
    // 3. Grant validity: active + not expired at request time.
    if (grant.state !== "active") {
      reasons.push(`grant ${grant.id} is revoked`);
      continue;
    }
    if (!(grant.expiresAt > request.at)) {
      reasons.push(`grant ${grant.id} is expired at request time`);
      continue;
    }
    // 4. Scope match: resource kind AND operation within granted scope.
    if (!grantsOperation(grant.scope, request.resource.resourceKind, request.operation)) {
      reasons.push(
        `grant ${grant.id} does not cover operation "${request.operation}" on resource kind "${request.resource.resourceKind}"`,
      );
      continue;
    }
    // 5. Purpose match (purpose strings are never echoed in reasons).
    if (grant.purpose !== request.purpose) {
      reasons.push(`grant ${grant.id} does not cover the requested purpose`);
      continue;
    }
    // 6. Policy rules: further restrict, never widen.
    if (policyDenials.length > 0) {
      if (!policyDenialsRecorded) {
        reasons.push(...policyDenials);
        policyDenialsRecorded = true;
      }
      continue;
    }
    return allow([`allowed by grant ${grant.id}`, ...applicablePolicyNotes], evaluatedAt);
  }

  return deny(reasons, evaluatedAt);
}

// ---------------------------------------------------------------------------
// Audit (append-only intent).
// ---------------------------------------------------------------------------

/**
 * Append-only audit record for an access decision. Recorded assumptions:
 *   - `id` / `decisionId` are opaque ids assigned by the persistence lane
 *     (the decision itself carries no id; the canonical id list is frozen).
 *   - `actor` is an opaque actor reference (person, recipient, or service).
 *   - `requestDigest` is a digest of the request — see
 *     {@link digestAccessRequest}. Raw request data values never appear.
 */
export interface AccessAudit {
  readonly id: string;
  readonly decisionId: string;
  readonly at: Date;
  readonly actor: string;
  readonly requestDigest: string;
}

export function isAccessAudit(value: unknown): value is AccessAudit {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof AccessAudit, unknown>>;
  if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.decisionId)) {
    return false;
  }
  if (!isTimestamp(candidate.at)) {
    return false;
  }
  if (!isNonEmptyString(candidate.actor)) {
    return false;
  }
  if (!isNonEmptyString(candidate.requestDigest)) {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link AccessAudit}. */
export function assertAccessAudit(candidate: unknown): asserts candidate is AccessAudit {
  if (!isAccessAudit(candidate)) {
    throw new DomainInvariantError(
      "Invalid access audit record: expected { id, decisionId, at, actor, requestDigest } with non-empty id/decisionId/actor/requestDigest strings and a valid timestamp.",
    );
  }
}

/**
 * Deterministic request digest for {@link AccessAudit} records.
 *
 * Recorded assumption: this is a structural (non-cryptographic) digest over
 * the request's identity labels — subject, recipient, resource kind, filter
 * COUNT (filter values are deliberately excluded so data values never reach
 * the audit trail), operation, purpose, and the request instant. The
 * persistence lane may replace it with a cryptographic hash at the boundary.
 */
export function digestAccessRequest(request: AccessRequest): string {
  assertAccessRequest(request);
  const parts = [
    "subject",
    request.subjectId,
    "recipient",
    request.recipientId,
    "resourceKind",
    request.resource.resourceKind,
    "filters",
    String(request.resource.filters?.length ?? 0),
    "operation",
    request.operation,
    "purpose",
    request.purpose,
    "at",
    request.at.toISOString(),
  ];
  return parts.join("|");
}
