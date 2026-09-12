/**
 * Shared discriminated-union result helpers for the device-source health
 * seam (A32–A35, Lane C packet M4-C).
 *
 * This is a deliberate SHAPE MIRROR of the Lane A measurement engine's
 * `EngineResult` (`{ ok: true, value } | { ok: false, error }`): the
 * device-source seam uses the same typed-result discipline — expected
 * domain rejections are TYPED RESULTS, never thrown exceptions — so the
 * engine (Lane A) can consume these seams without adapting result shapes
 * (handoff recorded in the packet report).
 *
 * Error payloads are PHID-safe by construction: they describe the violated
 * invariant (a `kind` plus structural context) and never echo received ids,
 * values, or payloads.
 */

/** Success/failure discriminated union for every seam operation. */
export type HealthResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Builds a success {@link HealthResult}. */
export function ok<T>(value: T): HealthResult<T, never> {
  return { ok: true, value };
}

/** Builds a rejection {@link HealthResult}. */
export function err<E>(error: E): HealthResult<never, E> {
  return { ok: false, error };
}
