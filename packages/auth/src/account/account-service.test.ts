import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { InMemoryRateLimiter } from "@orbb/platform";
import type { PersonId } from "@orbb/domain";
import { fromBase64Url, toBase64Url } from "../crypto.js";
import {
  buildAssertion,
  buildPackedSelfAttestation,
  createSyntheticAuthenticator,
  TEST_ALLOWED_ORIGINS,
  TEST_RP_ID,
} from "../webauthn/synthetic.js";
import {
  InMemoryChallengeStore,
  InMemoryPasskeyCredentialStore,
  PasskeyService,
} from "../webauthn/passkey-service.js";
import { InMemoryOtpStore, InMemoryOtpTransport } from "../otp/otp-store.js";
import { EmailOtpService } from "../otp/otp-service.js";
import { InMemoryRecoveryCodeStore } from "../recovery/recovery-store.js";
import { RecoveryService } from "../recovery/recovery-service.js";
import {
  InMemoryAccountStatusStore,
  InMemoryAccountStore,
  InMemoryEmailCredentialStore,
} from "./account-store.js";
import { AccountService } from "./account-service.js";
import type { AccountId } from "../ids.js";

const EMAIL = "ada.lovelace@example-health.test";

interface Harness {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  readonly limiter: InMemoryRateLimiter;
  readonly accounts: InMemoryAccountStore;
  readonly status: InMemoryAccountStatusStore;
  readonly emailCredentials: InMemoryEmailCredentialStore;
  readonly passkeys: PasskeyService;
  readonly recovery: RecoveryService;
  readonly service: AccountService;
  readonly personId: PersonId;
  readonly transport: InMemoryOtpTransport;
}

function buildHarness(transport?: InMemoryOtpTransport): Harness {
  const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
  const ids = new DeterministicIdFactory({ seed: "account-tests" });
  const limiter = new InMemoryRateLimiter({ nowMs: () => clock.now().getTime() });
  const accounts = new InMemoryAccountStore();
  const status = new InMemoryAccountStatusStore();
  const emailCredentials = new InMemoryEmailCredentialStore();
  const passkeys = new PasskeyService({
    credentials: new InMemoryPasskeyCredentialStore(),
    challenges: new InMemoryChallengeStore(),
    rpId: TEST_RP_ID,
    allowedOrigins: [...TEST_ALLOWED_ORIGINS],
    clock,
    challengeTtlSeconds: 60,
  });
  const recovery = new RecoveryService({
    store: new InMemoryRecoveryCodeStore(),
    clock,
    verifyLimiter: limiter,
  });
  const liveTransport = transport ?? new InMemoryOtpTransport();
  const otp = new EmailOtpService({
    store: new InMemoryOtpStore(),
    transport: liveTransport,
    limiter,
    clock,
    idFactory: ids,
  });
  const service = new AccountService({
    accounts,
    status,
    emailCredentials,
    passkeys,
    recovery,
    otp,
    clock,
    idFactory: ids,
  });
  const personId = ids.next("prsn") as PersonId;
  return {
    clock,
    ids,
    limiter,
    accounts,
    status,
    emailCredentials,
    passkeys,
    recovery,
    service,
    personId,
    transport: liveTransport,
  };
}

/** A harness whose account exists and has EMAIL bound. */
async function buildBoundHarness(): Promise<Harness & { accountId: AccountId }> {
  const harness = buildHarness();
  const created = await harness.service.createAccount({ personId: harness.personId });
  const accountId = created.ok ? created.account.id : parseFakeAccountId();
  await harness.service.bindEmailAddress(accountId, EMAIL);
  return { ...harness, accountId };
}

function parseFakeAccountId(): AccountId {
  return "acct_this-should-never-00001" as AccountId;
}

describe("AccountService (lifecycle seams)", () => {
  it("creates an account for a person with db-style idempotency", async () => {
    const { service, accounts, personId } = buildHarness();
    const created = await service.createAccount({ personId, idempotencyKey: "idem-1" });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(`expected ok, got ${created.code}`);
    }
    expect(created.account.id.startsWith("acct_")).toBe(true);
    expect(created.account.personId).toBe(personId);
    expect(accounts.snapshot()).toHaveLength(1);

    // Same idempotency key replays the stored account (first write wins).
    const replay = await service.createAccount({ personId, idempotencyKey: "idem-1" });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.account.id).toBe(created.account.id);
    }
    expect(accounts.snapshot()).toHaveLength(1);

    const statusResult = await service.getAuthStatus(created.account.id);
    expect(statusResult.ok).toBe(true);
    if (statusResult.ok) {
      expect(statusResult.status.state).toBe("active");
    }
  });

  it("denies account creation for an invalid person id (typed result)", async () => {
    const { service } = buildHarness();
    const result = await service.createAccount({ personId: "garbage" as unknown as PersonId });
    expect(result).toEqual({ ok: false, code: "PERSON_INVALID" });
  });

  it("binds a passkey through the full WebAuthn ceremony", async () => {
    const harness = buildHarness();
    const { service, passkeys, personId } = harness;
    const created = await service.createAccount({ personId });
    const accountId = created.ok ? created.account.id : parseFakeAccountId();

    const authenticator = createSyntheticAuthenticator("es256");
    const challenge = await passkeys.beginRegistration(personId);
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge: fromBase64Url(challenge.challenge),
    });
    const bound = await service.bindPasskey(accountId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      transports: ["internal"],
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      throw new Error(`expected ok, got ${bound.code}`);
    }
    expect(bound.credential.accountId).toBe(accountId);
    expect(bound.credential.personId).toBe(personId);
  });

  it("denies passkey binding for an unknown account", async () => {
    const { service, passkeys, personId } = buildHarness();
    const authenticator = createSyntheticAuthenticator("es256");
    const challenge = await passkeys.beginRegistration(personId);
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge: fromBase64Url(challenge.challenge),
    });
    const bound = await service.bindPasskey("acct_does-not-exist-000001" as AccountId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(bound).toEqual({ ok: false, code: "ACCOUNT_NOT_FOUND" });
  });

  it("binds an email address as a digest and refuses double-binding across accounts", async () => {
    const { service, ids, personId } = buildHarness();
    const created = await service.createAccount({ personId });
    const accountId = created.ok ? created.account.id : parseFakeAccountId();

    const bound = await service.bindEmailAddress(accountId, EMAIL);
    expect(bound.ok).toBe(true);
    if (bound.ok) {
      expect(bound.credential.emailHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(bound.credential.verifiedAt).toBeUndefined();
    }
    // Digest only at rest.
    const credentialDump = JSON.stringify(await service.listEmailAddresses(accountId));
    expect(credentialDump).not.toContain(EMAIL.toLowerCase());

    // Same address to a different account is refused.
    const otherPerson = ids.next("prsn") as PersonId;
    const otherCreated = await service.createAccount({ personId: otherPerson });
    const otherAccountId = otherCreated.ok ? otherCreated.account.id : parseFakeAccountId();
    const refused = await service.bindEmailAddress(otherAccountId, `  ${EMAIL.toUpperCase()} `);
    expect(refused).toEqual({ ok: false, code: "EMAIL_ALREADY_BOUND" });
    // Rebinding to the SAME account is a success.
    expect((await service.bindEmailAddress(accountId, EMAIL)).ok).toBe(true);
  });

  it("runs the email-OTP round trip and marks the address verified", async () => {
    const harness = await buildBoundHarness();
    const { service, transport, personId, accountId } = harness;

    const request = await service.requestEmailOtp({
      accountId,
      email: EMAIL,
      purpose: "bind-email",
    });
    expect(request.ok).toBe(true);
    const code = transport.deliveries[0]?.code ?? "";
    expect(code).toMatch(/^\d{6}$/u);

    const wrongCode = code === "999999" ? "000000" : "999999";
    const wrong = await service.verifyEmailOtp({
      accountId,
      email: EMAIL,
      purpose: "bind-email",
      code: wrongCode,
    });
    expect(wrong).toEqual({ ok: false, code: "INVALID_CODE" });

    const verified = await service.verifyEmailOtp({
      accountId,
      email: EMAIL,
      purpose: "bind-email",
      code,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.personId).toBe(personId);
      expect(verified.accountId).toBe(accountId);
    }
    const credentials = await service.listEmailAddresses(accountId);
    expect(credentials[0]?.verifiedAt).toBeDefined();
  });

  it("denies OTP requests for unbound addresses and locked or unknown accounts", async () => {
    const harness = await buildBoundHarness();
    const { service, accountId } = harness;

    const unbound = await service.requestEmailOtp({
      accountId,
      email: "stranger@example.test",
      purpose: "bind-email",
    });
    expect(unbound).toEqual({ ok: false, code: "EMAIL_NOT_BOUND" });

    const unknown = await service.requestEmailOtp({
      accountId: "acct_unknown-account-00001" as AccountId,
      email: EMAIL,
      purpose: "bind-email",
    });
    expect(unknown).toEqual({ ok: false, code: "ACCOUNT_NOT_FOUND" });

    await service.lock(accountId, "suspicious-activity");
    const locked = await service.requestEmailOtp({
      accountId,
      email: EMAIL,
      purpose: "bind-email",
    });
    expect(locked).toEqual({ ok: false, code: "ACCOUNT_LOCKED" });
  });

  it("locks and unlocks via a single-use recovery code", async () => {
    const harness = await buildBoundHarness();
    const { service, accountId } = harness;

    await service.lock(accountId, "suspicious-activity");
    const lockedStatus = await service.getAuthStatus(accountId);
    expect(lockedStatus.ok).toBe(true);
    if (lockedStatus.ok) {
      expect(lockedStatus.status.state).toBe("locked");
      expect(lockedStatus.status.lockedAt).toBeDefined();
      expect(lockedStatus.status.lockedReason).toBe("suspicious-activity");
    }

    const rotated = await service.rotateRecoveryCodes(accountId);
    expect(rotated.ok).toBe(true);
    const code = rotated.ok ? (rotated.codes[0] ?? "") : "";

    const wrongCode = await service.unlockWithRecoveryCode(accountId, "ZZZZZ-ZZZZZ");
    expect(wrongCode).toEqual({ ok: false, code: "INVALID_CODE" });
    // Still locked after the failed attempt.
    const stillLocked = await service.getAuthStatus(accountId);
    expect(stillLocked.ok && stillLocked.status.state).toBe("locked");

    const unlocked = await service.unlockWithRecoveryCode(accountId, code);
    expect(unlocked).toEqual({ ok: true });
    const activeStatus = await service.getAuthStatus(accountId);
    expect(activeStatus.ok && activeStatus.status.state).toBe("active");

    // Recovery codes are single use: the same code cannot unlock again.
    await service.lock(accountId, "second-lock");
    const replay = await service.unlockWithRecoveryCode(accountId, code);
    expect(replay).toEqual({ ok: false, code: "INVALID_CODE" });
    // A different code still works.
    const secondCode = rotated.ok ? (rotated.codes[1] ?? "") : "";
    expect((await service.unlockWithRecoveryCode(accountId, secondCode)).ok).toBe(true);
  });

  it("denies lock and unlock for unknown accounts", async () => {
    const { service } = buildHarness();
    const unknown = "acct_unknown-account-00001" as AccountId;
    expect(await service.lock(unknown)).toEqual({ ok: false, code: "ACCOUNT_NOT_FOUND" });
    expect(await service.unlockWithRecoveryCode(unknown, "AAAAA-BBBBB")).toEqual({
      ok: false,
      code: "ACCOUNT_NOT_FOUND",
    });
  });

  it("asserts a bound passkey end-to-end through the account stack", async () => {
    const harness = buildHarness();
    const { service, passkeys, personId } = harness;
    const created = await service.createAccount({ personId });
    const accountId = created.ok ? created.account.id : parseFakeAccountId();

    const authenticator = createSyntheticAuthenticator("ed25519");
    const challenge = await passkeys.beginRegistration(personId);
    const response = buildPackedSelfAttestation({
      authenticator,
      challenge: fromBase64Url(challenge.challenge),
    });
    const bound = await service.bindPasskey(accountId, {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
    });
    expect(bound.ok).toBe(true);

    const assertionChallenge = await passkeys.beginAssertion(personId);
    const assertion = buildAssertion({
      authenticator,
      challenge: fromBase64Url(assertionChallenge.challenge),
      signCount: 1,
    });
    const asserted = await passkeys.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
    });
    expect(asserted.ok).toBe(true);
    if (asserted.ok) {
      expect(asserted.credential.accountId).toBe(accountId);
      expect(asserted.credential.signCount).toBe(1);
    }
  });
});
