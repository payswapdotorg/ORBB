/**
 * @orbb/db error taxonomy.
 *
 * Errors are PHI-safe by construction (mirroring the domain/databox
 * conventions): messages describe the violated invariant and never echo
 * received values — ids, payloads, and keys stay out of message text.
 * The stable machine contract is the `code`, not the message.
 */

/**
 * Stable rejection codes for the persistence boundary:
 *   - "invalid-request"     — malformed input (cursor, key, record shape).
 *   - "state-conflict"      — optimistic-concurrency or uniqueness clash.
 *   - "not-found"           — a guarded mutation target does not exist.
 *   - "outbox-required"     — a mutating transaction ended without any
 *                             outbox event (architecture §4 violation).
 *   - "migration-failure"   — migrations could not be applied.
 */
export type PersistenceErrorCode =
  | "invalid-request"
  | "state-conflict"
  | "not-found"
  | "outbox-required"
  | "migration-failure";

/** Persistence-boundary failure. */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}
