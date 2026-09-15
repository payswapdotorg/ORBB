/**
 * Shared discriminated-union result helpers for the notification engine.
 *
 * RECORDED DECISION (measurement/intents lane style, A27–A31/A36–A43):
 * expected domain rejections are TYPED RESULTS, never thrown exceptions —
 * callers must be able to branch on the exact reason a reminder path is
 * denied or a dispatch is recorded as undeliverable. Delivery failures
 * from channels are likewise DATA inside a successful result (fail-closed
 * recorded outcomes), never exceptions and never silent drops.
 *
 * `NotificationResult` is structurally identical to the measurement lane's
 * `EngineResult` and the intent lane's `IntentResult` (redeclared locally
 * for the same dependency-budget reason those lanes recorded; values
 * interoperate at the boundary).
 *
 * Error payloads are PHID-safe by construction: they describe the violated
 * invariant (a `kind` plus structural context such as input indexes and
 * field names) and never echo received ids, values, or payloads.
 */
export type NotificationResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Builds a success {@link NotificationResult}. */
export function ok<T>(value: T): NotificationResult<T, never> {
  return { ok: true, value };
}

/** Builds a rejection {@link NotificationResult}. */
export function err<E>(error: E): NotificationResult<never, E> {
  return { ok: false, error };
}
