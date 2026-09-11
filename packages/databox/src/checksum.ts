/**
 * Checksum verifier contract for the DataBox upload flow (architecture §6
 * step 5: "verify object checksum and metadata").
 *
 * The verifier is a pure function injected into the upload-session service
 * so tests can substitute deterministic or deliberately-wrong verifiers,
 * and so the hash primitive stays swappable at the boundary. The reference
 * implementation uses `node:crypto` SHA-256 (builtin — recorded decision:
 * no runtime dependency is introduced for hashing).
 */
import { createHash } from "node:crypto";

/**
 * Pure checksum contract: maps object bytes to a lowercase-hex digest.
 * Implementations must be deterministic and side-effect free.
 */
export type ChecksumVerifier = (bytes: Uint8Array) => string;

/**
 * Reference SHA-256 verifier over `node:crypto`. Returns a 64-character
 * lowercase-hex digest. Safe for PHI: hashing happens in-process; the
 * digest is never a PHI channel (it is a content fingerprint, not content).
 */
export const sha256Checksum: ChecksumVerifier = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
