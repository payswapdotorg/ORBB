import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "@orbb/domain";
import {
  CLINIC_STATES,
  CLINIC_STATE_TRANSITIONS,
  ORGANIZATION_STATES,
  ORGANIZATION_STATE_TRANSITIONS,
  allowedClinicTransitions,
  allowedOrganizationTransitions,
  assertClinic,
  assertClinicTransition,
  assertOrganization,
  assertOrganizationTransition,
  canTransitionClinic,
  canTransitionOrganization,
  isClinic,
  isClinicState,
  isOrganization,
  isOrganizationState,
  parseClinicState,
  parseOrganizationState,
  type Clinic,
  type ClinicState,
  type Organization,
  type OrganizationState,
} from "./organizations.js";
import { parseClinicId, parseOrganizationId } from "./ids.js";

const ORG_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const CLINIC_BODY = "22ccy6e8x2xq4n8v3m2k9qrstuv";

const ORG_ID = parseOrganizationId(`org_${ORG_BODY}`);
const CLINIC_ID = parseClinicId(`clin_${CLINIC_BODY}`);

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: ORG_ID,
    displayName: "Synth Community Health",
    state: "active",
    ...overrides,
  };
}

function makeClinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    id: CLINIC_ID,
    organizationId: ORG_ID,
    displayName: "Synth Riverside Clinic",
    state: "active",
    ...overrides,
  };
}

/**
 * Table-driven transition proofs — the kernel test pattern: every
 * (from, to) cell of the matrix is asserted against the frozen table,
 * illegal transitions throw, and terminal states have no successors.
 */
function transitionTableSuite<S extends string>(params: {
  label: string;
  states: readonly S[];
  table: Readonly<Record<S, readonly S[]>>;
  canTransition: (from: S, to: S) => boolean;
  assertTransition: (from: S, to: S) => void;
  allowed: (from: S) => readonly S[];
}): void {
  describe(params.label, () => {
    for (const from of params.states) {
      for (const to of params.states) {
        const legal = params.table[from].includes(to);
        it(`${from} -> ${to} is ${legal ? "LEGAL" : "illegal"}`, () => {
          expect(params.canTransition(from, to)).toBe(legal);
          if (legal) {
            expect(() => params.assertTransition(from, to)).not.toThrow();
          } else {
            expect(() => params.assertTransition(from, to)).toThrow(DomainInvariantError);
          }
        });
      }
      it(`${from} allows exactly ${params.table[from].join(", ") || "(terminal)"}`, () => {
        expect([...params.allowed(from)]).toEqual([...params.table[from]]);
      });
    }

    it("has at least one terminal state with no successors", () => {
      const terminals = params.states.filter(
        (state) => params.table[state].length === 0,
      );
      expect(terminals.length).toBeGreaterThanOrEqual(1);
      for (const terminal of terminals) {
        for (const to of params.states) {
          expect(params.canTransition(terminal, to)).toBe(false);
        }
      }
    });

    it("every state has a table entry (total function)", () => {
      for (const state of params.states) {
        expect(Array.isArray(params.table[state])).toBe(true);
      }
    });
  });
}

transitionTableSuite<OrganizationState>({
  label: "organization transition table (kernel pattern, table-driven)",
  states: ORGANIZATION_STATES,
  table: ORGANIZATION_STATE_TRANSITIONS,
  canTransition: canTransitionOrganization,
  assertTransition: assertOrganizationTransition,
  allowed: allowedOrganizationTransitions,
});

transitionTableSuite<ClinicState>({
  label: "clinic transition table (mirrors the organization grammar)",
  states: CLINIC_STATES,
  table: CLINIC_STATE_TRANSITIONS,
  canTransition: canTransitionClinic,
  assertTransition: assertClinicTransition,
  allowed: allowedClinicTransitions,
});

describe("organization and clinic state vocabularies", () => {
  it("the grammars are exactly active | suspended | dissolved", () => {
    expect(ORGANIZATION_STATES).toEqual(["active", "suspended", "dissolved"]);
    expect(CLINIC_STATES).toEqual(["active", "suspended", "dissolved"]);
  });

  it("dissolved is terminal; suspended is recoverable; active can dissolve directly", () => {
    expect(canTransitionOrganization("suspended", "active")).toBe(true);
    expect(canTransitionOrganization("suspended", "dissolved")).toBe(true);
    expect(canTransitionOrganization("active", "suspended")).toBe(true);
    expect(canTransitionOrganization("active", "dissolved")).toBe(true);
    expect(canTransitionOrganization("dissolved", "active")).toBe(false);
    expect(canTransitionClinic("dissolved", "suspended")).toBe(false);
    // No self-loops, no resurrection, no suspended -> suspended.
    expect(canTransitionOrganization("active", "active")).toBe(false);
    expect(canTransitionOrganization("suspended", "suspended")).toBe(false);
  });

  it("parses legal states and rejects unknown ones", () => {
    expect(parseOrganizationState("active")).toBe("active");
    expect(parseClinicState("suspended")).toBe("suspended");
    expect(isOrganizationState("dissolved")).toBe(true);
    expect(isClinicState("dissolved")).toBe(true);
    expect(isOrganizationState("deleted")).toBe(false);
    expect(isClinicState("")).toBe(false);
    expect(isOrganizationState(42)).toBe(false);
    expect(() => parseOrganizationState("closed")).toThrow(DomainInvariantError);
    expect(() => parseClinicState(null)).toThrow(DomainInvariantError);
  });
});

describe("organization structural guard", () => {
  it("accepts a well-formed organization", () => {
    const organization = makeOrganization();
    expect(isOrganization(organization)).toBe(true);
    expect(() => assertOrganization(organization)).not.toThrow();
  });

  it("rejects malformed organizations without echoing values", () => {
    expect(isOrganization({})).toBe(false);
    expect(isOrganization(null)).toBe(false);
    expect(isOrganization(makeOrganization({ id: `prsn_${ORG_BODY}` as never }))).toBe(false);
    expect(isOrganization(makeOrganization({ displayName: "" }))).toBe(false);
    expect(isOrganization(makeOrganization({ state: "closed" as never }))).toBe(false);
    expect(() => assertOrganization({ id: ORG_ID })).toThrow(DomainInvariantError);
    expect(() => assertOrganization(makeOrganization({ displayName: "" }))).toThrow(
      DomainInvariantError,
    );
  });
});

describe("clinic structural guard", () => {
  it("accepts a well-formed clinic and ties it to its owning organization", () => {
    const clinic = makeClinic();
    expect(isClinic(clinic)).toBe(true);
    expect(() => assertClinic(clinic)).not.toThrow();
    expect(clinic.organizationId).toBe(ORG_ID);
  });

  it("rejects malformed clinics (ids, owner, name, state)", () => {
    expect(isClinic({})).toBe(false);
    expect(isClinic(null)).toBe(false);
    expect(isClinic(makeClinic({ id: `org_${CLINIC_BODY}` as never }))).toBe(false);
    expect(isClinic(makeClinic({ organizationId: `clin_${CLINIC_BODY}` as never }))).toBe(false);
    expect(isClinic(makeClinic({ displayName: "" }))).toBe(false);
    expect(isClinic(makeClinic({ state: "forming" as never }))).toBe(false);
    expect(() => assertClinic({ id: CLINIC_ID })).toThrow(DomainInvariantError);
  });
});
