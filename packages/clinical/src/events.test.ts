import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError, parsePersonId } from "@orbb/domain";
import {
  CLINICAL_EVENT_ID_PREFIX,
  CLINICAL_EVENT_TYPES,
  assertClinicalEventEnvelope,
  isClinicalEventEnvelope,
  isClinicalEventId,
  isClinicalEventType,
  parseClinicalEventId,
  parseClinicalEventType,
  type ClinicalEventEnvelope,
} from "./events.js";

const PERSON_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const EVENT_BODY = "22ccy6e8x2xq4n8v3m2k9qrstuv";

const SUBJECT = parsePersonId(`prsn_${PERSON_BODY}`);
const OCCURRED_AT = new Date("2025-06-01T12:00:00.000Z");

function makeEnvelope(overrides: Partial<ClinicalEventEnvelope> = {}): ClinicalEventEnvelope {
  return {
    eventId: parseClinicalEventId(`cevt_${EVENT_BODY}`),
    type: "PATIENT_LINK_CONFIRMED",
    version: 1,
    occurredAt: OCCURRED_AT,
    actor: SUBJECT,
    subject: SUBJECT,
    payloadSchemaVersion: "1.0.0",
    ...overrides,
  };
}

describe("clinical event id (contracts-mirror grammar)", () => {
  it("parses a canonical cevt_ id", () => {
    expect(parseClinicalEventId(`cevt_${EVENT_BODY}`)).toBe(`cevt_${EVENT_BODY}`);
    expect(isClinicalEventId(`cevt_${EVENT_BODY}`)).toBe(true);
    expect(CLINICAL_EVENT_ID_PREFIX).toBe("cevt");
  });

  it("rejects malformed ids and foreign prefixes", () => {
    expect(() => parseClinicalEventId("cevt_short")).toThrow(DomainInvariantError);
    expect(() => parseClinicalEventId("cevt_")).toThrow(DomainInvariantError);
    expect(() => parseClinicalEventId(`evt_${EVENT_BODY}`)).toThrow(DomainInvariantError);
    expect(() => parseClinicalEventId(`prsn_${EVENT_BODY}`)).toThrow(DomainInvariantError);
    expect(isClinicalEventId(`evt_${EVENT_BODY}`)).toBe(false);
    expect(isClinicalEventId(42)).toBe(false);
  });
});

describe("clinical event type vocabulary (frozen in-package mirror of contracts)", () => {
  it("contains exactly the recorded clinical state changes + evaluation events", () => {
    expect(CLINICAL_EVENT_TYPES).toEqual([
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
    ]);
    expect(new Set(CLINICAL_EVENT_TYPES).size).toBe(CLINICAL_EVENT_TYPES.length);
  });

  it("the work order's three example events are present verbatim", () => {
    for (const type of ["PATIENT_LINK_CONFIRMED", "CARE_TEAM_CHANGED", "PRACTITIONER_VERIFIED"]) {
      expect(CLINICAL_EVENT_TYPES).toContain(type);
    }
  });

  it("guards and parses the vocabulary", () => {
    expect(isClinicalEventType("CARE_TEAM_CHANGED")).toBe(true);
    expect(isClinicalEventType("CLINIC_DISSOLVED")).toBe(true);
    expect(isClinicalEventType("PATIENT_LINK_DELETED")).toBe(false);
    expect(isClinicalEventType(42)).toBe(false);
    expect(() => parseClinicalEventType("unknown")).toThrow(DomainInvariantError);
    expect(parseClinicalEventType("PRACTITIONER_VERIFIED")).toBe("PRACTITIONER_VERIFIED");
    expectTypeOf<(typeof CLINICAL_EVENT_TYPES)[number]>().not.toBeNever();
  });
});

describe("clinical event envelope (§11 field list, contracts-mirrored)", () => {
  it("accepts a well-formed envelope", () => {
    const envelope = makeEnvelope();
    expect(isClinicalEventEnvelope(envelope)).toBe(true);
    expect(() => assertClinicalEventEnvelope(envelope)).not.toThrow();
  });

  it("accepts optional correlation/causation tokens when non-empty", () => {
    const envelope = makeEnvelope({ correlationId: "corr-token-1", causationId: "cause-1" });
    expect(isClinicalEventEnvelope(envelope)).toBe(true);
  });

  it("rejects malformed envelopes field by field", () => {
    expect(isClinicalEventEnvelope({})).toBe(false);
    expect(isClinicalEventEnvelope(null)).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ eventId: `evt_${EVENT_BODY}` as never }))).toBe(
      false,
    );
    expect(isClinicalEventEnvelope(makeEnvelope({ type: "unknown" as never }))).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ version: 0 }))).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ version: 1.5 }))).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ occurredAt: new Date("nope") }))).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ actor: "not-an-actor" as never }))).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ subject: `pract_${PERSON_BODY}` as never }))).toBe(
      false,
    );
    expect(isClinicalEventEnvelope(makeEnvelope({ correlationId: "" }))).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ causationId: "" }))).toBe(false);
    expect(isClinicalEventEnvelope(makeEnvelope({ payloadSchemaVersion: "" }))).toBe(false);
    expect(() => assertClinicalEventEnvelope({ type: "CARE_TEAM_CHANGED" })).toThrow(
      DomainInvariantError,
    );
  });

  it("the actor accepts the REAL kernel ProvenanceActor union (person/device/source)", () => {
    expect(
      isClinicalEventEnvelope(
        makeEnvelope({ actor: parsePersonId(`prsn_${"33ddy6e8x2xq4n8v3m2k9wxyzab"}`) }),
      ),
    ).toBe(true);
  });
});
