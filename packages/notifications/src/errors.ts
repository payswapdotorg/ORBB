/**
 * @orbb/notifications error taxonomy.
 *
 * One family: `NotificationEngineError` — programming/invariant failures
 * inside the engine itself (bad construction arguments, corrupted injected
 * ports). It is NOT used for expected domain rejections: those surface as
 * typed results (re-used `EngineResult` from `@orbb/measurement`) so
 * callers can branch on a stable reason, exactly like the measurement
 * engine's A27–A31 style.
 *
 * Messages are PHID-safe by construction: they describe the violated
 * invariant and never echo received ids, values, or payloads (mirrors
 * `@orbb/domain` and `@orbb/measurement` error discipline).
 */

/**
 * Stable failure codes for engine programming errors. `code` (not the
 * message) is the stable contract for callers and tests.
 */
export type NotificationEngineErrorCode = "invalid-request" | "invariant-violation";

/** Notification-engine programming/invariant failure. */
export class NotificationEngineError extends Error {
  readonly code: NotificationEngineErrorCode;

  constructor(code: NotificationEngineErrorCode, message: string) {
    super(message);
    this.name = "NotificationEngineError";
    this.code = code;
  }
}
