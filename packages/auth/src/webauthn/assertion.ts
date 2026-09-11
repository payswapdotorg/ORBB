/**
 * WebAuthn assertion verification — W3C WebAuthn L3 §7.2 (verifying
 * authentication-assertion data).
 *
 * Ceremony steps implemented:
 *   1. Parse client data; verify type is `webauthn.get`, challenge, and
 *      origin (§7.2 steps 9–11).
 *   2. Credential-id binding: when the client echoed a credential id it
 *      must match the stored credential (CREDENTIAL_ID_MISMATCH).
 *   3. Parse authenticator data: rpIdHash must equal SHA-256(rpId);
 *      the UP flag is REQUIRED (L3 step 12); UV required on demand.
 *   4. Verify the signature over `authenticatorData ‖ SHA-256(clientDataJSON)`
 *      with the stored credential key.
 *   5. Signature-counter monotonicity (L3 step 17): when both the stored
 *      and received counters are non-zero, a received count that is less
 *      than or equal to the stored count signals a cloned authenticator
 *      and is REJECTED. A received count of zero means the authenticator
 *      does not implement a counter: accepted, stored count retained
 *      (recorded interpretation of the L3 text).
 *
 * Deny-by-default: every outcome is a typed result; malformed inputs map
 * to failure codes, never thrown user-facing details.
 */
import { sha256, timingSafeEqualUint8 } from "../crypto.js";
import { fromBase64Url } from "../crypto.js";
import { checkClientData, challengeToBytes, parseClientDataJSON } from "./client-data.js";
import { parseAuthenticatorData } from "./authenticator-data.js";
import { parseCosePublicKey } from "./cose.js";
import { verifyWebAuthnSignature, webauthnSignedData } from "./signature.js";

/** Typed failure codes for assertion verification (never thrown). */
export type AssertionFailureCode =
  | "MALFORMED_CLIENT_DATA"
  | "TYPE_MISMATCH"
  | "CHALLENGE_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "CREDENTIAL_ID_MISMATCH"
  | "MALFORMED_AUTHENTICATOR_DATA"
  | "RP_ID_MISMATCH"
  | "USER_PRESENCE_REQUIRED"
  | "USER_VERIFICATION_REQUIRED"
  | "UNSUPPORTED_PUBLIC_KEY"
  | "INVALID_SIGNATURE"
  | "SIGN_COUNT_REGRESSION";

/** The client-side assertion payload. */
export interface ClientAssertion {
  readonly clientDataJSON: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly signature: Uint8Array;
  /** Credential id echoed by the client (base64url), when present. */
  readonly credentialId?: string;
}

/** The stored-credential fields needed to verify an assertion. */
export interface AssertionCredentialSource {
  /** Stored credential id (base64url). */
  readonly credentialId: string;
  /** Raw COSE public key bytes as persisted at registration. */
  readonly publicKeyCose: Uint8Array;
  /** Stored signature counter (0 = no counter support). */
  readonly signCount: number;
}

/** Assertion verification policy. */
export interface AssertionVerifyOptions {
  /** The challenge the RP issued for this ceremony (base64url or raw bytes). */
  readonly expectedChallenge: string | Uint8Array;
  /** Exact origin allowlist (deny-by-default). */
  readonly allowedOrigins: readonly string[];
  readonly rpId: string;
  /** Require the UV flag (step 12). Default: false (UP alone suffices). */
  readonly requireUserVerification?: boolean;
}

/** Result of assertion verification: next signature counter on success. */
export type AssertionVerificationResult =
  | { readonly ok: true; readonly signCount: number }
  | { readonly ok: false; readonly code: AssertionFailureCode };

function fail(code: AssertionFailureCode): { ok: false; code: AssertionFailureCode } {
  return { ok: false, code };
}

/**
 * Verifies an assertion against a stored credential. Pure: challenge
 * policy (issuance/single-use) is composed by the `PasskeyService`.
 */
export function verifyAssertion(
  assertion: ClientAssertion,
  credential: AssertionCredentialSource,
  options: AssertionVerifyOptions,
): AssertionVerificationResult {
  // 1. Client data.
  let clientData;
  try {
    clientData = parseClientDataJSON(assertion.clientDataJSON);
  } catch {
    return fail("MALFORMED_CLIENT_DATA");
  }
  let expectedChallenge: Uint8Array;
  try {
    expectedChallenge = challengeToBytes(options.expectedChallenge);
  } catch {
    return fail("CHALLENGE_MISMATCH");
  }
  const clientDataFailure = checkClientData(clientData, {
    type: "webauthn.get",
    challenge: expectedChallenge,
    allowedOrigins: options.allowedOrigins,
  });
  if (clientDataFailure !== undefined) {
    return fail(clientDataFailure);
  }

  // 2. Credential-id binding (byte comparison, padding-lenient).
  if (assertion.credentialId !== undefined) {
    let echoedId: Uint8Array;
    let storedId: Uint8Array;
    try {
      echoedId = fromBase64Url(assertion.credentialId);
      storedId = fromBase64Url(credential.credentialId);
    } catch {
      return fail("CREDENTIAL_ID_MISMATCH");
    }
    if (!timingSafeEqualUint8(echoedId, storedId)) {
      return fail("CREDENTIAL_ID_MISMATCH");
    }
  }

  // 3. Authenticator data.
  let authData;
  try {
    authData = parseAuthenticatorData(assertion.authenticatorData);
  } catch {
    return fail("MALFORMED_AUTHENTICATOR_DATA");
  }
  const expectedRpIdHash = sha256(options.rpId);
  if (!timingSafeEqualUint8(authData.rpIdHash, expectedRpIdHash)) {
    return fail("RP_ID_MISMATCH");
  }
  if (!authData.flags.up) {
    return fail("USER_PRESENCE_REQUIRED");
  }
  if (options.requireUserVerification === true && !authData.flags.uv) {
    return fail("USER_VERIFICATION_REQUIRED");
  }

  // 4. Signature over authData ‖ SHA-256(clientDataJSON).
  let coseKey;
  try {
    coseKey = parseCosePublicKey(credential.publicKeyCose);
  } catch {
    return fail("UNSUPPORTED_PUBLIC_KEY");
  }
  const signatureBase = webauthnSignedData(assertion.authenticatorData, assertion.clientDataJSON);
  const signatureValid = verifyWebAuthnSignature({
    key: coseKey.key,
    alg: coseKey.alg,
    data: signatureBase,
    signature: assertion.signature,
  });
  if (!signatureValid) {
    return fail("INVALID_SIGNATURE");
  }

  // 5. Signature counter monotonicity (clone detection).
  const received = authData.signCount;
  const stored = credential.signCount;
  if (received !== 0 && stored !== 0 && received <= stored) {
    return fail("SIGN_COUNT_REGRESSION");
  }
  const nextSignCount = received !== 0 ? received : stored;
  return { ok: true, signCount: nextSignCount };
}

/** Decodes a base64url credential id to raw bytes (helper for callers). */
export function credentialIdToBytes(credentialId: string): Uint8Array {
  return fromBase64Url(credentialId);
}
