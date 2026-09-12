/**
 * @orbb/intents error taxonomy.
 *
 * One family: `IntentEngineError` — programming/invariant failures inside
 * the intent lane itself (non-canonicalizable values handed to the
 * serializer, corrupted registry state). It is NOT used for expected
 * domain rejections: those surface as typed results (see `result.ts`) so
 * callers can branch on a stable reason.
 *
 * Messages are PHID-safe by construction: they describe the violated
 * invariant and never echo received ids, values, or payloads (mirrors
 * `@orbb/domain` and `@orbb/measurement` error discipline).
 */

/**
 * Stable failure codes for intent-lane programming errors. `code` (not the
 * message) is the stable contract for callers and tests.
 */
export type IntentEngineErrorCode =
  | "invalid-request"
  | "invariant-violation"
  | "store-failure";

/** Intent-lane programming/invariant failure. */
export class IntentEngineError extends Error {
  readonly code: IntentEngineErrorCode;

  constructor(code: IntentEngineErrorCode, message: string) {
    super(message);
    this.name = "IntentEngineError";
    this.code = code;
  }
}
