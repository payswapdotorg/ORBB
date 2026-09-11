/**
 * WebAuthn registration verification — W3C WebAuthn L3 §7.1 (verifying
 * registration data), trust-ignored path ("none" attestation accepted;
 * attestation chains are never validated — the recorded M3-C decision).
 *
 * Ceremony steps implemented:
 *   1. Parse client data; verify type is `webauthn.create`, challenge,
 *      and origin (§7.1 steps 9–11).
 *   2. Decode the attestation object CBOR map {fmt, attStmt, authData}.
 *   3. Parse authenticator data; require the AT flag; verify rpIdHash.
 *   4. Extract the attested credential (id + COSE key).
 *   5. Verify the attestation statement per format:
 *        - "none": attStmt must be empty.
 *        - "packed": self-attestation (no x5c) verified with the
 *          attested credential key; x5c present → signature verified
 *          with the leaf certificate's key, trust chain IGNORED.
 *      Other formats are rejected (deny-by-default).
 *   6. NO PHI: the returned credential metadata is exactly
 *      {credentialId, publicKey, signCount, alg, aaguid, fmt} — device
 *      model + cryptographic material only.
 */
import { X509Certificate } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { fromBase64Url, sha256 } from "../crypto.js";
import { timingSafeEqualUint8, toBase64Url } from "../crypto.js";
import { decodeCbor, type CborKey, type CborValue } from "./cbor.js";
import { parseCosePublicKey, type CosePublicKey } from "./cose.js";
import { checkClientData, parseClientDataJSON } from "./client-data.js";
import { parseAuthenticatorData } from "./authenticator-data.js";
import { verifyWebAuthnSignature, webauthnSignedData } from "./signature.js";

/** Typed failure codes for registration verification (never thrown). */
export type AttestationFailureCode =
  | "MALFORMED_CLIENT_DATA"
  | "TYPE_MISMATCH"
  | "CHALLENGE_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "MALFORMED_ATTESTATION"
  | "MALFORMED_AUTHENTICATOR_DATA"
  | "RP_ID_MISMATCH"
  | "MISSING_ATTESTED_CREDENTIAL"
  | "UNSUPPORTED_PUBLIC_KEY"
  | "UNSUPPORTED_ATTESTATION_FORMAT"
  | "INVALID_ATTESTATION_SIGNATURE";

/** Input for `verifyAttestation`. */
export interface AttestationVerificationInput {
  readonly clientDataJSON: Uint8Array;
  readonly attestationObject: Uint8Array;
  /** The challenge the RP issued for this ceremony (base64url or raw bytes). */
  readonly expectedChallenge: string | Uint8Array;
  /** Exact origin allowlist (deny-by-default). */
  readonly allowedOrigins: readonly string[];
  readonly rpId: string;
}

/** Verified credential metadata — NO PHI (device + key material only). */
export interface VerifiedCredentialInfo {
  readonly credentialId: Uint8Array;
  readonly credentialIdBase64Url: string;
  /** Raw COSE public key bytes (the persistence format). */
  readonly publicKeyCose: Uint8Array;
  readonly alg: number;
  readonly signCount: number;
  readonly aaguid: Uint8Array;
  readonly attestationFormat: string;
}

/** Result of registration verification (deny-by-default). */
export type AttestationVerificationResult =
  | { readonly ok: true; readonly credential: VerifiedCredentialInfo }
  | { readonly ok: false; readonly code: AttestationFailureCode };

function fail(code: AttestationFailureCode): { ok: false; code: AttestationFailureCode } {
  return { ok: false, code };
}

/**
 * Verifies a registration ceremony response. Pure: no store, no clock,
 * no logging — the `PasskeyService` composes challenge policy around it.
 */
export function verifyAttestation(
  input: AttestationVerificationInput,
): AttestationVerificationResult {
  // 1. Client data.
  let clientData;
  try {
    clientData = parseClientDataJSON(input.clientDataJSON);
  } catch {
    return fail("MALFORMED_CLIENT_DATA");
  }
  let expectedChallenge: Uint8Array;
  try {
    expectedChallenge =
      typeof input.expectedChallenge === "string"
        ? fromBase64Url(input.expectedChallenge)
        : input.expectedChallenge;
  } catch {
    return fail("CHALLENGE_MISMATCH");
  }
  const clientDataFailure = checkClientData(clientData, {
    type: "webauthn.create",
    challenge: expectedChallenge,
    allowedOrigins: input.allowedOrigins,
  });
  if (clientDataFailure !== undefined) {
    return fail(clientDataFailure);
  }

  // 2. Attestation object.
  let attestation: CborValue;
  try {
    attestation = decodeCbor(input.attestationObject);
  } catch {
    return fail("MALFORMED_ATTESTATION");
  }
  if (!(attestation instanceof Map)) {
    return fail("MALFORMED_ATTESTATION");
  }
  const fmt = attestation.get("fmt");
  const attStmt = attestation.get("attStmt");
  const authDataBytes = attestation.get("authData");
  if (typeof fmt !== "string" || !(attStmt instanceof Map) || !(authDataBytes instanceof Uint8Array)) {
    return fail("MALFORMED_ATTESTATION");
  }

  // 3. Authenticator data.
  let authData;
  try {
    authData = parseAuthenticatorData(authDataBytes);
  } catch {
    return fail("MALFORMED_AUTHENTICATOR_DATA");
  }
  const expectedRpIdHash = sha256(input.rpId);
  if (!timingSafeEqualUint8(authData.rpIdHash, expectedRpIdHash)) {
    return fail("RP_ID_MISMATCH");
  }
  const attested = authData.attestedCredentialData;
  if (attested === undefined) {
    return fail("MISSING_ATTESTED_CREDENTIAL");
  }

  // 4. Credential public key.
  let coseKey: CosePublicKey;
  try {
    coseKey = parseCosePublicKey(attested.credentialPublicKey);
  } catch {
    return fail("UNSUPPORTED_PUBLIC_KEY");
  }

  // 5. Attestation statement.
  const signatureBase = webauthnSignedData(authDataBytes, input.clientDataJSON);
  const statementResult = verifyAttestationStatement({
    fmt,
    attStmt,
    signatureBase,
    credentialKey: coseKey.key,
    credentialAlg: coseKey.alg,
  });
  if (statementResult !== undefined) {
    return fail(statementResult);
  }

  return {
    ok: true,
    credential: {
      credentialId: attested.credentialId,
      credentialIdBase64Url: toBase64Url(attested.credentialId),
      publicKeyCose: attested.credentialPublicKey,
      alg: coseKey.alg,
      signCount: authData.signCount,
      aaguid: attested.aaguid,
      attestationFormat: fmt,
    },
  };
}

/** Attestation-statement verification per format; undefined = accepted. */
function verifyAttestationStatement(input: {
  readonly fmt: string;
  readonly attStmt: ReadonlyMap<CborKey, CborValue>;
  readonly signatureBase: Uint8Array;
  readonly credentialKey: KeyObject;
  readonly credentialAlg: number;
}): AttestationFailureCode | undefined {
  switch (input.fmt) {
    case "none": {
      if (input.attStmt.size !== 0) {
        return "MALFORMED_ATTESTATION";
      }
      return undefined;
    }
    case "packed": {
      const alg = input.attStmt.get("alg");
      const sig = input.attStmt.get("sig");
      if (typeof alg !== "number" || !(sig instanceof Uint8Array)) {
        return "MALFORMED_ATTESTATION";
      }
      const x5c = input.attStmt.get("x5c");
      if (x5c === undefined) {
        // Self-attestation: signed with the attested credential key.
        if (alg !== input.credentialAlg) {
          return "INVALID_ATTESTATION_SIGNATURE";
        }
        const valid = verifyWebAuthnSignature({
          key: input.credentialKey,
          alg,
          data: input.signatureBase,
          signature: sig,
        });
        return valid ? undefined : "INVALID_ATTESTATION_SIGNATURE";
      }
      // Cert path: verify the signature with the leaf certificate's key.
      // Trust decision is IGNORED (recorded M3-C choice): the chain is
      // never validated — callers that need trust policies layer them
      // on top of this shape/proof-of-possession verification.
      if (!Array.isArray(x5c) || x5c.length === 0) {
        return "MALFORMED_ATTESTATION";
      }
      const leaf = x5c[0];
      if (!(leaf instanceof Uint8Array)) {
        return "MALFORMED_ATTESTATION";
      }
      let leafKey: KeyObject;
      try {
        leafKey = new X509Certificate(leaf).publicKey;
      } catch {
        return "MALFORMED_ATTESTATION";
      }
      const valid = verifyWebAuthnSignature({
        key: leafKey,
        alg,
        data: input.signatureBase,
        signature: sig,
      });
      return valid ? undefined : "INVALID_ATTESTATION_SIGNATURE";
    }
    default:
      return "UNSUPPORTED_ATTESTATION_FORMAT";
  }
}
