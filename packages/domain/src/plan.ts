/**
 * MeasurementPlan aggregate (architecture §5).
 *
 * `MeasurementPlan(id, personId, intentId, state, metrics, createdAt)`.
 *
 * Recorded assumption: `metrics` is an ordered list of metric concept
 * codes (e.g. LOINC) the plan commits to measure. Structured PlanMetric
 * records (a §5 concept owned by the measurement lane) refine this later.
 *
 * State machine (frozen grammar):
 *   draft -> published -> active -> completed | cancelled
 *
 * Recorded assumption (strict grammar reading): abandoning a plan before
 * activation is not modeled in M0 — `draft` may only be published and
 * `published` may only be activated. Cancellation happens from `active`.
 */
import type { IntentId, PersonId, PlanId } from "./ids.js";
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

export const PLAN_STATES = ["draft", "published", "active", "completed", "cancelled"] as const;

export type PlanState = (typeof PLAN_STATES)[number];

export interface MeasurementPlan {
  readonly id: PlanId;
  readonly personId: PersonId;
  readonly intentId: IntentId;
  readonly state: PlanState;
  /** Metric concept codes this plan commits to measure. */
  readonly metrics: readonly string[];
  readonly createdAt: Date;
}

/** Legal PlanState transitions. Terminal states map to empty lists. */
export const PLAN_STATE_TRANSITIONS: StateTransitionTable<PlanState> = {
  draft: ["published"],
  published: ["active"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isPlanState(value: unknown): value is PlanState {
  return isState(PLAN_STATES, value);
}

export function parsePlanState(value: unknown): PlanState {
  return parseState(PLAN_STATES, value, "plan state");
}

export function allowedPlanTransitions(from: PlanState): readonly PlanState[] {
  return allowedTransitions(PLAN_STATE_TRANSITIONS, from);
}

export function canTransitionPlan(from: PlanState, to: PlanState): boolean {
  return canTransition(PLAN_STATE_TRANSITIONS, from, to);
}

/** Throws {@link import("./errors.js").DomainInvariantError} on illegal transitions. */
export function assertPlanTransition(from: PlanState, to: PlanState): void {
  assertTransition(PLAN_STATE_TRANSITIONS, from, to, "plan");
}

// ---------------------------------------------------------------------------
// Structural guard (M1 gap review: `metrics` is the list of concept codes a
// plan commits to measure — an empty list, or blank codes, is a plan that
// measures nothing; nothing enforced it. Added additively; working code is
// unchanged).
// ---------------------------------------------------------------------------

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isMeasurementPlan(value: unknown): value is MeasurementPlan {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof MeasurementPlan, unknown>>;
  if (!isIdOf("plan", candidate.id)) {
    return false;
  }
  if (!isIdOf("person", candidate.personId)) {
    return false;
  }
  if (!isIdOf("intent", candidate.intentId)) {
    return false;
  }
  if (!isPlanState(candidate.state)) {
    return false;
  }
  if (!Array.isArray(candidate.metrics) || candidate.metrics.length === 0) {
    return false;
  }
  for (const code of candidate.metrics) {
    if (typeof code !== "string" || code.length === 0) {
      return false;
    }
  }
  if (!isTimestamp(candidate.createdAt)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link MeasurementPlan}. Throws {@link DomainInvariantError} describing
 * the expected shape — received values are never echoed.
 */
export function assertMeasurementPlan(candidate: unknown): asserts candidate is MeasurementPlan {
  if (!isMeasurementPlan(candidate)) {
    throw new DomainInvariantError(
      "Invalid measurement plan: expected { id, personId, intentId, state, metrics, createdAt } with canonical ids, a legal plan state, a non-empty list of non-empty metric concept codes, and a valid creation timestamp.",
    );
  }
}
