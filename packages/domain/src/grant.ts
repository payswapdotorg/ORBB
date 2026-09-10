/**
 * AccessGrant aggregate (architecture §5, Access family).
 *
 * `AccessGrant(id, subjectId, recipientId, purpose, scope, state,
 * expiresAt)`.
 *
 * Recorded assumptions:
 *   - `subjectId` is the person whose data is shared (PersonId);
 *     `recipientId` is an opaque recipient identifier (clinician, study,
 *     organization, or service) — recipients get their own canonical id
 *     only when the consent lane models them as entities.
 *   - `purpose` is a purpose-of-use label (e.g. "CARE_MANAGEMENT");
 *     `scope` is a list of granted permission identifiers
 *     (e.g. ["observations:read", "intent:read"]).
 *   - Expiry is time-derived from `expiresAt` — there is deliberately no
 *     "expired" state. The state machine mirrors the ACCESS_GRANTED /
 *     ACCESS_REVOKED events: active -> revoked (terminal).
 */
import type { GrantId, PersonId } from "./ids.js";
import { isIdOf } from "./ids.js";
import { DomainInvariantError } from "./errors.js";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  isState,
  parseState,
  type StateTransitionTable,
} from "./stateMachine.js";

export const GRANT_STATES = ["active", "revoked"] as const;

export type GrantState = (typeof GRANT_STATES)[number];

export interface AccessGrant {
  readonly id: GrantId;
  readonly subjectId: PersonId;
  /** Opaque recipient identifier (consent lane owns the vocabulary). */
  readonly recipientId: string;
  /** Purpose-of-use label (consent lane owns the vocabulary). */
  readonly purpose: string;
  /** Granted permission identifiers. */
  readonly scope: readonly string[];
  readonly state: GrantState;
  readonly expiresAt: Date;
}

/** Legal GrantState transitions. `revoked` is terminal. */
export const GRANT_STATE_TRANSITIONS: StateTransitionTable<GrantState> = {
  active: ["revoked"],
  revoked: [],
};

export function isGrantState(value: unknown): value is GrantState {
  return isState(GRANT_STATES, value);
}

export function parseGrantState(value: unknown): GrantState {
  return parseState(GRANT_STATES, value, "grant state");
}

export function allowedGrantTransitions(from: GrantState): readonly GrantState[] {
  return allowedTransitions(GRANT_STATE_TRANSITIONS, from);
}

export function canTransitionGrant(from: GrantState, to: GrantState): boolean {
  return canTransition(GRANT_STATE_TRANSITIONS, from, to);
}

/** Throws {@link import("./errors.js").DomainInvariantError} on illegal transitions. */
export function assertGrantTransition(from: GrantState, to: GrantState): void {
  assertTransition(GRANT_STATE_TRANSITIONS, from, to, "grant");
}

// ---------------------------------------------------------------------------
// Structural guard (M1 gap review: scope entries and expiry were plain,
// unvalidated data — an empty scope, blank/non-string permission entries,
// or an invalid expiry Date are illegal states nothing detected. Added
// additively; working code is unchanged).
// ---------------------------------------------------------------------------

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isAccessGrant(value: unknown): value is AccessGrant {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof AccessGrant, unknown>>;
  if (!isIdOf("grant", candidate.id)) {
    return false;
  }
  if (!isIdOf("person", candidate.subjectId)) {
    return false;
  }
  if (typeof candidate.recipientId !== "string" || candidate.recipientId.length === 0) {
    return false;
  }
  if (typeof candidate.purpose !== "string" || candidate.purpose.length === 0) {
    return false;
  }
  if (!Array.isArray(candidate.scope) || candidate.scope.length === 0) {
    return false;
  }
  for (const permission of candidate.scope) {
    if (typeof permission !== "string" || permission.length === 0) {
      return false;
    }
  }
  if (!isGrantState(candidate.state)) {
    return false;
  }
  if (!isTimestamp(candidate.expiresAt)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed {@link AccessGrant}.
 * Throws {@link DomainInvariantError} describing the expected shape —
 * received values are never echoed.
 */
export function assertAccessGrant(candidate: unknown): asserts candidate is AccessGrant {
  if (!isAccessGrant(candidate)) {
    throw new DomainInvariantError(
      "Invalid access grant: expected { id, subjectId, recipientId, purpose, scope, state, expiresAt } with canonical ids, non-empty recipient/purpose labels, a non-empty list of non-empty permission identifiers, a legal grant state, and a valid expiry timestamp.",
    );
  }
}
