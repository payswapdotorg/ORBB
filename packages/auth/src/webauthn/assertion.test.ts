import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { toBase64Url } from "../crypto.js";
import { verifyAssertion, type AssertionCredentialSource } from "./assertion.js";
import {
  buildAssertion,
  createSyntheticAuthenticator,
  SYNTH_FLAGS,
  TEST_ALLOWED_ORIGINS,
  TEST_RP_ID,
} from "./synthetic.js";

const challenge = randomBytes(32);

function credentialOf(authenticator: ReturnType<typeof createSyntheticAuthenticator>): AssertionCredentialSource {
  return {
    credentialId: toBase64Url(authenticator.credentialId),
    publicKeyCose: authenticator.coseKey,
    signCount: 0,
  };
}

function options(extra?: { requireUserVerification?: boolean }) {
  return {
    expectedChallenge: challenge,
    allowedOrigins: [...TEST_ALLOWED_ORIGINS],
    rpId: TEST_RP_ID,
    ...(extra !== undefined ? extra : {}),
  };
}

describe("verifyAssertion (WebAuthn assertion, L3 §7.2)", () => {
  it("accepts a valid ES256 assertion and advances the signature counter", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const result = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(result).toEqual({ ok: true, signCount: 1 });
  });

  it("accepts a valid Ed25519 assertion", () => {
    const authenticator = createSyntheticAuthenticator("ed25519");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const result = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(result).toEqual({ ok: true, signCount: 1 });
  });

  it("accepts a valid RS256 assertion", () => {
    const authenticator = createSyntheticAuthenticator("rs256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const result = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(result).toEqual({ ok: true, signCount: 1 });
  });

  it("rejects a tampered challenge", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const result = verifyAssertion(
      assertion,
      credentialOf(authenticator),
      { ...options(), expectedChallenge: randomBytes(32) },
    );
    expect(result).toEqual({ ok: false, code: "CHALLENGE_MISMATCH" });
  });

  it("rejects a mismatched origin", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({
      authenticator,
      challenge,
      origin: "https://evil.example",
    });
    const result = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(result).toEqual({ ok: false, code: "ORIGIN_MISMATCH" });
  });

  it("rejects a mismatched RP ID (rpIdHash)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, rpId: "evil.example" });
    const result = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(result).toEqual({ ok: false, code: "RP_ID_MISMATCH" });
  });

  it("rejects a tampered signature", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const tampered = new Uint8Array(assertion.signature);
    tampered[5] = (tampered[5] as number) ^ 0x01;
    const result = verifyAssertion(
      { ...assertion, signature: tampered },
      credentialOf(authenticator),
      options(),
    );
    expect(result).toEqual({ ok: false, code: "INVALID_SIGNATURE" });
  });

  it("rejects an assertion signed by a different key (cloned credential)", () => {
    const credentialOwner = createSyntheticAuthenticator("es256");
    const impostor = createSyntheticAuthenticator("es256");
    const impostorAssertion = buildAssertion({ authenticator: impostor, challenge, signCount: 1 });
    const result = verifyAssertion(
      impostorAssertion,
      credentialOf(credentialOwner),
      options(),
    );
    expect(result).toEqual({ ok: false, code: "INVALID_SIGNATURE" });
  });

  it("rejects a signCount replay (equal counter)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 7 });
    const stored = { ...credentialOf(authenticator), signCount: 7 };
    const result = verifyAssertion(assertion, stored, options());
    expect(result).toEqual({ ok: false, code: "SIGN_COUNT_REGRESSION" });
  });

  it("rejects a signCount regression (decreasing counter)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 4 });
    const stored = { ...credentialOf(authenticator), signCount: 5 };
    const result = verifyAssertion(assertion, stored, options());
    expect(result).toEqual({ ok: false, code: "SIGN_COUNT_REGRESSION" });
  });

  it("accepts authenticators without counter support (0 → 0)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 0 });
    const result = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(result).toEqual({ ok: true, signCount: 0 });
  });

  it("retains the stored counter when the authenticator reports zero", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 0 });
    const stored = { ...credentialOf(authenticator), signCount: 9 };
    const result = verifyAssertion(assertion, stored, options());
    expect(result).toEqual({ ok: true, signCount: 9 });
  });

  it("requires the UP flag (L3 step 12)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({
      authenticator,
      challenge,
      flags: SYNTH_FLAGS.NONE,
    });
    const result = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(result).toEqual({ ok: false, code: "USER_PRESENCE_REQUIRED" });
  });

  it("requires the UV flag on demand", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({
      authenticator,
      challenge,
      flags: SYNTH_FLAGS.UP_ONLY,
    });
    const withoutUv = verifyAssertion(
      assertion,
      credentialOf(authenticator),
      options({ requireUserVerification: true }),
    );
    expect(withoutUv).toEqual({ ok: false, code: "USER_VERIFICATION_REQUIRED" });
    const withUv = verifyAssertion(assertion, credentialOf(authenticator), options());
    expect(withUv.ok).toBe(true);
  });

  it("rejects an echoed credential id that does not match the stored one", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const result = verifyAssertion(
      { ...assertion, credentialId: toBase64Url(randomBytes(16)) },
      credentialOf(authenticator),
      options(),
    );
    expect(result).toEqual({ ok: false, code: "CREDENTIAL_ID_MISMATCH" });
  });

  it("accepts an echoed credential id that matches the stored one (padding-lenient)", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const credential = credentialOf(authenticator);
    const result = verifyAssertion(
      { ...assertion, credentialId: `${credential.credentialId}==` },
      credential,
      options(),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects malformed authenticator data and client data with typed codes", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const badAuthData = verifyAssertion(
      { ...assertion, authenticatorData: new Uint8Array(10) },
      credentialOf(authenticator),
      options(),
    );
    expect(badAuthData).toEqual({ ok: false, code: "MALFORMED_AUTHENTICATOR_DATA" });
    const badClientData = verifyAssertion(
      { ...assertion, clientDataJSON: new Uint8Array([0xde, 0xad]) },
      credentialOf(authenticator),
      options(),
    );
    expect(badClientData).toEqual({ ok: false, code: "MALFORMED_CLIENT_DATA" });
  });

  it("rejects a corrupted stored COSE key with a typed code", () => {
    const authenticator = createSyntheticAuthenticator("es256");
    const assertion = buildAssertion({ authenticator, challenge, signCount: 1 });
    const corruptedKey = new Uint8Array(authenticator.coseKey);
    corruptedKey[corruptedKey.length - 1] = (corruptedKey[corruptedKey.length - 1] as number) ^ 0xff;
    const result = verifyAssertion(
      assertion,
      { ...credentialOf(authenticator), publicKeyCose: corruptedKey },
      options(),
    );
    expect(result.ok).toBe(false);
  });
});
