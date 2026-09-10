/**
 * Domain event envelope — exactly the fields mandated by architecture §11:
 *
 *   { eventId, type, version, occurredAt, actor, subject, correlationId,
 *     causationId, payloadSchemaVersion }
 *
 * Recorded assumptions:
 *   - `correlationId` and `causationId` are optional, mirroring the
 *     Provenance primitive (the §11 field list does not mark optionality;
 *     root events legitimately have neither). They are opaque correlation
 *     tokens, deliberately unbranded strings in M0.
 *   - `eventId` is a contracts-level branded id (`evt_<body>`) — it is not
 *     part of the frozen M0 canonical id list in @orbb/domain.
 *   - `version` is the envelope schema version (positive integer, starting
 *     at 1); `payloadSchemaVersion` versions the payload schema and is a
 *     non-empty string (semver-style encouraged).
 *   - `actor` / `subject` reuse the domain's provenance actor/person types.
 *   - `occurredAt` is an in-process `Date`; ISO-8601 serialization is a
 *     transport-boundary concern.
 */
import {
  DomainInvariantError,
  isPersonId,
  isProvenanceActor,
  type PersonId,
  type ProvenanceActor,
} from "@orbb/domain";
import { isDomainEventType, type DomainEventType } from "./eventTypes.js";

declare const eventIdBrand: unique symbol;

/** Branded canonical event identifier: `evt_<body>`. */
export type EventId = string & { readonly [eventIdBrand]: "EventId" };

export const EVENT_ID_PREFIX = "evt";

const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isEventId(value: unknown): value is EventId {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${EVENT_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(EVENT_ID_PREFIX.length + 1));
}

export function parseEventId(value: unknown): EventId {
  if (!isEventId(value)) {
    throw new DomainInvariantError(
      `Invalid event id: expected "${EVENT_ID_PREFIX}_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

export interface DomainEventEnvelope {
  readonly eventId: EventId;
  readonly type: DomainEventType;
  /** Envelope schema version (positive integer, starts at 1). */
  readonly version: number;
  readonly occurredAt: Date;
  readonly actor: ProvenanceActor;
  readonly subject: PersonId;
  readonly correlationId?: string;
  readonly causationId?: string;
  /** Payload schema version (semver-style string). */
  readonly payloadSchemaVersion: string;
}

function isPresentButNotNonEmptyString(value: unknown): boolean {
  return value !== undefined && (typeof value !== "string" || value.length === 0);
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isDomainEventEnvelope(value: unknown): value is DomainEventEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof DomainEventEnvelope, unknown>>;
  if (!isEventId(candidate.eventId)) {
    return false;
  }
  if (!isDomainEventType(candidate.type)) {
    return false;
  }
  if (
    typeof candidate.version !== "number" ||
    !Number.isInteger(candidate.version) ||
    candidate.version < 1
  ) {
    return false;
  }
  if (!isTimestamp(candidate.occurredAt)) {
    return false;
  }
  if (!isProvenanceActor(candidate.actor)) {
    return false;
  }
  if (!isPersonId(candidate.subject)) {
    return false;
  }
  if (isPresentButNotNonEmptyString(candidate.correlationId)) {
    return false;
  }
  if (isPresentButNotNonEmptyString(candidate.causationId)) {
    return false;
  }
  if (
    typeof candidate.payloadSchemaVersion !== "string" ||
    candidate.payloadSchemaVersion.length === 0
  ) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link DomainEventEnvelope}. Throws
 * {@link import("@orbb/domain").DomainInvariantError} describing the §11
 * shape — received values are never echoed.
 */
export function assertDomainEventEnvelope(
  candidate: unknown,
): asserts candidate is DomainEventEnvelope {
  if (!isDomainEventEnvelope(candidate)) {
    throw new DomainInvariantError(
      "Invalid domain event envelope: expected { eventId, type, version, occurredAt, actor, subject, correlationId?, causationId?, payloadSchemaVersion } with a canonical evt_ id, a canonical event type, a positive integer version, a valid timestamp, a person/device/source actor, a person subject, and a non-empty payload schema version.",
    );
  }
}
