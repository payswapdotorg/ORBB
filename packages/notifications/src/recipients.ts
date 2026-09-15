/**
 * Recipient directory (B8) — the delivery-addressing pseudonym seam.
 *
 * Reminder PAYLOADS never carry person identifiers (the B8 PHI rule), yet
 * a delivery channel ultimately needs a recipient. The seam: the engine
 * resolves the task's `personId` (which lives on the task snapshot, never
 * in the payload) into an OPAQUE, NON-IDENTIFYING `recipientRef` through
 * this injected directory — the observability lane's pseudonym precedent
 * (`hash:`-style correlatable handles, never raw ids in payloads, logs,
 * queue metadata, or URLs; architecture §6).
 *
 * The `recipientRef` is the only person-correlated value a channel ever
 * sees, and it is pseudonym-grade by construction at this seam. Real
 * implementations (app boundary) return push-subscription handles / email
 * pseudonym tokens resolved from their own governed stores; the in-memory
 * double maps SYNTH-marked tokens for tests.
 */
import type { PersonId } from "@orbb/domain";

/** Resolves person ids to opaque recipient references (pseudonym-grade). */
export interface RecipientDirectory {
  /**
   * The opaque recipient reference for `personId`, or `undefined` when the
   * person has no deliveryable recipient record (fail-closed: the engine
   * records an undeliverable outcome, never a crash, never a silent drop).
   */
  resolve(personId: PersonId): Promise<string | undefined>;
}

/**
 * In-memory {@link RecipientDirectory} (the test/impl double). Defensive:
 * returns a copy of nothing (strings are immutable) and never exposes the
 * internal map.
 */
export class InMemoryRecipientDirectory implements RecipientDirectory {
  readonly #recipients = new Map<string, string>();

  /** Registers (or replaces) the recipient reference for a person id. */
  register(personId: PersonId, recipientRef: string): void {
    this.#recipients.set(personId, recipientRef);
  }

  async resolve(personId: PersonId): Promise<string | undefined> {
    return this.#recipients.get(personId);
  }
}
