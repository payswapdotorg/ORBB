/**
 * Transactional outbox record (architecture §4: every domain mutation
 * writes domain state plus an outbox event inside one transaction;
 * workers consume the outbox asynchronously and idempotently).
 *
 * Recorded assumption: the outbox record carries the event identity, the
 * serialized (JSON) payload, delivery bookkeeping, and status. The full
 * envelope is materialized by the publisher when the record is relayed.
 */
import { DomainInvariantError } from "@orbb/domain";
import type { DomainEventType } from "./eventTypes.js";
import type { EventId } from "./envelope.js";

export const OUTBOX_STATUSES = ["pending", "published", "failed"] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export function isOutboxStatus(value: unknown): value is OutboxStatus {
  return typeof value === "string" && (OUTBOX_STATUSES as readonly string[]).includes(value);
}

export function parseOutboxStatus(value: unknown): OutboxStatus {
  if (!isOutboxStatus(value)) {
    throw new DomainInvariantError(
      `Invalid outbox status: expected one of ${OUTBOX_STATUSES.join(" | ")}.`,
    );
  }
  return value;
}

export interface OutboxRecord {
  readonly eventId: EventId;
  readonly eventType: DomainEventType;
  /** Serialized (JSON) event payload awaiting publication. */
  readonly payload: string;
  readonly status: OutboxStatus;
  /** Publication attempts so far (non-negative). */
  readonly attempts: number;
  readonly createdAt: Date;
  readonly publishedAt?: Date;
  /** Last publication failure reason, if any. */
  readonly lastError?: string;
}
