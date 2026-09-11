/**
 * Idempotency ledger — the §3/§4 mechanics behind "idempotency keys on
 * mutating repository methods (upsert-style semantics)".
 *
 * Every mutating repository method claims `(table, operation, key)`
 * inside the SAME transaction as the mutation:
 *   - first claim (ledger INSERT succeeds) → the mutation proceeds;
 *   - replay (conflict → ledger row already exists) → the repository
 *     returns the STORED record; no second write happens, no second
 *     outbox event is required (the original transaction already
 *     emitted one).
 *
 * First-write-wins on payload differences (a retried command with the
 * same key replays the original outcome — the HTTP idempotency-key
 * contract); reusing a key for a DIFFERENT record id is surfaced as a
 * plain replay of the original record as well.
 */
import type { Clock } from "@orbb/testkit";
import { and, eq } from "drizzle-orm";
import type { OrbbExecutor } from "./driver.js";
import { PersistenceError } from "./errors.js";
import { idempotencyLedger } from "./schema.js";

/** A mutation claim: one (table, operation, key) → record id binding. */
export interface IdempotencyClaim {
  readonly tableName: string;
  readonly operation: string;
  readonly idempotencyKey: string;
  /** Primary key of the affected row (the replay pointer). */
  readonly recordId: string;
}

/** Result of claiming: first application, or a replay pointer. */
export type IdempotencyClaimResult =
  | { readonly replayed: false }
  | { readonly replayed: true; readonly recordId: string };

/**
 * Claims an idempotency key inside the caller's transaction. Throws
 * {@link PersistenceError} ("invalid-request") for malformed keys and
 * ("state-conflict") if a claim row vanishes between conflict and read
 * (only possible under exotic isolation anomalies — surfaced loudly).
 */
export async function claimIdempotency(
  executor: OrbbExecutor,
  clock: Clock,
  claim: IdempotencyClaim,
): Promise<IdempotencyClaimResult> {
  const key = claim.idempotencyKey;
  if (typeof key !== "string" || key.length === 0 || key.length > 256) {
    throw new PersistenceError(
      "invalid-request",
      "Invalid idempotency key: expected a non-empty string of at most 256 characters.",
    );
  }

  const inserted = await executor
    .insert(idempotencyLedger)
    .values({
      tableName: claim.tableName,
      operation: claim.operation,
      idempotencyKey: key,
      recordId: claim.recordId,
      appliedAt: clock.now(),
    })
    .onConflictDoNothing()
    .returning({ recordId: idempotencyLedger.recordId });

  const row = inserted[0];
  if (row !== undefined) {
    return { replayed: false };
  }

  const existing = await executor
    .select({ recordId: idempotencyLedger.recordId })
    .from(idempotencyLedger)
    .where(
      and(
        eq(idempotencyLedger.tableName, claim.tableName),
        eq(idempotencyLedger.operation, claim.operation),
        eq(idempotencyLedger.idempotencyKey, key),
      ),
    )
    .limit(1);

  const stored = existing[0];
  if (stored === undefined) {
    throw new PersistenceError(
      "state-conflict",
      "Idempotency claim conflicted but could not be read back; the transaction is inconsistent.",
    );
  }
  return { replayed: true, recordId: stored.recordId };
}
