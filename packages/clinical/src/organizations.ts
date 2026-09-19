/**
 * A44 — Organization and Clinic aggregates (architecture §5 Identity
 * family: `Organization` is a core schema; `Clinic` is the
 * organization-owned care delivery unit).
 *
 * Both aggregates share the same state grammar:
 *
 *   active -> suspended -> active | dissolved
 *   active -> dissolved
 *   dissolved is TERMINAL (there is no resurrection — a dissolved
 *   organization or clinic is history, and any successor is a new entity
 *   with a new canonical id).
 *
 * The transition tables follow the kernel discipline exactly
 * (`packages/domain/src/grant.ts` over the internal state-machine engine):
 * a frozen const table plus per-aggregate `isState` / `parseState` /
 * `allowedTransitions` / `canTransition` / `assertTransition` exports, and
 * a terminal state with an empty successor list.
 *
 * Recorded assumptions (SYNTH-safe, boundary-shaped):
 *   - `displayName` is a plain, non-empty display label. Clinical legal
 *     names, registrations, jurisdictions, and identifiers are
 *     jurisdiction-specific governance concerns that do NOT exist in this
 *     package — everything here is SYNTH-fixtured and non-authoritative.
 *   - `Clinic.organizationId` references the OWNING Organization. A
 *     clinic's state machine is deliberately NOT coupled to its
 *     organization's state: the care-team permission evaluator checks BOTH
 *     independently (a dissolved organization denies regardless of the
 *     clinic's own state, and vice versa) — layering, not entanglement.
 *   - There is no "created"/"pending" state: an organization or clinic is
 *     born `active`. Registration workflows that gate activation are an
 *     M7-B concern.
 */
import { DomainInvariantError } from "@orbb/domain";
import { isClinicId, isOrganizationId, type ClinicId, type OrganizationId } from "./ids.js";
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

// ---------------------------------------------------------------------------
// Organization aggregate.
// ---------------------------------------------------------------------------

export const ORGANIZATION_STATES = ["active", "suspended", "dissolved"] as const;

export type OrganizationState = (typeof ORGANIZATION_STATES)[number];

/**
 * Legal OrganizationState transitions. `dissolved` is terminal — the only
 * terminal state. `suspended` is fully recoverable.
 */
export const ORGANIZATION_STATE_TRANSITIONS: StateTransitionTable<OrganizationState> = {
  active: ["suspended", "dissolved"],
  suspended: ["active", "dissolved"],
  dissolved: [],
};

export function isOrganizationState(value: unknown): value is OrganizationState {
  return isState(ORGANIZATION_STATES, value);
}

export function parseOrganizationState(value: unknown): OrganizationState {
  return parseState(ORGANIZATION_STATES, value, "organization state");
}

export function allowedOrganizationTransitions(
  from: OrganizationState,
): readonly OrganizationState[] {
  return allowedTransitions(ORGANIZATION_STATE_TRANSITIONS, from);
}

export function canTransitionOrganization(
  from: OrganizationState,
  to: OrganizationState,
): boolean {
  return canTransition(ORGANIZATION_STATE_TRANSITIONS, from, to);
}

/** Throws {@link DomainInvariantError} on illegal transitions. */
export function assertOrganizationTransition(
  from: OrganizationState,
  to: OrganizationState,
): void {
  assertTransition(ORGANIZATION_STATE_TRANSITIONS, from, to, "organization");
}

/** A care-delivery organization (A44). */
export interface Organization {
  readonly id: OrganizationId;
  /** Non-empty display label (SYNTH fixtures; no legal-name semantics). */
  readonly displayName: string;
  readonly state: OrganizationState;
}

export function isOrganization(value: unknown): value is Organization {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Organization, unknown>>;
  if (!isOrganizationId(candidate.id)) {
    return false;
  }
  if (!isNonEmptyString(candidate.displayName)) {
    return false;
  }
  if (!isOrganizationState(candidate.state)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link Organization}. Throws {@link DomainInvariantError} describing the
 * expected shape — received values are never echoed.
 */
export function assertOrganization(candidate: unknown): asserts candidate is Organization {
  if (!isOrganization(candidate)) {
    throw new DomainInvariantError(
      "Invalid organization: expected { id, displayName, state } with a canonical org_ id, a non-empty display name, and a legal organization state (active|suspended|dissolved).",
    );
  }
}

// ---------------------------------------------------------------------------
// Clinic aggregate (owning-organization linkage + mirrored state machine).
// ---------------------------------------------------------------------------

export const CLINIC_STATES = ["active", "suspended", "dissolved"] as const;

export type ClinicState = (typeof CLINIC_STATES)[number];

/**
 * Legal ClinicState transitions — mirrors the organization table: same
 * vocabulary, same recoverability, `dissolved` terminal.
 */
export const CLINIC_STATE_TRANSITIONS: StateTransitionTable<ClinicState> = {
  active: ["suspended", "dissolved"],
  suspended: ["active", "dissolved"],
  dissolved: [],
};

export function isClinicState(value: unknown): value is ClinicState {
  return isState(CLINIC_STATES, value);
}

export function parseClinicState(value: unknown): ClinicState {
  return parseState(CLINIC_STATES, value, "clinic state");
}

export function allowedClinicTransitions(from: ClinicState): readonly ClinicState[] {
  return allowedTransitions(CLINIC_STATE_TRANSITIONS, from);
}

export function canTransitionClinic(from: ClinicState, to: ClinicState): boolean {
  return canTransition(CLINIC_STATE_TRANSITIONS, from, to);
}

/** Throws {@link DomainInvariantError} on illegal transitions. */
export function assertClinicTransition(from: ClinicState, to: ClinicState): void {
  assertTransition(CLINIC_STATE_TRANSITIONS, from, to, "clinic");
}

/** A clinic owned by an organization (A44). */
export interface Clinic {
  readonly id: ClinicId;
  /** The owning organization. */
  readonly organizationId: OrganizationId;
  /** Non-empty display label (SYNTH fixtures; no legal-name semantics). */
  readonly displayName: string;
  readonly state: ClinicState;
}

export function isClinic(value: unknown): value is Clinic {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Clinic, unknown>>;
  if (!isClinicId(candidate.id)) {
    return false;
  }
  if (!isOrganizationId(candidate.organizationId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.displayName)) {
    return false;
  }
  if (!isClinicState(candidate.state)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed {@link Clinic}.
 * Throws {@link DomainInvariantError} describing the expected shape —
 * received values are never echoed.
 */
export function assertClinic(candidate: unknown): asserts candidate is Clinic {
  if (!isClinic(candidate)) {
    throw new DomainInvariantError(
      "Invalid clinic: expected { id, organizationId, displayName, state } with canonical clin_ and org_ ids, a non-empty display name, and a legal clinic state (active|suspended|dissolved).",
    );
  }
}
