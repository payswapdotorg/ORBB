/**
 * Send-attempt ledger (B8 idempotency bookkeeping).
 *
 * The ledger is the injectable port that records what was ACTUALLY
 * dispatched: every send attempt (delivered, undeliverable, or failed)
 * lands here exactly once per reminder id. The engine consults it before
 * every send, so recomputation and at-least-once redelivery collapse to
 * exactly-once dispatch per reminder identity (architecture §4 spirit:
 * never assume exactly-once delivery from any queue; be idempotent at
 * the consumer).
 *
 * Delivery vs. the ledger: a ledger write that fails AFTER a channel
 * delivered means the next pass MAY re-send that reminder (at-least-once
 * delivery) — the ledger is the dedup guard, and its failure surfaces as
 * a typed `ledger-failure`, never a silent gap (recorded in the README).
 */
import type { PersonId, TaskId } from "@orbb/domain";
import type { ChannelFailureReason } from "./channels.js";
import type { ReminderId } from "./ids.js";
import type { EscalationRung } from "./reminder.js";

/** Ledger statuses — the fail-closed delivery vocabulary, recorded verbatim. */
export const DISPATCH_STATUSES = ["delivered", "undeliverable", "failed"] as const;

export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/** One recorded send attempt (the audit unit of the engine). */
export interface DispatchRecord {
  readonly reminderId: ReminderId;
  readonly taskId: TaskId;
  readonly personId: PersonId;
  readonly channelId: string;
  readonly rung: EscalationRung;
  readonly status: DispatchStatus;
  /** Present exactly when the status is not `delivered`. */
  readonly reason?: ChannelFailureReason;
  readonly recordedAt: Date;
}

/** Result of a ledger write. */
export type LedgerWriteOutcome =
  | { readonly status: "recorded" }
  | { readonly status: "already-recorded"; readonly existing: DispatchRecord };

/**
 * Persistence port for dispatch records (async — the db adapter arrives
 * in a later integration packet; the in-memory store is the reference
 * double). Implementations MUST be idempotent per reminder id: recording
 * an already-recorded id returns `already-recorded` with the existing
 * entry and never duplicates it.
 */
export interface ReminderDispatchLedger {
  record(entry: DispatchRecord): Promise<LedgerWriteOutcome>;
  find(reminderId: ReminderId): Promise<DispatchRecord | undefined>;
  list(): Promise<readonly DispatchRecord[]>;
}

function cloneRecord(record: DispatchRecord): DispatchRecord {
  return {
    ...record,
    ...(record.reason !== undefined ? { reason: { kind: record.reason.kind } } : {}),
    recordedAt: new Date(record.recordedAt.getTime()),
  };
}

/**
 * In-memory reference `ReminderDispatchLedger`: one entry per reminder
 * id (exactly-once), insertion-ordered listing, defensive copies in and
 * out.
 */
export class InMemoryReminderDispatchLedger implements ReminderDispatchLedger {
  readonly #entries = new Map<string, DispatchRecord>();

  async record(entry: DispatchRecord): Promise<LedgerWriteOutcome> {
    const existing = this.#entries.get(entry.reminderId);
    if (existing !== undefined) {
      return { status: "already-recorded", existing: cloneRecord(existing) };
    }
    this.#entries.set(entry.reminderId, cloneRecord(entry));
    return { status: "recorded" };
  }

  async find(reminderId: ReminderId): Promise<DispatchRecord | undefined> {
    const entry = this.#entries.get(reminderId);
    return entry === undefined ? undefined : cloneRecord(entry);
  }

  async list(): Promise<readonly DispatchRecord[]> {
    return [...this.#entries.values()].map(cloneRecord);
  }
}
