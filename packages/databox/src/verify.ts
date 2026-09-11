/**
 * A18 — evidence checksum / metadata validation (architecture §6 step 5:
 * "verify object checksum and metadata").
 *
 * RECORDED DECISION (module placement): this lives in @orbb/databox —
 * NOT @orbb/db — because the DataBox package owns the EvidenceObject
 * record contracts (upload/contracts.ts), the sha256 primitive
 * (checksum.ts), the content-addressed key layout (objectkeys.ts), and
 * the upload-flow error taxonomy this validation reuses. Keeping the
 * validation adjacent to the types it validates also avoids a reverse
 * dependency (db → databox types), which would invert the layering:
 * @orbb/db persists records; @orbb/databox owns their meaning.
 *
 * Semantics match the M2-C upload-service checks (strict equality —
 * no case normalization, no trimming): a digest, size, or media type
 * that differs in ANY way is a mismatch.
 *
 * PHI-safety: error messages name the violated invariant and never echo
 * received values (digests, keys, ids, sizes stay out of message text);
 * the stable machine contract is the UploadFlowError `code`.
 */
import { isEvidenceId } from "@orbb/domain";
import type { EvidenceObjectRecord } from "./upload/contracts.js";
import { UploadFlowError } from "./errors.js";
import { contentAddressedKey, isSha256Hex } from "./objectkeys.js";
import { sha256Checksum, type ChecksumVerifier } from "./checksum.js";

/**
 * The declared side of evidence metadata: what the upload session (or
 * the caller) DECLARES the object to be — digest, size, and media type.
 */
export interface DeclaredEvidenceMetadata {
  /** Declared lowercase-hex SHA-256 digest (64 chars). */
  readonly sha256: string;
  /** Declared size in bytes (non-negative). */
  readonly sizeBytes: number;
  /** Declared media type (e.g. "image/png"; non-empty). */
  readonly mediaType: string;
}

function assertDeclared(declared: DeclaredEvidenceMetadata): void {
  if (typeof declared !== "object" || declared === null) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid declared evidence metadata: expected { sha256, sizeBytes, mediaType }.",
    );
  }
  if (!isSha256Hex(declared.sha256)) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid declared evidence metadata: expected a 64-character lowercase hexadecimal sha256.",
    );
  }
  if (
    typeof declared.sizeBytes !== "number" ||
    !Number.isInteger(declared.sizeBytes) ||
    declared.sizeBytes < 0
  ) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid declared evidence metadata: expected a non-negative integer size in bytes.",
    );
  }
  if (typeof declared.mediaType !== "string" || declared.mediaType.length === 0) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid declared evidence metadata: expected a non-empty media type.",
    );
  }
}

/**
 * Verifies raw object bytes against a DECLARED digest: computes the
 * SHA-256 of `bytes` (via the injected {@link ChecksumVerifier}) and
 * requires exact equality with `declaredSha256`.
 *
 * Pure: the default verifier is `sha256Checksum` (node:crypto); inject
 * a deterministic verifier in tests. Returns the computed digest.
 * Throws `checksum-mismatch` (or `invalid-request` for a malformed
 * declared digest).
 */
export function verifyEvidenceSha256(
  bytes: Uint8Array,
  declaredSha256: string,
  checksum: ChecksumVerifier = sha256Checksum,
): string {
  if (!isSha256Hex(declaredSha256)) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid declared evidence digest: expected a 64-character lowercase hexadecimal sha256.",
    );
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid evidence bytes: expected a Uint8Array.",
    );
  }
  const computed = checksum(bytes);
  if (computed !== declaredSha256) {
    throw new UploadFlowError(
      "checksum-mismatch",
      "Computed object checksum does not match the declared checksum.",
    );
  }
  return computed;
}

/**
 * Size consistency guard: the actual byte count must equal the declared
 * size exactly (no off-by-one tolerance — an evidence object that grew
 * or shrank is a different object). Throws `size-mismatch` (or
 * `invalid-request` for a malformed declared size).
 */
export function verifyEvidenceSize(actualBytes: number, declaredSizeBytes: number): void {
  if (
    typeof declaredSizeBytes !== "number" ||
    !Number.isInteger(declaredSizeBytes) ||
    declaredSizeBytes < 0
  ) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid declared evidence size: expected a non-negative integer.",
    );
  }
  if (typeof actualBytes !== "number" || !Number.isInteger(actualBytes) || actualBytes < 0) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid actual evidence size: expected a non-negative integer.",
    );
  }
  if (actualBytes !== declaredSizeBytes) {
    throw new UploadFlowError(
      "size-mismatch",
      "Actual object size does not match the declared size.",
    );
  }
}

/**
 * Media-type consistency guard: exact string equality (the media type
 * is bound into the presigned-URL signature in the M2-C flow, so any
 * difference is a mismatch, not a normalization concern).
 * Throws `media-type-mismatch` (or `invalid-request` for malformed
 * inputs).
 */
export function verifyEvidenceMediaType(actual: string, declared: string): void {
  if (typeof declared !== "string" || declared.length === 0) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid declared evidence media type: expected a non-empty string.",
    );
  }
  if (typeof actual !== "string" || actual.length === 0) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid actual evidence media type: expected a non-empty string.",
    );
  }
  if (actual !== declared) {
    throw new UploadFlowError(
      "media-type-mismatch",
      "Actual object media type does not match the declared media type.",
    );
  }
}

/**
 * Full evidence-metadata verification: the STORED
 * {@link EvidenceObjectRecord} against the DECLARED metadata.
 *
 * Checks, in order:
 *   1. record shape — canonical `evid_` id and `prsn_` person id
 *      (invalid-request otherwise);
 *   2. declared shape — digest grammar, integer size, non-empty media
 *      type (invalid-request);
 *   3. digest consistency — record.sha256 === declared.sha256
 *      (checksum-mismatch);
 *   4. size consistency — record.sizeBytes === declared.sizeBytes
 *      (size-mismatch);
 *   5. media type consistency — record.mediaType === declared.mediaType
 *      (media-type-mismatch);
 *   6. content-addressing consistency — record.objectKey must be the
 *      canonical key for (record.id, record.sha256) (object-key-mismatch).
 *
 * Pure and total: throws {@link UploadFlowError} on the FIRST violated
 * invariant; returns void when everything agrees.
 */
export function verifyEvidenceMetadata(
  record: EvidenceObjectRecord,
  declared: DeclaredEvidenceMetadata,
): void {
  if (typeof record !== "object" || record === null) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid evidence object record: expected the M2-C EvidenceObjectRecord shape.",
    );
  }
  if (!isEvidenceId(record.id)) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid evidence object record: expected a canonical evid_ id.",
    );
  }
  if (
    !("personId" in record) ||
    typeof (record as { personId?: unknown }).personId !== "string" ||
    (record as { personId: string }).personId.length === 0
  ) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid evidence object record: expected a person id.",
    );
  }
  assertDeclared(declared);
  if (record.sha256 !== declared.sha256) {
    throw new UploadFlowError(
      "checksum-mismatch",
      "Stored evidence checksum does not match the declared checksum.",
    );
  }
  if (record.sizeBytes !== declared.sizeBytes) {
    throw new UploadFlowError(
      "size-mismatch",
      "Stored evidence size does not match the declared size.",
    );
  }
  if (record.mediaType !== declared.mediaType) {
    throw new UploadFlowError(
      "media-type-mismatch",
      "Stored evidence media type does not match the declared media type.",
    );
  }
  if (record.objectKey !== contentAddressedKey(record.id, record.sha256)) {
    throw new UploadFlowError(
      "object-key-mismatch",
      "Stored evidence object key is not the canonical content-addressed key for its id and digest.",
    );
  }
}
