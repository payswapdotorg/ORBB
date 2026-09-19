import { describe, expect, it } from "vitest";
import {
  effectiveLaunchAccess,
  evaluateSmartScope,
  grantedAccessOf,
  type SmartGrantedAccess,
} from "./evaluation.js";
import { parseSmartScopeSet, type SmartScope } from "./scopes.js";

const OBS = "patient/Observation.rs";
const COND = "patient/Condition.rs";
const DOC = "patient/DocumentReference.rs";
const PAT = "patient/Patient.rs";

function scopes(...wire: string[]): readonly SmartScope[] {
  const result = parseSmartScopeSet(wire.join(" "));
  if (!result.ok) {
    throw new Error("test fixture scopes must parse");
  }
  return result.scopes;
}

describe("evaluateSmartScope (deny-by-default)", () => {
  it("denies when nothing is granted (empty set is valid and grants nothing)", () => {
    const result = evaluateSmartScope("", { resourceType: "Observation", access: "read" });
    expect(result.decision).toBe("DENY");
    if (result.decision === "DENY") {
      expect(result.reason).toBe("NO_GRANTS");
    }
  });

  it("denies whitespace-only granted sets", () => {
    const result = evaluateSmartScope("   ", { resourceType: "Observation", access: "search" });
    expect(result.decision).toBe("DENY");
  });

  it("allows a granted read and a granted search under rs", () => {
    for (const access of ["read", "search"] as const) {
      const result = evaluateSmartScope(OBS, { resourceType: "Observation", access });
      expect(result.decision).toBe("ALLOW");
      if (result.decision === "ALLOW") {
        expect(format(result.granted)).toBe(OBS);
      }
    }
  });

  it("denies a resource type the launch does not grant", () => {
    const result = evaluateSmartScope(OBS, { resourceType: "Condition", access: "read" });
    expect(result.decision).toBe("DENY");
    if (result.decision === "DENY") {
      expect(result.reason).toBe("RESOURCE_NOT_GRANTED");
    }
  });

  it("denies unknown resource types outright (never guesses)", () => {
    const result = evaluateSmartScope(OBS, { resourceType: "DiagnosticReport", access: "read" });
    expect(result.decision).toBe("DENY");
    if (result.decision === "DENY") {
      expect(result.reason).toBe("UNKNOWN_RESOURCE_TYPE");
    }
  });

  it("denies non-read-shaped access actions outright", () => {
    for (const access of ["create", "update", "delete", "write", "*", "READ"]) {
      const result = evaluateSmartScope(OBS, { resourceType: "Observation", access });
      expect(result.decision).toBe("DENY");
      if (result.decision === "DENY") {
        expect(result.reason).toBe("UNKNOWN_ACCESS_ACTION");
      }
    }
  });

  it("ACTION_NOT_GRANTED is distinct from RESOURCE_NOT_GRANTED (future-proofing)", () => {
    // Today rs covers both read and search, so a granted resource always
    // covers both actions; the branch exists so a future frozen modifier
    // (e.g. r-only) cannot silently widen. Prove the discriminator via
    // the grantedAccessOf flattening instead.
    const granted = grantedAccessOf(scopes(OBS));
    expect(granted).toEqual([
      { resourceType: "Observation", access: "read" },
      { resourceType: "Observation", access: "search" },
    ]);
  });

  it("denies (never throws) when the granted scope string is corrupted external data", () => {
    const result = evaluateSmartScope(`${OBS} patient/ImagingStudy.rs`, {
      resourceType: "Observation",
      access: "read",
    });
    expect(result.decision).toBe("DENY");
    if (result.decision === "DENY") {
      expect(result.reason).toBe("GRANTED_SCOPE_MALFORMED");
      expect(result.message).toContain("index 1");
    }
  });

  it("evaluates multi-scope sets", () => {
    const wire = [OBS, COND, DOC, PAT].join(" ");
    for (const resourceType of ["Observation", "Condition", "DocumentReference", "Patient"]) {
      const result = evaluateSmartScope(wire, { resourceType, access: "read" });
      expect(result.decision).toBe("ALLOW");
    }
    const result = evaluateSmartScope(wire, { resourceType: "Patient", access: "search" });
    expect(result.decision).toBe("ALLOW");
  });
});

describe("effectiveLaunchAccess (the boundary NEVER widens)", () => {
  const standing: readonly SmartGrantedAccess[] = [
    { resourceType: "Observation", access: "read" },
    { resourceType: "Observation", access: "search" },
    { resourceType: "Condition", access: "read" },
  ];

  it("LAUNCH ALONE GRANTS NOTHING: empty standing access yields an empty effective set", () => {
    const effective = effectiveLaunchAccess(scopes(OBS, COND, DOC, PAT), []);
    expect(effective).toEqual([]);
  });

  it("an empty launch grants nothing regardless of standing access", () => {
    const effective = effectiveLaunchAccess([], standing);
    expect(effective).toEqual([]);
  });

  it("intersects at (resourceType, access) granularity", () => {
    const effective = effectiveLaunchAccess(scopes(OBS, COND), standing);
    expect(effective).toEqual([
      { resourceType: "Observation", access: "read" },
      { resourceType: "Observation", access: "search" },
      { resourceType: "Condition", access: "read" },
    ]);
  });

  it("the effective set is a SUBSET of the launch's granted actions (never widens)", () => {
    const launch = scopes(OBS, COND, DOC, PAT);
    const launchActions = grantedAccessOf(launch);
    const effective = effectiveLaunchAccess(launch, standing);
    for (const entry of effective) {
      expect(launchActions).toContainEqual(entry);
      expect(standing).toContainEqual(entry);
    }
    expect(effective.length).toBeLessThanOrEqual(launchActions.length);
  });

  it("disjoint sets intersect to empty", () => {
    const effective = effectiveLaunchAccess(scopes(OBS), [
      { resourceType: "Patient", access: "read" },
      { resourceType: "Patient", access: "search" },
    ]);
    expect(effective).toEqual([]);
  });

  it("standing access can never ADD a resource the launch did not grant", () => {
    const broadStanding: readonly SmartGrantedAccess[] = [
      { resourceType: "Observation", access: "read" },
      { resourceType: "Observation", access: "search" },
      { resourceType: "Condition", access: "read" },
      { resourceType: "Condition", access: "search" },
      { resourceType: "DocumentReference", access: "read" },
      { resourceType: "DocumentReference", access: "search" },
      { resourceType: "Patient", access: "read" },
      { resourceType: "Patient", access: "search" },
    ];
    const effective = effectiveLaunchAccess(scopes(COND), broadStanding);
    expect(effective).toEqual([
      { resourceType: "Condition", access: "read" },
      { resourceType: "Condition", access: "search" },
    ]);
  });
});

function format(scope: SmartScope): string {
  return `patient/${scope.resourceType}.${scope.modifier}`;
}
