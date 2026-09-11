/**
 * Session storage seam + in-memory reference store.
 *
 * The store contract (db-backed adapters arrive with the API-integration
 * packet — recorded handoff):
 *   - Sessions are keyed by the SHA-256 digest of the opaque token.
 *   - `rotate` MUST invalidate the old token and insert the new session
 *     in ONE atomic operation: a concurrent `findByTokenHash` of the old
 *     token must never observe a state where both tokens are valid, and
 *     `rotate` fails (returns `undefined`) when the old token was already
 *     revoked or removed concurrently.
 *   - `revoke` is idempotent (second revoke → `false`) and keeps the
 *     tombstone so a later verify of a revoked token reports `REVOKED`,
 *     not `INVALID_TOKEN` (the distinction is operational signal, not
 *     user-facing detail).
 */
import type { StoredSession } from "./session.js";

/** Injectable session persistence. */
export interface SessionStore {
  /** Persists a new session (its token digest is the key). */
  create(session: StoredSession): Promise<void>;
  /** Looks up a session by token digest — including revoked tombstones. */
  findByTokenHash(tokenHash: string): Promise<StoredSession | undefined>;
  /** Updates `lastSeenAt` on a live (unrevoked) session; returns the updated record. */
  touch(tokenHash: string, lastSeenAt: Date): Promise<StoredSession | undefined>;
  /** Marks a live session revoked (tombstone kept). Returns false when absent/already revoked. */
  revoke(tokenHash: string, revokedAt: Date): Promise<boolean>;
  /**
   * Atomically revokes the session bound to `oldTokenHash` and inserts
   * `next`. Returns `undefined` when no revocable session exists for
   * `oldTokenHash` (absent or already revoked — concurrency loser).
   */
  rotate(oldTokenHash: string, next: StoredSession, revokedAt: Date): Promise<StoredSession | undefined>;
}

/** In-memory reference `SessionStore` (single-node; atomic by construction). */
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, StoredSession>();

  async create(session: StoredSession): Promise<void> {
    this.#sessions.set(session.tokenHash, session);
  }

  async findByTokenHash(tokenHash: string): Promise<StoredSession | undefined> {
    return this.#sessions.get(tokenHash);
  }

  async touch(tokenHash: string, lastSeenAt: Date): Promise<StoredSession | undefined> {
    const stored = this.#sessions.get(tokenHash);
    if (stored === undefined || stored.revokedAt !== undefined) {
      return undefined;
    }
    const updated: StoredSession = { ...stored, lastSeenAt };
    this.#sessions.set(tokenHash, updated);
    return updated;
  }

  async revoke(tokenHash: string, revokedAt: Date): Promise<boolean> {
    const stored = this.#sessions.get(tokenHash);
    if (stored === undefined || stored.revokedAt !== undefined) {
      return false;
    }
    this.#sessions.set(tokenHash, { ...stored, revokedAt });
    return true;
  }

  async rotate(
    oldTokenHash: string,
    next: StoredSession,
    revokedAt: Date,
  ): Promise<StoredSession | undefined> {
    const stored = this.#sessions.get(oldTokenHash);
    if (stored === undefined || stored.revokedAt !== undefined) {
      return undefined;
    }
    this.#sessions.set(oldTokenHash, { ...stored, revokedAt });
    this.#sessions.set(next.tokenHash, next);
    return next;
  }

  /** Test/inspection surface: all stored records (token digests only). */
  snapshot(): readonly StoredSession[] {
    return [...this.#sessions.values()];
  }

  /** Clears the store (test-reset convenience; not part of `SessionStore`). */
  clear(): void {
    this.#sessions.clear();
  }
}
