/**
 * A45 — PatientLink: the person ↔ practitioner relationship with a
 * verification lifecycle (architecture §5 Clinical/research family).
 *
 *   requested -> confirmed | declined (terminal)
 *   confirmed -> revoked (terminal)
 *
 * LINKING IS CONSENT-SHAPED. The PERSON (patient) confirms — directly or
 * through an explicit invitation flow. A practitioner can REQUEST a link
 * but can NEVER self-confirm one: the confirmation vocabulary
 * ({@link PATIENT_LINK_CONFIRMATION_SOURCES}) contains only `person` and
 * `invitation`, and this package exports no function that confirms,
 * declines, or revokes a link on practitioner authority — the vocabulary
 * has no words for it, proven by test (the same "a schema cannot express
 * what it has no words for" discipline as the adherence non-punitive
 * proof).
 *
 * FAIL-CLOSED: an unconfirmed link confers NOTHING. The care-team
 * permission evaluator treats every state except `confirmed` — including
 * `requested`, `declined`, `revoked`, and a link that does not connect
 * the evaluated (person, practitioner) pair at all — as
 * `unconfirmed-patient-link` and DENIES.
 *
 * RECORDED ASSUMPTIONS (SYNTH-safe, boundary-shaped):
 *   - A link is identified by the (person, practitioner) pair — no
 *     separate id kind (kernel `Relationship` precedent; a link id is a
 *     kernel-promotion decision).
 *   - `requestedBy` records who initiated the request (`person` or
 *     `practitioner`) so the audit trail can distinguish
 *     practitioner-initiated requests (awaiting the person's consent)
 *     from person-initiated invitations (awaiting confirmation through
 *     the person's own action or their explicit invitation flow).
 *   - The `invitation` source proxies the PERSON only: the calling layer
 *     must invoke it under the person's authenticated session or a
 *     person-issued invitation token. This package models the
 *     vocabulary; enforcing invitation-token authenticity is the
 *     boundary lane's job (recorded handoff).
 *   - Only person-side sources confirm, decline, and revoke. A
 *     practitioner ending care is modeled as a CARE-TEAM change
 *     (practitioner-removed) — never as link revocation (recorded
 *     assumption; M7-B may add practitioner-side departure flows).
 *   - No expiry on links: a confirmed link persists until the person
 *     revokes it. Time-scoped links are a consent-lane refinement.
 */
import { DomainInvariantError, isPersonId, type PersonId } from "@orbb/domain";
import { isPractitionerId, type PractitionerId } from "./ids.js";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  isState,
  parseState,
  type StateTransitionTable,
} from "./stateMachine.js";

// ---------------------------------------------------------------------------
// Actors and person-side confirmation sources (frozen vocabularies).
// ---------------------------------------------------------------------------

/** Who may initiate a patient-link request (frozen vocabulary). */
export const PATIENT_LINK_ACTORS = ["person", "practitioner"] as const;

export type PatientLinkActor = (typeof PATIENT_LINK_ACTORS)[number];

export function isPatientLinkActor(value: unknown): value is PatientLinkActor {
  return typeof value === "string" && (PATIENT_LINK_ACTORS as readonly string[]).includes(value);
}

export function parsePatientLinkActor(value: unknown): PatientLinkActor {
  if (!isPatientLinkActor(value)) {
    throw new DomainInvariantError(
      `Invalid patient-link actor: expected one of ${PATIENT_LINK_ACTORS.join(" | ")}.`,
    );
  }
  return value;
}

/**
 * Who may act on the person's side of a link (frozen vocabulary):
 * the person directly, or an explicit invitation flow proxying them.
 * Deliberately DOES NOT contain `practitioner` — a practitioner can
 * request but never self-confirm.
 */
export const PATIENT_LINK_CONFIRMATION_SOURCES = ["person", "invitation"] as const;

export type PatientLinkConfirmationSource =
  (typeof PATIENT_LINK_CONFIRMATION_SOURCES)[number];

export function isPatientLinkConfirmationSource(
  value: unknown,
): value is PatientLinkConfirmationSource {
  return (
    typeof value === "string" &&
    (PATIENT_LINK_CONFIRMATION_SOURCES as readonly string[]).includes(value)
  );
}

export function parsePatientLinkConfirmationSource(
  value: unknown,
): PatientLinkConfirmationSource {
  if (!isPatientLinkConfirmationSource(value)) {
    throw new DomainInvariantError(
      `Invalid patient-link confirmation source: expected one of ${PATIENT_LINK_CONFIRMATION_SOURCES.join(" | ")} — a practitioner can request a link but never self-confirm one.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// State machine.
// ---------------------------------------------------------------------------

export const PATIENT_LINK_STATES = ["requested", "confirmed", "declined", "revoked"] as const;

export type PatientLinkState = (typeof PATIENT_LINK_STATES)[number];

/**
 * Legal PatientLinkState transitions. `declined` and `revoked` are
 * terminal — a declined request can never quietly become confirmed, and a
 * revoked link requires a fresh, re-consented request.
 */
export const PATIENT_LINK_STATE_TRANSITIONS: StateTransitionTable<PatientLinkState> = {
  requested: ["confirmed", "declined"],
  confirmed: ["revoked"],
  declined: [],
  revoked: [],
};

export function isPatientLinkState(value: unknown): value is PatientLinkState {
  return isState(PATIENT_LINK_STATES, value);
}

export function parsePatientLinkState(value: unknown): PatientLinkState {
  return parseState(PATIENT_LINK_STATES, value, "patient link state");
}

export function allowedPatientLinkTransitions(
  from: PatientLinkState,
): readonly PatientLinkState[] {
  return allowedTransitions(PATIENT_LINK_STATE_TRANSITIONS, from);
}

export function canTransitionPatientLink(
  from: PatientLinkState,
  to: PatientLinkState,
): boolean {
  return canTransition(PATIENT_LINK_STATE_TRANSITIONS, from, to);
}

/** Throws {@link DomainInvariantError} on illegal transitions. */
export function assertPatientLinkTransition(
  from: PatientLinkState,
  to: PatientLinkState,
): void {
  assertTransition(PATIENT_LINK_STATE_TRANSITIONS, from, to, "patient link");
}

// ---------------------------------------------------------------------------
// The aggregate.
// ---------------------------------------------------------------------------

/** The person ↔ practitioner relationship (A45). */
export interface PatientLink {
  readonly personId: PersonId;
  readonly practitionerId: PractitionerId;
  readonly state: PatientLinkState;
  /** Who initiated the request (person or practitioner). */
  readonly requestedBy: PatientLinkActor;
}

export function isPatientLink(value: unknown): value is PatientLink {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof PatientLink, unknown>>;
  if (!isPersonId(candidate.personId)) {
    return false;
  }
  if (!isPractitionerId(candidate.practitionerId)) {
    return false;
  }
  if (!isPatientLinkState(candidate.state)) {
    return false;
  }
  if (!isPatientLinkActor(candidate.requestedBy)) {
    return false;
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link PatientLink}. Throws {@link DomainInvariantError} describing
 * the expected shape — received values are never echoed.
 */
export function assertPatientLink(candidate: unknown): asserts candidate is PatientLink {
  if (!isPatientLink(candidate)) {
    throw new DomainInvariantError(
      "Invalid patient link: expected { personId, practitionerId, state, requestedBy } with a canonical prsn_ person id, a canonical pract_ practitioner id, a legal patient link state (requested|confirmed|declined|revoked), and a requestedBy actor of person|practitioner.",
    );
  }
}

// ---------------------------------------------------------------------------
// The lifecycle actions (pure; every step asserts the legal transition).
// ---------------------------------------------------------------------------

/**
 * Opens a link request. Either side may initiate (`requestedBy`), but the
 * resulting link confers NOTHING until the person side confirms it.
 */
export function requestPatientLink(
  personId: PersonId,
  practitionerId: PractitionerId,
  requestedBy: PatientLinkActor,
): PatientLink {
  if (!isPersonId(personId)) {
    throw new DomainInvariantError(
      'Invalid person id: expected "prsn_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].',
    );
  }
  if (!isPractitionerId(practitionerId)) {
    throw new DomainInvariantError(
      'Invalid practitioner id: expected "pract_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].',
    );
  }
  if (!isPatientLinkActor(requestedBy)) {
    throw new DomainInvariantError(
      `Invalid patient-link actor: expected one of ${PATIENT_LINK_ACTORS.join(" | ")}.`,
    );
  }
  return { personId, practitionerId, state: "requested", requestedBy };
}

/**
 * The person-side confirmation (or the explicit invitation flow proxying
 * the person). Legal ONLY from `requested`; every other source state
 * throws. The source can never be a practitioner — the parameter type is
 * the closed {@link PatientLinkConfirmationSource} union.
 */
export function confirmPatientLink(
  link: PatientLink,
  source: PatientLinkConfirmationSource,
): PatientLink {
  assertPatientLink(link);
  if (!isPatientLinkConfirmationSource(source)) {
    throw new DomainInvariantError(
      `Invalid patient-link confirmation source: expected one of ${PATIENT_LINK_CONFIRMATION_SOURCES.join(" | ")} — a practitioner can request a link but never self-confirm one.`,
    );
  }
  assertPatientLinkTransition(link.state, "confirmed");
  return { ...link, state: "confirmed" };
}

/**
 * The person-side decline of a pending request. Legal ONLY from
 * `requested`; `declined` is terminal.
 */
export function declinePatientLink(
  link: PatientLink,
  source: PatientLinkConfirmationSource,
): PatientLink {
  assertPatientLink(link);
  if (!isPatientLinkConfirmationSource(source)) {
    throw new DomainInvariantError(
      `Invalid patient-link confirmation source: expected one of ${PATIENT_LINK_CONFIRMATION_SOURCES.join(" | ")} — a practitioner can request a link but never self-confirm one.`,
    );
  }
  assertPatientLinkTransition(link.state, "declined");
  return { ...link, state: "declined" };
}

/**
 * The person-side revocation of a confirmed link. Legal ONLY from
 * `confirmed`; `revoked` is terminal.
 */
export function revokePatientLink(
  link: PatientLink,
  source: PatientLinkConfirmationSource,
): PatientLink {
  assertPatientLink(link);
  if (!isPatientLinkConfirmationSource(source)) {
    throw new DomainInvariantError(
      `Invalid patient-link confirmation source: expected one of ${PATIENT_LINK_CONFIRMATION_SOURCES.join(" | ")} — a practitioner can request a link but never self-confirm one.`,
    );
  }
  assertPatientLinkTransition(link.state, "revoked");
  return { ...link, state: "revoked" };
}
