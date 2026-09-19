/**
 * Timeline domain events (A49, part 4) — the timeline-local mirror of
 * the contracts event vocabulary and envelope (architecture §11), in
 * the M7-A catalog-mirror pattern of `@orbb/clinical`'s `events.ts`.
 *
 * The contracts vocabulary (`packages/contracts` `DOMAIN_EVENT_TYPES`)
 * is FROZEN: adding timeline event types is a tech-lead promotion. The
 * timeline event vocabulary (`TIMELINE_READ` — the access-decision
 * event) and the {@link TimelineEventEnvelope} (exactly the §11 field
 * list: eventId, type, version, occurredAt, actor, subject,
 * correlationId?, causationId?, payloadSchemaVersion) live in-package
 * and are structurally identical to the contracts shapes.
 *
 * CONTRACTS-PROMOTION HANDOFF (recorded, not performed here): when the
 * tech-lead lane promotes the timeline vocabulary, these types move into
 * the contracts `DOMAIN_EVENT_TYPES` and the envelope reduces to a
 * re-export of `DomainEventEnvelope`; the timeline event id kind
 * (`tevt_`) rebrands to the contracts `evt_` id. The names below are
 * promotion-stable (no renames needed).
 *
 * RECORDED ASSUMPTIONS:
 *   - The actor of a TIMELINE_READ event is the requesting PRACTITIONER
 *     (the care-team reader). A person reading their OWN timeline is a
 *     recorded FUTURE surface (the self-serve seam) — the actor union
 *     admits `PersonId` now so the promotion is additive, but nothing
 *     in this package constructs a person-actor event.
 *   - Payloads are NOT modeled here (mirroring the clinical lane):
 *     `payloadSchemaVersion` versions the payload schema the
 *     persistence lane attaches to the outbox record. The envelope
 *     carries labels and ids only — never observation values, never
 *     free text.
 */
import { DomainInvariantError, ID_BODY_PATTERN, isPersonId, type PersonId } from "@orbb/domain";
import { isPractitionerId, type PractitionerId } from "@orbb/clinical";

// ---------------------------------------------------------------------------
// Timeline event id (timeline-local mirror of the contracts evt_ id).
// ---------------------------------------------------------------------------

declare const timelineEventIdBrand: unique symbol;

/** Branded timeline event identifier: `tevt_<body>`. */
export type TimelineEventId = string & {
  readonly [timelineEventIdBrand]: "TimelineEventId";
};

export const TIMELINE_EVENT_ID_PREFIX = "tevt";

export function isTimelineEventId(value: unknown): value is TimelineEventId {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${TIMELINE_EVENT_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(TIMELINE_EVENT_ID_PREFIX.length + 1));
}

export function parseTimelineEventId(value: unknown): TimelineEventId {
  if (!isTimelineEventId(value)) {
    throw new DomainInvariantError(
      `Invalid timeline event id: expected "${TIMELINE_EVENT_ID_PREFIX}_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Timeline event types (frozen in-package vocabulary).
// ---------------------------------------------------------------------------

/**
 * The timeline domain event vocabulary. `TIMELINE_READ` is the access
 * decision event: every `assembleTimeline` evaluation (ALLOW and DENY
 * alike) produces exactly one. Frozen: extending it is a tech-lead
 * decision (contracts promotion).
 */
export const TIMELINE_EVENT_TYPES = ["TIMELINE_READ"] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export function isTimelineEventType(value: unknown): value is TimelineEventType {
  return (
    typeof value === "string" && (TIMELINE_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export function parseTimelineEventType(value: unknown): TimelineEventType {
  if (!isTimelineEventType(value)) {
    throw new DomainInvariantError(
      `Invalid timeline event type: expected one of ${TIMELINE_EVENT_TYPES.join(" | ")}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// The envelope (§11 field list, contracts-mirrored).
// ---------------------------------------------------------------------------

/**
 * Who can act on a timeline: the requesting practitioner (the shipped
 * care-team reader) — with `PersonId` admitted for the recorded future
 * self-serve seam (nothing constructs it yet).
 */
export type TimelineEventActor = PractitionerId | PersonId;

export function isTimelineEventActor(value: unknown): value is TimelineEventActor {
  return isPractitionerId(value) || isPersonId(value);
}

/**
 * A timeline domain event envelope — the §11 shape over the timeline
 * vocabulary: { eventId, type, version, occurredAt, actor, subject,
 * correlationId?, causationId?, payloadSchemaVersion }.
 */
export interface TimelineEventEnvelope {
  readonly eventId: TimelineEventId;
  readonly type: TimelineEventType;
  /** Envelope schema version (positive integer, starts at 1). */
  readonly version: number;
  readonly occurredAt: Date;
  readonly actor: TimelineEventActor;
  readonly subject: PersonId;
  readonly correlationId?: string;
  readonly causationId?: string;
  /** Payload schema version (semver-style string). */
  readonly payloadSchemaVersion: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPresentButNotNonEmptyString(value: unknown): boolean {
  return value !== undefined && (typeof value !== "string" || value.length === 0);
}

export function isTimelineEventEnvelope(value: unknown): value is TimelineEventEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof TimelineEventEnvelope, unknown>>;
  if (!isTimelineEventId(candidate.eventId)) {
    return false;
  }
  if (!isTimelineEventType(candidate.type)) {
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
  if (!isTimelineEventActor(candidate.actor)) {
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
  if (!isNonEmptyString(candidate.payloadSchemaVersion)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link TimelineEventEnvelope}. Throws {@link DomainInvariantError}
 * describing the §11 shape — received values are never echoed.
 */
export function assertTimelineEventEnvelope(
  candidate: unknown,
): asserts candidate is TimelineEventEnvelope {
  if (!isTimelineEventEnvelope(candidate)) {
    throw new DomainInvariantError(
      "Invalid timeline event envelope: expected { eventId, type, version, occurredAt, actor, subject, correlationId?, causationId?, payloadSchemaVersion } with a canonical tevt_ id, a timeline event type, a positive integer version, a valid timestamp, a practitioner (or future person) actor, a person subject, and a non-empty payload schema version.",
    );
  }
}
