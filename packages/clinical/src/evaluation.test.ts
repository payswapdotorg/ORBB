import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DomainInvariantError,
  parseGrantId,
  parsePersonId,
  type AccessGrant,
  type PersonId,
} from "@orbb/domain";
import {
  CARE_TEAM_DENY_REASONS,
  assertCareTeamAccessRequest,
  evaluateCareTeamAccess,
  isCareTeamAccessRequest,
  isCareTeamDenyReason,
  type CareTeamAccessRequest,
  type CareTeamAccessSnapshot,
  type CareTeamDenyReason,
} from "./evaluation.js";
import {
  CARE_TEAM_SCOPE_PERMISSIONS,
  careTeamScopePermissionSegments,
} from "./scopes.js";
import {
  CLINICAL_ACCESS_ALLOW_REASON,
  isClinicalAccessAuditRecord,
} from "./audit.js";
import type { CareTeam } from "./careTeams.js";
import {
  parseClinicId,
  parseOrganizationId,
  parsePractitionerId,
  type PractitionerId,
} from "./ids.js";
import type { Clinic, Organization } from "./organizations.js";
import type { PatientLink } from "./patientLinks.js";
import type {
  Practitioner,
  PractitionerClinicAffiliation,
  PractitionerOrganizationMembership,
} from "./practitioners.js";

// ---------------------------------------------------------------------------
// SYNTH fixtures (deterministic; no real medical data — AGENTS.md).
// ---------------------------------------------------------------------------

const PERSON_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";
const OTHER_PERSON_BODY = "22ccy6e8x2xq4n8v3m2k9qrstuv";
const PRACT_BODY = "33ddy6e8x2xq4n8v3m2k9wxyzab";
const OTHER_PRACT_BODY = "44eey6e8x2xq4n8v3m2k9abcdef";
const ORG_BODY = "55ffy6e8x2xq4n8v3m2k9abcdef";
const OTHER_ORG_BODY = "66aay6e8x2xq4n8v3m2k9abcdef";
const CLINIC_BODY = "77bby6e8x2xq4n8v3m2k9abcdef";
const GRANT_BODY = "88ccy6e8x2xq4n8v3m2k9abcdef";

const SUBJECT: PersonId = parsePersonId(`prsn_${PERSON_BODY}`);
const OTHER_PERSON: PersonId = parsePersonId(`prsn_${OTHER_PERSON_BODY}`);
const PRACTITIONER: PractitionerId = parsePractitionerId(`pract_${PRACT_BODY}`);
const OTHER_PRACTITIONER: PractitionerId = parsePractitionerId(`pract_${OTHER_PRACT_BODY}`);
const ORG_ID = parseOrganizationId(`org_${ORG_BODY}`);
const OTHER_ORG_ID = parseOrganizationId(`org_${OTHER_ORG_BODY}`);
const CLINIC_ID = parseClinicId(`clin_${CLINIC_BODY}`);

const CARE_MANAGEMENT = "CARE_MANAGEMENT";
const REQUEST_AT = new Date("2025-06-01T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-06-01T12:00:00.000Z");

/**
 * The injected clock fixture (testkit discipline): the evaluator is pure
 * and takes the evaluation instant on the request — the calling layer
 * stamps it from a clock it injects. Every expiry test below drives THIS
 * fixture, never wall-clock time.
 */
function fixedClock(at: Date): () => Date {
  return () => at;
}

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: parseGrantId(`grant_${GRANT_BODY}`),
    subjectId: SUBJECT,
    // The clinical lane resolves the kernel's opaque recipientId: the
    // practitioner's canonical id IS the recipient.
    recipientId: PRACTITIONER,
    purpose: CARE_MANAGEMENT,
    scope: ["observations:read", "timeline:read", "intent:read"],
    state: "active",
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CareTeamAccessRequest> = {}): CareTeamAccessRequest {
  return {
    subjectId: SUBJECT,
    practitionerId: PRACTITIONER,
    purpose: CARE_MANAGEMENT,
    permission: "observations:read",
    at: REQUEST_AT,
    ...overrides,
  };
}

function makeLink(overrides: Partial<PatientLink> = {}): PatientLink {
  return {
    personId: SUBJECT,
    practitionerId: PRACTITIONER,
    state: "confirmed",
    requestedBy: "practitioner",
    ...overrides,
  };
}

function makeTeam(overrides: Partial<CareTeam> = {}): CareTeam {
  return {
    personId: SUBJECT,
    state: "active",
    entries: [{ practitionerId: PRACTITIONER, role: "primary-care" }],
    ...overrides,
  };
}

function makePractitioner(overrides: Partial<Practitioner> = {}): Practitioner {
  return {
    id: PRACTITIONER,
    displayName: "Dr. Synth Practitioner",
    state: "verified",
    ...overrides,
  };
}

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

function makeMembership(
  overrides: Partial<PractitionerOrganizationMembership> = {},
): PractitionerOrganizationMembership {
  return {
    practitionerId: PRACTITIONER,
    organizationId: ORG_ID,
    role: "member",
    active: true,
    ...overrides,
  };
}

function makeAffiliation(
  overrides: Partial<PractitionerClinicAffiliation> = {},
): PractitionerClinicAffiliation {
  return {
    practitionerId: PRACTITIONER,
    clinicId: CLINIC_ID,
    role: "member",
    active: true,
    ...overrides,
  };
}

/** Snapshot overrides with an org-level/clinic-scoped switch. */
interface SnapshotOverrides {
  grant?: AccessGrant;
  patientLink?: PatientLink;
  careTeam?: CareTeam;
  practitioner?: Practitioner;
  organization?: Organization;
  membership?: PractitionerOrganizationMembership;
  clinic?: Clinic;
  affiliation?: PractitionerClinicAffiliation;
  /** Default true; false builds an org-level (clinic-less) snapshot. */
  clinicScoped?: boolean;
}

function makeSnapshot(overrides: SnapshotOverrides = {}): CareTeamAccessSnapshot {
  const {
    grant = makeGrant(),
    patientLink = makeLink(),
    careTeam = makeTeam(),
    practitioner = makePractitioner(),
    organization = makeOrganization(),
    membership = makeMembership(),
    clinic = makeClinic(),
    affiliation = makeAffiliation(),
    clinicScoped = true,
  } = overrides;
  return clinicScoped
    ? {
        grant,
        patientLink,
        careTeam,
        practitioner,
        organization,
        membership,
        clinic,
        affiliation,
      }
    : { grant, patientLink, careTeam, practitioner, organization, membership };
}

// ---------------------------------------------------------------------------
// The exhaustive deny-by-default proof: EVERY typed reason, one cause each.
// ---------------------------------------------------------------------------

interface DenialCase {
  readonly reason: CareTeamDenyReason;
  readonly label: string;
  readonly request?: Partial<CareTeamAccessRequest>;
  readonly snapshot?: SnapshotOverrides;
}

const EXHAUSTIVE_DENIALS: readonly DenialCase[] = [
  {
    reason: "unknown-scope-permission",
    label: "the requested permission is outside the frozen read-only vocabulary",
    request: { permission: "observations:write" },
  },
  {
    reason: "unknown-recipient",
    label: "the grant's recipientId does not resolve to the requesting practitioner",
    snapshot: { grant: makeGrant({ recipientId: "legacy-opaque-recipient-42" }) },
  },
  {
    reason: "subject-mismatch",
    label: "the grant belongs to a different subject",
    snapshot: { grant: makeGrant({ subjectId: OTHER_PERSON }) },
  },
  {
    reason: "revoked-grant",
    label: "the grant is revoked (kernel state)",
    snapshot: { grant: makeGrant({ state: "revoked" }) },
  },
  {
    reason: "expired-grant",
    label: "the grant is expired at the evaluation instant (injected clock)",
    request: { at: EXPIRES_AT },
  },
  {
    reason: "missing-scope",
    label: "the grant does not cover the requested permission",
    snapshot: { grant: makeGrant({ scope: ["timeline:read", "intent:read"] }) },
  },
  {
    reason: "purpose-mismatch",
    label: "the stated purpose differs from the grant purpose",
    request: { purpose: "RESEARCH" },
  },
  {
    reason: "unconfirmed-patient-link",
    label: "the patient link is still only requested",
    snapshot: { patientLink: makeLink({ state: "requested" }) },
  },
  {
    reason: "inactive-care-team",
    label: "the care team is dissolved (terminal)",
    snapshot: { careTeam: makeTeam({ state: "dissolved" }) },
  },
  {
    reason: "not-on-care-team",
    label: "the practitioner is not on the care team",
    snapshot: { careTeam: makeTeam({ entries: [] }) },
  },
  {
    reason: "suspended-practitioner",
    label: "the practitioner is suspended-from-verified",
    snapshot: { practitioner: makePractitioner({ state: "suspended-from-verified" }) },
  },
  {
    reason: "unverified-practitioner",
    label: "the practitioner was never verified (verification is never implied)",
    snapshot: { practitioner: makePractitioner({ state: "unverified" }) },
  },
  {
    reason: "dissolved-organization",
    label: "the organization is dissolved",
    snapshot: { organization: makeOrganization({ state: "dissolved" }) },
  },
  {
    reason: "suspended-organization",
    label: "the organization is suspended",
    snapshot: { organization: makeOrganization({ state: "suspended" }) },
  },
  {
    reason: "inactive-membership",
    label: "the practitioner's organization membership is inactive",
    snapshot: { membership: makeMembership({ active: false }) },
  },
  {
    reason: "dissolved-clinic",
    label: "the clinic is dissolved",
    snapshot: { clinic: makeClinic({ state: "dissolved" }) },
  },
  {
    reason: "suspended-clinic",
    label: "the clinic is suspended",
    snapshot: { clinic: makeClinic({ state: "suspended" }) },
  },
  {
    reason: "inactive-affiliation",
    label: "the practitioner's clinic affiliation is inactive",
    snapshot: { affiliation: makeAffiliation({ active: false }) },
  },
];

describe("deny-by-default is ABSOLUTE — every failure mode denies with its typed reason", () => {
  for (const denial of EXHAUSTIVE_DENIALS) {
    it(`${denial.reason}: ${denial.label}`, () => {
      const request = makeRequest(denial.request ?? {});
      const decision = evaluateCareTeamAccess(request, makeSnapshot(denial.snapshot ?? {}));
      expect(decision.kind).toBe("DENY");
      if (decision.kind === "DENY") {
        expect(decision.reason).toBe(denial.reason);
        expect(decision.evaluatedAt).toBe(request.at);
        expect(decision.audit.decision).toBe("DENY");
        expect(decision.audit.reason).toBe(denial.reason);
        expect(isClinicalAccessAuditRecord(decision.audit)).toBe(true);
      }
    });
  }

  it("the typed deny-reason vocabulary is frozen, complete, and duplicate-free", () => {
    expect(CARE_TEAM_DENY_REASONS).toEqual(EXHAUSTIVE_DENIALS.map((denial) => denial.reason));
    expect(new Set(CARE_TEAM_DENY_REASONS).size).toBe(CARE_TEAM_DENY_REASONS.length);
    expect(isCareTeamDenyReason("expired-grant")).toBe(true);
    expect(isCareTeamDenyReason("allowed")).toBe(false);
    expect(isCareTeamDenyReason("")).toBe(false);
  });
});

describe("additional deny variants — fail-closed on every shape of doubt", () => {
  it("an unconfirmed link in ANY non-confirmed shape denies (declined, revoked, wrong pair)", () => {
    for (const patientLink of [
      makeLink({ state: "declined" }),
      makeLink({ state: "revoked" }),
      makeLink({ personId: OTHER_PERSON }),
      makeLink({ practitionerId: OTHER_PRACTITIONER }),
    ]) {
      const decision = evaluateCareTeamAccess(makeRequest(), makeSnapshot({ patientLink }));
      expect(decision.kind).toBe("DENY");
      if (decision.kind === "DENY") {
        expect(decision.reason).toBe("unconfirmed-patient-link");
      }
    }
  });

  it("a forming (never-activated) care team denies as inactive", () => {
    const decision = evaluateCareTeamAccess(
      makeRequest(),
      makeSnapshot({ careTeam: makeTeam({ state: "forming" }) }),
    );
    expect(decision.kind).toBe("DENY");
    if (decision.kind === "DENY") {
      expect(decision.reason).toBe("inactive-care-team");
    }
  });

  it("a care team belonging to a different person denies as not-on-care-team", () => {
    const decision = evaluateCareTeamAccess(
      makeRequest(),
      makeSnapshot({ careTeam: makeTeam({ personId: OTHER_PERSON }) }),
    );
    expect(decision.kind).toBe("DENY");
    if (decision.kind === "DENY") {
      expect(decision.reason).toBe("not-on-care-team");
    }
  });

  it("a snapshot practitioner that is not the requester denies as not-on-care-team", () => {
    const decision = evaluateCareTeamAccess(
      makeRequest(),
      makeSnapshot({ practitioner: makePractitioner({ id: OTHER_PRACTITIONER }) }),
    );
    expect(decision.kind).toBe("DENY");
    if (decision.kind === "DENY") {
      expect(decision.reason).toBe("not-on-care-team");
    }
  });

  it("a membership bound to a different practitioner or organization denies as inactive", () => {
    for (const membership of [
      makeMembership({ practitionerId: OTHER_PRACTITIONER }),
      makeMembership({ organizationId: OTHER_ORG_ID }),
    ]) {
      const decision = evaluateCareTeamAccess(makeRequest(), makeSnapshot({ membership }));
      expect(decision.kind).toBe("DENY");
      if (decision.kind === "DENY") {
        expect(decision.reason).toBe("inactive-membership");
      }
    }
  });

  it("an affiliation bound to a different practitioner or clinic denies as inactive", () => {
    for (const affiliation of [
      makeAffiliation({ practitionerId: OTHER_PRACTITIONER }),
      makeAffiliation({ clinicId: parseClinicId(`clin_${OTHER_ORG_BODY}`) }),
    ]) {
      const decision = evaluateCareTeamAccess(makeRequest(), makeSnapshot({ affiliation }));
      expect(decision.kind).toBe("DENY");
      if (decision.kind === "DENY") {
        expect(decision.reason).toBe("inactive-affiliation");
      }
    }
  });

  it("a clinic WITHOUT any affiliation denies as inactive-affiliation (clinic-scoped demands one)", () => {
    const snapshot: CareTeamAccessSnapshot = {
      grant: makeGrant(),
      patientLink: makeLink(),
      careTeam: makeTeam(),
      practitioner: makePractitioner(),
      organization: makeOrganization(),
      membership: makeMembership(),
      clinic: makeClinic(),
    };
    const decision = evaluateCareTeamAccess(makeRequest(), snapshot);
    expect(decision.kind).toBe("DENY");
    if (decision.kind === "DENY") {
      expect(decision.reason).toBe("inactive-affiliation");
    }
  });

  it("an org-level snapshot (no clinic) has NO clinic/affiliation requirements — and no clinic denials", () => {
    const decision = evaluateCareTeamAccess(makeRequest(), makeSnapshot({ clinicScoped: false }));
    expect(decision.kind).toBe("ALLOW");
  });
});

describe("expired-grant denial via the injected clock (the evaluation instant is injected, never wall-clock)", () => {
  it("denies exactly AT the expiry instant (kernel rule: valid strictly before expiry)", () => {
    const clock = fixedClock(EXPIRES_AT);
    const decision = evaluateCareTeamAccess(makeRequest({ at: clock() }), makeSnapshot());
    expect(decision.kind).toBe("DENY");
    if (decision.kind === "DENY") {
      expect(decision.reason).toBe("expired-grant");
      expect(decision.evaluatedAt).toBe(EXPIRES_AT);
    }
  });

  it("denies AFTER the expiry instant", () => {
    const clock = fixedClock(new Date(EXPIRES_AT.getTime() + 1));
    const decision = evaluateCareTeamAccess(makeRequest({ at: clock() }), makeSnapshot());
    expect(decision.kind).toBe("DENY");
    if (decision.kind === "DENY") {
      expect(decision.reason).toBe("expired-grant");
    }
  });

  it("allows one millisecond BEFORE the expiry instant", () => {
    const clock = fixedClock(new Date(EXPIRES_AT.getTime() - 1));
    const decision = evaluateCareTeamAccess(makeRequest({ at: clock() }), makeSnapshot());
    expect(decision.kind).toBe("ALLOW");
  });

  it("a revoked grant denies BEFORE its expiry too (state outranks time)", () => {
    const decision = evaluateCareTeamAccess(
      makeRequest(),
      makeSnapshot({ grant: makeGrant({ state: "revoked" }) }),
    );
    expect(decision.kind).toBe("DENY");
    if (decision.kind === "DENY") {
      expect(decision.reason).toBe("revoked-grant");
    }
  });
});

describe("allow paths — ONLY when every condition holds", () => {
  it("allows the fully-healthy clinic-scoped snapshot, carrying the audit record and grant id", () => {
    const decision = evaluateCareTeamAccess(makeRequest(), makeSnapshot());
    expect(decision.kind).toBe("ALLOW");
    if (decision.kind === "ALLOW") {
      expect(decision.grantId).toBe(parseGrantId(`grant_${GRANT_BODY}`));
      expect(decision.careTeamRole).toBe("primary-care");
      expect(decision.evaluatedAt).toBe(REQUEST_AT);
      expect(decision.audit).toEqual({
        actor: PRACTITIONER,
        subjectId: SUBJECT,
        permission: "observations:read",
        at: REQUEST_AT,
        decision: "ALLOW",
        reason: CLINICAL_ACCESS_ALLOW_REASON,
      });
      expect(isClinicalAccessAuditRecord(decision.audit)).toBe(true);
    }
  });

  it("allows an entry without a role label (role is optional; the key is simply absent)", () => {
    const decision = evaluateCareTeamAccess(
      makeRequest(),
      makeSnapshot({ careTeam: makeTeam({ entries: [{ practitionerId: PRACTITIONER }] }) }),
    );
    expect(decision.kind).toBe("ALLOW");
    if (decision.kind === "ALLOW") {
      expect("careTeamRole" in decision).toBe(false);
    }
  });

  it("allows every frozen read-only permission when the grant covers it", () => {
    for (const permission of CARE_TEAM_SCOPE_PERMISSIONS) {
      const decision = evaluateCareTeamAccess(
        makeRequest({ permission }),
        makeSnapshot(),
      );
      expect(decision.kind, `permission ${permission} must be allowed`).toBe("ALLOW");
    }
  });

  it("allows a reverified (previously suspended, re-verified) practitioner", () => {
    const decision = evaluateCareTeamAccess(
      makeRequest(),
      makeSnapshot({ practitioner: makePractitioner({ state: "reverified" }) }),
    );
    expect(decision.kind).toBe("ALLOW");
  });

  it("determinism: identical inputs produce identical decisions (pure evaluation)", () => {
    const first = evaluateCareTeamAccess(makeRequest(), makeSnapshot());
    const second = evaluateCareTeamAccess(makeRequest(), makeSnapshot());
    expect(first).toEqual(second);
  });

  it("layering: the decision delegates the grant-side verdict to the REAL kernel evaluator", () => {
    // The kernel alone would ALLOW this grant — but the clinical layer
    // still denies when the patient link is unconfirmed: the kernel
    // allow is necessary, never sufficient.
    const kernelWouldAllow = makeGrant();
    const decision = evaluateCareTeamAccess(
      makeRequest(),
      makeSnapshot({ grant: kernelWouldAllow, patientLink: makeLink({ state: "requested" }) }),
    );
    expect(decision.kind).toBe("DENY");
  });
});

describe("evaluation order is recorded semantics (first failure wins, deterministically)", () => {
  const ORDERED_FAILURES: readonly {
    readonly label: string;
    readonly expected: CareTeamDenyReason;
    readonly request?: Partial<CareTeamAccessRequest>;
    readonly snapshot?: SnapshotOverrides;
  }[] = [
    {
      label: "out-of-vocabulary permission outranks every grant-side failure",
      expected: "unknown-scope-permission",
      request: { permission: "observations:write" },
      snapshot: { grant: makeGrant({ state: "revoked" }) },
    },
    {
      label: "unknown recipient outranks a revoked grant",
      expected: "unknown-recipient",
      snapshot: { grant: makeGrant({ recipientId: "someone-else", state: "revoked" }) },
    },
    {
      label: "grant-side failures (kernel layer) outrank clinical-side failures",
      expected: "expired-grant",
      request: { at: EXPIRES_AT },
      snapshot: { patientLink: makeLink({ state: "requested" }) },
    },
    {
      label: "an unconfirmed link outranks a suspended practitioner and dissolved organization",
      expected: "unconfirmed-patient-link",
      snapshot: {
        patientLink: makeLink({ state: "requested" }),
        practitioner: makePractitioner({ state: "suspended-from-verified" }),
        organization: makeOrganization({ state: "dissolved" }),
      },
    },
    {
      label: "a suspended practitioner outranks a dissolved organization",
      expected: "suspended-practitioner",
      snapshot: {
        practitioner: makePractitioner({ state: "suspended-from-verified" }),
        organization: makeOrganization({ state: "dissolved" }),
      },
    },
    {
      label: "a dissolved organization outranks an inactive membership",
      expected: "dissolved-organization",
      snapshot: {
        organization: makeOrganization({ state: "dissolved" }),
        membership: makeMembership({ active: false }),
      },
    },
    {
      label: "an inactive membership outranks a dissolved clinic",
      expected: "inactive-membership",
      snapshot: {
        membership: makeMembership({ active: false }),
        clinic: makeClinic({ state: "dissolved" }),
      },
    },
  ];

  for (const failure of ORDERED_FAILURES) {
    it(failure.label, () => {
      const decision = evaluateCareTeamAccess(
        makeRequest(failure.request ?? {}),
        makeSnapshot(failure.snapshot ?? {}),
      );
      expect(decision.kind).toBe("DENY");
      if (decision.kind === "DENY") {
        expect(decision.reason).toBe(failure.expected);
      }
    });
  }
});

describe("malformed inputs are data-integrity failures and THROW (kernel discipline)", () => {
  it("a malformed request throws and never returns a decision", () => {
    for (const malformed of [
      {},
      null,
      { subjectId: SUBJECT, practitionerId: PRACTITIONER, purpose: "", permission: "observations:read", at: REQUEST_AT },
      { subjectId: `pract_${PERSON_BODY}`, practitionerId: PRACTITIONER, purpose: "CARE_MANAGEMENT", permission: "observations:read", at: REQUEST_AT },
      { subjectId: SUBJECT, practitionerId: `prsn_${PRACT_BODY}`, purpose: "CARE_MANAGEMENT", permission: "observations:read", at: REQUEST_AT },
      { subjectId: SUBJECT, practitionerId: PRACTITIONER, purpose: "CARE_MANAGEMENT", permission: "observations:read", at: new Date("not-a-date") },
    ]) {
      expect(() =>
        evaluateCareTeamAccess(malformed as CareTeamAccessRequest, makeSnapshot()),
      ).toThrow(DomainInvariantError);
    }
  });

  it("malformed snapshot entities throw (guards run before any evaluation)", () => {
    expect(() =>
      evaluateCareTeamAccess(makeRequest(), makeSnapshot({ patientLink: makeLink({ state: "pending" as never }) })),
    ).toThrow(DomainInvariantError);
    expect(() =>
      evaluateCareTeamAccess(makeRequest(), makeSnapshot({ organization: makeOrganization({ state: "closed" as never }) })),
    ).toThrow(DomainInvariantError);
    expect(() =>
      evaluateCareTeamAccess(makeRequest(), makeSnapshot({ practitioner: makePractitioner({ displayName: "" }) })),
    ).toThrow(DomainInvariantError);
    expect(() =>
      evaluateCareTeamAccess(makeRequest(), makeSnapshot({ membership: makeMembership({ role: "superuser" as never }) })),
    ).toThrow(DomainInvariantError);
    expect(() =>
      evaluateCareTeamAccess(makeRequest(), makeSnapshot({ clinic: makeClinic({ organizationId: `clin_${ORG_BODY}` as never }) })),
    ).toThrow(DomainInvariantError);
  });

  it("a STRUCTURALLY malformed grant with matching subject+recipient throws inside the KERNEL evaluator", () => {
    // Empty scope violates the kernel AccessGrant structural guard; the
    // grant is a candidacy match, so the kernel asserts it — malformed
    // stored data is never silently evaluated.
    const malformedGrant = makeGrant({ scope: [] });
    expect(() =>
      evaluateCareTeamAccess(makeRequest(), makeSnapshot({ grant: malformedGrant })),
    ).toThrow(DomainInvariantError);
  });

  it("the request guard narrows and describes the shape without echoing values", () => {
    expect(isCareTeamAccessRequest(makeRequest())).toBe(true);
    expect(isCareTeamAccessRequest({})).toBe(false);
    expect(() => assertCareTeamAccessRequest(null)).toThrow(DomainInvariantError);
    let message = "";
    try {
      assertCareTeamAccessRequest({ subjectId: "leaky-subject-value" });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("expected");
    expect(message).not.toContain("leaky-subject-value");
  });
});

describe("the read-only scope vocabulary (frozen, kernel-shaped)", () => {
  it("is exactly the three recorded read-only permissions", () => {
    expect(CARE_TEAM_SCOPE_PERMISSIONS).toEqual([
      "observations:read",
      "timeline:read",
      "intent:read",
    ]);
  });

  it("every entry is a well-formed kernel <kind>:<operation> scope permission", () => {
    for (const permission of CARE_TEAM_SCOPE_PERMISSIONS) {
      const segments = careTeamScopePermissionSegments(permission);
      expect(segments.operation).toBe("read");
      expect(segments.resourceKind.length).toBeGreaterThan(0);
    }
  });

  it("no write operation is expressible — requests for write scopes deny as unknown vocabulary", () => {
    for (const writePermission of [
      "observations:write",
      "timeline:write",
      "intent:write",
      "plan:write",
      "plan:read",
      "observations",
      ":read",
      "observations:read:extra",
    ]) {
      const decision = evaluateCareTeamAccess(
        makeRequest({ permission: writePermission }),
        makeSnapshot({ grant: makeGrant({ scope: [writePermission] }) }),
      );
      expect(decision.kind, `permission "${writePermission}" must deny`).toBe("DENY");
      if (decision.kind === "DENY") {
        expect(decision.reason).toBe("unknown-scope-permission");
      }
    }
  });
});

describe("the decision type is a closed discriminated union", () => {
  it("narrows to ALLOW (grantId, careTeamRole) and DENY (typed reason) only", () => {
    const decision = evaluateCareTeamAccess(makeRequest(), makeSnapshot());
    if (decision.kind === "ALLOW") {
      expectTypeOf(decision.kind).toEqualTypeOf<"ALLOW">();
      expectTypeOf(decision.grantId).toEqualTypeOf<AccessGrant["id"]>();
    } else {
      expectTypeOf(decision.kind).toEqualTypeOf<"DENY">();
      expectTypeOf(decision.reason).toEqualTypeOf<CareTeamDenyReason>();
    }
  });

  it("every deny reason in the frozen vocabulary is reachable through the evaluator", () => {
    const reachable = new Set<CareTeamDenyReason>();
    for (const denial of EXHAUSTIVE_DENIALS) {
      const decision = evaluateCareTeamAccess(
        makeRequest(denial.request ?? {}),
        makeSnapshot(denial.snapshot ?? {}),
      );
      if (decision.kind === "DENY") {
        reachable.add(decision.reason);
      }
    }
    expect([...reachable].sort()).toEqual([...CARE_TEAM_DENY_REASONS].sort());
  });
});
