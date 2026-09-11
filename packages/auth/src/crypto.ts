/**
 * Crypto primitives for the identity boundary — ALL of it node:crypto
 * (zero runtime package dependencies, by recorded decision).
 *
 * Choices recorded for the security invariant "tokens opaque + rotatable,
 * timing-constant comparisons where practical":
 *   - Opaque tokens: 32 random bytes (256 bits ≥ the required 128 bits)
 *     serialized as unpadded base64url (43 chars).
 *   - At-rest token binding: lowercase-hex SHA-256 (matches the
 *     `SHA256_HEX_PATTERN` grammar used across @orbb packages). Stores
 *     only ever hold digests.
 *   - Timing-constant comparisons: `timingSafeEqual` over the SHA-256
 *     digests of secrets (fixed 32-byte width, so the digest comparison
 *     is length-hiding by construction; a length mismatch on the digest
 *     short-circuits to `false`, which leaks only the length of the
 *     *digest* — public by format). For fixed-format secrets (6-digit
 *     OTPs, recovery codes, WebAuthn challenges) we hash first and then
 *     compare digests, the standard timing-safe comparison shape.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { AuthInvariantError } from "./errors.js";

/** Lowercase-hex SHA-256 digest of the input. */
export function sha256Hex(input: Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Raw 32-byte SHA-256 digest of the input. */
export function sha256(input: Uint8Array | string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(input).digest());
}

/** Unpadded base64url encoding (the WebAuthn wire encoding). */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Decodes base64url (padding tolerated and stripped — recorded lenience;
 * the spec encodes challenges/ids unpadded, but a padded echo is harmless).
 * Throws {@link AuthInvariantError} on any character outside the alphabet.
 */
export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/=+$/u, "");
  if (!/^[A-Za-z0-9_-]*$/u.test(normalized)) {
    throw new AuthInvariantError("base64url: input contains characters outside the URL-safe alphabet.");
  }
  return new Uint8Array(Buffer.from(normalized, "base64url"));
}

/**
 * Fresh opaque token: `bytes` random bytes as unpadded base64url.
 * Default 32 bytes = 256 bits of entropy (>= the 128-bit floor).
 */
export function randomToken(bytes: number = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 256) {
    throw new AuthInvariantError("randomToken requires an integer byte length between 16 and 256.");
  }
  return randomBytes(bytes).toString("base64url");
}

/** Uniform random numeric string of `count` digits (via `randomInt`: no modulo bias). */
export function randomDigits(count: number): string {
  if (!Number.isInteger(count) || count < 4 || count > 16) {
    throw new AuthInvariantError("randomDigits requires an integer count between 4 and 16.");
  }
  let out = "";
  for (let i = 0; i < count; i += 1) {
    out += randomInt(0, 10).toString();
  }
  return out;
}

/** Constant-time equality of two byte strings (length mismatch → false). */
export function timingSafeEqualUint8(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Constant-time equality of two lowercase-hex SHA-256 digests.
 * Non-hex or wrong-width inputs return `false` (deny-by-default) instead
 * of throwing: this is a comparison helper on the verify path.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(a) || !/^[0-9a-f]{64}$/u.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
