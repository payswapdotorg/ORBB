import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { toBase64Url } from "../crypto.js";
import { verifyAttestation } from "./attestation.js";
import { COSE_ALG } from "./cose.js";
import {
  buildAssertion,
  buildAttestationObject,
  buildPackedSelfAttestation,
  createSyntheticAuthenticator,
  TEST_ALLOWED_ORIGINS,
  TEST_RP_ID,
} from "./synthetic.js";

const challenge = randomBytes(32);

function baseInput() {
  return {
    expectedChallenge: toBase64Url(challenge),
    allowedOrigins: [...TEST_ALLOWED_ORIGINS],
    rpId: TEST_RP_ID,
  };
}

describe("verifyAttestation (WebAuthn registration, L3 §7.1)", () => {
  it("accepts a valid ES256 packed self-attestation", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const result = verifyAttestation({ ...baseInput(), ...response });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.credential.credentialIdBase64Url).toBe(toBase64Url(authenticator.credentialId));
    expect(toBase64Url(result.credential.credentialId)).toBe(toBase64Url(authenticator.credentialId));
    expect(result.credential.publicKeyCose).toEqual(authenticator.coseKey);
    expect(result.credential.alg).toBe(COSE_ALG.ES256);
    expect(result.credential.signCount).toBe(0);
    expect(result.credential.attestationFormat).toBe("packed");
    expect(result.credential.aaguid.length).toBe(16);
  });

  it("accepts a valid Ed25519 packed self-attestation", () => {
    const authenticator = createSyntheticAuthenticator("ed25519");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const result = verifyAttestation({ ...baseInput(), ...response });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.credential.alg).toBe(COSE_ALG.ED25519);
  });

  it("accepts a valid RS256 packed self-attestation", () => {
    const authenticator = createSyntheticAuthenticator("rs256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const result = verifyAttestation({ ...baseInput(), ...response });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.credential.alg).toBe(COSE_ALG.RS256);
  });

  it("accepts the 'none' attestation format with an empty statement (trust-ignored path)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const noneAttestation = buildAttestationObject({
      fmt: "none",
      attStmt: new Map(),
      authData: response.authData,
    });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: noneAttestation,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered challenge", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const result = verifyAttestation({
      ...baseInput(),
      ...response,
      expectedChallenge: toBase64Url(randomBytes(32)),
    });
    expect(result).toEqual({ ok: false, code: "CHALLENGE_MISMATCH" });
  });

  it("rejects a mismatched origin", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge,
      origin: "https://evil.example",
    });
    const result = verifyAttestation({ ...baseInput(), ...response });
    expect(result).toEqual({ ok: false, code: "ORIGIN_MISMATCH" });
  });

  it("rejects a mismatched RP ID (rpIdHash)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge,
      rpId: "evil.example",
    });
    const result = verifyAttestation({ ...baseInput(), ...response });
    expect(result).toEqual({ ok: false, code: "RP_ID_MISMATCH" });
  });

  it("rejects a tampered attestation signature", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const tamperedSignature = new Uint8Array(response.signature);
    tamperedSignature[10] = (tamperedSignature[10] as number) ^ 0x01;
    const tampered = buildAttestationObject({
      fmt: "packed",
      attStmt: new Map<string, Uint8Array | number>([
        ["alg", COSE_ALG.ES256],
        ["sig", tamperedSignature],
      ]),
      authData: response.authData,
    });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: tampered,
    });
    expect(result).toEqual({ ok: false, code: "INVALID_ATTESTATION_SIGNATURE" });
  });

  it("rejects a packed statement whose declared alg does not match the credential key", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const swapped = buildAttestationObject({
      fmt: "packed",
      attStmt: new Map<string, Uint8Array | number>([
        ["alg", COSE_ALG.RS256],
        ["sig", response.signature],
      ]),
      authData: response.authData,
    });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: swapped,
    });
    expect(result).toEqual({ ok: false, code: "INVALID_ATTESTATION_SIGNATURE" });
  });

  it("rejects the wrong ceremony type (assertion client data on registration)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const assertion = buildAssertion({ authenticator, challenge });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: assertion.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(result).toEqual({ ok: false, code: "TYPE_MISMATCH" });
  });

  it("rejects unsupported attestation formats", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const u2f = buildAttestationObject({
      fmt: "fido-u2f",
      attStmt: new Map(),
      authData: response.authData,
    });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: u2f,
    });
    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_ATTESTATION_FORMAT" });
  });

  it("rejects malformed attestation objects", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: new Uint8Array([0xff, 0xff, 0xff]),
    });
    expect(result).toEqual({ ok: false, code: "MALFORMED_ATTESTATION" });
  });

  it("rejects malformed client data", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: new Uint8Array([0xde, 0xad]),
      attestationObject: response.attestationObject,
    });
    expect(result).toEqual({ ok: false, code: "MALFORMED_CLIENT_DATA" });
  });

  it("rejects authenticator data without the AT flag", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const assertion = buildAssertion({ authenticator, challenge });
    const rebuilt = buildAttestationObject({
      fmt: "packed",
      attStmt: new Map(),
      authData: assertion.authenticatorData,
    });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: rebuilt,
    });
    expect(result).toEqual({ ok: false, code: "MISSING_ATTESTED_CREDENTIAL" });
  });

  it("rejects 'none' format with a non-empty attStmt", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const sneaky = buildAttestationObject({
      fmt: "none",
      attStmt: new Map<string, number>([["alg", -7]]),
      authData: response.authData,
    });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: sneaky,
    });
    expect(result).toEqual({ ok: false, code: "MALFORMED_ATTESTATION" });
  });

  it("rejects packed with a garbage x5c certificate", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    const withX5c = buildAttestationObject({
      fmt: "packed",
      attStmt: new Map<string, number | Uint8Array | Uint8Array[]>([
        ["alg", -7],
        ["sig", new Uint8Array(64)],
        ["x5c", [new Uint8Array([0x30, 0x03, 0x02, 0x01])]],
      ]),
      authData: response.authData,
    });
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: withX5c,
    });
    expect(result).toEqual({ ok: false, code: "MALFORMED_ATTESTATION" });
  });

  it("rejects a corrupted embedded COSE key (typed denial, never a throw)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge });
    // The COSE key is the tail of authData; corrupting the last byte of
    // the attestation object corrupts the key region.
    const corrupted = new Uint8Array(response.attestationObject);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] as number) ^ 0xff;
    const result = verifyAttestation({
      ...baseInput(),
      clientDataJSON: response.clientDataJSON,
      attestationObject: corrupted,
    });
    expect(result.ok).toBe(false);
  });
});
