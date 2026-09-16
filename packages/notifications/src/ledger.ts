/**
 * Send-attempt ledger (B8) — the idempotency ledger of record.
 *
 * The ledger records WHAT WAS ACTUALLY DISPATCHED: one {@link SendAttempt}
 * per dispatched reminder identity, whether the delivery succeeded or was
 * undeliverable (a fail-closed recorded outcome is still a dispatch
 * ATTEMPT of record — never a silent drop). Ledger entries are PHID-free:
 * reminder id, channel, rung, outcome, timestamp — the payload itself is
 * deterministically reproducible from schedule inputs, so it is not
 * duplicated into the ledger.
 *
 * EXACTLY-ONCE SEMANTICS (recorded): the ledger is keyed by REMINDER id.
 * A reminder with any recorded attempt — sent OR undeliverable — is never
 * re-sent under the same identity; retries flow through NEW reminder
 * identities (new windows after the scheduler's roll-forward). This is
 * the anti-spam direction required by the "gentle" ladder: a failed
 * delivery is visible (recorded reason), and the engine does not hammer a
 * failing channel within one reminder identity.
 */
import type { ReminderId, SendAttemptId } from "./ids.js";
import type { ChannelSendResult } from "./channels.js";
import type { NotificationChannelId, ReminderRung } from "./vocabulary.js";

/**
 * One recorded dispatch of one reminder (the ledger's row shape —
 * PHID-free by construction).
 */
export interface SendAttempt {
  /** Creation-scoped attempt id (`snd_<body>`, testkit IdFactory source). */
  readonly id: SendAttemptId;
  /** The dispatched reminder's deterministic identity (the ledger key). */
  readonly reminderId: ReminderId;
  readonly channel: NotificationChannelId;
  readonly rung: ReminderRung;
  /** The fail-closed outcome: `sent`, or `undeliverable` WITH its reason. */
  readonly outcome: ChannelSendResult;
  readonly dispatchedAt: Date;
}

/**
 * The persistence port for send attempts (async — the db adapter arrives
 * in a later integration packet, handoff recorded in README.md; the
 * in-memory ledger is the reference double).
 */
export interface SendAttemptLedger {
  /**
   * Records an attempt, UPSERTED BY REMINDER ID: a second `record` for an
   * already-ledgered reminder id is a no-op (exactly-once rows).
   */
  record(attempt: SendAttempt): Promise<void>;
  /** The recorded attempt for a reminder id, when one exists. */
  findByReminderId(reminderId: ReminderId): Promise<SendAttempt | undefined>;
  /** All recorded attempts in ledger order (defensive copies). */
  listAll(): Promise<readonly SendAttempt[]>;
}

/** In-memory reference {@link SendAttemptLedger} (defensive copies in and out). */
export class InMemorySendAttemptLedger implements SendAttemptLedger {
  readonly #attempts = new Map<string, SendAttempt>();

  async record(attempt: SendAttempt): Promise<void> {
    if (!this.#attempts.has(attempt.reminderId)) {
      this.#attempts.set(attempt.reminderId, cloneAttempt(attempt));
    }
  }

  async findByReminderId(reminderId: ReminderId): Promise<SendAttempt | undefined> {
    const attempt = this.#attempts.get(reminderId);
    return attempt === undefined ? undefined : cloneAttempt(attempt);
  }

  async listAll(): Promise<readonly SendAttempt[]> {
    return [...this.#attempts.values()].map(cloneAttempt);
  }
}

function cloneAttempt(attempt: SendAttempt): SendAttempt {
  return {
    ...attempt,
    outcome: cloneOutcome(attempt.outcome),
    dispatchedAt: new Date(attempt.dispatchedAt.getTime()),
  };
}

function cloneOutcome(outcome: ChannelSendResult): ChannelSendResult {
  if (outcome.status === "sent") {
    return { ...outcome, deliveredAt: new Date(outcome.deliveredAt.getTime()) };
  }
  return { ...outcome, reason: { ...outcome.reason } };
}
