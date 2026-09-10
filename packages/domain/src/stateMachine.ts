/**
 * Internal (not re-exported from the package index): a tiny, pure
 * state-machine engine shared by the per-aggregate transition guards.
 */
import { DomainInvariantError } from "./errors.js";

/** Immutable transition table: maps each state to its legal successors. */
export type StateTransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export function isState<S extends string>(states: readonly S[], value: unknown): value is S {
  return typeof value === "string" && (states as readonly string[]).includes(value);
}

export function parseState<S extends string>(states: readonly S[], value: unknown, label: string): S {
  if (!isState(states, value)) {
    throw new DomainInvariantError(
      `Invalid ${label}: expected one of ${states.join(" | ")}.`,
    );
  }
  return value;
}

export function canTransition<S extends string>(
  table: StateTransitionTable<S>,
  from: S,
  to: S,
): boolean {
  return table[from].includes(to);
}

export function assertTransition<S extends string>(
  table: StateTransitionTable<S>,
  from: S,
  to: S,
  label: string,
): void {
  if (!canTransition(table, from, to)) {
    const legal = table[from];
    const legalText =
      legal.length > 0 ? legal.join(", ") : "(none — terminal state)";
    throw new DomainInvariantError(
      `Illegal ${label} state transition: ${from} -> ${to}. Legal transitions from ${from}: ${legalText}.`,
    );
  }
}

export function allowedTransitions<S extends string>(
  table: StateTransitionTable<S>,
  from: S,
): readonly S[] {
  return table[from];
}
