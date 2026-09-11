import { describe, expect, it } from "vitest";
import { createLogger, InMemorySink } from "@orbb/observability";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { InMemoryRateLimiter } from "@orbb/platform";
import type { PersonId } from "@orbb/domain";
import { fromBase64Url, toBase64Url } from "./crypto.js";
import { InMemorySessionStore } from "./session/session-store.js";
import { SessionService } from "./session/session-service.js";
import {
  buildAssertion,
  buildPackedSelfAttestation,
  createSyntheticAuthenticator,
  TEST_ALLOWED_ORIGINS,
  TEST_RP_ID,
} from "./webauthn/synthetic.js";
import {
  InMemoryChallengeStore,
  InMemoryPasskeyCredentialStore,
  PasskeyService,
} from "./webauthn/passkey-service.js";
import { InMemoryOtpStore, InMemoryOtpTransport } from "./otp/otp-store.js";
import { EmailOtpService } from "./otp/otp-service.js";
import { InMemoryRecoveryCodeStore } from "./recovery/recovery-store.js";
import { RecoveryService } from "./recovery/recovery-service.js";
import {
  InMemoryAccountStatusStore,
  InMemoryAccountStore,
  InMemoryEmailCredentialStore,
} from "./account/account-store.js";
import { AccountService } from "./account/account-service.js";
import type { AccountId } from "./ids.js";

/**
 * Synthetic PII/PHI-style markers — obviously synthetic, never real data.
 * If any of these strings appear in a store dump or a log record, the
 * boundary has leaked.
 */
const SYNTH_EMAIL = "ada.lovelace@example-health.test";
const SYNTH_EMAIL_LOCAL = "ada.lovelace";

describe("zero-PHI boundary (stores + logs)", () => {
  it("keeps every at-rest surface free of emails, codes, tokens, and recovery codes", async () => {
    const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
    const ids = new DeterministicIdFactory({ seed: "zero-phi" });
    const limiter = new InMemoryRateLimiter({ nowMs: () => clock.now().getTime() });
    const sink = new InMemorySink();
    const logger = createLogger(
      { service: "auth" },
      { sink, nowMs: () => clock.now().getTime() },
    );

    const sessionStore = new InMemorySessionStore();
    const sessionService = new SessionService({
      store: sessionStore,
      clock,
      idFactory: ids,
      logger,
    });

    const passkeyCredentials = new InMemoryPasskeyCredentialStore();
    const passkeyChallenges = new InMemoryChallengeStore();
    const passkeys = new PasskeyService({
      credentials: passkeyCredentials,
      challenges: passkeyChallenges,
      rpId: TEST_RP_ID,
      allowedOrigins: [...TEST_ALLOWED_ORIGINS],
      clock,
      logger,
    });

    const otpStore = new InMemoryOtpStore();
    const otpTransport = new InMemoryOtpTransport();
    const otp = new EmailOtpService({
      store: otpStore,
      transport: otpTransport,
      limiter,
      clock,
      idFactory: ids,
      logger,
    });

    const recoveryStore = new InMemoryRecoveryCodeStore();
    const recovery = new RecoveryService({ store: recoveryStore, clock, verifyLimiter: limiter, logger });

    const accounts = new InMemoryAccountStore();
    const status = new InMemoryAccountStatusStore();
    const emailCredentials = new InMemoryEmailCredentialStore();
    const accountService = new AccountService({
      accounts,
      status,
      emailCredentials,
      passkeys,
      recovery,
      otp,
      clock,
      idFactory: ids,
      logger,
    });

    const personId = ids.next("prsn") as PersonId;

    // --- Exercise every flow, success AND failure paths ---
    const issued = await sessionService.issue({ personId });
    expect(issued.ok).toBe(true);
    const sessionToken = issued.ok ? issued.token : "never";
    await sessionService.verify("unknown-token");
    await sessionService.verify(sessionToken);
    await sessionService.rotate(sessionToken);
    await sessionService.verify(sessionToken); // revoked now: failure path logs

    const authenticator = createSyntheticAuthenticator("es256");
    const registration = await passkeys.beginRegistration(personId);
    const attestation = buildPackedSelfAttestation({
      authenticator,
      challenge: fromBase64Url(registration.challenge),
    });
    await passkeys.register(personId, {
      clientDataJSON: attestation.clientDataJSON,
      attestationObject: attestation.attestationObject,
    });
    const assertionChallenge = await passkeys.beginAssertion();
    const assertion = buildAssertion({
      authenticator,
      challenge: fromBase64Url(assertionChallenge.challenge),
      signCount: 1,
    });
    // A failing assertion first (tampered signature), then a valid one.
    const tamperedSignature = new Uint8Array(assertion.signature);
    tamperedSignature[0] = (tamperedSignature[0] as number) ^ 0x01;
    await passkeys.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: tamperedSignature,
    });
    await passkeys.assert({
      credentialId: toBase64Url(authenticator.credentialId),
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
    });

    const otpIssue = await otp.issue({ personId, email: SYNTH_EMAIL, purpose: "login" });
    expect(otpIssue.ok).toBe(true);
    const otpCode = otpTransport.deliveries[0]?.code ?? "";
    expect(otpCode).toMatch(/^\d{6}$/u);
    await otp.verify({ personId, email: SYNTH_EMAIL, purpose: "login", code: "000000" });
    await otp.verify({ personId, email: SYNTH_EMAIL, purpose: "login", code: otpCode });

    const account = await accountService.createAccount({ personId });
    const accountId = account.ok ? account.account.id : ("acct_x" as AccountId);
    const rotated = await recovery.rotate(accountId);
    expect(rotated.ok).toBe(true);
    const recoveryCode = rotated.ok ? (rotated.codes[0] ?? "") : "";
    await recovery.verify(accountId, "ZZZZZ-ZZZZZ");
    await accountService.bindEmailAddress(accountId, SYNTH_EMAIL);
    await accountService.lock(accountId, "suspicious-activity");
    await accountService.unlockWithRecoveryCode(accountId, recoveryCode);

    // --- The assertions: nothing user-supplied or secret persists ---
    const secrets = [
      SYNTH_EMAIL,
      SYNTH_EMAIL_LOCAL,
      otpCode,
      recoveryCode,
      sessionToken,
      registration.challenge,
      assertionChallenge.challenge,
    ];

    const storeDumps = [
      JSON.stringify(sessionStore.snapshot()),
      JSON.stringify(passkeyCredentials.snapshot()),
      JSON.stringify(passkeyChallenges.snapshot()),
      JSON.stringify(otpStore.snapshot()),
      JSON.stringify(recoveryStore.snapshot()),
      JSON.stringify(accounts.snapshot()),
      JSON.stringify(status.snapshot()),
      JSON.stringify(emailCredentials.snapshot()),
    ];

    for (const dump of storeDumps) {
      for (const secret of secrets) {
        expect(dump).not.toContain(secret);
      }
    }

    // --- Log records: the redaction policy runs before the sink ---
    const logDump = JSON.stringify(sink.records);
    expect(sink.records.length).toBeGreaterThan(10);
    for (const secret of secrets) {
      expect(logDump).not.toContain(secret);
    }
    // No raw person ids (deny-listed field name) survive to the sink.
    expect(logDump).not.toContain(personId);
    // No raw account ids either (pseudonymized field).
    expect(logDump).not.toContain(accountId);
    // The synthetic email never appears in ANY log field.
    expect(logDump).not.toContain(SYNTH_EMAIL);
  });

  it("proves the observability redaction policy directly (deny-by-default)", () => {
    const sink = new InMemorySink();
    const logger = createLogger({ service: "auth" }, { sink, nowMs: () => 0 });
    logger.info("smuggled fields test", {
      event: "auth.test.redaction",
      personId: "prsn_SYNTH-smuggled-000001",
      accountId: "acct_SYNTH-smuggled-000002",
      email: "someone@example.test",
      token: "super-secret-opaque-token",
      code: "123456",
    });
    const record = sink.records[0];
    expect(record).toBeDefined();
    // Envelope fields survive (allow-listed).
    expect(record?.["msg"]).toBe("smuggled fields test");
    expect(record?.["event"]).toBe("auth.test.redaction");
    // Deny-listed fields are fully redacted.
    expect(record?.["personId"]).toBe("[REDACTED]");
    expect(record?.["email"]).toBe("[REDACTED]");
    expect(record?.["token"]).toBe("[REDACTED]");
    // Unmatched fields fall to deny-by-default redaction.
    expect(record?.["code"]).toBe("[REDACTED]");
    // Pseudonymized correlation: "hash:<hex>" — never the raw id.
    expect(record?.["accountId"]).not.toBe("acct_SYNTH-smuggled-000002");
    expect((record?.["accountId"] as string).startsWith("hash:")).toBe(true);
    // And the raw values never appear anywhere in the record.
    const dump = JSON.stringify(sink.records);
    expect(dump).not.toContain("prsn_SYNTH-smuggled-000001");
    expect(dump).not.toContain("someone@example.test");
    expect(dump).not.toContain("super-secret-opaque-token");
    expect(dump).not.toContain("acct_SYNTH-smuggled-000002");
  });
});
