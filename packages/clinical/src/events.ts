/**
 * A45/A44 — clinical domain events: the clinical-local mirror of the
 * contracts event vocabulary and envelope (architecture §11).
 *
 * The contracts vocabulary (`packages/contracts/src/eventTypes.ts`
 * `DOMAIN_EVENT_TYPES`) is FROZEN: adding clinical event types is a
 * tech-lead promotion. The M7-A catalog-mirror pattern applies — the
 * clinical event types and the {@link ClinicalEventEnvelope} (exactly the
 * §11 field list: eventId, type, version, occurredAt, actor, subject,
 * correlationId?, causationId?, payloadSchemaVersion) live in-package and
 * are structurally identical to the contracts shapes, importing the REAL
 * kernel `ProvenanceActor` and `PersonId` types for actor/subject.
 *
 * CONTRACTS-PROMOTION HANDOFF (recorded, not performed here): when the
 * tech-lead lane promotes the clinical vocabulary, these types move into
 * `DOMAIN_EVENT_TYPES` in `packages/contracts/src/eventTypes.ts` and the
 * envelope reduces to a re-export of `DomainEventEnvelope`; the clinical
 * event id kind (`cevt_`) rebrands to the contracts `evt_` id. The
 * names below are chosen to be promotion-stable (no renames needed).
 *
 * RECORDED ASSUMPTIONS:
 *   - Every clinical event type names a state change of an A44/A45
 *     aggregate or a permission decision — one vocabulary entry per
 *     legal transition (plus CARE_TEAM_CHANGED for the additive
 *     composition fold, whose change kind rides in the payload, and
 *     CARE_TEAM_ACCESS_EVALUATED, mirroring the kernel's
 *     ACCESS_EVALUATED).
 *   - Payloads are NOT modeled here: `payloadSchemaVersion` versions the
 *     payload schema the persistence lane attaches. Payload shapes are
 *     an M7-B concern (recorded).
 */
import {
  DomainInvariantError,
  isPersonId,
  isProvenanceActor,
  ID_BODY_PATTERN,
  type PersonId,
  type ProvenanceActor,
} from "@orbb/domain";

// ---------------------------------------------------------------------------
// Clinical event id (clinical-local mirror of the contracts evt_ id).
// ---------------------------------------------------------------------------

declare const clinicalEventIdBrand: unique symbol;

/** Branded clinical event identifier: `cevt_<body>`. */
export type ClinicalEventId = string & {
  readonly [clinicalEventIdBrand]: "ClinicalEventId";
};

export const CLINICAL_EVENT_ID_PREFIX = "cevt";

export function isClinicalEventId(value: unknown): value is ClinicalEventId {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${CLINICAL_EVENT_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(CLINICAL_EVENT_ID_PREFIX.length + 1));
}

export function parseClinicalEventId(value: unknown): ClinicalEventId {
  if (!isClinicalEventId(value)) {
    throw new DomainInvariantError(
      `Invalid clinical event id: expected "${CLINICAL_EVENT_ID_PREFIX}_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Clinical event types (frozen in-package vocabulary).
// ---------------------------------------------------------------------------

/**
 * The clinical domain event vocabulary — one entry per legal state
 * change of the A44/A45 aggregates, plus the additive-composition and
 * evaluation events. Frozen: extending it is a tech-lead decision.
 */
export const CLINICAL_EVENT_TYPES = [
  "PATIENT_LINK_REQUESTED",
  "PATIENT_LINK_CONFIRMED",
  "PATIENT_LINK_DECLINED",
  "PATIENT_LINK_REVOKED",
  "CARE_TEAM_CHANGED",
  "CARE_TEAM_DISSOLVED",
  "CARE_TEAM_ACCESS_EVALUATED",
  "PRACTITIONER_VERIFIED",
  "PRACTITIONER_REVERIFIED",
  "PRACTITIONER_SUSPENDED",
  "ORGANIZATION_SUSPENDED",
  "ORGANIZATION_REACTIVATED",
  "ORGANIZATION_DISSOLVED",
  "CLINIC_SUSPENDED",
  "CLINIC_REACTIVATED",
  "CLINIC_DISSOLVED",
] as const;

export type ClinicalEventType = (typeof CLINICAL_EVENT_TYPES)[number];

export function isClinicalEventType(value: unknown): value is ClinicalEventType {
  return (
    typeof value === "string" && (CLINICAL_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export function parseClinicalEventType(value: unknown): ClinicalEventType {
  if (!isClinicalEventType(value)) {
    throw new DomainInvariantError(
      `Invalid clinical event type: expected one of ${CLINICAL_EVENT_TYPES.join(" | ")}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// The envelope (§11 field list, contracts-mirrored).
// ---------------------------------------------------------------------------

/**
 * A clinical domain event envelope — the §11 shape over the clinical
 * vocabulary: { eventId, type, version, occurredAt, actor, subject,
 * correlationId?, causationId?, payloadSchemaVersion }.
 */
export interface ClinicalEventEnvelope {
  readonly eventId: ClinicalEventId;
  readonly type: ClinicalEventType;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPresentButNotNonEmptyString(value: unknown): boolean {
  return value !== undefined && (typeof value !== "string" || value.length === 0);
}

export function isClinicalEventEnvelope(value: unknown): value is ClinicalEventEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ClinicalEventEnvelope, unknown>>;
  if (!isClinicalEventId(candidate.eventId)) {
    return false;
  }
  if (!isClinicalEventType(candidate.type)) {
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
  if (!isNonEmptyString(candidate.payloadSchemaVersion)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link ClinicalEventEnvelope}. Throws
 * {@link DomainInvariantError} describing the §11 shape — received
 * values are never echoed.
 */
export function assertClinicalEventEnvelope(
  candidate: unknown,
): asserts candidate is ClinicalEventEnvelope {
  if (!isClinicalEventEnvelope(candidate)) {
    throw new DomainInvariantError(
      "Invalid clinical event envelope: expected { eventId, type, version, occurredAt, actor, subject, correlationId?, causationId?, payloadSchemaVersion } with a canonical cevt_ id, a clinical event type, a positive integer version, a valid timestamp, a person/device/source actor, a person subject, and a non-empty payload schema version.",
    );
  }
}
