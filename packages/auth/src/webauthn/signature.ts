/**
 * WebAuthn signature verification — W3C WebAuthn L3 §6.5.5 / §6.5.6.
 *
 * The signed bytes are always `authenticatorData ‖ SHA-256(clientDataJSON)`.
 * ES256 signatures on the WebAuthn wire are RAW r‖s (IEEE P1363), NOT
 * DER: node:crypto is instructed to verify in `ieee-p1363` mode.
 * Ed25519 signatures are 64 raw bytes; RS256 is PKCS#1 v1.5. Any
 * malformed key/signature input maps to `false` (verification failure),
 * never a thrown user-facing error.
 */
import { verify as cryptoVerify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { sha256 } from "../crypto.js";
import { COSE_ALG } from "./cose.js";

/** Computes the WebAuthn signature base: authData ‖ SHA-256(clientDataJSON). */
export function webauthnSignedData(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Uint8Array {
  const clientDataHash = sha256(clientDataJSON);
  const out = new Uint8Array(authenticatorData.length + clientDataHash.length);
  out.set(authenticatorData, 0);
  out.set(clientDataHash, authenticatorData.length);
  return out;
}

/**
 * Verifies a WebAuthn signature over `data` with `key` for COSE `alg`.
 * Returns `false` for unsupported algorithms and malformed inputs —
 * deny-by-default, no throws on the verify path.
 */
export function verifyWebAuthnSignature(input: {
  readonly key: KeyObject;
  readonly alg: number;
  readonly data: Uint8Array;
  readonly signature: Uint8Array;
}): boolean {
  const { key, alg, data, signature } = input;
  try {
    switch (alg) {
      case COSE_ALG.ES256:
        return cryptoVerify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
      case COSE_ALG.ED25519:
        return cryptoVerify(null, data, key, signature);
      case COSE_ALG.RS256:
        return cryptoVerify("sha256", data, key, signature);
      default:
        return false;
    }
  } catch {
    return false;
  }
}
