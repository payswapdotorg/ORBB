import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DomainInvariantError,
  isPersonId,
  parsePersonId,
  type PersonId,
} from "@orbb/domain";
import {
  CLINICAL_ID_PREFIXES,
  isClinicId,
  isClinicalIdOf,
  isOrganizationId,
  isPractitionerId,
  parseClinicId,
  parseClinicalId,
  parseOrganizationId,
  parsePractitionerId,
  type ClinicId,
  type ClinicalIdKind,
  type OrganizationId,
  type PractitionerId,
} from "./ids.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

function clinicalId(kind: ClinicalIdKind, body: string = BODY): string {
  return `${CLINICAL_ID_PREFIXES[kind]}_${body}`;
}

describe("clinical canonical ids", () => {
  it("parses a clinical id for every kind", () => {
    const kinds: readonly ClinicalIdKind[] = ["organization", "clinic", "practitioner"];
    for (const kind of kinds) {
      const id = clinicalId(kind);
      expect(parseClinicalId(kind, id)).toBe(id);
      expect(isClinicalIdOf(kind, id)).toBe(true);
    }
  });

  it("rejects ids carrying the wrong kind prefix", () => {
    expect(() => parseOrganizationId(clinicalId("clinic"))).toThrow(DomainInvariantError);
    expect(() => parseClinicId(clinicalId("practitioner"))).toThrow(DomainInvariantError);
    expect(() => parsePractitionerId(clinicalId("organization"))).toThrow(DomainInvariantError);
  });

  it("rejects kernel ids in clinical positions and vice versa (no grammar bleed)", () => {
    expect(isOrganizationId(`prsn_${BODY}`)).toBe(false);
    expect(isClinicId(`plan_${BODY}`)).toBe(false);
    expect(isPractitionerId(`prsn_${BODY}`)).toBe(false);
    expect(isPersonId(clinicalId("practitioner"))).toBe(false);
    expect(() => parseOrganizationId(`prsn_${BODY}`)).toThrow(DomainInvariantError);
    expect(() => parsePersonId(clinicalId("organization"))).toThrow(DomainInvariantError);
  });

  it("rejects malformed id bodies (the kernel body grammar, mirrored exactly)", () => {
    expect(() => parseOrganizationId("org_short")).toThrow(DomainInvariantError);
    expect(() => parseClinicId("clin_")).toThrow(DomainInvariantError);
    expect(() => parsePractitionerId(`pract_${"x".repeat(129)}`)).toThrow(DomainInvariantError);
    expect(() => parsePractitionerId(`pract_${"!".repeat(26)}`)).toThrow(DomainInvariantError);
    expect(() => parseClinicId("clin")).toThrow(DomainInvariantError);
    expect(() => parseOrganizationId("organization_01h45y6e8x2xq4n8v3m2k9abcd")).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects non-string values", () => {
    expect(() => parseOrganizationId(42)).toThrow(DomainInvariantError);
    expect(() => parseClinicId(null)).toThrow(DomainInvariantError);
    expect(() => parsePractitionerId(undefined)).toThrow(DomainInvariantError);
    expect(() =>
      parsePractitionerId({ id: `pract_${BODY}` }),
    ).toThrow(DomainInvariantError);
  });

  it("error messages describe the grammar without echoing the value", () => {
    let message = "";
    try {
      parseClinicId("clin_leaky!value-that-must-not-appear");
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("clin");
    expect(message).not.toContain("leaky-value-that-must-not-appear");
  });

  it("type guards narrow to the branded types", () => {
    expect(isOrganizationId(clinicalId("organization"))).toBe(true);
    expect(isClinicId(clinicalId("clinic"))).toBe(true);
    expect(isPractitionerId(clinicalId("practitioner"))).toBe(true);
    expect(isClinicalIdOf("organization", clinicalId("clinic"))).toBe(false);
    expect(isOrganizationId(123)).toBe(false);
    expect(isClinicId(null)).toBe(false);
  });

  it("round-trips prefixed ULID-shaped and UUID-shaped bodies", () => {
    expect(parseOrganizationId("org_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(
      "org_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    );
    expect(parseClinicId("clin_3f2b8a4c1d9e0f7a6b5c4d3e2f1a0b9c")).toBe(
      "clin_3f2b8a4c1d9e0f7a6b5c4d3e2f1a0b9c",
    );
  });

  it("exposes exactly one fixed prefix per kind, colliding with no kernel prefix", () => {
    expect(CLINICAL_ID_PREFIXES).toEqual({
      organization: "org",
      clinic: "clin",
      practitioner: "pract",
    });
    const kernelPrefixes = [
      "prsn",
      "intent",
      "obs",
      "evid",
      "plan",
      "task",
      "grant",
      "dev",
      "src",
      "prov",
    ];
    for (const prefix of Object.values(CLINICAL_ID_PREFIXES)) {
      expect(kernelPrefixes, `clinical prefix "${prefix}" must not collide`).not.toContain(
        prefix,
      );
    }
  });
});

describe("cross-kind assignment does not type-check (compile-level)", () => {
  it("clinical id brands are mutually exclusive AND kernel-exclusive", () => {
    const organization = parseOrganizationId(clinicalId("organization"));
    const clinic = parseClinicId(clinicalId("clinic"));
    const practitioner = parsePractitionerId(clinicalId("practitioner"));

    // The brands are distinct string subtypes — identity still holds.
    expect(typeof organization).toBe("string");
    expect(typeof clinic).toBe("string");
    expect(typeof practitioner).toBe("string");

    // @ts-expect-error — an OrganizationId is not a ClinicId (compile proof)
    const asClinic: ClinicId = organization;
    // @ts-expect-error — a ClinicId is not a PractitionerId (compile proof)
    const asPractitioner: PractitionerId = clinic;
    // @ts-expect-error — a PractitionerId is not an OrganizationId (compile proof)
    const asOrganization: OrganizationId = practitioner;
    // @ts-expect-error — a clinical id is not a kernel PersonId (compile proof)
    const asPerson: PersonId = organization;
    // Runtime guards reject the same smuggles the compiler rejects.
    expect(isClinicId(asClinic)).toBe(false);
    expect(isPractitionerId(asPractitioner)).toBe(false);
    expect(isOrganizationId(asOrganization)).toBe(false);
    expect(isPersonId(asPerson)).toBe(false);
  });

  it("the branded types are nominal, not structural aliases", () => {
    expectTypeOf<OrganizationId>().not.toEqualTypeOf<ClinicId>();
    expectTypeOf<ClinicId>().not.toEqualTypeOf<PractitionerId>();
    expectTypeOf<PractitionerId>().not.toEqualTypeOf<OrganizationId>();
  });
});
