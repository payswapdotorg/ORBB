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
import { isIdOf } from "./ids.js";
import { DomainInvariantError } from "./errors.js";
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

// ---------------------------------------------------------------------------
// Structural guard (M1 gap review: evidencePackVersion was documented as a
// positive integer and objective as a statement, but nothing enforced
// either — added additively; working code is unchanged).
// ---------------------------------------------------------------------------

/** Type guard: is `value` a positive integer (evidence-pack version)? */
export function isEvidencePackVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Parses a positive-integer evidence-pack version; throws on anything else. */
export function parseEvidencePackVersion(value: unknown): number {
  if (!isEvidencePackVersion(value)) {
    throw new DomainInvariantError(
      "Invalid evidence pack version: expected a positive integer (>= 1).",
    );
  }
  return value;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isHealthIntent(value: unknown): value is HealthIntent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof HealthIntent, unknown>>;
  if (!isIdOf("intent", candidate.id)) {
    return false;
  }
  if (!isIdOf("person", candidate.personId)) {
    return false;
  }
  if (typeof candidate.objective !== "string" || candidate.objective.length === 0) {
    return false;
  }
  if (!isIntentState(candidate.state)) {
    return false;
  }
  if (!isTimestamp(candidate.createdAt)) {
    return false;
  }
  if (candidate.evidencePackVersion !== undefined && !isEvidencePackVersion(candidate.evidencePackVersion)) {
    return false;
  }
  if (candidate.planId !== undefined && !isIdOf("plan", candidate.planId)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed {@link HealthIntent}.
 * Throws {@link DomainInvariantError} describing the expected shape —
 * received values are never echoed.
 */
export function assertHealthIntent(candidate: unknown): asserts candidate is HealthIntent {
  if (!isHealthIntent(candidate)) {
    throw new DomainInvariantError(
      "Invalid health intent: expected { id, personId, objective, state, createdAt, evidencePackVersion?, planId? } with canonical ids, a non-empty objective, a legal intent state, a valid creation timestamp, an optional positive-integer evidence pack version, and an optional canonical plan id.",
    );
  }
}
