/**
 * Shared discriminated-union result helpers for the adherence engine.
 *
 * This is a deliberate SHAPE MIRROR of the measurement engine's
 * `EngineResult` and the platform health seam's `HealthResult`
 * (`{ ok: true, value } | { ok: false, error }`): expected domain
 * rejections are TYPED RESULTS, never thrown exceptions — the journey-#7
 * orchestrator must be able to branch on the exact reason an adherence
 * path degraded to observe-only, refused enforcement, or authorized a
 * restriction.
 *
 * Error payloads are PHID-safe by construction: they describe the violated
 * invariant (a `kind` plus structural context such as a field path) and
 * never echo received ids, values, or payloads.
 */
export type AdherenceResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Builds a success {@link AdherenceResult}. */
export function ok<T>(value: T): AdherenceResult<T, never> {
  return { ok: true, value };
}

/** Builds a rejection {@link AdherenceResult}. */
export function err<E>(error: E): AdherenceResult<never, E> {
  return { ok: false, error };
}
