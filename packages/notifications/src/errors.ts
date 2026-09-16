/**
 * @orbb/notifications error taxonomy.
 *
 * One family: `NotificationEngineError` — programming/invariant failures
 * inside the engine itself (bad construction arguments, corrupted doubles,
 * reminder-id derivation invariants). It is NOT used for expected domain
 * rejections: those surface as typed results (see `result.ts`) so callers
 * can branch on a stable reason. Channel delivery failures are recorded
 * outcomes (fail-closed data), never exceptions crossing this boundary.
 *
 * Messages are PHID-safe by construction: they describe the violated
 * invariant and never echo received ids, values, or payloads (mirrors
 * `@orbb/domain`, `@orbb/measurement` and `@orbb/intents` discipline).
 */

/**
 * Stable failure codes for engine programming errors. `code` (not the
 * message) is the stable contract for callers and tests.
 */
export type NotificationEngineErrorCode =
  | "invalid-request"
  | "invariant-violation"
  | "store-failure";

/** Notification-engine programming/invariant failure. */
export class NotificationEngineError extends Error {
  readonly code: NotificationEngineErrorCode;

  constructor(code: NotificationEngineErrorCode, message: string) {
    super(message);
    this.name = "NotificationEngineError";
    this.code = code;
  }
}
