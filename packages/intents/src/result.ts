/**
 * Shared discriminated-union result helpers for the intent lane.
 *
 * Mirrors the M4-A measurement engine style (recorded decision, A36–A38):
 * expected domain rejections are TYPED RESULTS, never thrown exceptions —
 * callers (the future IntentProposer service and the human review/publish
 * workflow, A42/A43) must be able to branch on the exact reason an intent
 * path is denied (deny-by-default, architecture §7 spirit). Thrown
 * `DomainInvariantError`s from `@orbb/domain` guards are consumed at this
 * lane's boundary and converted into typed rejections, so domain
 * invariants stay enforced by the frozen domain code while callers never
 * need try/catch for expected outcomes.
 *
 * Structurally identical to `@orbb/measurement`'s `EngineResult` (the
 * dependency budget for this package is @orbb/domain + @orbb/testkit only,
 * so the shape is redeclared here; values interoperate at the integration
 * boundary — handoff recorded in src/index.ts).
 *
 * Error payloads are PHID-safe by construction: they describe the violated
 * invariant (a `kind` plus structural context such as entry or metric
 * indexes) and never echo received ids, values, or payloads.
 */
export type IntentResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Builds a success {@link IntentResult}. */
export function ok<T>(value: T): IntentResult<T, never> {
  return { ok: true, value };
}

/** Builds a rejection {@link IntentResult}. */
export function err<E>(error: E): IntentResult<never, E> {
  return { ok: false, error };
}
