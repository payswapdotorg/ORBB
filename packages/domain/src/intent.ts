/**
 * HealthIntent aggregate (architecture §5).
 *
 * `HealthIntent(id, personId, objective, state, createdAt,
 * evidencePackVersion?, planId?)`.
 *
 * State machine (frozen grammar):
 *   draft -> active -> (paused <-> active) -> achieved | retired
 *
 * Recorded assumption (strict grammar reading): `paused` may only return
 * to `active`; achieving or retiring an intent requires resuming it
 * first. `achieved` and `retired` are terminal.
 */
import type { IntentId, PersonId, PlanId } from "./ids.js";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  parseState,
  isState,
  type StateTransitionTable,
} from "./stateMachine.js";

export const INTENT_STATES = ["draft", "active", "paused", "achieved", "retired"] as const;

export type IntentState = (typeof INTENT_STATES)[number];

export interface HealthIntent {
  readonly id: IntentId;
  readonly personId: PersonId;
  /** Free-text objective statement (M0; structured objectives arrive later). */
  readonly objective: string;
  readonly state: IntentState;
  readonly createdAt: Date;
  /** Monotonic evidence-pack version for this intent (positive integer). */
  readonly evidencePackVersion?: number;
  /** The measurement plan currently fulfilling this intent, if any. */
  readonly planId?: PlanId;
}

/** Legal IntentState transitions. Terminal states map to empty lists. */
export const INTENT_STATE_TRANSITIONS: StateTransitionTable<IntentState> = {
  draft: ["active"],
  active: ["paused", "achieved", "retired"],
  paused: ["active"],
  achieved: [],
  retired: [],
};

export function isIntentState(value: unknown): value is IntentState {
  return isState(INTENT_STATES, value);
}

export function parseIntentState(value: unknown): IntentState {
  return parseState(INTENT_STATES, value, "intent state");
}

export function allowedIntentTransitions(from: IntentState): readonly IntentState[] {
  return allowedTransitions(INTENT_STATE_TRANSITIONS, from);
}

export function canTransitionIntent(from: IntentState, to: IntentState): boolean {
  return canTransition(INTENT_STATE_TRANSITIONS, from, to);
}

/** Throws {@link import("./errors.js").DomainInvariantError} on illegal transitions. */
export function assertIntentTransition(from: IntentState, to: IntentState): void {
  assertTransition(INTENT_STATE_TRANSITIONS, from, to, "intent");
}
