import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import { parseGrantId, parsePersonId, type PersonId } from "./ids.js";
import type { AccessGrant } from "./grant.js";
import {
  ACCESS_DECISION_PROVENANCE_PLACEHOLDER,
  assertAccessAudit,
  assertDataScope,
  digestAccessRequest,
  evaluateAccess,
  grantsOperation,
  isAccessAudit,
  isDataScope,
  parseScopePermission,
  type AccessAudit,
  type AccessRequest,
  type ConsentPolicy,
  type DataScope,
  type EmergencyState,
  type Relationship,
} from "./access.js";

const SUBJECT_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const OTHER_PERSON_BODY = "22ccy6e8x2xq4n8v3m2k9qrstuv";

const SUBJECT = parsePersonId(`prsn_${SUBJECT_BODY}`);
const OTHER_PERSON = parsePersonId(`prsn_${OTHER_PERSON_BODY}`);
const RECIPIENT = "recipient-clinic-42";
const OTHER_RECIPIENT = "recipient-study-7";

const CARE_MANAGEMENT = "CARE_MANAGEMENT";
const RESEARCH = "RESEARCH";

const REQUEST_AT = new Date("2025-06-01T12:00:00.000Z");
const LATER_THAN_REQUEST = new Date("2026-06-01T12:00:00.000Z");
const EARLIER_THAN_REQUEST = new Date("2024-06-01T12:00:00.000Z");

const NO_EMERGENCY: EmergencyState = { active: false };

const observationScope: DataScope = { resourceKind: "observation" };

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: parseGrantId(`grant_${SUBJECT_BODY}`),
    subjectId: SUBJECT,
    recipientId: RECIPIENT,
    purpose: CARE_MANAGEMENT,
    scope: ["observation:read"],
    state: "active",
    expiresAt: LATER_THAN_REQUEST,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    subjectId: SUBJECT,
    recipientId: RECIPIENT,
    resource: observationScope,
    purpose: CARE_MANAGEMENT,
    operation: "read",
    at: REQUEST_AT,
    ...overrides,
  };
}

function makeRelationship(overrides: Partial<Relationship> = {}): Relationship {
  return {
    subjectId: SUBJECT,
    recipientId: RECIPIENT,
    type: "care-team",
    active: true,
    ...overrides,
  };
}

const careTeamPolicy: ConsentPolicy = {
  id: "policy-care-team",
  label: "care-team membership required",
  purposes: [CARE_MANAGEMENT],
  requiredRelationshipTypes: ["care-team"],
};

describe("grant scope permissions", () => {
  it("parses well-formed <kind>:<operation> entries", () => {
    expect(parseScopePermission("observation:read")).toEqual({
      resourceKind: "observation",
      operation: "read",
    });
    expect(parseScopePermission("intent:write")).toEqual({
      resourceKind: "intent",
      operation: "write",
    });
  });

  it("rejects malformed entries", () => {
    expect(() => parseScopePermission("observation")).toThrow(DomainInvariantError);
    expect(() => parseScopePermission(":read")).toThrow(DomainInvariantError);
    expect(() => parseScopePermission("observation:")).toThrow(DomainInvariantError);
    expect(() => parseScopePermission("observation:read:extra")).toThrow(DomainInvariantError);
    expect(() => parseScopePermission("")).toThrow(DomainInvariantError);
  });

  it("matches only the exact kind+operation pair", () => {
    const scope = ["observation:read", "intent:read"];
    expect(grantsOperation(scope, "observation", "read")).toBe(true);
    expect(grantsOperation(scope, "observation", "write")).toBe(false);
    expect(grantsOperation(scope, "intent", "read")).toBe(true);
    expect(grantsOperation(scope, "plan", "read")).toBe(false);
    expect(grantsOperation([], "observation", "read")).toBe(false);
  });
});

describe("data scope guard", () => {
  it("accepts a kind-only scope and a scope with filters", () => {
    expect(isDataScope({ resourceKind: "observation" })).toBe(true);
    expect(
      isDataScope({
        resourceKind: "observation",
        filters: [{ field: "conceptCode", value: "8867-4" }],
      }),
    ).toBe(true);
    expect(() =>
      assertDataScope({ resourceKind: "observation", filters: [] }),
    ).not.toThrow();
  });

  it("rejects malformed scopes and filters", () => {
    expect(isDataScope({})).toBe(false);
    expect(isDataScope({ resourceKind: "" })).toBe(false);
    expect(isDataScope(null)).toBe(false);
    expect(isDataScope({ resourceKind: "observation", filters: "all" })).toBe(false);
    expect(
      isDataScope({ resourceKind: "observation", filters: [{ field: "", value: "x" }] }),
    ).toBe(false);
    expect(
      isDataScope({ resourceKind: "observation", filters: [{ field: "conceptCode", value: "" }] }),
    ).toBe(false);
    expect(() => assertDataScope({ resourceKind: "" })).toThrow(DomainInvariantError);
  });
});

describe("evaluateAccess — allow paths", () => {
  it("allows when an active, unexpired grant covers the kind+operation and purpose", () => {
    const decision = evaluateAccess(makeRequest(), [makeGrant()], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("ALLOW");
    expect(decision.reasons.some((reason) => reason.includes("grant_"))).toBe(true);
    expect(decision.evaluatedAt).toBe(REQUEST_AT);
    expect(decision.provenanceId).toBe(ACCESS_DECISION_PROVENANCE_PLACEHOLDER);
  });

  it("allows when any one of several grants authorizes the request", () => {
    const expired = makeGrant({
      id: parseGrantId(`grant_${"11aay6e8x2xq4n8v3m2k9bcdefg"}`),
      expiresAt: EARLIER_THAN_REQUEST,
    });
    const wrongPurpose = makeGrant({
      id: parseGrantId(`grant_${"33ddy6e8x2xq4n8v3m2k9hijkl"}`),
      purpose: RESEARCH,
    });
    const good = makeGrant();
    const decision = evaluateAccess(
      makeRequest(),
      [expired, wrongPurpose, good],
      [],
      [],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("ALLOW");
    expect(decision.reasons.some((reason) => reason.includes("allowed by grant"))).toBe(true);
  });

  it("allows when an applicable policy's required relationship is satisfied", () => {
    const decision = evaluateAccess(
      makeRequest(),
      [makeGrant()],
      [careTeamPolicy],
      [makeRelationship()],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("ALLOW");
    expect(decision.reasons.some((reason) => reason.includes("satisfied"))).toBe(true);
  });

  it("allows when a policy exists but does not apply to the requested purpose", () => {
    const researchOnlyPolicy: ConsentPolicy = {
      id: "policy-research",
      label: "research restrictions",
      purposes: [RESEARCH],
      deniedOperations: ["read"],
    };
    const decision = evaluateAccess(
      makeRequest(),
      [makeGrant()],
      [researchOnlyPolicy],
      [],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("ALLOW");
  });

  it("allows when a policy applies but carries no restrictions", () => {
    const noOpPolicy: ConsentPolicy = { id: "policy-noop", label: "no-op policy" };
    const decision = evaluateAccess(makeRequest(), [makeGrant()], [noOpPolicy], [], NO_EMERGENCY);
    expect(decision.decision).toBe("ALLOW");
  });

  it("allows when a policy denies other operations/kinds than the requested one", () => {
    const policy: ConsentPolicy = {
      id: "policy-write",
      label: "no writes, no plans",
      purposes: [CARE_MANAGEMENT],
      deniedOperations: ["write"],
      deniedResourceKinds: ["plan"],
    };
    const decision = evaluateAccess(makeRequest(), [makeGrant()], [policy], [], NO_EMERGENCY);
    expect(decision.decision).toBe("ALLOW");
  });
});

describe("evaluateAccess — deny paths", () => {
  it("denies by default when there are no grants at all", () => {
    const decision = evaluateAccess(makeRequest(), [], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons).toEqual(["no grant for subject and recipient"]);
  });

  it("denies when the only grant belongs to a different subject (cross-subject grants never apply)", () => {
    const foreignGrant = makeGrant({ subjectId: OTHER_PERSON });
    const decision = evaluateAccess(makeRequest(), [foreignGrant], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons).toEqual(["no grant for subject and recipient"]);
  });

  it("denies when the only grant belongs to a different recipient", () => {
    const foreignGrant = makeGrant({ recipientId: OTHER_RECIPIENT });
    const decision = evaluateAccess(makeRequest(), [foreignGrant], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
  });

  it("denies when the grant is revoked", () => {
    const revoked = makeGrant({ state: "revoked" });
    const decision = evaluateAccess(makeRequest(), [revoked], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons.some((reason) => reason.includes("revoked"))).toBe(true);
  });

  it("denies when the grant expired before the request time", () => {
    const expired = makeGrant({ expiresAt: EARLIER_THAN_REQUEST });
    const decision = evaluateAccess(makeRequest(), [expired], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons.some((reason) => reason.includes("expired"))).toBe(true);
  });

  it("treats a grant as expired at the exact expiry instant (valid strictly before expiry)", () => {
    const expiringExactlyAtRequest = makeGrant({ expiresAt: REQUEST_AT });
    const decision = evaluateAccess(
      makeRequest(),
      [expiringExactlyAtRequest],
      [],
      [],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons.some((reason) => reason.includes("expired"))).toBe(true);
    // one millisecond before expiry it is still valid
    const validUntilJustBefore = makeGrant({
      expiresAt: new Date(REQUEST_AT.getTime() + 1),
    });
    expect(
      evaluateAccess(makeRequest(), [validUntilJustBefore], [], [], NO_EMERGENCY).decision,
    ).toBe("ALLOW");
  });

  it("denies when the operation is not within the granted scope", () => {
    const decision = evaluateAccess(
      makeRequest({ operation: "write" }),
      [makeGrant()],
      [],
      [],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");
    expect(
      decision.reasons.some(
        (reason) => reason.includes("does not cover operation") && reason.includes("write"),
      ),
    ).toBe(true);
  });

  it("denies when the resource kind is not within the granted scope", () => {
    const decision = evaluateAccess(
      makeRequest({ resource: { resourceKind: "plan" } }),
      [makeGrant()],
      [],
      [],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");
    expect(
      decision.reasons.some(
        (reason) => reason.includes("does not cover operation") && reason.includes("plan"),
      ),
    ).toBe(true);
  });

  it("denies on purpose mismatch without echoing the purpose strings", () => {
    const grant = makeGrant({ purpose: RESEARCH });
    const decision = evaluateAccess(makeRequest(), [grant], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons.some((reason) => reason.includes("purpose"))).toBe(true);
    for (const reason of decision.reasons) {
      expect(reason.includes(CARE_MANAGEMENT)).toBe(false);
      expect(reason.includes(RESEARCH)).toBe(false);
    }
  });

  it("denies when no grant ultimately authorizes, collecting every failure reason", () => {
    const expired = makeGrant({
      id: parseGrantId(`grant_${"11aay6e8x2xq4n8v3m2k9bcdefg"}`),
      expiresAt: EARLIER_THAN_REQUEST,
    });
    const wrongPurpose = makeGrant({
      id: parseGrantId(`grant_${"33ddy6e8x2xq4n8v3m2k9hijkl"}`),
      purpose: RESEARCH,
    });
    const decision = evaluateAccess(
      makeRequest(),
      [expired, wrongPurpose],
      [],
      [],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons.some((reason) => reason.includes("expired"))).toBe(true);
    expect(decision.reasons.some((reason) => reason.includes("purpose"))).toBe(true);
  });
});

describe("evaluateAccess — policy narrowing (restrict, never widen)", () => {
  it("denies when a policy requires a relationship that does not exist", () => {
    const decision = evaluateAccess(makeRequest(), [makeGrant()], [careTeamPolicy], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(
      decision.reasons.some((reason) => reason.includes("care-team membership required")),
    ).toBe(true);
  });

  it("denies when the required relationship exists but is inactive", () => {
    const decision = evaluateAccess(
      makeRequest(),
      [makeGrant()],
      [careTeamPolicy],
      [makeRelationship({ active: false })],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");
  });

  it("denies when the required relationship has the wrong type", () => {
    const decision = evaluateAccess(
      makeRequest(),
      [makeGrant()],
      [careTeamPolicy],
      [makeRelationship({ type: "emergency-contact" })],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");
  });

  it("denies when the relationship belongs to another subject or recipient", () => {
    const foreignSubject = makeRelationship({ subjectId: OTHER_PERSON });
    const decision = evaluateAccess(
      makeRequest(),
      [makeGrant()],
      [careTeamPolicy],
      [foreignSubject],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");

    const foreignRecipient = makeRelationship({ recipientId: OTHER_RECIPIENT });
    const other = evaluateAccess(
      makeRequest(),
      [makeGrant()],
      [careTeamPolicy],
      [foreignRecipient],
      NO_EMERGENCY,
    );
    expect(other.decision).toBe("DENY");
  });

  it("denies when a policy forbids the requested operation", () => {
    const policy: ConsentPolicy = {
      id: "policy-readonly",
      label: "read-only sharing",
      purposes: [CARE_MANAGEMENT],
      deniedOperations: ["read"],
    };
    const decision = evaluateAccess(makeRequest(), [makeGrant()], [policy], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons.some((reason) => reason.includes("read-only sharing"))).toBe(true);
  });

  it("denies when a policy forbids the requested resource kind", () => {
    const policy: ConsentPolicy = {
      id: "policy-no-observations",
      label: "no observation sharing",
      purposes: [CARE_MANAGEMENT],
      deniedResourceKinds: ["observation"],
    };
    const decision = evaluateAccess(makeRequest(), [makeGrant()], [policy], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(
      decision.reasons.some((reason) => reason.includes("no observation sharing")),
    ).toBe(true);
  });

  it("a policy can never widen access: no grant means DENY even with permissive policies", () => {
    const permissive: ConsentPolicy = { id: "policy-open", label: "open policy" };
    const decision = evaluateAccess(makeRequest(), [], [permissive], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
  });

  it("a policy can never revive an expired grant", () => {
    const permissive: ConsentPolicy = { id: "policy-open", label: "open policy" };
    const expired = makeGrant({ expiresAt: EARLIER_THAN_REQUEST });
    const decision = evaluateAccess(
      makeRequest(),
      [expired],
      [permissive],
      [],
      NO_EMERGENCY,
    );
    expect(decision.decision).toBe("DENY");
  });

  it("an all-purposes policy (absent purpose list) applies to every purpose", () => {
    const policy: ConsentPolicy = {
      id: "policy-global",
      label: "global no-writes",
      deniedOperations: ["read"],
    };
    const decision = evaluateAccess(makeRequest(), [makeGrant()], [policy], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
  });
});

describe("evaluateAccess — emergency override", () => {
  it("allows with zero grants when an emergency is active (break-glass)", () => {
    const emergency: EmergencyState = { active: true };
    const decision = evaluateAccess(makeRequest(), [], [], [], emergency);
    expect(decision.decision).toBe("ALLOW");
    expect(decision.reasons).toContain("emergency override active");
    expect(decision.provenanceId).toBe(ACCESS_DECISION_PROVENANCE_PLACEHOLDER);
  });

  it("includes the emergency context label when present", () => {
    const emergency: EmergencyState = { active: true, label: "er-trauma-bay" };
    const decision = evaluateAccess(makeRequest(), [], [], [], emergency);
    expect(decision.decision).toBe("ALLOW");
    expect(decision.reasons).toContain("emergency context: er-trauma-bay");
  });

  it("bypasses revoked grants, expired grants, scope, purpose, and policy restrictions", () => {
    const emergency: EmergencyState = { active: true, label: "er-trauma-bay" };
    const revoked = makeGrant({ state: "revoked" });
    const decision = evaluateAccess(
      makeRequest({ operation: "write", purpose: RESEARCH }),
      [revoked],
      [careTeamPolicy],
      [],
      emergency,
    );
    expect(decision.decision).toBe("ALLOW");
    expect(decision.reasons).toContain("emergency override active");
  });

  it("does not override anything when the emergency is inactive", () => {
    const labeled: EmergencyState = { active: false, label: "er-trauma-bay" };
    const decision = evaluateAccess(makeRequest(), [], [], [], labeled);
    expect(decision.decision).toBe("DENY");
  });
});

describe("evaluateAccess — input validation", () => {
  it("throws on a malformed request", () => {
    const badSubject = {
      ...makeRequest(),
      subjectId: "not-a-person-id" as unknown as PersonId,
    };
    expect(() => evaluateAccess(badSubject, [], [], [], NO_EMERGENCY)).toThrow(
      DomainInvariantError,
    );
    const badOperation = { ...makeRequest(), operation: "" };
    expect(() => evaluateAccess(badOperation, [], [], [], NO_EMERGENCY)).toThrow(
      DomainInvariantError,
    );
    const badDate = { ...makeRequest(), at: new Date("not-a-date") };
    expect(() => evaluateAccess(badDate, [], [], [], NO_EMERGENCY)).toThrow(
      DomainInvariantError,
    );
  });

  it("throws on a malformed emergency state, policy, or relationship", () => {
    const badEmergency = { active: "yes" } as unknown as EmergencyState;
    expect(() => evaluateAccess(makeRequest(), [], [], [], badEmergency)).toThrow(
      DomainInvariantError,
    );
    const badPolicy = { id: "", label: "x" } as unknown as ConsentPolicy;
    expect(() => evaluateAccess(makeRequest(), [], [badPolicy], [], NO_EMERGENCY)).toThrow(
      DomainInvariantError,
    );
    const badRelationship = { subjectId: "junk" } as unknown as Relationship;
    expect(() =>
      evaluateAccess(makeRequest(), [], [], [badRelationship], NO_EMERGENCY),
    ).toThrow(DomainInvariantError);
  });

  it("throws when a candidate grant is structurally malformed", () => {
    const malformed = { ...makeGrant(), scope: [] as string[] };
    expect(() => evaluateAccess(makeRequest(), [malformed], [], [], NO_EMERGENCY)).toThrow(
      DomainInvariantError,
    );
    const malformedScopeEntry = { ...makeGrant(), scope: ["garbage"] };
    expect(() =>
      evaluateAccess(makeRequest(), [malformedScopeEntry], [], [], NO_EMERGENCY),
    ).toThrow(DomainInvariantError);
  });

  it("never inspects malformed grants that are not candidates (cross-subject grants are ignored entirely)", () => {
    const foreignMalformed = {
      ...makeGrant(),
      subjectId: OTHER_PERSON,
      scope: "not-even-a-list" as unknown as string[],
    };
    const decision = evaluateAccess(makeRequest(), [foreignMalformed], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons).toEqual(["no grant for subject and recipient"]);
  });

  it("returns reasons that are labels only — never request data values or purposes", () => {
    const request = makeRequest({
      resource: {
        resourceKind: "observation",
        filters: [{ field: "conceptCode", value: "8867-4" }],
      },
    });
    const expired = makeGrant({ expiresAt: EARLIER_THAN_REQUEST });
    const decision = evaluateAccess(request, [expired], [], [], NO_EMERGENCY);
    expect(decision.decision).toBe("DENY");
    for (const reason of decision.reasons) {
      expect(reason.includes("8867-4")).toBe(false);
      expect(reason.includes(CARE_MANAGEMENT)).toBe(false);
    }
  });
});

describe("access audit", () => {
  it("accepts a well-formed audit record", () => {
    const audit: AccessAudit = {
      id: "audit-0001",
      decisionId: "decision-0001",
      at: REQUEST_AT,
      actor: "recipient-clinic-42",
      requestDigest: digestAccessRequest(makeRequest()),
    };
    expect(isAccessAudit(audit)).toBe(true);
    expect(() => assertAccessAudit(audit)).not.toThrow();
  });

  it("rejects malformed audit records", () => {
    expect(isAccessAudit(null)).toBe(false);
    expect(isAccessAudit({ id: "", decisionId: "d", at: REQUEST_AT, actor: "a", requestDigest: "x" })).toBe(false);
    expect(
      isAccessAudit({ id: "a", decisionId: "d", at: new Date("not-a-date"), actor: "a", requestDigest: "x" }),
    ).toBe(false);
    expect(() => assertAccessAudit(null)).toThrow(DomainInvariantError);
  });
});

describe("request digest", () => {
  it("is deterministic for identical requests", () => {
    expect(digestAccessRequest(makeRequest())).toBe(digestAccessRequest(makeRequest()));
  });

  it("changes when identity-bearing labels change", () => {
    expect(digestAccessRequest(makeRequest())).not.toBe(
      digestAccessRequest(makeRequest({ operation: "write" })),
    );
    expect(digestAccessRequest(makeRequest())).not.toBe(
      digestAccessRequest(makeRequest({ recipientId: OTHER_RECIPIENT })),
    );
    expect(digestAccessRequest(makeRequest())).not.toBe(
      digestAccessRequest(makeRequest({ at: LATER_THAN_REQUEST })),
    );
  });

  it("excludes filter values but reflects the filter count", () => {
    const oneFilter = makeRequest({
      resource: { resourceKind: "observation", filters: [{ field: "conceptCode", value: "8867-4" }] },
    });
    const otherValue = makeRequest({
      resource: { resourceKind: "observation", filters: [{ field: "conceptCode", value: "72166-2" }] },
    });
    const twoFilters = makeRequest({
      resource: {
        resourceKind: "observation",
        filters: [
          { field: "conceptCode", value: "8867-4" },
          { field: "category", value: "vital-signs" },
        ],
      },
    });
    // filter VALUES never reach the digest
    expect(digestAccessRequest(oneFilter)).toBe(digestAccessRequest(otherValue));
    // but the filter COUNT does
    expect(digestAccessRequest(oneFilter)).not.toBe(digestAccessRequest(twoFilters));
    expect(digestAccessRequest(oneFilter)).not.toBe(digestAccessRequest(makeRequest()));
  });

  it("throws on a malformed request", () => {
    const bad = { ...makeRequest(), subjectId: "junk" as unknown as PersonId };
    expect(() => digestAccessRequest(bad)).toThrow(DomainInvariantError);
  });
});
