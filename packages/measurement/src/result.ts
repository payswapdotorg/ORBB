/**
 * Shared discriminated-union result helpers for the measurement engine.
 *
 * Recorded decision (A27–A31 engine style): expected domain rejections are
 * TYPED RESULTS, never thrown exceptions — the capture path and the E2E
 * harness (Lane C) must be able to branch on the exact reason a
 * measurement path is denied (deny-by-default, architecture §7 spirit).
 * Thrown `DomainInvariantError`s from `@orbb/domain` guards are consumed
 * at the engine boundary and converted into typed rejections, so domain
 * invariants stay enforced by the frozen domain code while callers never
 * need try/catch for expected outcomes.
 *
 * Error payloads are PHID-safe by construction: they describe the violated
 * invariant (a `kind` plus structural context such as selector indexes)
 * and never echo received ids, values, or payloads.
 */
export type EngineResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Builds a success {@link EngineResult}. */
export function ok<T>(value: T): EngineResult<T, never> {
  return { ok: true, value };
}

/** Builds a rejection {@link EngineResult}. */
export function err<E>(error: E): EngineResult<never, E> {
  return { ok: false, error };
}
