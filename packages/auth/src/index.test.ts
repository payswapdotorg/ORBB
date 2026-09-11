import { describe, expect, it } from "vitest";
import * as auth from "./index.js";

describe("@orbb/auth identity boundary (M3-C)", () => {
  it("exports the session system", () => {
    expect(typeof auth.SessionService).toBe("function");
    expect(typeof auth.InMemorySessionStore).toBe("function");
    expect(typeof auth.toSessionRecord).toBe("function");
  });

  it("exports the WebAuthn passkey system (pure verifiers + ceremony service)", () => {
    expect(typeof auth.verifyAttestation).toBe("function");
    expect(typeof auth.verifyAssertion).toBe("function");
    expect(typeof auth.parseAuthenticatorData).toBe("function");
    expect(typeof auth.parseCosePublicKey).toBe("function");
    expect(typeof auth.parseClientDataJSON).toBe("function");
    expect(typeof auth.decodeCbor).toBe("function");
    expect(typeof auth.encodeCbor).toBe("function");
    expect(typeof auth.verifyWebAuthnSignature).toBe("function");
    expect(typeof auth.PasskeyService).toBe("function");
    expect(typeof auth.InMemoryPasskeyCredentialStore).toBe("function");
    expect(typeof auth.InMemoryChallengeStore).toBe("function");
  });

  it("exports the email OTP and recovery systems", () => {
    expect(typeof auth.EmailOtpService).toBe("function");
    expect(typeof auth.InMemoryOtpStore).toBe("function");
    expect(typeof auth.InMemoryOtpTransport).toBe("function");
    expect(typeof auth.normalizeEmail).toBe("function");
    expect(typeof auth.RecoveryService).toBe("function");
    expect(typeof auth.InMemoryRecoveryCodeStore).toBe("function");
    expect(typeof auth.normalizeRecoveryCode).toBe("function");
  });

  it("exports the Upstash rate-limit adapter and the account lifecycle seams", () => {
    expect(typeof auth.UpstashRateLimiter).toBe("function");
    expect(typeof auth.AccountService).toBe("function");
    expect(typeof auth.InMemoryAccountStore).toBe("function");
    expect(typeof auth.InMemoryAccountStatusStore).toBe("function");
    expect(typeof auth.InMemoryEmailCredentialStore).toBe("function");
    expect(typeof auth.createAuthLogger).toBe("function");
  });

  it("exports the identity id grammar and injectable defaults", () => {
    expect(typeof auth.isAccountId).toBe("function");
    expect(typeof auth.parseAccountId).toBe("function");
    expect(typeof auth.RandomIdFactory).toBe("function");
    expect(typeof auth.requirePersonId).toBe("function");
    expect(auth.ACCOUNT_ID_PREFIX).toBe("acct");
    expect(auth.SESSION_ID_PREFIX).toBe("sess");
    expect(auth.systemClock).toBeDefined();
    expect(typeof auth.sha256Hex).toBe("function");
    expect(typeof auth.timingSafeEqualHex).toBe("function");
    expect(typeof auth.AuthInvariantError).toBe("function");
  });

  it("keeps the M0 re-exports of the identity principal types", () => {
    // Type-only re-exports: compiled away at runtime; the module loads.
    expect(auth).toBeDefined();
  });
});
