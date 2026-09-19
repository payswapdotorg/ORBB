/**
 * A45 — CareTeam: a person's care team as an ORDERED composition of
 * practitioner memberships.
 *
 * Care-team state machine (recorded grammar):
 *
 *   forming -> active            (the first practitioner is added)
 *   forming -> dissolved         (the team is dissolved before activation)
 *   active  -> dissolved
 *   dissolved is TERMINAL
 *
 * `forming` is a team that exists but has no composition yet (recorded
 * assumption); it activates on the first `practitioner-added` change.
 * `active` is the only state the permission evaluator accepts
 * (`inactive-care-team` is a distinct typed deny reason).
 *
 * CARE-TEAM CHANGES ARE ADDITIVE EVENTS WITH AUDIT RECORDS — NEVER SILENT
 * MUTATION. Every composition change is an explicit
 * {@link CareTeamChange} value (a discriminated union: who acted, when,
 * which practitioner, which role) — that value IS the additive event AND
 * the audit record. The only way to evolve a team is
 * {@link applyCareTeamChange}, a pure fold that never mutates its input,
 * preserves entry order, and throws {@link DomainInvariantError} on every
 * illegal application (dissolved team, duplicate add, unknown removal,
 * person mismatch). The persisted change log itself is the event-store
 * concern — the `CARE_TEAM_CHANGED` clinical event type is the envelope
 * vocabulary for it (contracts-promotion handoff recorded in README).
 *
 * RECORDED ASSUMPTIONS:
 *   - Care-team roles are OPTIONAL labels from a frozen vocabulary
 *     (`primary-care | origin | consulting`). Unlabeled membership is
 *     legal — a practitioner can be on the team without a role label.
 *   - Entries are ordered by insertion; a `role-labeled` change replaces
 *     the entry's role label IN PLACE (position preserved).
 *   - The fold does NOT require a confirmed PatientLink when adding a
 *     practitioner: the confirmed-link requirement is enforced by the
 *     care-team permission EVALUATOR at decision time (deny-by-default),
 *     not by composition. Composition-time coupling would duplicate the
 *     evaluator's authority and make replay order-dependent.
 *   - Removing the last practitioner leaves the team `active` (an empty
 *     active team is legal; only dissolution is terminal).
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

// ---------------------------------------------------------------------------
// Frozen care-team role vocabulary.
// ---------------------------------------------------------------------------

/** Frozen in-package care-team role label vocabulary. */
export const CARE_TEAM_ROLES = ["primary-care", "origin", "consulting"] as const;

export type CareTeamRole = (typeof CARE_TEAM_ROLES)[number];

export function isCareTeamRole(value: unknown): value is CareTeamRole {
  return typeof value === "string" && (CARE_TEAM_ROLES as readonly string[]).includes(value);
}

export function parseCareTeamRole(value: unknown): CareTeamRole {
  if (!isCareTeamRole(value)) {
    throw new DomainInvariantError(
      `Invalid care-team role: expected one of ${CARE_TEAM_ROLES.join(" | ")}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// State machine.
// ---------------------------------------------------------------------------

export const CARE_TEAM_STATES = ["forming", "active", "dissolved"] as const;

export type CareTeamState = (typeof CARE_TEAM_STATES)[number];

/**
 * Legal CareTeamState transitions. `dissolved` is terminal — no change of
 * ANY kind applies to a dissolved team.
 */
export const CARE_TEAM_STATE_TRANSITIONS: StateTransitionTable<CareTeamState> = {
  forming: ["active", "dissolved"],
  active: ["dissolved"],
  dissolved: [],
};

export function isCareTeamState(value: unknown): value is CareTeamState {
  return isState(CARE_TEAM_STATES, value);
}

export function parseCareTeamState(value: unknown): CareTeamState {
  return parseState(CARE_TEAM_STATES, value, "care team state");
}

export function allowedCareTeamTransitions(from: CareTeamState): readonly CareTeamState[] {
  return allowedTransitions(CARE_TEAM_STATE_TRANSITIONS, from);
}

export function canTransitionCareTeam(from: CareTeamState, to: CareTeamState): boolean {
  return canTransition(CARE_TEAM_STATE_TRANSITIONS, from, to);
}

/** Throws {@link DomainInvariantError} on illegal transitions. */
export function assertCareTeamTransition(from: CareTeamState, to: CareTeamState): void {
  assertTransition(CARE_TEAM_STATE_TRANSITIONS, from, to, "care team");
}

// ---------------------------------------------------------------------------
// The aggregate + its entries.
// ---------------------------------------------------------------------------

/** One practitioner's place in a care team (ordered composition member). */
export interface CareTeamEntry {
  readonly practitionerId: PractitionerId;
  /** Optional role label from the frozen vocabulary. */
  readonly role?: CareTeamRole;
}

export function isCareTeamEntry(value: unknown): value is CareTeamEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CareTeamEntry, unknown>>;
  if (!isPractitionerId(candidate.practitionerId)) {
    return false;
  }
  if (candidate.role !== undefined && !isCareTeamRole(candidate.role)) {
    return false;
  }
  return true;
}

/** A person's care team (A45). */
export interface CareTeam {
  readonly personId: PersonId;
  readonly state: CareTeamState;
  /** Ordered composition (insertion order; the fold preserves it). */
  readonly entries: readonly CareTeamEntry[];
}

export function isCareTeam(value: unknown): value is CareTeam {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CareTeam, unknown>>;
  if (!isPersonId(candidate.personId)) {
    return false;
  }
  if (!isCareTeamState(candidate.state)) {
    return false;
  }
  if (!Array.isArray(candidate.entries)) {
    return false;
  }
  for (const entry of candidate.entries) {
    if (!isCareTeamEntry(entry)) {
      return false;
    }
  }
  return true;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link CareTeam}. Throws {@link DomainInvariantError} describing the
 * expected shape — received values are never echoed.
 */
export function assertCareTeam(candidate: unknown): asserts candidate is CareTeam {
  if (!isCareTeam(candidate)) {
    throw new DomainInvariantError(
      "Invalid care team: expected { personId, state, entries } with a canonical prsn_ person id, a legal care team state (forming|active|dissolved), and a list of entries { practitionerId, role? } with canonical pract_ ids and, where present, a role of primary-care|origin|consulting.",
    );
  }
}

/**
 * Creates an EMPTY care team in the `forming` state — the only constructor
 * this package exports. Activation happens exclusively through the first
 * `practitioner-added` change.
 */
export function newCareTeam(personId: PersonId): CareTeam {
  if (!isPersonId(personId)) {
    throw new DomainInvariantError(
      'Invalid person id: expected "prsn_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].',
    );
  }
  return { personId, state: "forming", entries: [] };
}

// ---------------------------------------------------------------------------
// Additive change events (discriminated union; each carries its audit).
// ---------------------------------------------------------------------------

export const CARE_TEAM_CHANGE_KINDS = [
  "practitioner-added",
  "practitioner-removed",
  "role-labeled",
  "care-team-dissolved",
] as const;

export type CareTeamChangeKind = (typeof CARE_TEAM_CHANGE_KINDS)[number];

export function isCareTeamChangeKind(value: unknown): value is CareTeamChangeKind {
  return (
    typeof value === "string" && (CARE_TEAM_CHANGE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * An additive care-team change event — also the audit record of the
 * change (who acted, when, which practitioner, which role). Never
 * constructed implicitly; applied only via {@link applyCareTeamChange}.
 */
export type CareTeamChange =
  | {
      readonly kind: "practitioner-added";
      readonly personId: PersonId;
      readonly practitionerId: PractitionerId;
      /** Role label applied at admission (optional). */
      readonly role?: CareTeamRole;
      /** When the change occurred. */
      readonly at: Date;
      /** Opaque actor label (who made the change — audit field). */
      readonly actor: string;
    }
  | {
      readonly kind: "practitioner-removed";
      readonly personId: PersonId;
      readonly practitionerId: PractitionerId;
      readonly at: Date;
      readonly actor: string;
    }
  | {
      readonly kind: "role-labeled";
      readonly personId: PersonId;
      readonly practitionerId: PractitionerId;
      readonly role: CareTeamRole;
      readonly at: Date;
      readonly actor: string;
    }
  | {
      readonly kind: "care-team-dissolved";
      readonly personId: PersonId;
      readonly at: Date;
      readonly actor: string;
    };

export function isCareTeamChange(value: unknown): value is CareTeamChange {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // keyof over the union yields only the shared fields, so the candidate
  // view spans every field any variant may carry.
  const candidate = value as Partial<
    Record<"kind" | "personId" | "practitionerId" | "role" | "at" | "actor", unknown>
  >;
  if (typeof candidate.kind !== "string") {
    return false;
  }
  switch (candidate.kind) {
    case "practitioner-added": {
      if (!isPractitionerId(candidate.practitionerId)) {
        return false;
      }
      if (candidate.role !== undefined && !isCareTeamRole(candidate.role)) {
        return false;
      }
      return isPersonId(candidate.personId) && isTimestamp(candidate.at) && isNonEmptyString(candidate.actor);
    }
    case "practitioner-removed": {
      if (!isPractitionerId(candidate.practitionerId)) {
        return false;
      }
      return isPersonId(candidate.personId) && isTimestamp(candidate.at) && isNonEmptyString(candidate.actor);
    }
    case "role-labeled": {
      if (!isPractitionerId(candidate.practitionerId)) {
        return false;
      }
      if (!isCareTeamRole(candidate.role)) {
        return false;
      }
      return isPersonId(candidate.personId) && isTimestamp(candidate.at) && isNonEmptyString(candidate.actor);
    }
    case "care-team-dissolved": {
      return isPersonId(candidate.personId) && isTimestamp(candidate.at) && isNonEmptyString(candidate.actor);
    }
    default:
      return false;
  }
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link CareTeamChange}. Throws {@link DomainInvariantError} describing
 * the expected shape — received values are never echoed.
 */
export function assertCareTeamChange(candidate: unknown): asserts candidate is CareTeamChange {
  if (!isCareTeamChange(candidate)) {
    throw new DomainInvariantError(
      'Invalid care-team change: expected one of the additive kinds (practitioner-added|practitioner-removed|role-labeled|care-team-dissolved) with a canonical prsn_ personId, a canonical pract_ practitionerId (except on dissolution), a role of primary-care|origin|consulting where the kind carries one, a valid timestamp, and a non-empty actor label.',
    );
  }
}

// ---------------------------------------------------------------------------
// The pure fold: additive events -> new team value (never silent mutation).
// ---------------------------------------------------------------------------

/**
 * Applies an additive {@link CareTeamChange} to a {@link CareTeam}.
 *
 * Preconditions (each violation throws {@link DomainInvariantError}):
 *   - the team and the change are structurally well-formed;
 *   - the change's personId matches the team's personId (a change never
 *     crosses persons);
 *   - the team is not `dissolved` (terminal: NO change of any kind — not
 *     even a duplicate dissolution — applies);
 *   - `practitioner-added`: the practitioner is not already on the team;
 *     a `forming` team atomically activates (asserting forming -> active);
 *   - `practitioner-removed`: the practitioner IS on the team;
 *   - `role-labeled`: the practitioner IS on the team;
 *   - `care-team-dissolved`: asserts the legal state transition to
 *     `dissolved`.
 *
 * Neither input is mutated: a NEW team value is returned. Entry order is
 * preserved (appends at the end; role replacement in place).
 */
export function applyCareTeamChange(team: CareTeam, change: CareTeamChange): CareTeam {
  assertCareTeam(team);
  assertCareTeamChange(change);
  if (change.personId !== team.personId) {
    throw new DomainInvariantError(
      "Illegal care-team change: the change targets a different person than the team.",
    );
  }
  if (team.state === "dissolved") {
    throw new DomainInvariantError(
      "Illegal care-team change: the team is dissolved (terminal — no change of any kind applies).",
    );
  }

  switch (change.kind) {
    case "practitioner-added": {
      if (team.entries.some((entry) => entry.practitionerId === change.practitionerId)) {
        throw new DomainInvariantError(
          "Illegal care-team change: the practitioner is already on the team.",
        );
      }
      const nextState: CareTeamState =
        team.state === "forming" ? "active" : team.state;
      if (team.state === "forming") {
        assertCareTeamTransition("forming", "active");
      }
      const entry: CareTeamEntry =
        change.role === undefined
          ? { practitionerId: change.practitionerId }
          : { practitionerId: change.practitionerId, role: change.role };
      return {
        ...team,
        state: nextState,
        entries: [...team.entries, entry],
      };
    }
    case "practitioner-removed": {
      if (!team.entries.some((entry) => entry.practitionerId === change.practitionerId)) {
        throw new DomainInvariantError(
          "Illegal care-team change: the practitioner is not on the team.",
        );
      }
      return {
        ...team,
        entries: team.entries.filter(
          (entry) => entry.practitionerId !== change.practitionerId,
        ),
      };
    }
    case "role-labeled": {
      const index = team.entries.findIndex(
        (entry) => entry.practitionerId === change.practitionerId,
      );
      if (index < 0) {
        throw new DomainInvariantError(
          "Illegal care-team change: the practitioner is not on the team.",
        );
      }
      const entries = [...team.entries];
      entries[index] = { practitionerId: change.practitionerId, role: change.role };
      return { ...team, entries };
    }
    case "care-team-dissolved": {
      assertCareTeamTransition(team.state, "dissolved");
      return { ...team, state: "dissolved" };
    }
  }
}
