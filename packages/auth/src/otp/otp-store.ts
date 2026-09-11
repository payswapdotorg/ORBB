/**
 * Email OTP persistence + delivery seams (§3 A22).
 *
 * Recorded privacy decisions:
 *   - The at-rest OTP record carries the SHA-256 digests of the code AND
 *     of the normalized email (`emailHash`), never the plaintext
 *     values: a store dump leaks neither the secret code nor the address.
 *   - The delivery transport necessarily receives the plaintext email
 *     and code (it is the email system); it is injectable and defaults
 *     to an in-memory double — no live email sending exists in tests.
 *   - At most ONE active challenge exists per (person, email, purpose):
 *     re-issuance REPLACES the previous challenge (old code dies).
 */
import type { PersonId } from "@orbb/domain";
import type { AccountId } from "../ids.js";

/** Purposes are operational strings (e.g. "login", "bind-email") — never PHI. */
export type OtpPurpose = string;

/** The at-rest OTP challenge record (hashes only — see module docs). */
export interface OtpChallengeRecord {
  /** Opaque record id (`otp_<body>`, from the IdFactory seam). */
  readonly id: string;
  readonly personId: PersonId;
  readonly accountId?: AccountId;
  /** SHA-256 hex of the normalized email. */
  readonly emailHash: string;
  /** SHA-256 hex of the numeric code (compared timing-safe). */
  readonly codeHash: string;
  readonly purpose: OtpPurpose;
  readonly createdAt: Date;
  /** Exclusive validity horizon: expired when `now >= expiresAt`. */
  readonly expiresAt: Date;
  /** Failed verification attempts recorded so far. */
  readonly attempts: number;
  /** Set when the code was successfully used (single-use). */
  readonly consumedAt?: Date;
}

/** What the transport receives (plaintext email + code by necessity). */
export interface OtpDelivery {
  readonly personId: PersonId;
  readonly email: string;
  readonly code: string;
  readonly purpose: OtpPurpose;
  readonly expiresAt: Date;
}

/**
 * Injectable email transport. Real adapters (the API-integration packet
 * wires an email provider behind this seam) must never log the code.
 */
export interface OtpTransport {
  deliver(delivery: OtpDelivery): Promise<void>;
}

/** In-memory transport double: records deliveries for assertions. */
export class InMemoryOtpTransport implements OtpTransport {
  readonly #deliveries: OtpDelivery[] = [];

  async deliver(delivery: OtpDelivery): Promise<void> {
    this.#deliveries.push(delivery);
  }

  /** Delivered payloads in order (test surface; contains codes by design). */
  get deliveries(): readonly OtpDelivery[] {
    return this.#deliveries;
  }

  /** Clears recorded deliveries (test-reset convenience). */
  clear(): void {
    this.#deliveries.length = 0;
  }
}

/**
 * Injectable OTP challenge persistence.
 *
 * Contract notes for db-backed adapters (API-integration handoff):
 *   - `insert` REPLACES any active challenge with the same
 *     (personId, emailHash, purpose) key — one active code per key.
 *   - `recordFailedAttempt` increments `attempts` on the ACTIVE
 *     (unconsumed) challenge and returns the updated record.
 *   - `consume` is the single-use commit: it must atomically mark the
 *     active challenge consumed only when unconsumed (the concurrency
 *     winner), returning whether the commit happened.
 */
export interface OtpStore {
  insert(record: OtpChallengeRecord): Promise<void>;
  findActive(personId: PersonId, emailHash: string, purpose: OtpPurpose): Promise<OtpChallengeRecord | undefined>;
  recordFailedAttempt(
    personId: PersonId,
    emailHash: string,
    purpose: OtpPurpose,
  ): Promise<OtpChallengeRecord | undefined>;
  consume(personId: PersonId, emailHash: string, purpose: OtpPurpose, now: Date): Promise<boolean>;
}

/** In-memory reference `OtpStore`. */
export class InMemoryOtpStore implements OtpStore {
  readonly #records = new Map<string, OtpChallengeRecord>();

  async insert(record: OtpChallengeRecord): Promise<void> {
    this.#records.set(otpKey(record.personId, record.emailHash, record.purpose), record);
  }

  async findActive(
    personId: PersonId,
    emailHash: string,
    purpose: OtpPurpose,
  ): Promise<OtpChallengeRecord | undefined> {
    const record = this.#records.get(otpKey(personId, emailHash, purpose));
    if (record === undefined || record.consumedAt !== undefined) {
      return undefined;
    }
    return record;
  }

  async recordFailedAttempt(
    personId: PersonId,
    emailHash: string,
    purpose: OtpPurpose,
  ): Promise<OtpChallengeRecord | undefined> {
    const record = this.#records.get(otpKey(personId, emailHash, purpose));
    if (record === undefined || record.consumedAt !== undefined) {
      return undefined;
    }
    const updated: OtpChallengeRecord = { ...record, attempts: record.attempts + 1 };
    this.#records.set(otpKey(personId, emailHash, purpose), updated);
    return updated;
  }

  async consume(
    personId: PersonId,
    emailHash: string,
    purpose: OtpPurpose,
    now: Date,
  ): Promise<boolean> {
    const record = this.#records.get(otpKey(personId, emailHash, purpose));
    if (record === undefined || record.consumedAt !== undefined) {
      return false;
    }
    this.#records.set(otpKey(personId, emailHash, purpose), { ...record, consumedAt: now });
    return true;
  }

  /** Test/inspection surface: all stored records (hashes only). */
  snapshot(): readonly OtpChallengeRecord[] {
    return [...this.#records.values()];
  }

  /** Clears the store (test-reset convenience). */
  clear(): void {
    this.#records.clear();
  }
}

function otpKey(personId: PersonId, emailHash: string, purpose: OtpPurpose): string {
  return `${personId}|${purpose}|${emailHash}`;
}
