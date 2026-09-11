/**
 * COSE public key (RFC 9053 §7 / RFC 8230) → node:crypto `KeyObject`.
 *
 * Supported algorithms (recorded decision — the three algorithms the
 * WebAuthn L3 mandated/interoperability-baseline set covers in practice,
 * all verifiable with node:crypto):
 *   - ES256 (alg -7, EC2 kty 2, P-256 crv 1) — raw r‖s signatures.
 *   - Ed25519 / EdDSA (alg -8, OKP kty 1, Ed25519 crv 6).
 *   - RS256 (alg -257, RSA kty 3) — PKCS#1 v1.5.
 * Anything else is rejected (`UNSUPPORTED_PUBLIC_KEY` at the verify
 * boundary). Keys are converted through JWK and re-checked against
 * `asymmetricKeyType` so malformed points cannot smuggle through.
 */
import { createPublicKey, type KeyObject } from "node:crypto";
import { AuthInvariantError } from "../errors.js";
import { toBase64Url } from "../crypto.js";
import { decodeCbor, type CborKey, type CborValue } from "./cbor.js";

/** COSE key common parameter labels (RFC 9053 §7). */
export const COSE_KEY_LABELS = {
  KTY: 1,
  ALG: 3,
} as const;

/** COSE key types. */
export const COSE_KTY = {
  /** Octet Key Pair (Ed25519). */
  OKP: 1,
  /** Elliptic Curve (2-coordinate). */
  EC2: 2,
  /** RSA. */
  RSA: 3,
} as const;

/** COSE algorithms supported by this verifier. */
export const COSE_ALG = {
  /** ECDSA w/ SHA-256 on P-256. */
  ES256: -7,
  /** EdDSA on Ed25519 (pure Ed25519). */
  ED25519: -8,
  /** RSASSA-PKCS1-v1_5 w/ SHA-256. */
  RS256: -257,
} as const;

/** COSE curves. */
export const COSE_CRV = {
  /** P-256 (EC2). */
  P256: 1,
  /** Ed25519 (OKP). */
  ED25519: 6,
} as const;

/** A parsed COSE public key with its node:crypto key object. */
export interface CosePublicKey {
  /** The COSE algorithm identifier (must match the assertion signature alg). */
  readonly alg: number;
  readonly key: KeyObject;
}

function unsupported(detail: string): AuthInvariantError {
  return new AuthInvariantError(`cose key: ${detail}`);
}

function requireInt(map: Map<CborKey, CborValue>, label: number, name: string): number {
  const value = map.get(label);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw unsupported(`expected integer parameter ${name} (label ${label})`);
  }
  return value;
}

function requireBytes(
  map: Map<CborKey, CborValue>,
  label: number,
  name: string,
  length?: number,
): Uint8Array {
  const value = map.get(label);
  if (!(value instanceof Uint8Array)) {
    throw unsupported(`expected byte-string parameter ${name} (label ${label})`);
  }
  if (length !== undefined && value.length !== length) {
    throw unsupported(`parameter ${name} must be exactly ${length} bytes`);
  }
  return value;
}

/**
 * Parses raw COSE public-key bytes into a {@link CosePublicKey}.
 * Shape errors throw {@link AuthInvariantError}; verify paths map them
 * to `UNSUPPORTED_PUBLIC_KEY`.
 */
export function parseCosePublicKey(coseBytes: Uint8Array): CosePublicKey {
  const decoded = decodeCbor(coseBytes);
  if (!(decoded instanceof Map)) {
    throw unsupported("expected a CBOR map");
  }
  const kty = requireInt(decoded, COSE_KEY_LABELS.KTY, "kty");
  const alg = requireInt(decoded, COSE_KEY_LABELS.ALG, "alg");

  switch (kty) {
    case COSE_KTY.EC2: {
      const crv = requireInt(decoded, -1, "crv");
      if (crv !== COSE_CRV.P256) {
        throw unsupported("only P-256 elliptic curves are supported");
      }
      if (alg !== COSE_ALG.ES256) {
        throw unsupported("EC2 keys must declare ES256 (-7)");
      }
      const x = requireBytes(decoded, -2, "x", 32);
      const y = requireBytes(decoded, -3, "y", 32);
      const key = createPublicKey({
        key: { kty: "EC", crv: "P-256", x: toBase64Url(x), y: toBase64Url(y) },
        format: "jwk",
      });
      assertKeyType(key, "ec");
      return { alg, key };
    }
    case COSE_KTY.OKP: {
      const crv = requireInt(decoded, -1, "crv");
      if (crv !== COSE_CRV.ED25519) {
        throw unsupported("only Ed25519 octet key pairs are supported");
      }
      if (alg !== COSE_ALG.ED25519) {
        throw unsupported("OKP keys must declare Ed25519 (-8)");
      }
      const x = requireBytes(decoded, -2, "x", 32);
      const key = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: toBase64Url(x) },
        format: "jwk",
      });
      assertKeyType(key, "ed25519");
      return { alg, key };
    }
    case COSE_KTY.RSA: {
      if (alg !== COSE_ALG.RS256) {
        throw unsupported("RSA keys must declare RS256 (-257)");
      }
      const n = requireBytes(decoded, -1, "n");
      const e = requireBytes(decoded, -2, "e");
      const key = createPublicKey({
        key: { kty: "RSA", n: toBase64Url(n), e: toBase64Url(e) },
        format: "jwk",
      });
      assertKeyType(key, "rsa");
      return { alg, key };
    }
    default:
      throw unsupported(`unsupported key type ${kty}`);
  }
}

function assertKeyType(key: KeyObject, expected: string): void {
  if (key.asymmetricKeyType !== expected) {
    throw unsupported(`key material inconsistent (expected ${expected})`);
  }
}
