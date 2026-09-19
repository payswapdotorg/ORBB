import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError, parsePersonId } from "@orbb/domain";
import {
  CLINICAL_ACCESS_ALLOW_REASON,
  CLINICAL_ACCESS_DECISIONS,
  assertClinicalAccessAuditRecord,
  isClinicalAccessAuditRecord,
  type ClinicalAccessAuditRecord,
} from "./audit.js";

const PERSON_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const SUBJECT = parsePersonId(`prsn_${PERSON_BODY}`);
const AT = new Date("2025-06-01T12:00:00.000Z");

function makeAudit(overrides: Partial<ClinicalAccessAuditRecord> = {}): ClinicalAccessAuditRecord {
  return {
    actor: "pract_22ccy6e8x2xq4n8v3m2k9qrstuv",
    subjectId: SUBJECT,
    permission: "observations:read",
    at: AT,
    decision: "ALLOW",
    reason: CLINICAL_ACCESS_ALLOW_REASON,
    ...overrides,
  };
}

describe("clinical access audit record (who/what/when/decision/reason)", () => {
  it("accepts a well-formed record", () => {
    const record = makeAudit();
    expect(isClinicalAccessAuditRecord(record)).toBe(true);
    expect(() => assertClinicalAccessAuditRecord(record)).not.toThrow();
  });

  it("the decision vocabulary mirrors the access_audits check constraint", () => {
    expect(CLINICAL_ACCESS_DECISIONS).toEqual(["ALLOW", "DENY"]);
    expectTypeOf<(typeof CLINICAL_ACCESS_DECISIONS)[number]>().toEqualTypeOf<"ALLOW" | "DENY">();
  });

  it("the allow reason is the single frozen label", () => {
    expect(CLINICAL_ACCESS_ALLOW_REASON).toBe("care-team-access-granted");
  });

  it("rejects malformed records field by field", () => {
    expect(isClinicalAccessAuditRecord({})).toBe(false);
    expect(isClinicalAccessAuditRecord(null)).toBe(false);
    expect(isClinicalAccessAuditRecord(makeAudit({ actor: "" }))).toBe(false);
    expect(isClinicalAccessAuditRecord(makeAudit({ subjectId: `pract_${PERSON_BODY}` as never }))).toBe(false);
    expect(isClinicalAccessAuditRecord(makeAudit({ permission: "" }))).toBe(false);
    expect(isClinicalAccessAuditRecord(makeAudit({ at: new Date("nope") }))).toBe(false);
    expect(isClinicalAccessAuditRecord(makeAudit({ decision: "MAYBE" as never }))).toBe(false);
    expect(isClinicalAccessAuditRecord(makeAudit({ reason: "" }))).toBe(false);
    expect(() => assertClinicalAccessAuditRecord({ actor: "x" })).toThrow(DomainInvariantError);
  });
});
