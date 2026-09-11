/**
 * Opaque, content-addressed object keys (architecture §6: "Objects are
 * addressed by opaque object IDs and content hashes, never user-controlled
 * paths").
 *
 * Recorded design decisions:
 *   - Key layout is `evidence/v1/<objectId>/<sha256>` — deterministic, so
 *     the same (object id, content hash) pair always addresses the same key
 *     (testable determinism), and the object id component is a randomly
 *     generated opaque `evid_<body>` value the caller never controls, so
 *     keys are non-guessable by construction. The `v1` namespace segment
 *     leaves room for future layout evolution without ambiguity.
 *   - `sha256` MUST be lowercase hex (64 chars). Uppercase hex is rejected
 *     rather than normalized: the same digest in different cases must never
 *     silently address two different keys.
 *   - Object ids are validated with the frozen @orbb/domain guards
 *     (`isEvidenceId`), never accepted raw.
 */
import { isEvidenceId, type EvidenceId } from "@orbb/domain";
import { UploadFlowError } from "./errors.js";

/** Namespace segment prefixing every M2-C object key. */
export const OBJECT_KEY_NAMESPACE = "evidence/v1";

/** Lowercase hexadecimal SHA-256 digest (64 chars). */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Type guard: is `value` a lowercase-hex SHA-256 digest? */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

/**
 * Parses and validates a raw value as a lowercase-hex SHA-256 digest.
 * Throws {@link UploadFlowError} ("invalid-request") describing the expected
 * shape — the offending value is never echoed.
 */
export function parseSha256Hex(value: unknown): string {
  if (!isSha256Hex(value)) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid object digest: expected a 64-character lowercase hexadecimal SHA-256 value.",
    );
  }
  return value;
}

/**
 * Pure, deterministic content-addressed object key:
 * `evidence/v1/<objectId>/<sha256>`.
 *
 * Same inputs always produce the same key; either input changing produces a
 * different key. Inputs are validated (canonical evidence id grammar, exact
 * key kind `evid_`, lowercase-hex digest) — invalid inputs throw
 * {@link UploadFlowError} ("invalid-request") and are never echoed.
 */
export function contentAddressedKey(objectId: EvidenceId, sha256: string): string {
  if (!isEvidenceId(objectId)) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid object id for content addressing: expected a canonical evid_<body> identifier.",
    );
  }
  if (!isSha256Hex(sha256)) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid object digest for content addressing: expected a 64-character lowercase hexadecimal SHA-256 value.",
    );
  }
  return `${OBJECT_KEY_NAMESPACE}/${objectId}/${sha256}`;
}
