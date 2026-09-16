/**
 * Shared discriminated-union result helpers for the notification engine
 * (A27–A31 `@orbb/measurement` engine style, mirrored locally so the
 * package surface stays self-contained).
 *
 * Recorded decision: expected domain rejections are TYPED RESULTS, never
 * thrown exceptions — callers (worker dispatch loop, API routes, the Lane C
 * E2E harness) must be able to branch on the exact reason a reminder path
 * is denied or degraded (deny-by-default, architecture §7 spirit).
 * Delivery-channel failures are also typed outcomes (`DeliveryResult`),
 * never exceptions, so a failing provider can never crash the engine.
 *
 * Error payloads are PHID-safe by construction: they describe the violated
 * invariant (a `kind`) and never echo received ids, values, or payloads.
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
