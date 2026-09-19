import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError, parsePersonId, type PersonId } from "@orbb/domain";
import {
  CARE_TEAM_CHANGE_KINDS,
  CARE_TEAM_ROLES,
  CARE_TEAM_STATES,
  CARE_TEAM_STATE_TRANSITIONS,
  allowedCareTeamTransitions,
  applyCareTeamChange,
  assertCareTeam,
  assertCareTeamChange,
  assertCareTeamTransition,
  canTransitionCareTeam,
  isCareTeam,
  isCareTeamChange,
  isCareTeamChangeKind,
  isCareTeamEntry,
  isCareTeamRole,
  isCareTeamState,
  newCareTeam,
  parseCareTeamRole,
  parseCareTeamState,
  type CareTeamChange,
  type CareTeamRole,
} from "./careTeams.js";
import { parsePractitionerId, type PractitionerId } from "./ids.js";

const PERSON_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const PRACT_A_BODY = "22ccy6e8x2xq4n8v3m2k9qrstuv";
const PRACT_B_BODY = "33ddy6e8x2xq4n8v3m2k9wxyzab";

const PERSON = parsePersonId(`prsn_${PERSON_BODY}`);
const OTHER_PERSON: PersonId = parsePersonId(`prsn_${"44ee" + PRACT_A_BODY.slice(4)}`);
const PRACT_A: PractitionerId = parsePractitionerId(`pract_${PRACT_A_BODY}`);
const PRACT_B: PractitionerId = parsePractitionerId(`pract_${PRACT_B_BODY}`);

const AT = new Date("2025-06-01T12:00:00.000Z");
const ACTOR = "person";

function added(practitionerId: PractitionerId, role?: CareTeamRole): CareTeamChange {
  return role === undefined
    ? { kind: "practitioner-added", personId: PERSON, practitionerId, at: AT, actor: ACTOR }
    : {
        kind: "practitioner-added",
        personId: PERSON,
        practitionerId,
        role,
        at: AT,
        actor: ACTOR,
      };
}

function removed(practitionerId: PractitionerId): CareTeamChange {
  return { kind: "practitioner-removed", personId: PERSON, practitionerId, at: AT, actor: ACTOR };
}

function labeled(practitionerId: PractitionerId, role: CareTeamRole): CareTeamChange {
  return { kind: "role-labeled", personId: PERSON, practitionerId, role, at: AT, actor: ACTOR };
}

function dissolved(): CareTeamChange {
  return { kind: "care-team-dissolved", personId: PERSON, at: AT, actor: ACTOR };
}

/**
 * Table-driven transition proofs over the full care-team state matrix
 * (the kernel test pattern).
 */
describe("care team transition table (kernel pattern, table-driven)", () => {
  for (const from of CARE_TEAM_STATES) {
    for (const to of CARE_TEAM_STATES) {
      const legal = CARE_TEAM_STATE_TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${legal ? "LEGAL" : "illegal"}`, () => {
        expect(canTransitionCareTeam(from, to)).toBe(legal);
        if (legal) {
          expect(() => assertCareTeamTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertCareTeamTransition(from, to)).toThrow(DomainInvariantError);
        }
      });
    }
    it(`${from} allows exactly ${CARE_TEAM_STATE_TRANSITIONS[from].join(", ") || "(terminal)"}`, () => {
      expect([...allowedCareTeamTransitions(from)]).toEqual([
        ...CARE_TEAM_STATE_TRANSITIONS[from],
      ]);
    });
  }

  it("dissolved is terminal; forming activates; active only dissolves", () => {
    expect(CARE_TEAM_STATES).toEqual(["forming", "active", "dissolved"]);
    expect(CARE_TEAM_STATE_TRANSITIONS.dissolved).toEqual([]);
    expect(canTransitionCareTeam("forming", "active")).toBe(true);
    expect(canTransitionCareTeam("forming", "dissolved")).toBe(true);
    expect(canTransitionCareTeam("active", "forming")).toBe(false);
    expect(canTransitionCareTeam("active", "active")).toBe(false);
  });

  it("parses legal states and rejects unknown ones", () => {
    expect(parseCareTeamState("active")).toBe("active");
    expect(isCareTeamState("forming")).toBe(true);
    expect(isCareTeamState("archived")).toBe(false);
    expect(isCareTeamState(42)).toBe(false);
    expect(() => parseCareTeamState("closed")).toThrow(DomainInvariantError);
  });
});

describe("care-team role vocabulary (frozen)", () => {
  it("is exactly primary-care | origin | consulting", () => {
    expect(CARE_TEAM_ROLES).toEqual(["primary-care", "origin", "consulting"]);
    expectTypeOf<(typeof CARE_TEAM_ROLES)[number]>().toEqualTypeOf<
      "primary-care" | "origin" | "consulting"
    >();
    expect(isCareTeamRole("primary-care")).toBe(true);
    expect(isCareTeamRole("origin")).toBe(true);
    expect(isCareTeamRole("consulting")).toBe(true);
    expect(isCareTeamRole("attending")).toBe(false);
    expect(isCareTeamRole("")).toBe(false);
    expect(() => parseCareTeamRole("supervising")).toThrow(DomainInvariantError);
    expect(parseCareTeamRole("origin")).toBe("origin");
  });
});

describe("care team structural guard + constructor", () => {
  it("newCareTeam mints an EMPTY forming team", () => {
    const team = newCareTeam(PERSON);
    expect(team.state).toBe("forming");
    expect(team.entries).toEqual([]);
    expect(isCareTeam(team)).toBe(true);
    expect(() => assertCareTeam(team)).not.toThrow();
  });

  it("rejects a malformed person id at construction", () => {
    expect(() => newCareTeam(`pract_${PERSON_BODY}` as never)).toThrow(DomainInvariantError);
  });

  it("rejects malformed teams and entries", () => {
    expect(isCareTeam({})).toBe(false);
    expect(isCareTeam(null)).toBe(false);
    expect(
      isCareTeam({ personId: PERSON, state: "active", entries: "none" as never }),
    ).toBe(false);
    expect(
      isCareTeam({
        personId: PERSON,
        state: "active",
        entries: [{ practitionerId: `prsn_${PRACT_A_BODY}` }],
      }),
    ).toBe(false);
    expect(
      isCareTeam({
        personId: PERSON,
        state: "active",
        entries: [{ practitionerId: PRACT_A, role: "attending" as never }],
      }),
    ).toBe(false);
    expect(isCareTeamEntry({ practitionerId: PRACT_A })).toBe(true);
    expect(isCareTeamEntry({ practitionerId: PRACT_A, role: "origin" })).toBe(true);
    expect(isCareTeamEntry({})).toBe(false);
    expect(() => assertCareTeam(null)).toThrow(DomainInvariantError);
  });
});

describe("the additive fold — changes are events with audit fields, never silent mutation", () => {
  it("adding the first practitioner ACTIVATES a forming team", () => {
    const team = applyCareTeamChange(newCareTeam(PERSON), added(PRACT_A));
    expect(team.state).toBe("active");
    expect(team.entries.map((entry) => entry.practitionerId)).toEqual([PRACT_A]);
  });

  it("adding more practitioners preserves insertion order", () => {
    let team = newCareTeam(PERSON);
    team = applyCareTeamChange(team, added(PRACT_A));
    team = applyCareTeamChange(team, added(PRACT_B));
    expect(team.entries.map((entry) => entry.practitionerId)).toEqual([PRACT_A, PRACT_B]);
  });

  it("a role label can be applied at admission", () => {
    const team = applyCareTeamChange(newCareTeam(PERSON), added(PRACT_A, "primary-care"));
    expect(team.entries[0]?.role).toBe("primary-care");
  });

  it("role-labeled replaces the label IN PLACE (position preserved)", () => {
    let team = newCareTeam(PERSON);
    team = applyCareTeamChange(team, added(PRACT_A, "consulting"));
    team = applyCareTeamChange(team, added(PRACT_B));
    team = applyCareTeamChange(team, labeled(PRACT_A, "primary-care"));
    expect(team.entries.map((entry) => entry.practitionerId)).toEqual([PRACT_A, PRACT_B]);
    expect(team.entries[0]?.role).toBe("primary-care");
    expect(team.entries[1]?.role).toBeUndefined();
  });

  it("removal preserves the order of the remaining entries", () => {
    let team = newCareTeam(PERSON);
    team = applyCareTeamChange(team, added(PRACT_A));
    team = applyCareTeamChange(team, added(PRACT_B));
    team = applyCareTeamChange(team, removed(PRACT_A));
    expect(team.entries.map((entry) => entry.practitionerId)).toEqual([PRACT_B]);
    expect(team.state).toBe("active");
  });

  it("removing the last practitioner leaves the team active (empty is legal)", () => {
    let team = newCareTeam(PERSON);
    team = applyCareTeamChange(team, added(PRACT_A));
    team = applyCareTeamChange(team, removed(PRACT_A));
    expect(team.entries).toEqual([]);
    expect(team.state).toBe("active");
  });

  it("dissolution is legal from forming and from active; dissolved is TERMINAL for every kind", () => {
    const fromForming = applyCareTeamChange(newCareTeam(PERSON), dissolved());
    expect(fromForming.state).toBe("dissolved");

    let team = newCareTeam(PERSON);
    team = applyCareTeamChange(team, added(PRACT_A));
    team = applyCareTeamChange(team, dissolved());
    expect(team.state).toBe("dissolved");
    expect(team.entries.map((entry) => entry.practitionerId)).toEqual([PRACT_A]);

    for (const change of [
      added(PRACT_B),
      removed(PRACT_A),
      labeled(PRACT_A, "origin"),
      dissolved(),
    ]) {
      expect(() => applyCareTeamChange(team, change)).toThrow(DomainInvariantError);
    }
  });

  it("duplicate adds, unknown removals, and unknown labels throw", () => {
    let team = newCareTeam(PERSON);
    team = applyCareTeamChange(team, added(PRACT_A));
    expect(() => applyCareTeamChange(team, added(PRACT_A))).toThrow(DomainInvariantError);
    expect(() => applyCareTeamChange(team, removed(PRACT_B))).toThrow(DomainInvariantError);
    expect(() => applyCareTeamChange(team, labeled(PRACT_B, "origin"))).toThrow(
      DomainInvariantError,
    );
  });

  it("a change never crosses persons", () => {
    const foreign: CareTeamChange = {
      kind: "practitioner-added",
      personId: OTHER_PERSON,
      practitionerId: PRACT_A,
      at: AT,
      actor: ACTOR,
    };
    expect(() => applyCareTeamChange(newCareTeam(PERSON), foreign)).toThrow(
      DomainInvariantError,
    );
  });

  it("the fold is pure — inputs are never mutated", () => {
    const team = newCareTeam(PERSON);
    const afterAdd = applyCareTeamChange(team, added(PRACT_A));
    expect(team.entries).toEqual([]);
    expect(team.state).toBe("forming");
    const afterRemove = applyCareTeamChange(afterAdd, removed(PRACT_A));
    expect(afterAdd.entries.map((entry) => entry.practitionerId)).toEqual([PRACT_A]);
    expect(afterRemove.entries).toEqual([]);
  });

  it("the change record IS the audit record (who/when/which practitioner/which role)", () => {
    const change = added(PRACT_A, "origin");
    expect(change.at).toBe(AT);
    expect(change.actor).toBe(ACTOR);
    expect(isCareTeamChange(change)).toBe(true);
    expect(() => assertCareTeamChange(change)).not.toThrow();
  });
});

describe("care-team change kinds + structural guard", () => {
  it("the change-kind vocabulary is frozen and complete", () => {
    expect(CARE_TEAM_CHANGE_KINDS).toEqual([
      "practitioner-added",
      "practitioner-removed",
      "role-labeled",
      "care-team-dissolved",
    ]);
    expect(isCareTeamChangeKind("practitioner-added")).toBe(true);
    expect(isCareTeamChangeKind("practitioner-invited")).toBe(false);
  });

  it("role-labeled REQUIRES a role; the other kinds must not carry a bogus one structurally", () => {
    expect(isCareTeamChange(labeled(PRACT_A, "origin"))).toBe(true);
    expect(
      isCareTeamChange({
        kind: "role-labeled",
        personId: PERSON,
        practitionerId: PRACT_A,
        at: AT,
        actor: ACTOR,
      }),
    ).toBe(false);
    expect(isCareTeamChange(added(PRACT_A, "attending" as never))).toBe(false);
  });

  it("dissolution changes carry no practitioner; the others require one", () => {
    expect(isCareTeamChange(dissolved())).toBe(true);
    expect(
      isCareTeamChange({
        kind: "care-team-dissolved",
        personId: PERSON,
        practitionerId: PRACT_A,
        at: AT,
        actor: ACTOR,
      }),
    ).toBe(true);
    expect(
      isCareTeamChange({
        kind: "practitioner-removed",
        personId: PERSON,
        at: AT,
        actor: ACTOR,
      }),
    ).toBe(false);
  });

  it("rejects malformed changes (person, practitioner, timestamp, actor, kind)", () => {
    expect(isCareTeamChange({})).toBe(false);
    expect(isCareTeamChange(null)).toBe(false);
    expect(isCareTeamChange({ kind: "unknown", personId: PERSON, at: AT, actor: ACTOR })).toBe(
      false,
    );
    expect(
      isCareTeamChange({
        kind: "practitioner-added",
        personId: `pract_${PERSON_BODY}`,
        practitionerId: PRACT_A,
        at: AT,
        actor: ACTOR,
      }),
    ).toBe(false);
    expect(
      isCareTeamChange({
        kind: "practitioner-added",
        personId: PERSON,
        practitionerId: PRACT_A,
        at: new Date("not-a-date"),
        actor: ACTOR,
      }),
    ).toBe(false);
    expect(
      isCareTeamChange({
        kind: "practitioner-added",
        personId: PERSON,
        practitionerId: PRACT_A,
        at: AT,
        actor: "",
      }),
    ).toBe(false);
    expect(() => assertCareTeamChange({ kind: "nope" })).toThrow(DomainInvariantError);
  });
});
