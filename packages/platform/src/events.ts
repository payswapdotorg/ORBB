/**
 * Async messaging adapters (architecture provider map: Async → Cloudflare
 * Queues + Workers → EventBus/JobRunner).
 *
 * Delivery semantics: the architecture assumes at-least-once delivery
 * (never assume exactly-once). Every consumer MUST be idempotent using
 * event ids / idempotency keys; the transactional outbox is written in the
 * same Postgres transaction as domain state (architecture §4).
 */

/**
 * One published domain event. `payload` is opaque here — the canonical
 * envelope and event-type union are owned by `@orbb/contracts`.
 */
export interface EventMessage {
  /** Topic name, e.g. "observation.recorded". */
  readonly topic: string;
  /** Opaque, contract-owned payload. */
  readonly payload: unknown;
  /** Idempotency key (event id) used by consumers for deduplication. */
  readonly idempotencyKey?: string;
}

/**
 * Replacement interface for the domain-event publishing concern.
 *
 * Provider default: Cloudflare Queues (durable retries, low cost). At M0
 * there is deliberately NO in-memory implementation — see
 * `environments.ts` for the provider matrix.
 */
export interface EventBus {
  publish(message: EventMessage): Promise<void>;
}

/** One queued background job. */
export interface Job {
  readonly type: string;
  /** Opaque, contract-owned payload. */
  readonly payload: unknown;
  /** Idempotency key for exactly-once effects at the consumer. */
  readonly idempotencyKey?: string;
  /** Maximum delivery attempts before the message is dropped to DLQ. */
  readonly maxAttempts?: number;
}

/** Consumer for one job type. Must be idempotent (at-least-once delivery). */
export interface JobHandler {
  handle(job: Job): Promise<void>;
}

/**
 * Replacement interface for the background-job concern.
 *
 * Provider default: Cloudflare Queues + Worker consumers.
 */
export interface JobRunner {
  enqueue(job: Job): Promise<void>;
  /** Registers the handler for a job type (one handler per type). */
  registerHandler(jobType: string, handler: JobHandler): void;
}
