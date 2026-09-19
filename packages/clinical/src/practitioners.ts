/**
 * A44 — Practitioner aggregate + the membership aggregates
 * (PractitionerOrganizationMembership, PractitionerClinicAffiliation).
 *
 * Practitioner verification state machine (recorded grammar):
 *
 *   unverified -> verified                  (explicit verification)
 *   verified -> suspended-from-verified     (suspension of a verified
 *                                            practitioner)
 *   suspended-from-verified -> reverified   (reverification)
 *   reverified -> suspended-from-verified   (a reverified practitioner can
 *                                            be suspended again)
 *
 * VERIFICATION IS AN EXPLICIT, AUDITABLE STEP, NEVER IMPLIED. Nothing in
 * this package verifies anything: `verifyPractitioner` records that a
 * verification happened (who verified, what evidence, when — see
 * {@link PractitionerVerification}) and applies the legal transition.
 * There is no constructor that mints a practitioner directly in
 * `verified`/`reverified`, and no transition that reaches them except the
 * explicit verification steps — proven by the transition table and by
 * test.
 *
 * RECORDED ASSUMPTIONS (SYNTH-only vocabulary — jurisdiction-specific
 * governance is REQUIRED before real-world use, per AGENTS.md):
 *   - WHO verifies: an opaque `verifiedBy` label (e.g. a SYNTH
 *     "credentialing-authority" label). Modeling actual credentialing
 *     bodies, licenses, or jurisdictional registries is out of scope —
 *     the vocabulary is deliberately SYNTH-only.
 *   - WHAT evidence: an opaque `evidence` LABEL (never an evidence
 *     object, never a document, never PHI — labels only, mirroring the
 *     kernel's "reasons carry names/labels only" rule).
 *   - `unverified` is the initial state and can ONLY move to `verified`.
 *     There is no declined/rejected verification state — a failed
 *     verification simply leaves the practitioner `unverified` (fail
 *     closed: an unverified practitioner is denied by the care-team
 *     evaluator with a distinct typed reason).
 *   - `suspended-from-verified` is reachable ONLY from `verified` or
 *     `reverified` — never from `unverified` (suspending an unverified
 *     practitioner would imply it once carried verified status).
 *   - No terminal state: a suspended practitioner can always be
 *     reverified. Permanent debarment is a jurisdictional governance
 *     concern recorded out of scope.
 *
 * Membership role vocabulary (frozen in-package): `member | admin | owner`.
 * RECORDED ASSUMPTION: the same role ladder applies to organization
 * membership and clinic affiliation; finer-grained per-clinical-context
 * roles (e.g. attending, referring) are an M7-B refinement. Both
 * aggregates carry an `active` flag mirroring the kernel `Relationship`
 * discipline ("temporal validity is a snapshot concern — the evaluator
 * evaluates against the snapshot given").
 */
import { DomainInvariantError } from "@orbb/domain";
import { isClinicId, isOrganizationId, isPractitionerId, type ClinicId, type OrganizationId, type PractitionerId } from "./ids.js";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  isState,
  parseState,
  type StateTransitionTable,
} from "./stateMachine.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

// ---------------------------------------------------------------------------
// Practitioner aggregate.
// ---------------------------------------------------------------------------

export const PRACTITIONER_STATES = [
  "unverified",
  "verified",
  "suspended-from-verified",
  "reverified",
] as const;

export type PractitionerState = (typeof PRACTITIONER_STATES)[number];

/**
 * Legal PractitionerState transitions. `unverified` only moves forward via
 * the explicit verification step; `verified`/`reverified` only move to
 * `suspended-from-verified`; `suspended-from-verified` only moves back via
 * reverification. No terminal state.
 */
export const PRACTITIONER_STATE_TRANSITIONS: StateTransitionTable<PractitionerState> = {
  unverified: ["verified"],
  verified: ["suspended-from-verified"],
  "suspended-from-verified": ["reverified"],
  reverified: ["suspended-from-verified"],
};

export function isPractitionerState(value: unknown): value is PractitionerState {
  return isState(PRACTITIONER_STATES, value);
}

export function parsePractitionerState(value: unknown): PractitionerState {
  return parseState(PRACTITIONER_STATES, value, "practitioner state");
}

export function allowedPractitionerTransitions(
  from: PractitionerState,
): readonly PractitionerState[] {
  return allowedTransitions(PRACTITIONER_STATE_TRANSITIONS, from);
}

export function canTransitionPractitioner(
  from: PractitionerState,
  to: PractitionerState,
): boolean {
  return canTransition(PRACTITIONER_STATE_TRANSITIONS, from, to);
}

/** Throws {@link DomainInvariantError} on illegal transitions. */
export function assertPractitionerTransition(
  from: PractitionerState,
  to: PractitionerState,
): void {
  assertTransition(PRACTITIONER_STATE_TRANSITIONS, from, to, "practitioner");
}

/** A practitioner (A44). Born `unverified` — always. */
export interface Practitioner {
  readonly id: PractitionerId;
  /** Non-empty display label (SYNTH fixtures; no credential semantics). */
  readonly displayName: string;
  readonly state: PractitionerState;
}

export function isPractitioner(value: unknown): value is Practitioner {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Practitioner, unknown>>;
  if (!isPractitionerId(candidate.id)) {
    return false;
  }
  if (!isNonEmptyString(candidate.displayName)) {
    return false;
  }
  if (!isPractitionerState(candidate.state)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link Practitioner}. Throws {@link DomainInvariantError} describing
 * the expected shape — received values are never echoed.
 */
export function assertPractitioner(candidate: unknown): asserts candidate is Practitioner {
  if (!isPractitioner(candidate)) {
    throw new DomainInvariantError(
      "Invalid practitioner: expected { id, displayName, state } with a canonical pract_ id, a non-empty display name, and a legal practitioner state (unverified|verified|suspended-from-verified|reverified).",
    );
  }
}

// ---------------------------------------------------------------------------
// The explicit verification step (SYNTH-only vocabulary).
// ---------------------------------------------------------------------------

/**
 * The record of a practitioner verification. Labels only — SYNTH
 * vocabulary: WHO verified (`verifiedBy`, e.g. a synthetic
 * credentialing-authority label) and WHAT evidence category was used
 * (`evidence`). Never a document, never PHI, never authoritative.
 */
export interface PractitionerVerification {
  /** Opaque label of the verifying authority (SYNTH-only vocabulary). */
  readonly verifiedBy: string;
  /** Opaque evidence label (SYNTH-only vocabulary; labels never data). */
  readonly evidence: string;
  /** When the verification was recorded. */
  readonly at: Date;
}

export function isPractitionerVerification(value: unknown): value is PractitionerVerification {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof PractitionerVerification, unknown>>;
  if (!isNonEmptyString(candidate.verifiedBy)) {
    return false;
  }
  if (!isNonEmptyString(candidate.evidence)) {
    return false;
  }
  if (!isTimestamp(candidate.at)) {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link PractitionerVerification}. */
export function assertPractitionerVerification(
  candidate: unknown,
): asserts candidate is PractitionerVerification {
  if (!isPractitionerVerification(candidate)) {
    throw new DomainInvariantError(
      "Invalid practitioner verification: expected { verifiedBy, evidence, at } with non-empty labels and a valid timestamp — labels only, never data values.",
    );
  }
}

/**
 * Creates a practitioner in the `unverified` state — the ONLY constructor
 * this package exports for the aggregate. Verified status is reachable
 * exclusively through {@link verifyPractitioner}.
 */
export function newPractitioner(id: PractitionerId, displayName: string): Practitioner {
  if (!isPractitionerId(id)) {
    throw new DomainInvariantError(
      'Invalid practitioner id: expected "pract_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].',
    );
  }
  if (!isNonEmptyString(displayName)) {
    throw new DomainInvariantError("Invalid practitioner display name: expected a non-empty string.");
  }
  return { id, displayName, state: "unverified" };
}

/**
 * The EXPLICIT, auditable verification step. Legal from `unverified`
 * (-> `verified`) and from `suspended-from-verified` (-> `reverified`)
 * only; every other source state throws. The verification record is
 * validated structurally — but note it is NOT stored on the aggregate:
 * verification records are audit-trail entries (the calling layer
 * persists them; the clinical event `PRACTITIONER_VERIFIED` /
 `PRACTITIONER_REVERIFIED` is the envelope shape for that trail).
 */
export function verifyPractitioner(
  practitioner: Practitioner,
  verification: PractitionerVerification,
): Practitioner {
  assertPractitioner(practitioner);
  assertPractitionerVerification(verification);
  if (practitioner.state !== "unverified" && practitioner.state !== "suspended-from-verified") {
    throw new DomainInvariantError(
      `Illegal practitioner verification: state ${practitioner.state} cannot be verified — only unverified (-> verified) and suspended-from-verified (-> reverified) accept the explicit verification step.`,
    );
  }
  const target: PractitionerState =
    practitioner.state === "unverified" ? "verified" : "reverified";
  assertPractitionerTransition(practitioner.state, target);
  return { ...practitioner, state: target };
}

/**
 * Suspension of a verified/reverified practitioner (-> `suspended-from-
 * verified`). Illegal from `unverified` (nothing verified to suspend) and
 * from `suspended-from-verified` (already suspended).
 */
export function suspendPractitioner(practitioner: Practitioner): Practitioner {
  assertPractitioner(practitioner);
  assertPractitionerTransition(practitioner.state, "suspended-from-verified");
  return { ...practitioner, state: "suspended-from-verified" };
}

// ---------------------------------------------------------------------------
// Membership aggregates (frozen role vocabulary).
// ---------------------------------------------------------------------------

/** Frozen in-package role vocabulary for practitioner memberships. */
export const PRACTITIONER_ROLES = ["member", "admin", "owner"] as const;

export type PractitionerRole = (typeof PRACTITIONER_ROLES)[number];

export function isPractitionerRole(value: unknown): value is PractitionerRole {
  return typeof value === "string" && (PRACTITIONER_ROLES as readonly string[]).includes(value);
}

export function parsePractitionerRole(value: unknown): PractitionerRole {
  if (!isPractitionerRole(value)) {
    throw new DomainInvariantError(
      `Invalid practitioner role: expected one of ${PRACTITIONER_ROLES.join(" | ")}.`,
    );
  }
  return value;
}

/**
 * Practitioner ↔ organization membership (A44). Identified by the
 * (practitioner, organization) pair — no separate id kind (recorded
 * assumption: composite identity, mirroring the kernel `Relationship`;
 * an explicit membership id is a kernel-promotion decision).
 */
export interface PractitionerOrganizationMembership {
  readonly practitionerId: PractitionerId;
  readonly organizationId: OrganizationId;
  /** Role within the organization (frozen vocabulary). */
  readonly role: PractitionerRole;
  /** Current membership flag (kernel Relationship snapshot discipline). */
  readonly active: boolean;
}

export function isPractitionerOrganizationMembership(
  value: unknown,
): value is PractitionerOrganizationMembership {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof PractitionerOrganizationMembership, unknown>>;
  if (!isPractitionerId(candidate.practitionerId)) {
    return false;
  }
  if (!isOrganizationId(candidate.organizationId)) {
    return false;
  }
  if (!isPractitionerRole(candidate.role)) {
    return false;
  }
  if (typeof candidate.active !== "boolean") {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts a well-formed
 * {@link PractitionerOrganizationMembership}.
 */
export function assertPractitionerOrganizationMembership(
  candidate: unknown,
): asserts candidate is PractitionerOrganizationMembership {
  if (!isPractitionerOrganizationMembership(candidate)) {
    throw new DomainInvariantError(
      "Invalid practitioner-organization membership: expected { practitionerId, organizationId, role, active } with canonical pract_ and org_ ids, a role of member|admin|owner, and a boolean active flag.",
    );
  }
}

/**
 * Practitioner ↔ clinic affiliation (A44). Identified by the
 * (practitioner, clinic) pair; the owning organization is reached through
 * the clinic's own `organizationId`.
 */
export interface PractitionerClinicAffiliation {
  readonly practitionerId: PractitionerId;
  readonly clinicId: ClinicId;
  /** Role within the clinic (frozen vocabulary). */
  readonly role: PractitionerRole;
  /** Current affiliation flag (kernel Relationship snapshot discipline). */
  readonly active: boolean;
}

export function isPractitionerClinicAffiliation(
  value: unknown,
): value is PractitionerClinicAffiliation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof PractitionerClinicAffiliation, unknown>>;
  if (!isPractitionerId(candidate.practitionerId)) {
    return false;
  }
  if (!isClinicId(candidate.clinicId)) {
    return false;
  }
  if (!isPractitionerRole(candidate.role)) {
    return false;
  }
  if (typeof candidate.active !== "boolean") {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts a well-formed {@link PractitionerClinicAffiliation}.
 */
export function assertPractitionerClinicAffiliation(
  candidate: unknown,
): asserts candidate is PractitionerClinicAffiliation {
  if (!isPractitionerClinicAffiliation(candidate)) {
    throw new DomainInvariantError(
      "Invalid practitioner-clinic affiliation: expected { practitionerId, clinicId, role, active } with canonical pract_ and clin_ ids, a role of member|admin|owner, and a boolean active flag.",
    );
  }
}
