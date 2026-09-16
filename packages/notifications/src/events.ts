/**
 * B8 — TASK_DUE event emission through the contracts envelope.
 *
 * RECORDED DESIGN DECISIONS / ASSUMPTIONS:
 *
 * - The frozen `@orbb/contracts` event vocabulary has no
 *   REMINDER_DISPATCHED type (adding one is a tech-lead decision, not a
 *   worker decision) — `TASK_DUE` is the canonical event for a measurement
 *   task reaching its due/missed reminder state, so every successfully
 *   DISPATCHED reminder emits exactly one `TASK_DUE` envelope (§11 shape:
 *   eventId, type, version, occurredAt, actor, subject, correlationId?,
 *   causationId?, payloadSchemaVersion).
 *
 * - ACTOR ASSUMPTION (recorded): `@orbb/domain`'s `ProvenanceActor` union
 *   is PersonId | DeviceId | SourceId, and `provenance.ts` explicitly
 *   reserves service-account actors for tech-lead review. A reminder is a
 *   time-driven event with no initiating person/device/source — we record
 *   the SUBJECT person as the actor (the event is the person's own
 *   measurement task coming due). A dedicated system-actor kind is a
 *   recorded handoff for tech-lead review.
 *
 * - `causationId` carries the deterministic reminder id (the dispatch
 *   caused the event); `correlationId` is omitted (no ambient correlation
 *   in a pure engine). `eventId` comes from the injected `IdFactory`
 *   (creation-scoped identity — the ledger prevents duplicate dispatches,
 *   so a re-dispatch never occurs; a successful retry after failure is a
 *   genuinely new occurrence and gets a new event id).
 *
 * - The event PAYLOAD is the canonical-JSON serialization of
 *   {@link TaskDueEventPayload} — reminder id, channel id, and the
 *   PHI-free reminder payload. The envelope `subject` is the frozen §11
 *   PersonId field (an opaque pseudonym by construction); the payload
 *   plane itself stays person-free.
 *
 * - Delivery semantics (architecture §4): the sink is at-least-once
 *   shaped; consumers dedupe by event id. Transactional coupling of the
 *   ledger write and the outbox write (one transaction) is the db-adapter
 *   integration packet's concern — handoff recorded in the README.
 */
import type { EventId, DomainEventEnvelope } from "@orbb/contracts";
import type { PersonId } from "@orbb/domain";
import type { IdFactory } from "@orbb/testkit";
import { canonicalJson } from "./canonical.js";
import type { ReminderId } from "./identity.js";
import type { ReminderPayload } from "./payloads.js";

/** Envelope schema version of the TASK_DUE emission (positive int, starts at 1). */
export const TASK_DUE_ENVELOPE_VERSION = 1;

/** Payload schema version of the TASK_DUE emission (semver-style string). */
export const TASK_DUE_PAYLOAD_SCHEMA_VERSION = "1.0.0";

/** The typed payload of a dispatched-reminder TASK_DUE event. */
export interface TaskDueEventPayload {
  readonly reminderId: ReminderId;
  readonly channelId: string;
  readonly reminder: ReminderPayload;
}

/**
 * The event emission port. Production wiring writes the envelope + payload
 * to the transactional outbox (the `@orbb/db` UnitOfWork seam); the
 * in-memory double collects envelopes for tests and harnesses.
 */
export interface ReminderEventSink {
  publish(event: DomainEventEnvelope, payload: string): Promise<void>;
}

/** A fully-built TASK_DUE emission: the §11 envelope + canonical payload. */
export interface TaskDueEvent {
  readonly event: DomainEventEnvelope;
  readonly payload: string;
}

/** Input for {@link buildTaskDueEvent}. */
export interface BuildTaskDueEventInput {
  readonly ids: IdFactory;
  readonly personId: PersonId;
  readonly reminderId: ReminderId;
  readonly channelId: string;
  readonly payload: ReminderPayload;
  readonly occurredAt: Date;
}

/** Builds the TASK_DUE envelope + canonical payload for one dispatched reminder. */
export function buildTaskDueEvent(input: BuildTaskDueEventInput): TaskDueEvent {
  const eventId = input.ids.next("evt") as EventId;
  const event: DomainEventEnvelope = {
    eventId,
    type: "TASK_DUE",
    version: TASK_DUE_ENVELOPE_VERSION,
    occurredAt: new Date(input.occurredAt.getTime()),
    actor: input.personId,
    subject: input.personId,
    causationId: input.reminderId,
    payloadSchemaVersion: TASK_DUE_PAYLOAD_SCHEMA_VERSION,
  };
  const payload: TaskDueEventPayload = {
    reminderId: input.reminderId,
    channelId: input.channelId,
    reminder: input.payload,
  };
  return { event, payload: canonicalJson(payload) };
}

/** In-memory reference {@link ReminderEventSink} double (defensive copies). */
export class InMemoryReminderEventSink implements ReminderEventSink {
  readonly #events: TaskDueEvent[] = [];

  async publish(event: DomainEventEnvelope, payload: string): Promise<void> {
    this.#events.push({
      event: {
        eventId: event.eventId,
        type: event.type,
        version: event.version,
        occurredAt: new Date(event.occurredAt.getTime()),
        actor: event.actor,
        subject: event.subject,
        ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
        ...(event.causationId !== undefined ? { causationId: event.causationId } : {}),
        payloadSchemaVersion: event.payloadSchemaVersion,
      },
      payload,
    });
  }

  /** All collected emissions in publish order, defensively copied. */
  getEvents(): readonly TaskDueEvent[] {
    return this.#events.map((emission) => ({
      event: {
        eventId: emission.event.eventId,
        type: emission.event.type,
        version: emission.event.version,
        occurredAt: new Date(emission.event.occurredAt.getTime()),
        actor: emission.event.actor,
        subject: emission.event.subject,
        ...(emission.event.correlationId !== undefined
          ? { correlationId: emission.event.correlationId }
          : {}),
        ...(emission.event.causationId !== undefined
          ? { causationId: emission.event.causationId }
          : {}),
        payloadSchemaVersion: emission.event.payloadSchemaVersion,
      },
      payload: emission.payload,
    }));
  }
}
