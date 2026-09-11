/**
 * @orbb/measurement error taxonomy.
 *
 * One family: `MeasurementEngineError` — programming/invariant failures
 * inside the engine itself (bad construction arguments, corrupted store
 * state). It is NOT used for expected domain rejections: those surface as
 * typed results (see `result.ts`) so callers can branch on a stable
 * reason.
 *
 * Messages are PHID-safe by construction: they describe the violated
 * invariant and never echo received ids, values, or payloads (mirrors
 * `@orbb/domain` and `@orbb/databox` error discipline).
 */

/**
 * Stable failure codes for engine programming errors. `code` (not the
 * message) is the stable contract for callers and tests.
 */
export type MeasurementEngineErrorCode =
  | "invalid-request"
  | "invariant-violation"
  | "store-failure";

/** Measurement-engine programming/invariant failure. */
export class MeasurementEngineError extends Error {
  readonly code: MeasurementEngineErrorCode;

  constructor(code: MeasurementEngineErrorCode, message: string) {
    super(message);
    this.name = "MeasurementEngineError";
    this.code = code;
  }
}
