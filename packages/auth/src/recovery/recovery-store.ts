/**
 * Recovery-code persistence seam (§3 A22).
 *
 * Recorded privacy/security decisions:
 *   - At rest, only the SHA-256 digest of each normalized code is kept;
 *     digests are compared timing-safe. The plaintext list is shown to
 *     the user exactly once, at rotation time.
 *   - Codes are single-use: `consume` is the atomic commit.
 *   - The whole SET is replaced on rotation (old codes all die at once).
 */
import type { AccountId } from "../ids.js";

/** One recovery-code slot (digest + lifecycle timestamps). */
export interface RecoveryCodeRecord {
  /** SHA-256 hex of the normalized code. */
  readonly codeHash: string;
  readonly createdAt: Date;
  /** Set when this code was used (single-use). */
  readonly consumedAt?: Date;
}

/** The full set bound to one account. */
export interface RecoveryCodeSet {
  readonly accountId: AccountId;
  readonly codes: readonly RecoveryCodeRecord[];
  readonly createdAt: Date;
  /** Set when a later rotation replaced this set. */
  readonly rotatedAt?: Date;
}

/**
 * Injectable recovery-code persistence.
 *
 * Contract notes for db-backed adapters (API-integration handoff):
 *   - `replace` atomically swaps the ENTIRE set for the account.
 *   - `consume` atomically marks the matching UNCONSUMED code consumed
 *     and returns whether it did (the concurrency winner).
 */
export interface RecoveryCodeStore {
  replace(accountId: AccountId, records: readonly RecoveryCodeRecord[], now: Date): Promise<void>;
  findSet(accountId: AccountId): Promise<RecoveryCodeSet | undefined>;
  consume(accountId: AccountId, codeHash: string, now: Date): Promise<boolean>;
}

/** In-memory reference `RecoveryCodeStore`. */
export class InMemoryRecoveryCodeStore implements RecoveryCodeStore {
  readonly #sets = new Map<string, RecoveryCodeSet>();

  async replace(
    accountId: AccountId,
    records: readonly RecoveryCodeRecord[],
    now: Date,
  ): Promise<void> {
    const existing = this.#sets.get(accountId);
    this.#sets.set(accountId, {
      accountId,
      codes: records,
      createdAt: records[0]?.createdAt ?? now,
      ...(existing !== undefined ? { rotatedAt: now } : {}),
    });
  }

  async findSet(accountId: AccountId): Promise<RecoveryCodeSet | undefined> {
    return this.#sets.get(accountId);
  }

  async consume(accountId: AccountId, codeHash: string, now: Date): Promise<boolean> {
    const set = this.#sets.get(accountId);
    if (set === undefined) {
      return false;
    }
    const index = set.codes.findIndex(
      (code) => code.codeHash === codeHash && code.consumedAt === undefined,
    );
    if (index < 0) {
      return false;
    }
    const target = set.codes[index];
    if (target === undefined) {
      return false;
    }
    const updated: RecoveryCodeRecord = { ...target, consumedAt: now };
    const codes = [...set.codes];
    codes[index] = updated;
    this.#sets.set(accountId, { ...set, codes });
    return true;
  }

  /** Test/inspection surface: all stored sets (digests only). */
  snapshot(): readonly RecoveryCodeSet[] {
    return [...this.#sets.values()];
  }

  /** Clears the store (test-reset convenience). */
  clear(): void {
    this.#sets.clear();
  }
}
