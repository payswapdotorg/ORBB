/**
 * @orbb/databox error taxonomy.
 *
 * Errors are PHID-safe by construction: messages describe the invariant that
 * failed and never echo received values (object keys, checksums, ids, and
 * payloads stay out of message text — architecture §6 "never send full PHI
 * through ... generic logs").
 *
 * Two families:
 *   - `UploadFlowError` — upload-session orchestration rejections
 *     (architecture §6 steps 1–6), discriminated by a stable `code`.
 *   - `EnvelopeCryptoError` — envelope-encryption failures (architecture
 *     §7), discriminated by a stable `code`.
 *   - `ObjectStoreError` — object-plane adapter failures (R2/S3 transport).
 *
 * Codes (not messages) are the stable contract for callers and tests.
 */

/**
 * Stable rejection codes for the upload-session flow. Deny-by-default:
 * anything the guard does not explicitly allow surfaces as "unauthorized".
 */
export type UploadFlowErrorCode =
  | "invalid-request"
  | "unauthorized"
  | "session-not-found"
  | "session-expired"
  | "object-key-mismatch"
  | "object-missing"
  | "checksum-mismatch"
  | "size-mismatch"
  | "media-type-mismatch"
  | "metadata-inconsistency";

/** Upload-session flow rejection (architecture §6 steps 1–6). */
export class UploadFlowError extends Error {
  readonly code: UploadFlowErrorCode;

  constructor(code: UploadFlowErrorCode, message: string) {
    super(message);
    this.name = "UploadFlowError";
    this.code = code;
  }
}

/**
 * Stable failure codes for envelope encryption. Context mismatch is an
 * authentication failure by design (architecture §7 context binding).
 */
export type EnvelopeCryptoErrorCode =
  | "invalid-context"
  | "malformed-envelope"
  | "context-mismatch"
  | "key-unwrap-failure"
  | "integrity-failure";

/** Envelope-encryption failure (architecture §7). */
export class EnvelopeCryptoError extends Error {
  readonly code: EnvelopeCryptoErrorCode;

  constructor(code: EnvelopeCryptoErrorCode, message: string) {
    super(message);
    this.name = "EnvelopeCryptoError";
    this.code = code;
  }
}

/**
 * Object-plane transport failure surfaced by the R2 (S3-compatible)
 * adapter. `status` and `providerCode` carry the provider's status/code
 * when available; message text never echoes response bodies.
 */
export class ObjectStoreError extends Error {
  /** HTTP status of the failed provider response, when a response arrived. */
  readonly status?: number | undefined;
  /** Provider error code (e.g. S3 `NoSuchKey`), when parseable. */
  readonly providerCode?: string | undefined;

  constructor(message: string, status?: number, providerCode?: string) {
    super(message);
    this.name = "ObjectStoreError";
    this.status = status;
    this.providerCode = providerCode;
  }
}
