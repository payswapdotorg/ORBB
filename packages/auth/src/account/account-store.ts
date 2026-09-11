/**
 * Account lifecycle persistence seams (§3 A22).
 *
 * RECORDED HANDOFF (db shapes): the interfaces below MIRROR the frozen
 * shapes of `@orbb/db` (packages/db/src/contracts.ts): `AccountRecord`
 * is `{id: AccountId, personId: PersonId}`, and `AccountRepository` is
 * `insert(account, {idempotencyKey}) / findById / listByPerson`. The
 * db-backed adapters that implement these seams arrive with the
 * API-integration packet; this package depends on no persistence
 * package (dependency direction: adapters depend on @orbb/auth).
 * One deliberate simplification, recorded: `listByPerson` returns the
 * full list instead of the db's cursor-paged result — the adapter can
 * paginate internally.
 *
 * Auth-internal state (lock status, bound email addresses) has NO M2
 * column in the minimal `accounts` table, so it lives behind its own
 * seams here (stores below); the db schema grows them in a later
 * milestone and the adapters move over without touching this package's
 * service surface.
 */
import type { PersonId } from "@orbb/domain";
import { isAccountId, type AccountId } from "../ids.js";
import { sha256Hex } from "../crypto.js";
import { AuthInvariantError } from "../errors.js";
import { normalizeEmail } from "../otp/otp-service.js";

// ---------------------------------------------------------------------------
// Account record + repository shape (mirrors @orbb/db AccountRepository).
// ---------------------------------------------------------------------------

/** Account row shape (mirrors `@orbb/db` `AccountRecord`). */
export interface AccountRecordShape {
  readonly id: AccountId;
  readonly personId: PersonId;
}

/** Mutation options (mirrors `@orbb/db` `MutationOptions`). */
export interface AccountMutationOptions {
  /** Caller-supplied idempotency key (retry safety, architecture §3). */
  readonly idempotencyKey: string;
}

/** Account repository seam (mirrors `@orbb/db` `AccountRepository`). */
export interface AccountRepositoryShape {
  insert(account: AccountRecordShape, options: AccountMutationOptions): Promise<AccountRecordShape>;
  findById(id: AccountId): Promise<AccountRecordShape | undefined>;
  /** Simplified from the db's cursor-paged shape (recorded handoff). */
  listByPerson(personId: PersonId): Promise<readonly AccountRecordShape[]>;
}

/** In-memory reference store with db-style idempotent insert (first write wins). */
export class InMemoryAccountStore implements AccountRepositoryShape {
  readonly #accounts = new Map<string, AccountRecordShape>();
  readonly #idempotency = new Map<string, AccountRecordShape>();

  async insert(
    account: AccountRecordShape,
    options: AccountMutationOptions,
  ): Promise<AccountRecordShape> {
    const replay = this.#idempotency.get(options.idempotencyKey);
    if (replay !== undefined) {
      return replay;
    }
    this.#idempotency.set(options.idempotencyKey, account);
    this.#accounts.set(account.id, account);
    return account;
  }

  async findById(id: AccountId): Promise<AccountRecordShape | undefined> {
    return this.#accounts.get(id);
  }

  async listByPerson(personId: PersonId): Promise<readonly AccountRecordShape[]> {
    return [...this.#accounts.values()].filter((account) => account.personId === personId);
  }

  /** Test/inspection surface. */
  snapshot(): readonly AccountRecordShape[] {
    return [...this.#accounts.values()];
  }

  /** Clears the store (test-reset convenience). */
  clear(): void {
    this.#accounts.clear();
    this.#idempotency.clear();
  }
}

// ---------------------------------------------------------------------------
// Auth status (lock state) seam.
// ---------------------------------------------------------------------------

/** Account auth lifecycle state. */
export type AccountAuthState = "active" | "locked";

/** Lock-state record for one account. */
export interface AccountAuthStatus {
  readonly accountId: AccountId;
  readonly state: AccountAuthState;
  readonly updatedAt: Date;
  readonly lockedAt?: Date;
  /** Operational reason code (never PHI, never free text). */
  readonly lockedReason?: string;
}

/**
 * Injectable lock-state persistence. Absence of a record means ACTIVE
 * (accounts start unlocked; only an explicit lock writes a record).
 */
export interface AccountStatusStore {
  upsert(status: AccountAuthStatus): Promise<void>;
  find(accountId: AccountId): Promise<AccountAuthStatus | undefined>;
}

/** In-memory reference `AccountStatusStore`. */
export class InMemoryAccountStatusStore implements AccountStatusStore {
  readonly #statuses = new Map<string, AccountAuthStatus>();

  async upsert(status: AccountAuthStatus): Promise<void> {
    this.#statuses.set(status.accountId, status);
  }

  async find(accountId: AccountId): Promise<AccountAuthStatus | undefined> {
    return this.#statuses.get(accountId);
  }

  /** Test/inspection surface. */
  snapshot(): readonly AccountAuthStatus[] {
    return [...this.#statuses.values()];
  }

  /** Clears the store (test-reset convenience). */
  clear(): void {
    this.#statuses.clear();
  }
}

// ---------------------------------------------------------------------------
// Email-address credential seam (email-OTP-capable addresses).
// ---------------------------------------------------------------------------

/** A bound email address (digest only — the address itself never persists). */
export interface EmailAddressCredential {
  readonly accountId: AccountId;
  readonly personId: PersonId;
  /** SHA-256 hex of the normalized email. */
  readonly emailHash: string;
  readonly createdAt: Date;
  /** Set once the address proved control via an OTP verification. */
  readonly verifiedAt?: Date;
}

/** Injectable email-credential persistence. */
export interface EmailCredentialStore {
  upsert(credential: EmailAddressCredential): Promise<void>;
  findByEmailHash(emailHash: string): Promise<EmailAddressCredential | undefined>;
  listByAccount(accountId: AccountId): Promise<readonly EmailAddressCredential[]>;
  markVerified(emailHash: string, verifiedAt: Date): Promise<EmailAddressCredential | undefined>;
}

/** In-memory reference `EmailCredentialStore`. */
export class InMemoryEmailCredentialStore implements EmailCredentialStore {
  readonly #credentials = new Map<string, EmailAddressCredential>();

  async upsert(credential: EmailAddressCredential): Promise<void> {
    this.#credentials.set(credential.emailHash, credential);
  }

  async findByEmailHash(emailHash: string): Promise<EmailAddressCredential | undefined> {
    return this.#credentials.get(emailHash);
  }

  async listByAccount(accountId: AccountId): Promise<readonly EmailAddressCredential[]> {
    return [...this.#credentials.values()].filter((credential) => credential.accountId === accountId);
  }

  async markVerified(
    emailHash: string,
    verifiedAt: Date,
  ): Promise<EmailAddressCredential | undefined> {
    const credential = this.#credentials.get(emailHash);
    if (credential === undefined) {
      return undefined;
    }
    const updated: EmailAddressCredential = { ...credential, verifiedAt };
    this.#credentials.set(emailHash, updated);
    return updated;
  }

  /** Test/inspection surface. */
  snapshot(): readonly EmailAddressCredential[] {
    return [...this.#credentials.values()];
  }

  /** Clears the store (test-reset convenience). */
  clear(): void {
    this.#credentials.clear();
  }
}

/** Hashes a normalized email for the credential seam (digest only at rest). */
export function emailHashOf(email: string): string {
  return sha256Hex(normalizeEmail(email));
}

/** Validates an account id at runtime (shape guard, mirrors db grammar). */
export function requireAccount(value: unknown): AccountId {
  if (!isAccountId(value)) {
    throw new AuthInvariantError(
      'Invalid account id: expected "acct_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].',
    );
  }
  return value;
}
