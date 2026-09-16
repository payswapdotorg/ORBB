/**
 * B8 — The send-attempt ledger (what was ACTUALLY dispatched).
 *
 * RECORDED DESIGN DECISIONS:
 *
 * - The ledger is the dispatch idempotency boundary: it keys records by
 *   the deterministic `ReminderId`, so a delivered reminder is dispatched
 *   EXACTLY ONCE, ever — recomputing the schedule over unchanged inputs
 *   adds nothing, and the engine skips already-dispatched reminders with
 *   an accounted reason.
 *
 * - Record shape mirrors the `@orbb/contracts` `OutboxRecord` bookkeeping
 *   style: one row per reminder id, an `attempts` counter, the LATEST
 *   attempt's status (`dispatched` | `failed`), and the last failure
 *   reason. A FAILED attempt is recorded but does NOT block a later retry
 *   (the person never received it) until `attempts` reaches the engine's
 *   `maxDispatchAttempts` cap — after which the reminder is skipped with
 *   reason `retries-exhausted` (fail-closed, recorded, never silent).
 *
 * - The ledger is PERSON-FREE by design: `taskId` is enough to correlate
 *   back to the person through the task store (the observability
 *   discipline — person ids are denied in log-shaped records). It is also
 *   observation-free and evidence-free: only ids, the rung, the channel,
 *   attempt bookkeeping, and classified failure reasons.
 *
 * - Persistence port is async (db adapter arrives in a later integration
 *   packet — handoff recorded); `InMemoryReminderDispatchLedger` is the
 *   reference double with defensive copies in and out.
 */
import type { TaskId } from "@orbb/domain";
import type { ReminderId } from "./identity.js";
import type { ReminderRung } from "./payloads.js";
import type { DeliveryFailureReason } from "./channels.js";

/** Lifecycle statuses of a reminder's dispatch (latest attempt). */
export const REMINDER_DISPATCH_STATUSES = ["dispatched", "failed"] as const;

export type ReminderDispatchStatus = (typeof REMINDER_DISPATCH_STATUSES)[number];

/** Type guard: is `value` a canonical dispatch status? */
export function isReminderDispatchStatus(value: unknown): value is ReminderDispatchStatus {
  return (
    typeof value === "string" &&
    (REMINDER_DISPATCH_STATUSES as readonly string[]).includes(value)
  );
}

/** One send attempt, handed to the ledger by the engine. */
export interface ReminderAttemptRecord {
  readonly reminderId: ReminderId;
  readonly taskId: TaskId;
  readonly channelId: string;
  readonly rung: ReminderRung;
  /** Outcome of THIS attempt. */
  readonly status: ReminderDispatchStatus;
  readonly attemptedAt: Date;
  /** Present exactly on failed attempts. */
  readonly failureReason?: DeliveryFailureReason;
  /** Present exactly on failed attempts with a detail. */
  readonly failureDetail?: string;
}

/** The accumulated dispatch record for one reminder id. */
export interface ReminderDispatchRecord {
  readonly reminderId: ReminderId;
  readonly taskId: TaskId;
  readonly channelId: string;
  readonly rung: ReminderRung;
  /** Latest attempt's outcome. */
  readonly status: ReminderDispatchStatus;
  /** Total attempts recorded for this reminder (>= 1). */
  readonly attempts: number;
  readonly firstAttemptedAt: Date;
  readonly lastAttemptedAt: Date;
  /** Present exactly when the latest attempt delivered. */
  readonly deliveredAt?: Date;
  /** Present exactly when the latest attempt failed. */
  readonly lastFailureReason?: DeliveryFailureReason;
  readonly lastFailureDetail?: string;
}

/**
 * Persistence port for dispatch records. `recordAttempt` is idempotent per
 * reminder id: it appends ONE attempt (creating the record on the first
 * attempt, updating bookkeeping on later ones) and returns the accumulated
 * record. There is never more than one record per reminder id.
 */
export interface ReminderDispatchLedger {
  findById(reminderId: ReminderId): Promise<ReminderDispatchRecord | undefined>;
  recordAttempt(attempt: ReminderAttemptRecord): Promise<ReminderDispatchRecord>;
}

/** In-memory reference `ReminderDispatchLedger` (defensive copies in/out). */
export class InMemoryReminderDispatchLedger implements ReminderDispatchLedger {
  readonly #records = new Map<string, ReminderDispatchRecord>();

  async findById(reminderId: ReminderId): Promise<ReminderDispatchRecord | undefined> {
    const record = this.#records.get(reminderId);
    return record === undefined ? undefined : cloneDispatchRecord(record);
  }

  async recordAttempt(attempt: ReminderAttemptRecord): Promise<ReminderDispatchRecord> {
    const existing = this.#records.get(attempt.reminderId);
    if (existing === undefined) {
      const created: ReminderDispatchRecord = {
        reminderId: attempt.reminderId,
        taskId: attempt.taskId,
        channelId: attempt.channelId,
        rung: attempt.rung,
        status: attempt.status,
        attempts: 1,
        firstAttemptedAt: new Date(attempt.attemptedAt.getTime()),
        lastAttemptedAt: new Date(attempt.attemptedAt.getTime()),
        ...(attempt.status === "dispatched"
          ? { deliveredAt: new Date(attempt.attemptedAt.getTime()) }
          : {}),
        ...(attempt.status === "failed" && attempt.failureReason !== undefined
          ? { lastFailureReason: attempt.failureReason }
          : {}),
        ...(attempt.status === "failed" && attempt.failureDetail !== undefined
          ? { lastFailureDetail: attempt.failureDetail }
          : {}),
      };
      this.#records.set(attempt.reminderId, created);
      return cloneDispatchRecord(created);
    }
    const updated: ReminderDispatchRecord = {
      reminderId: attempt.reminderId,
      taskId: attempt.taskId,
      channelId: attempt.channelId,
      rung: attempt.rung,
      status: attempt.status,
      attempts: existing.attempts + 1,
      firstAttemptedAt: new Date(existing.firstAttemptedAt.getTime()),
      lastAttemptedAt: new Date(attempt.attemptedAt.getTime()),
      ...(attempt.status === "dispatched"
        ? { deliveredAt: new Date(attempt.attemptedAt.getTime()) }
        : {}),
      ...(attempt.status === "failed" && attempt.failureReason !== undefined
        ? { lastFailureReason: attempt.failureReason }
        : {}),
      ...(attempt.status === "failed" && attempt.failureDetail !== undefined
        ? { lastFailureDetail: attempt.failureDetail }
        : {}),
    };
    this.#records.set(attempt.reminderId, updated);
    return cloneDispatchRecord(updated);
  }

  /** All records in first-attempt (insertion) order — deterministic per call sequence. */
  listAll(): readonly ReminderDispatchRecord[] {
    return [...this.#records.values()].map(cloneDispatchRecord);
  }
}

function cloneDispatchRecord(record: ReminderDispatchRecord): ReminderDispatchRecord {
  return {
    reminderId: record.reminderId,
    taskId: record.taskId,
    channelId: record.channelId,
    rung: record.rung,
    status: record.status,
    attempts: record.attempts,
    firstAttemptedAt: new Date(record.firstAttemptedAt.getTime()),
    lastAttemptedAt: new Date(record.lastAttemptedAt.getTime()),
    ...(record.deliveredAt !== undefined
      ? { deliveredAt: new Date(record.deliveredAt.getTime()) }
      : {}),
    ...(record.lastFailureReason !== undefined
      ? { lastFailureReason: record.lastFailureReason }
      : {}),
    ...(record.lastFailureDetail !== undefined
      ? { lastFailureDetail: record.lastFailureDetail }
      : {}),
  };
}
