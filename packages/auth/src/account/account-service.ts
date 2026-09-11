/**
 * `AccountService` — account lifecycle orchestration (§3 A22).
 *
 * Composes the identity services over the db-shaped seams:
 *   - create an account for a person (acct_ id, db-style idempotency),
 *   - bind credentials: a passkey (WebAuthn registration) or an
 *     email-OTP-capable address (bound as a digest, verified through a
 *     real OTP round-trip),
 *   - lock / unlock: locking disables the account; unlocking requires a
 *     valid single-use recovery code (`unlockWithRecoveryCode`).
 *
 * The account repository seam mirrors `@orbb/db` shapes; db-backed
 * adapters arrive in the API-integration packet (recorded handoff).
 * Deny-by-default throughout: typed results, no thrown user-facing
 * details. No PHI: only opaque ids, digests, and operational codes.
 */
import type { PersonId } from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import type { Logger } from "@orbb/observability";
import {
  ACCOUNT_ID_PREFIX,
  parseAccountId,
  RandomIdFactory,
  randomIdempotencyKey,
  requirePersonId,
  systemClock,
  type AccountId,
} from "../ids.js";
import type { EmailOtpService, OtpIssueResult, OtpVerifyResult } from "../otp/otp-service.js";
import type {
  PasskeyRegistrationRequest,
  PasskeyRegistrationResult,
  PasskeyService,
} from "../webauthn/passkey-service.js";
import type {
  AccountAuthStatus,
  AccountRecordShape,
  AccountRepositoryShape,
  AccountStatusStore,
  EmailAddressCredential,
  EmailCredentialStore,
} from "./account-store.js";
import { emailHashOf } from "./account-store.js";
import type { RecoveryRotationResult, RecoveryService, RecoveryVerificationResult } from "../recovery/recovery-service.js";

/** Options for constructing an {@link AccountService}. */
export interface AccountServiceOptions {
  /** Account repository seam (mirrors @orbb/db `AccountRepository`). */
  readonly accounts: AccountRepositoryShape;
  readonly status: AccountStatusStore;
  readonly emailCredentials: EmailCredentialStore;
  readonly passkeys: PasskeyService;
  readonly recovery: RecoveryService;
  readonly otp: EmailOtpService;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly logger?: Logger;
}

/** Input for `AccountService.createAccount`. */
export interface CreateAccountInput {
  readonly personId: PersonId;
  /** Caller-supplied idempotency key (db contract §3); generated when omitted. */
  readonly idempotencyKey?: string;
}

/** Result of account creation. */
export type AccountCreateResult =
  | { readonly ok: true; readonly account: AccountRecordShape }
  | { readonly ok: false; readonly code: "PERSON_INVALID" };

/** Result of account-scoped passkey binding (relays ceremony codes). */
export type AccountBindPasskeyResult = PasskeyRegistrationResult | { readonly ok: false; readonly code: "ACCOUNT_NOT_FOUND" };

/** Result of email-address binding. */
export type AccountEmailBindResult =
  | { readonly ok: true; readonly credential: EmailAddressCredential }
  | { readonly ok: false; readonly code: "ACCOUNT_NOT_FOUND" | "EMAIL_ALREADY_BOUND" };

/** Result of an account-scoped OTP request (relays issuance codes). */
export type AccountOtpRequestResult =
  | OtpIssueResult
  | { readonly ok: false; readonly code: "ACCOUNT_NOT_FOUND" | "ACCOUNT_LOCKED" | "EMAIL_NOT_BOUND" };

/** Result of an account-scoped OTP verification (relays verification codes). */
export type AccountOtpVerifyResult =
  | OtpVerifyResult
  | { readonly ok: false; readonly code: "ACCOUNT_NOT_FOUND" | "ACCOUNT_LOCKED" | "EMAIL_NOT_BOUND" };

/** Result of recovery-based unlock (relays recovery codes). */
export type AccountUnlockResult =
  | RecoveryVerificationResult
  | { readonly ok: false; readonly code: "ACCOUNT_NOT_FOUND" };

/** Result of lock / get-status operations. */
export type AccountStatusResult =
  | { readonly ok: true; readonly status: AccountAuthStatus }
  | { readonly ok: false; readonly code: "ACCOUNT_NOT_FOUND" };

/** Account lifecycle orchestration over the identity services. */
export class AccountService {
  readonly #accounts: AccountRepositoryShape;
  readonly #status: AccountStatusStore;
  readonly #emailCredentials: EmailCredentialStore;
  readonly #passkeys: PasskeyService;
  readonly #recovery: RecoveryService;
  readonly #otp: EmailOtpService;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #log: Logger | undefined;

  constructor(options: AccountServiceOptions) {
    this.#accounts = options.accounts;
    this.#status = options.status;
    this.#emailCredentials = options.emailCredentials;
    this.#passkeys = options.passkeys;
    this.#recovery = options.recovery;
    this.#otp = options.otp;
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.idFactory ?? new RandomIdFactory();
    this.#log = options.logger;
  }

  /**
   * Creates an account for a person (db-shaped insert with an
   * idempotency key) and records the initial ACTIVE auth status.
   */
  async createAccount(input: CreateAccountInput): Promise<AccountCreateResult> {
    if (!requirePersonIdOrInvalid(input.personId)) {
      return { ok: false, code: "PERSON_INVALID" };
    }
    const account: AccountRecordShape = {
      id: parseAccountId(this.#ids.next(ACCOUNT_ID_PREFIX)),
      personId: input.personId,
    };
    const idempotencyKey =
      input.idempotencyKey !== undefined && input.idempotencyKey.length > 0
        ? input.idempotencyKey
        : randomIdempotencyKey();
    const inserted = await this.#accounts.insert(account, { idempotencyKey });
    await this.#status.upsert({
      accountId: inserted.id,
      state: "active",
      updatedAt: this.#clock.now(),
    });
    this.#log?.info("account created", { event: "auth.account.created", accountId: inserted.id });
    return { ok: true, account: inserted };
  }

  /**
   * Binds a passkey to an account: resolves the account's person, runs
   * the full WebAuthn registration ceremony (challenge store governs),
   * and persists the credential bound to {person, account}.
   */
  async bindPasskey(
    accountId: AccountId,
    registration: PasskeyRegistrationRequest,
  ): Promise<AccountBindPasskeyResult> {
    const account = await this.#accounts.findById(accountId);
    if (account === undefined) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    }
    return this.#passkeys.register(account.personId, registration, { accountId });
  }

  /**
   * Binds an email-OTP-capable address to an account. The address is
   * stored as its digest; an address already bound to another account is
   * refused (typed failure). Control is proven later via OTP.
   */
  async bindEmailAddress(
    accountId: AccountId,
    email: string,
  ): Promise<AccountEmailBindResult> {
    const account = await this.#accounts.findById(accountId);
    if (account === undefined) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    }
    const emailHash = emailHashOf(email);
    const existing = await this.#emailCredentials.findByEmailHash(emailHash);
    if (existing !== undefined && existing.accountId !== accountId) {
      this.#log?.warn("email bind refused: address already bound", {
        event: "auth.account.email_bind_refused",
        accountId,
      });
      return { ok: false, code: "EMAIL_ALREADY_BOUND" };
    }
    const credential: EmailAddressCredential = {
      accountId,
      personId: account.personId,
      emailHash,
      createdAt: this.#clock.now(),
    };
    await this.#emailCredentials.upsert(credential);
    this.#log?.info("email address bound", { event: "auth.account.email_bound", accountId });
    return { ok: true, credential };
  }

  /** Lists the (digest-only) email credentials bound to an account. */
  async listEmailAddresses(accountId: AccountId): Promise<readonly EmailAddressCredential[]> {
    return this.#emailCredentials.listByAccount(accountId);
  }

  /**
   * Requests an OTP for a BOUND address of an ACTIVE account (relay of
   * the throttled issuance path).
   */
  async requestEmailOtp(input: {
    readonly accountId: AccountId;
    readonly email: string;
    readonly purpose: string;
  }): Promise<AccountOtpRequestResult> {
    const account = await this.#accounts.findById(input.accountId);
    if (account === undefined) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    }
    const status = await this.#authStatusOf(input.accountId);
    if (status.state === "locked") {
      return { ok: false, code: "ACCOUNT_LOCKED" };
    }
    const bound = await this.#emailCredentials.findByEmailHash(emailHashOf(input.email));
    if (bound === undefined || bound.accountId !== input.accountId) {
      return { ok: false, code: "EMAIL_NOT_BOUND" };
    }
    return this.#otp.issue({
      personId: account.personId,
      accountId: input.accountId,
      email: input.email,
      purpose: input.purpose,
    });
  }

  /**
   * Verifies an OTP for a bound address: a successful verification
   * proves control and marks the credential verified (relay of the
   * single-use verification path).
   */
  async verifyEmailOtp(input: {
    readonly accountId: AccountId;
    readonly email: string;
    readonly purpose: string;
    readonly code: string;
  }): Promise<AccountOtpVerifyResult> {
    const account = await this.#accounts.findById(input.accountId);
    if (account === undefined) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    }
    const status = await this.#authStatusOf(input.accountId);
    if (status.state === "locked") {
      return { ok: false, code: "ACCOUNT_LOCKED" };
    }
    const bound = await this.#emailCredentials.findByEmailHash(emailHashOf(input.email));
    if (bound === undefined || bound.accountId !== input.accountId) {
      return { ok: false, code: "EMAIL_NOT_BOUND" };
    }
    const verified = await this.#otp.verify({
      personId: account.personId,
      email: input.email,
      purpose: input.purpose,
      code: input.code,
    });
    if (verified.ok) {
      await this.#emailCredentials.markVerified(emailHashOf(input.email), this.#clock.now());
    }
    return verified;
  }

  /**
   * Rotates the recovery set for an account and returns the plaintext
   * codes exactly once (relay of `RecoveryService.rotate`).
   */
  async rotateRecoveryCodes(accountId: AccountId): Promise<RecoveryRotationResult> {
    return this.#recovery.rotate(accountId);
  }

  /** Locks an account (typed reason code, never PHI). */
  async lock(accountId: AccountId, reason?: string): Promise<AccountStatusResult> {
    const account = await this.#accounts.findById(accountId);
    if (account === undefined) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    }
    const now = this.#clock.now();
    const status: AccountAuthStatus = {
      accountId,
      state: "locked",
      updatedAt: now,
      lockedAt: now,
      ...(reason !== undefined ? { lockedReason: reason } : {}),
    };
    await this.#status.upsert(status);
    this.#log?.warn("account locked", { event: "auth.account.locked", accountId });
    return { ok: true, status };
  }

  /**
   * Unlocks an account with a single-use recovery code: the code must
   * verify AND consume atomically; only then does the account return to
   * ACTIVE.
   */
  async unlockWithRecoveryCode(accountId: AccountId, code: string): Promise<AccountUnlockResult> {
    const account = await this.#accounts.findById(accountId);
    if (account === undefined) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    }
    const verification = await this.#recovery.verify(accountId, code);
    if (!verification.ok) {
      return verification;
    }
    const status: AccountAuthStatus = {
      accountId,
      state: "active",
      updatedAt: this.#clock.now(),
    };
    await this.#status.upsert(status);
    this.#log?.info("account unlocked via recovery code", {
      event: "auth.account.unlocked",
      accountId,
    });
    return { ok: true };
  }

  /** Reads the auth status (absence of a record = ACTIVE). */
  async getAuthStatus(accountId: AccountId): Promise<AccountStatusResult> {
    const account = await this.#accounts.findById(accountId);
    if (account === undefined) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    }
    return { ok: true, status: await this.#authStatusOf(accountId) };
  }

  async #authStatusOf(accountId: AccountId): Promise<AccountAuthStatus> {
    const stored = await this.#status.find(accountId);
    if (stored !== undefined) {
      return stored;
    }
    return {
      accountId,
      state: "active",
      updatedAt: this.#clock.now(),
    };
  }
}

/**
 * Person-id validation that returns instead of throwing, so the
 * account-creation PUBLIC path stays typed (programmer errors for
 * internal invariants still throw; an invalid caller payload is a
 * denial, not an exception).
 */
function requirePersonIdOrInvalid(personId: PersonId): boolean {
  try {
    requirePersonId(personId);
    return true;
  } catch {
    return false;
  }
}
