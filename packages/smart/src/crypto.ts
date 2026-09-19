/**
 * Crypto primitives for the SMART launch boundary — ALL of it node:crypto
 * (zero external runtime dependencies, by recorded decision).
 *
 * This module is a LOCAL mirror of the @orbb/auth token discipline
 * (packages/auth/src/crypto.ts), kept deliberately rather than imported so
 * the launch boundary stays decoupled from the identity package: the API
 * layer composes both boundaries, and the dependency direction stays
 * one-way (nothing in @orbb/auth imports @orbb/smart, and vice versa).
 * The discipline mirrored, verbatim from @orbb/auth:
 *
 *   - Opaque tokens: 32 random bytes (256 bits >= the required 128 bits)
 *     serialized as unpadded base64url (43 chars). NEVER a JWT: the SYNTH
 *     exchange doubles issue opaque tokens only — no embedded claims, so
 *     no PHI can ever ride inside a token (architecture §6/§7).
 *   - At-rest token binding: lowercase-hex SHA-256. Stores/doubles only
 *     ever hold digests.
 *   - Timing-constant comparisons: `timingSafeEqual` over fixed-width
 *     SHA-256 digests (length-hiding by construction; a length mismatch
 *     short-circuits to `false`, leaking only the *digest* length —
 *     public by format).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SmartInvariantError } from "./errors.js";

/** Lowercase-hex SHA-256 digest of the input. */
export function sha256Hex(input: Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Fresh opaque token: `bytes` random bytes as unpadded base64url.
 * Default 32 bytes = 256 bits of entropy (>= the 128-bit floor).
 */
export function randomOpaqueToken(bytes: number = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 256) {
    throw new SmartInvariantError(
      "randomOpaqueToken requires an integer byte length between 16 and 256.",
    );
  }
  return randomBytes(bytes).toString("base64url");
}

/**
 * Constant-time equality of two lowercase-hex SHA-256 digests.
 * Non-hex or wrong-width inputs return `false` (deny-by-default) instead
 * of throwing: this is a comparison helper on verify paths.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(a) || !/^[0-9a-f]{64}$/u.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
