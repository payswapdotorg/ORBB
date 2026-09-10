import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import { parseDeviceId, parsePersonId, parseProvenanceId, parseSourceId } from "./ids.js";
import {
  assertProvenance,
  isProvenance,
  isProvenanceActor,
  type Provenance,
  type ProvenanceActor,
} from "./provenance.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

function validProvenance(actor: ProvenanceActor): Provenance {
  return {
    provenanceId: parseProvenanceId(`prov_${BODY}`),
    actor,
    subject: parsePersonId(`prsn_${BODY}`),
    occurredAt: new Date("2025-01-15T08:30:00.000Z"),
  };
}

describe("provenance", () => {
  it("accepts a well-formed record with a person actor", () => {
    const provenance: Provenance = validProvenance(parsePersonId(`prsn_${BODY}`));
    expect(isProvenance(provenance)).toBe(true);
    expect(() => assertProvenance(provenance)).not.toThrow();
  });

  it("accepts device and source actors and optional correlation fields", () => {
    const withDevice: Provenance = {
      ...validProvenance(parseDeviceId(`dev_${BODY}`)),
      causationId: "evt_01h45y6e8x2xq4n8v3m2k9abcd",
      correlationId: "corr-7f3a",
    };
    const withSource: Provenance = validProvenance(parseSourceId(`src_${BODY}`));
    expect(isProvenance(withDevice)).toBe(true);
    expect(isProvenance(withSource)).toBe(true);
  });

  it("recognizes valid actors", () => {
    expect(isProvenanceActor(`prsn_${BODY}`)).toBe(true);
    expect(isProvenanceActor(`dev_${BODY}`)).toBe(true);
    expect(isProvenanceActor(`src_${BODY}`)).toBe(true);
    expect(isProvenanceActor(`task_${BODY}`)).toBe(false);
    expect(isProvenanceActor("not-an-id")).toBe(false);
    expect(isProvenanceActor(5)).toBe(false);
  });

  it("rejects non-object values", () => {
    for (const candidate of [null, undefined, 42, "prov_01h45y6e8x2xq4n8v3m2k9abcd", true]) {
      expect(isProvenance(candidate)).toBe(false);
      expect(() => assertProvenance(candidate)).toThrow(DomainInvariantError);
    }
  });

  it("rejects an invalid provenanceId", () => {
    const candidate: unknown = { ...validProvenance(parsePersonId(`prsn_${BODY}`)), provenanceId: `task_${BODY}` };
    expect(isProvenance(candidate)).toBe(false);
    expect(() => assertProvenance(candidate)).toThrow(DomainInvariantError);
  });

  it("rejects an actor that is not a person, device, or source", () => {
    const candidate: unknown = { ...validProvenance(parsePersonId(`prsn_${BODY}`)), actor: `task_${BODY}` };
    expect(isProvenance(candidate)).toBe(false);
    expect(() => assertProvenance(candidate)).toThrow(DomainInvariantError);
  });

  it("rejects a subject that is not a person id", () => {
    const candidate: unknown = { ...validProvenance(parsePersonId(`prsn_${BODY}`)), subject: `dev_${BODY}` };
    expect(isProvenance(candidate)).toBe(false);
    expect(() => assertProvenance(candidate)).toThrow(DomainInvariantError);
  });

  it("rejects invalid timestamps", () => {
    const stringDate: unknown = { ...validProvenance(parsePersonId(`prsn_${BODY}`)), occurredAt: "2025-01-15T08:30:00.000Z" };
    const invalidDate: unknown = { ...validProvenance(parsePersonId(`prsn_${BODY}`)), occurredAt: new Date("not-a-date") };
    expect(isProvenance(stringDate)).toBe(false);
    expect(isProvenance(invalidDate)).toBe(false);
    expect(() => assertProvenance(stringDate)).toThrow(DomainInvariantError);
    expect(() => assertProvenance(invalidDate)).toThrow(DomainInvariantError);
  });

  it("rejects present-but-empty optional fields", () => {
    const emptyCausation: unknown = { ...validProvenance(parsePersonId(`prsn_${BODY}`)), causationId: "" };
    const nonStringCorrelation: unknown = { ...validProvenance(parsePersonId(`prsn_${BODY}`)), correlationId: 12 };
    expect(isProvenance(emptyCausation)).toBe(false);
    expect(isProvenance(nonStringCorrelation)).toBe(false);
    expect(() => assertProvenance(emptyCausation)).toThrow(DomainInvariantError);
    expect(() => assertProvenance(nonStringCorrelation)).toThrow(DomainInvariantError);
  });

  it("narrows the candidate after assertion", () => {
    const candidate: unknown = validProvenance(parsePersonId(`prsn_${BODY}`));
    assertProvenance(candidate);
    expect(candidate.subject).toBe(`prsn_${BODY}`);
    expect(candidate.occurredAt.getTime()).toBe(new Date("2025-01-15T08:30:00.000Z").getTime());
  });

  it("error messages never echo received values", () => {
    let message = "";
    try {
      assertProvenance({ provenanceId: "leaky", actor: "leaky", subject: "leaky" });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("provenanceId");
    expect(message).not.toContain("leaky");
  });
});
