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
