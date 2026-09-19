import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError } from "@orbb/domain";
import {
  PRACTITIONER_ROLES,
  PRACTITIONER_STATES,
  PRACTITIONER_STATE_TRANSITIONS,
  allowedPractitionerTransitions,
  assertPractitioner,
  assertPractitionerClinicAffiliation,
  assertPractitionerOrganizationMembership,
  assertPractitionerTransition,
  assertPractitionerVerification,
  canTransitionPractitioner,
  isPractitioner,
  isPractitionerClinicAffiliation,
  isPractitionerOrganizationMembership,
  isPractitionerRole,
  isPractitionerState,
  isPractitionerVerification,
  newPractitioner,
  parsePractitionerRole,
  parsePractitionerState,
  suspendPractitioner,
  verifyPractitioner,
  type Practitioner,
  type PractitionerVerification,
} from "./practitioners.js";
import { parseClinicId, parseOrganizationId, parsePractitionerId } from "./ids.js";

const PRACT_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const ORG_BODY = "22ccy6e8x2xq4n8v3m2k9qrstuv";
const CLINIC_BODY = "33ddy6e8x2xq4n8v3m2k9wxyzab";

const PRACT_ID = parsePractitionerId(`pract_${PRACT_BODY}`);
const ORG_ID = parseOrganizationId(`org_${ORG_BODY}`);
const CLINIC_ID = parseClinicId(`clin_${CLINIC_BODY}`);

const VERIFICATION: PractitionerVerification = {
  verifiedBy: "synth-credentialing-authority",
  evidence: "synth-license-check",
  at: new Date("2025-06-01T12:00:00.000Z"),
};

function makePractitioner(overrides: Partial<Practitioner> = {}): Practitioner {
  return {
    id: PRACT_ID,
    displayName: "Dr. Synth Practitioner",
    state: "unverified",
    ...overrides,
  };
}

/**
 * Table-driven transition proofs over the full practitioner state matrix
 * (the kernel test pattern).
 */
describe("practitioner transition table (kernel pattern, table-driven)", () => {
  for (const from of PRACTITIONER_STATES) {
    for (const to of PRACTITIONER_STATES) {
      const legal = PRACTITIONER_STATE_TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${legal ? "LEGAL" : "illegal"}`, () => {
        expect(canTransitionPractitioner(from, to)).toBe(legal);
        if (legal) {
          expect(() => assertPractitionerTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertPractitionerTransition(from, to)).toThrow(DomainInvariantError);
        }
      });
    }
    it(`${from} allows exactly ${PRACTITIONER_STATE_TRANSITIONS[from].join(", ")}`, () => {
      expect([...allowedPractitionerTransitions(from)]).toEqual([
        ...PRACTITIONER_STATE_TRANSITIONS[from],
      ]);
    });
  }

  it("the grammar is exactly the four recorded states", () => {
    expect(PRACTITIONER_STATES).toEqual([
      "unverified",
      "verified",
      "suspended-from-verified",
      "reverified",
    ]);
  });

  it("verification is the ONLY way out of unverified", () => {
    expect(PRACTITIONER_STATE_TRANSITIONS.unverified).toEqual(["verified"]);
  });

  it("suspension is reachable only from verified/reverified status", () => {
    expect(canTransitionPractitioner("unverified", "suspended-from-verified")).toBe(false);
    expect(canTransitionPractitioner("verified", "suspended-from-verified")).toBe(true);
    expect(canTransitionPractitioner("reverified", "suspended-from-verified")).toBe(true);
    expect(canTransitionPractitioner("suspended-from-verified", "suspended-from-verified")).toBe(
      false,
    );
  });

  it("there is deliberately no terminal state (reverification is always possible)", () => {
    const terminals = PRACTITIONER_STATES.filter(
      (state) => PRACTITIONER_STATE_TRANSITIONS[state].length === 0,
    );
    expect(terminals).toEqual([]);
  });
});

describe("practitioner structural guard + constructor", () => {
  it("newPractitioner mints ONLY unverified practitioners", () => {
    const practitioner = newPractitioner(PRACT_ID, "Dr. Synth Practitioner");
    expect(practitioner.state).toBe("unverified");
    expect(isPractitioner(practitioner)).toBe(true);
    expect(() => assertPractitioner(practitioner)).not.toThrow();
  });

  it("rejects malformed practitioners and constructor arguments", () => {
    expect(isPractitioner({})).toBe(false);
    expect(isPractitioner(null)).toBe(false);
    expect(isPractitioner(makePractitioner({ id: `prsn_${PRACT_BODY}` as never }))).toBe(false);
    expect(isPractitioner(makePractitioner({ displayName: "" }))).toBe(false);
    expect(isPractitioner(makePractitioner({ state: "verified-" as never }))).toBe(false);
    expect(() => newPractitioner(`prsn_${PRACT_BODY}` as never, "Dr. X")).toThrow(
      DomainInvariantError,
    );
    expect(() => newPractitioner(PRACT_ID, "")).toThrow(DomainInvariantError);
    expect(() => assertPractitioner({ id: PRACT_ID })).toThrow(DomainInvariantError);
  });

  it("parses legal states and rejects unknown ones", () => {
    expect(parsePractitionerState("verified")).toBe("verified");
    expect(isPractitionerState("unverified")).toBe(true);
    expect(isPractitionerState("verified")).toBe(true);
    expect(isPractitionerState("suspended")).toBe(false);
    expect(isPractitionerState(42)).toBe(false);
    expect(() => parsePractitionerState("licensed")).toThrow(DomainInvariantError);
  });
});

describe("the explicit verification step (never implied)", () => {
  it("verifies an unverified practitioner -> verified", () => {
    const verified = verifyPractitioner(makePractitioner(), VERIFICATION);
    expect(verified.state).toBe("verified");
    expect(verified.id).toBe(PRACT_ID);
  });

  it("reverifies a suspended practitioner -> reverified", () => {
    const suspended = suspendPractitioner(makePractitioner({ state: "verified" }));
    expect(suspended.state).toBe("suspended-from-verified");
    const reverified = verifyPractitioner(suspended, VERIFICATION);
    expect(reverified.state).toBe("reverified");
  });

  it("round-trips the full verification lifecycle", () => {
    let practitioner = newPractitioner(PRACT_ID, "Dr. Synth Practitioner");
    practitioner = verifyPractitioner(practitioner, VERIFICATION);
    expect(practitioner.state).toBe("verified");
    practitioner = suspendPractitioner(practitioner);
    expect(practitioner.state).toBe("suspended-from-verified");
    practitioner = verifyPractitioner(practitioner, VERIFICATION);
    expect(practitioner.state).toBe("reverified");
    practitioner = suspendPractitioner(practitioner);
    expect(practitioner.state).toBe("suspended-from-verified");
  });

  it("refuses to verify an already-verified or reverified practitioner", () => {
    expect(() => verifyPractitioner(makePractitioner({ state: "verified" }), VERIFICATION)).toThrow(
      DomainInvariantError,
    );
    expect(() =>
      verifyPractitioner(makePractitioner({ state: "reverified" }), VERIFICATION),
    ).toThrow(DomainInvariantError);
  });

  it("refuses to suspend an unverified or already-suspended practitioner", () => {
    expect(() => suspendPractitioner(makePractitioner())).toThrow(DomainInvariantError);
    expect(() =>
      suspendPractitioner(makePractitioner({ state: "suspended-from-verified" })),
    ).toThrow(DomainInvariantError);
  });

  it("the verification record is labels-only SYNTH vocabulary", () => {
    expect(() =>
      verifyPractitioner(makePractitioner(), { ...VERIFICATION, verifiedBy: "" }),
    ).toThrow(DomainInvariantError);
    expect(() =>
      verifyPractitioner(makePractitioner(), { ...VERIFICATION, evidence: "" }),
    ).toThrow(DomainInvariantError);
    expect(() =>
      verifyPractitioner(makePractitioner(), {
        ...VERIFICATION,
        at: new Date("not-a-date"),
      }),
    ).toThrow(DomainInvariantError);
    expect(isPractitionerVerification(VERIFICATION)).toBe(true);
    expect(isPractitionerVerification({ verifiedBy: "x" })).toBe(false);
    expect(() => assertPractitionerVerification({ verifiedBy: "x" })).toThrow(
      DomainInvariantError,
    );
  });

  it("verification never mutates the input (pure step)", () => {
    const original = makePractitioner();
    verifyPractitioner(original, VERIFICATION);
    expect(original.state).toBe("unverified");
  });
});

describe("membership role vocabulary (frozen)", () => {
  it("is exactly member | admin | owner", () => {
    expect(PRACTITIONER_ROLES).toEqual(["member", "admin", "owner"]);
    expectTypeOf<(typeof PRACTITIONER_ROLES)[number]>().toEqualTypeOf<
      "member" | "admin" | "owner"
    >();
  });

  it("accepts the frozen roles, rejects everything else", () => {
    expect(isPractitionerRole("member")).toBe(true);
    expect(isPractitionerRole("admin")).toBe(true);
    expect(isPractitionerRole("owner")).toBe(true);
    expect(isPractitionerRole("superuser")).toBe(false);
    expect(isPractitionerRole("")).toBe(false);
    expect(isPractitionerRole(1)).toBe(false);
    expect(() => parsePractitionerRole("chief")).toThrow(DomainInvariantError);
    expect(parsePractitionerRole("owner")).toBe("owner");
  });
});

describe("membership aggregates", () => {
  it("accepts a well-formed organization membership", () => {
    const membership = {
      practitionerId: PRACT_ID,
      organizationId: ORG_ID,
      role: "member",
      active: true,
    } as const;
    expect(isPractitionerOrganizationMembership(membership)).toBe(true);
    expect(() => assertPractitionerOrganizationMembership(membership)).not.toThrow();
  });

  it("rejects malformed organization memberships", () => {
    expect(isPractitionerOrganizationMembership({})).toBe(false);
    expect(isPractitionerOrganizationMembership(null)).toBe(false);
    expect(
      isPractitionerOrganizationMembership({
        practitionerId: `org_${PRACT_BODY}`,
        organizationId: ORG_ID,
        role: "member",
        active: true,
      }),
    ).toBe(false);
    expect(
      isPractitionerOrganizationMembership({
        practitionerId: PRACT_ID,
        organizationId: `pract_${ORG_BODY}`,
        role: "member",
        active: true,
      }),
    ).toBe(false);
    expect(
      isPractitionerOrganizationMembership({
        practitionerId: PRACT_ID,
        organizationId: ORG_ID,
        role: "superuser",
        active: true,
      }),
    ).toBe(false);
    expect(
      isPractitionerOrganizationMembership({
        practitionerId: PRACT_ID,
        organizationId: ORG_ID,
        role: "member",
        active: "yes",
      }),
    ).toBe(false);
    expect(() =>
      assertPractitionerOrganizationMembership({ practitionerId: PRACT_ID }),
    ).toThrow(DomainInvariantError);
  });

  it("accepts a well-formed clinic affiliation and rejects malformed ones", () => {
    const affiliation = {
      practitionerId: PRACT_ID,
      clinicId: CLINIC_ID,
      role: "admin",
      active: true,
    } as const;
    expect(isPractitionerClinicAffiliation(affiliation)).toBe(true);
    expect(() => assertPractitionerClinicAffiliation(affiliation)).not.toThrow();

    expect(isPractitionerClinicAffiliation({})).toBe(false);
    expect(
      isPractitionerClinicAffiliation({
        practitionerId: PRACT_ID,
        clinicId: `org_${CLINIC_BODY}`,
        role: "admin",
        active: true,
      }),
    ).toBe(false);
    expect(
      isPractitionerClinicAffiliation({
        practitionerId: PRACT_ID,
        clinicId: CLINIC_ID,
        role: "member",
        active: false,
      }),
    ).toBe(true);
    expect(() => assertPractitionerClinicAffiliation(null)).toThrow(DomainInvariantError);
  });
});
