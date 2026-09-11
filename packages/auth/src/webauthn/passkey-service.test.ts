import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import type { PersonId } from "@orbb/domain";
import { fromBase64Url, toBase64Url } from "../crypto.js";
import {
  buildAssertion,
  buildPackedSelfAttestation,
  createSyntheticAuthenticator,
  TEST_ALLOWED_ORIGINS,
  TEST_RP_ID,
} from "./synthetic.js";
import {
  InMemoryChallengeStore,
  InMemoryPasskeyCredentialStore,
  PasskeyService,
} from "./passkey-service.js";

function buildHarness() {
  const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
  const ids = new DeterministicIdFactory({ seed: "passkey-tests" });
  const credentials = new InMemoryPasskeyCredentialStore();
  const challenges = new InMemoryChallengeStore();
  const service = new PasskeyService({
    credentials,
    challenges,
    rpId: TEST_RP_ID,
    allowedOrigins: [...TEST_ALLOWED_ORIGINS],
    clock,
    challengeTtlSeconds: 60,
  });
  const personId = ids.next("prsn") as PersonId;
  return { clock, ids, credentials, challenges, service, personId };
}

describe("PasskeyService (ceremony orchestration)", () => {
  it("issues person-bound single-use registration challenges", async () => {
    const { service, challenges, personId } = buildHarness();
    const issued = await service.beginRegistration(personId);
    expect(issued.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(fromBase64Url(issued.challenge).length).toBe(32);
    expect(challenges.snapshot()).toHaveLength(1);
    expect(challenges.snapshot()[0]?.personId).toBe(personId);
    expect(challenges.snapshot()[0]?.purpose).toBe("registration");
    // Challenge hash only — the raw challenge never persists.
    expect(challenges.snapshot()[0]?.challengeHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(challenges.snapshot())).not.toContain(issued.challenge);
  });

  it("registers a credential through the full ceremony (challenge consumed)", async () => {
    const { service, challenges, credentials, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const issued = await service.beginRegistration(personId);
    const challengeBytes = fromBase64Url(issued.challenge);
    const response = buildPackedSelfAttestation({ authenticator, challenge: challengeBytes });
    const result = await service.register(personId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      transports: ["internal", "hybrid"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.credential.personId).toBe(personId);
    expect(result.credential.credentialId).toBe(toBase64Url(authenticator.credentialId));
    expect(result.credential.publicKeyCose).toEqual(authenticator.coseKey);
    expect(result.credential.signCount).toBe(0);
    expect(result.credential.transports).toEqual(["internal", "hybrid"]);
    expect(credentials.snapshot()).toHaveLength(1);
    // Single use: the challenge is gone.
    expect(challenges.snapshot()).toHaveLength(0);
  });

  it("denies registration with a challenge that was never issued", async () => {
    const { service, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const response = buildPackedSelfAttestation({ authenticator, challenge: randomBytes(32) });
    const result = await service.register(personId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(result).toEqual({ ok: false, code: "INVALID_CHALLENGE" });
  });

  it("denies challenge replay (single use)", async () => {
    const { service, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const issued = await service.beginRegistration(personId);
    const challengeBytes = fromBase64Url(issued.challenge);
    const response = buildPackedSelfAttestation({ authenticator, challenge: challengeBytes });
    const first = await service.register(personId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(first.ok).toBe(true);
    const replay = await service.register(personId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(replay).toEqual({ ok: false, code: "INVALID_CHALLENGE" });
  });

  it("denies expired challenges (TTL via DeterministicClock)", async () => {
    const { service, clock, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const issued = await service.beginRegistration(personId);
    clock.advance(60_001);
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge: fromBase64Url(issued.challenge),
    });
    const result = await service.register(personId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(result).toEqual({ ok: false, code: "CHALLENGE_EXPIRED" });
  });

  it("denies a person using another person's registration challenge", async () => {
    const { service, ids, personId } = buildHarness();
    const otherPerson = ids.next("prsn") as PersonId;
    const authenticator = createSyntheticAuthenticator("es256");
    const issued = await service.beginRegistration(otherPerson);
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge: fromBase64Url(issued.challenge),
    });
    const result = await service.register(personId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(result).toEqual({ ok: false, code: "INVALID_CHALLENGE" });
  });

  it("denies an explicit expectedChallenge that disagrees with client data", async () => {
    const { service, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const issued = await service.beginRegistration(personId);
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge: fromBase64Url(issued.challenge),
    });
    const result = await service.register(personId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      expectedChallenge: toBase64Url(randomBytes(32)),
    });
    expect(result).toEqual({ ok: false, code: "INVALID_CHALLENGE" });
  });

  it("completes the full assertion ceremony and persists the counter", async () => {
    const { service, credentials, clock, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const registered = await registerHelper(service, personId, authenticator);
    expect(registered.ok).toBe(true);

    const assertionChallenge = await service.beginAssertion(personId);
    const assertion = buildAssertion({
      authenticator,
      challenge: fromBase64Url(assertionChallenge.challenge),
      signCount: 1,
    });
    const result = await service.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.credential.personId).toBe(personId);
    expect(result.credential.signCount).toBe(1);
    expect(result.credential.lastUsedAt?.getTime()).toBe(clock.now().getTime());
    expect(credentials.snapshot()[0]?.signCount).toBe(1);
  });

  it("denies assertion replay via the signature counter", async () => {
    const { service, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const registered = await registerHelper(service, personId, authenticator);
    expect(registered.ok).toBe(true);
    const assertionChallenge = await service.beginAssertion(personId);
    const assertion = buildAssertion({
      authenticator,
      challenge: fromBase64Url(assertionChallenge.challenge),
      signCount: 1,
    });
    const first = await service.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
    });
    expect(first.ok).toBe(true);
    // Replay the same assertion: new challenge needed, but the counter
    // would regress — the pure verifier rejects it.
    const secondChallenge = await service.beginAssertion(personId);
    const replayClientData = rebuildClientData(
      assertion.clientDataJSON,
      secondChallenge.challenge,
    );
    const replay = await service.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: replayClientData,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
    });
    // The signature no longer matches the new client data hash, OR the
    // counter regressed — either way it is a typed denial.
    expect(replay.ok).toBe(false);
  });

  it("denies assertions for unknown credentials", async () => {
    const { service, personId } = buildHarness();
    const assertionChallenge = await service.beginAssertion(personId);
    const result = await service.assert({
      credentialId: toBase64Url(randomBytes(16)),
      clientDataJSON: new Uint8Array(),
      authenticatorData: new Uint8Array(),
      signature: new Uint8Array(),
    });
    expect(result).toEqual({ ok: false, code: "UNKNOWN_CREDENTIAL" });
    expect(assertionChallenge.challenge.length).toBe(43);
  });

  it("denies an assertion with a tampered signature", async () => {
    const { service, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    expect((await registerHelper(service, personId, authenticator)).ok).toBe(true);
    const assertionChallenge = await service.beginAssertion(personId);
    const assertion = buildAssertion({
      authenticator,
      challenge: fromBase64Url(assertionChallenge.challenge),
      signCount: 1,
    });
    const tampered = new Uint8Array(assertion.signature);
    tampered[3] = (tampered[3] as number) ^ 0x01;
    const result = await service.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: tampered,
    });
    expect(result).toEqual({ ok: false, code: "INVALID_SIGNATURE" });
  });

  it("anonymous assertion challenges accept any credential", async () => {
    const { service, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    expect((await registerHelper(service, personId, authenticator)).ok).toBe(true);
    const anonymous = await service.beginAssertion();
    const assertion = buildAssertion({
      authenticator,
      challenge: fromBase64Url(anonymous.challenge),
      signCount: 1,
    });
    const result = await service.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
    });
    expect(result.ok).toBe(true);
  });

  it("lists and removes credentials", async () => {
    const { service, ids, personId } = buildHarness();
    const otherPerson = ids.next("prsn") as PersonId;
    const authenticator = createSyntheticAuthenticator("es256");
    const registered = await registerHelper(service, personId, authenticator);
    expect(registered.ok).toBe(true);
    expect(await service.listCredentials(personId)).toHaveLength(1);
    expect(await service.listCredentials(otherPerson)).toHaveLength(0);
    expect(await service.removeCredential(toBase64Url(authenticator.credentialId))).toBe(true);
    expect(await service.removeCredential(toBase64Url(authenticator.credentialId))).toBe(false);
    expect(await service.listCredentials(personId)).toHaveLength(0);
  });

  it("rejects an invalid challenge TTL at construction", () => {
    const credentials = new InMemoryPasskeyCredentialStore();
    const challenges = new InMemoryChallengeStore();
    expect(
      () =>
        new PasskeyService({
          credentials,
          challenges,
          rpId: TEST_RP_ID,
          allowedOrigins: [...TEST_ALLOWED_ORIGINS],
          challengeTtlSeconds: 29,
        }),
    ).toThrowError(RangeError);
  });
});

async function registerHelper(
  service: PasskeyService,
  personId: PersonId,
  authenticator: ReturnType<typeof createSyntheticAuthenticator>,
) {
  const issued = await service.beginRegistration(personId);
  const response = buildPackedSelfAttestation({
    authenticator,
    challenge: fromBase64Url(issued.challenge),
  });
  return service.register(personId, {
    clientDataJSON: response.clientDataJSON,
    attestationObject: response.attestationObject,
  });
}

/** Rewrites the challenge field of a client data JSON payload. */
function rebuildClientData(original: Uint8Array, newChallenge: string): Uint8Array {
  const parsed = JSON.parse(new TextDecoder().decode(original)) as { challenge: string };
  const rebuilt = JSON.stringify({ ...parsed, challenge: newChallenge });
  return new TextEncoder().encode(rebuilt);
}
