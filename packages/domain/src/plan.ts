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
