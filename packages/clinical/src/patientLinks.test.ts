import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError, parsePersonId } from "@orbb/domain";
import {
  PATIENT_LINK_ACTORS,
  PATIENT_LINK_CONFIRMATION_SOURCES,
  PATIENT_LINK_STATES,
  PATIENT_LINK_STATE_TRANSITIONS,
  allowedPatientLinkTransitions,
  assertPatientLink,
  assertPatientLinkTransition,
  canTransitionPatientLink,
  confirmPatientLink,
  declinePatientLink,
  isPatientLink,
  isPatientLinkActor,
  isPatientLinkConfirmationSource,
  isPatientLinkState,
  parsePatientLinkActor,
  parsePatientLinkConfirmationSource,
  parsePatientLinkState,
  requestPatientLink,
  revokePatientLink,
  type PatientLink,
} from "./patientLinks.js";
import { parsePractitionerId } from "./ids.js";

const PERSON_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const PRACT_BODY = "22ccy6e8x2xq4n8v3m2k9qrstuv";

const PERSON = parsePersonId(`prsn_${PERSON_BODY}`);
const PRACTITIONER = parsePractitionerId(`pract_${PRACT_BODY}`);

function makeLink(overrides: Partial<PatientLink> = {}): PatientLink {
  return {
    personId: PERSON,
    practitionerId: PRACTITIONER,
    state: "requested",
    requestedBy: "practitioner",
    ...overrides,
  };
}

/**
 * Table-driven transition proofs over the full patient-link state matrix
 * (the kernel test pattern).
 */
describe("patient link transition table (kernel pattern, table-driven)", () => {
  for (const from of PATIENT_LINK_STATES) {
    for (const to of PATIENT_LINK_STATES) {
      const legal = PATIENT_LINK_STATE_TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${legal ? "LEGAL" : "illegal"}`, () => {
        expect(canTransitionPatientLink(from, to)).toBe(legal);
        if (legal) {
          expect(() => assertPatientLinkTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertPatientLinkTransition(from, to)).toThrow(DomainInvariantError);
        }
      });
    }
    it(`${from} allows exactly ${PATIENT_LINK_STATE_TRANSITIONS[from].join(", ") || "(terminal)"}`, () => {
      expect([...allowedPatientLinkTransitions(from)]).toEqual([
        ...PATIENT_LINK_STATE_TRANSITIONS[from],
      ]);
    });
  }

  it("declined and revoked are terminal; requested is the only entry point", () => {
    expect(PATIENT_LINK_STATES).toEqual(["requested", "confirmed", "declined", "revoked"]);
    expect(PATIENT_LINK_STATE_TRANSITIONS.declined).toEqual([]);
    expect(PATIENT_LINK_STATE_TRANSITIONS.revoked).toEqual([]);
    for (const from of PATIENT_LINK_STATES) {
      if (from !== "requested") {
        expect(canTransitionPatientLink(from, "requested")).toBe(false);
      }
    }
    // A declined request can never quietly become confirmed.
    expect(canTransitionPatientLink("declined", "confirmed")).toBe(false);
    expect(canTransitionPatientLink("revoked", "confirmed")).toBe(false);
  });

  it("parses legal states and rejects unknown ones", () => {
    expect(parsePatientLinkState("confirmed")).toBe("confirmed");
    expect(isPatientLinkState("requested")).toBe(true);
    expect(isPatientLinkState("pending")).toBe(false);
    expect(isPatientLinkState(null)).toBe(false);
    expect(() => parsePatientLinkState("expired")).toThrow(DomainInvariantError);
  });
});

describe("the consent-shaped linking discipline", () => {
  it("a practitioner CAN request a link", () => {
    const link = requestPatientLink(PERSON, PRACTITIONER, "practitioner");
    expect(link.state).toBe("requested");
    expect(link.requestedBy).toBe("practitioner");
  });

  it("a person can also request (invitation-shaped)", () => {
    const link = requestPatientLink(PERSON, PRACTITIONER, "person");
    expect(link.requestedBy).toBe("person");
  });

  it("request validates ids and actors", () => {
    expect(() => requestPatientLink(`pract_${PERSON_BODY}` as never, PRACTITIONER, "person")).toThrow(
      DomainInvariantError,
    );
    expect(() => requestPatientLink(PERSON, `prsn_${PRACT_BODY}` as never, "person")).toThrow(
      DomainInvariantError,
    );
    expect(() =>
      requestPatientLink(PERSON, PRACTITIONER, "system" as never),
    ).toThrow(DomainInvariantError);
  });

  it("the person confirms; the invitation flow confirms; both are person-side only", () => {
    const byPerson = confirmPatientLink(makeLink(), "person");
    expect(byPerson.state).toBe("confirmed");
    const byInvitation = confirmPatientLink(makeLink(), "invitation");
    expect(byInvitation.state).toBe("confirmed");
  });

  it("the confirmation vocabulary contains NO practitioner word — never self-confirm", () => {
    expect(PATIENT_LINK_CONFIRMATION_SOURCES).toEqual(["person", "invitation"]);
    expectTypeOf<(typeof PATIENT_LINK_CONFIRMATION_SOURCES)[number]>().toEqualTypeOf<
      "person" | "invitation"
    >();
    expect(isPatientLinkConfirmationSource("practitioner")).toBe(false);
    expect(() => parsePatientLinkConfirmationSource("practitioner")).toThrow(
      DomainInvariantError,
    );
    expect(isPatientLinkConfirmationSource("person")).toBe(true);
  });

  it("confirmation is legal only from requested", () => {
    expect(() => confirmPatientLink(makeLink({ state: "confirmed" }), "person")).toThrow(
      DomainInvariantError,
    );
    expect(() => confirmPatientLink(makeLink({ state: "declined" }), "person")).toThrow(
      DomainInvariantError,
    );
    expect(() => confirmPatientLink(makeLink({ state: "revoked" }), "invitation")).toThrow(
      DomainInvariantError,
    );
  });

  it("decline is person-side, legal only from requested, and terminal", () => {
    const declined = declinePatientLink(makeLink(), "person");
    expect(declined.state).toBe("declined");
    expect(() => declinePatientLink(declined, "person")).toThrow(DomainInvariantError);
    expect(() => declinePatientLink(makeLink({ state: "confirmed" }), "person")).toThrow(
      DomainInvariantError,
    );
  });

  it("revocation is person-side, legal only from confirmed, and terminal", () => {
    const confirmed = confirmPatientLink(makeLink(), "person");
    const revoked = revokePatientLink(confirmed, "person");
    expect(revoked.state).toBe("revoked");
    expect(() => revokePatientLink(revoked, "person")).toThrow(DomainInvariantError);
    expect(() => revokePatientLink(makeLink(), "person")).toThrow(DomainInvariantError);
  });

  it("an invalid confirmation source is rejected before any transition applies", () => {
    expect(() => confirmPatientLink(makeLink(), "practitioner" as never)).toThrow(
      DomainInvariantError,
    );
    expect(() => declinePatientLink(makeLink(), "system" as never)).toThrow(
      DomainInvariantError,
    );
    expect(() => revokePatientLink(makeLink({ state: "confirmed" }), null as never)).toThrow(
      DomainInvariantError,
    );
  });

  it("actions are pure — inputs are never mutated", () => {
    const requested = makeLink();
    confirmPatientLink(requested, "person");
    expect(requested.state).toBe("requested");
  });
});

describe("patient link structural guard + actor vocabulary", () => {
  it("accepts a well-formed link", () => {
    const link = makeLink();
    expect(isPatientLink(link)).toBe(true);
    expect(() => assertPatientLink(link)).not.toThrow();
  });

  it("rejects malformed links (ids, state, actor)", () => {
    expect(isPatientLink({})).toBe(false);
    expect(isPatientLink(null)).toBe(false);
    expect(isPatientLink(makeLink({ personId: `pract_${PERSON_BODY}` as never }))).toBe(false);
    expect(isPatientLink(makeLink({ practitionerId: `prsn_${PRACT_BODY}` as never }))).toBe(false);
    expect(isPatientLink(makeLink({ state: "pending" as never }))).toBe(false);
    expect(isPatientLink(makeLink({ requestedBy: "system" as never }))).toBe(false);
    expect(() => assertPatientLink({ personId: PERSON })).toThrow(DomainInvariantError);
  });

  it("the actor vocabulary is exactly person | practitioner", () => {
    expect(PATIENT_LINK_ACTORS).toEqual(["person", "practitioner"]);
    expect(isPatientLinkActor("person")).toBe(true);
    expect(isPatientLinkActor("practitioner")).toBe(true);
    expect(isPatientLinkActor("service")).toBe(false);
    expect(() => parsePatientLinkActor("admin")).toThrow(DomainInvariantError);
    expect(parsePatientLinkActor("person")).toBe("person");
  });

  it("the full lifecycle: practitioner requests, person confirms, person revokes", () => {
    let link = requestPatientLink(PERSON, PRACTITIONER, "practitioner");
    expect(link.state).toBe("requested");
    link = confirmPatientLink(link, "person");
    expect(link.state).toBe("confirmed");
    link = revokePatientLink(link, "person");
    expect(link.state).toBe("revoked");
    // A fresh request after revocation is a NEW link value, never a
    // resurrection of the terminal one.
    const fresh = requestPatientLink(PERSON, PRACTITIONER, "person");
    expect(fresh.state).toBe("requested");
    expect(() => confirmPatientLink(link, "person")).toThrow(DomainInvariantError);
  });
});
