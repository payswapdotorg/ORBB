/**
 * ORBB async consumer Worker — M0 shell.
 *
 * Two surfaces:
 *   - `queue` — a no-op queue-drain stub: it acknowledges every message
 *     so test/local queue plumbing never dead-letters. Real idempotent
 *     consumers (at-least-once delivery) land with the persistence and
 *     measurement milestones; the drain stub is replaced then.
 *   - `fetch` — `GET /healthz` liveness probe, same contract as the api
 *     Worker (`{"ok":true,"service":"orbb-worker"}`), so both compute
 *     surfaces are uniformly probeable.
 *
 * Message/batch types below are structural subsets of the Cloudflare
 * Queues consumer shapes — no provider SDK types are imported; the
 * runtime's own objects satisfy them structurally.
 */
import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, service: "orbb-worker" }));

/** Structural subset of a Cloudflare Queues message (no SDK import). */
export interface DrainMessage {
  readonly id: string;
  readonly body: unknown;
  ack(): void;
  retry(): void;
}

/** Structural subset of a Cloudflare Queues batch (no SDK import). */
export interface DrainBatch {
  readonly queue: string;
  readonly messages: readonly DrainMessage[];
}

/**
 * No-op queue-drain stub: acknowledges every message in the batch.
 * Deterministic, side-effect-free, credential-free.
 */
export async function drainQueue(batch: DrainBatch): Promise<void> {
  for (const message of batch.messages) {
    message.ack();
  }
}

export default {
  fetch: app.fetch,
  queue: drainQueue,
};
