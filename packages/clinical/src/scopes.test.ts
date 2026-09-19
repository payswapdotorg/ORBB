import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError } from "@orbb/domain";
import {
  CARE_TEAM_SCOPE_PERMISSIONS,
  careTeamScopePermissionSegments,
  isCareTeamScopePermission,
  parseCareTeamScopePermission,
  type CareTeamScopePermission,
} from "./scopes.js";

describe("the frozen care-team scope vocabulary", () => {
  it("is exactly observations:read | timeline:read | intent:read", () => {
    expect(CARE_TEAM_SCOPE_PERMISSIONS).toEqual([
      "observations:read",
      "timeline:read",
      "intent:read",
    ]);
    expectTypeOf<CareTeamScopePermission>().toEqualTypeOf<
      "observations:read" | "timeline:read" | "intent:read"
    >();
  });

  it("guards and parses the closed set", () => {
    expect(isCareTeamScopePermission("observations:read")).toBe(true);
    expect(isCareTeamScopePermission("timeline:read")).toBe(true);
    expect(isCareTeamScopePermission("intent:read")).toBe(true);
    expect(isCareTeamScopePermission("observations:write")).toBe(false);
    expect(isCareTeamScopePermission("observation")).toBe(false);
    expect(isCareTeamScopePermission("")).toBe(false);
    expect(isCareTeamScopePermission(42)).toBe(false);
    expect(() => parseCareTeamScopePermission("plan:read")).toThrow(DomainInvariantError);
    expect(parseCareTeamScopePermission("timeline:read")).toBe("timeline:read");
  });

  it("every entry segments as a REAL kernel <kind>:<operation> permission", () => {
    expect(careTeamScopePermissionSegments("observations:read")).toEqual({
      resourceKind: "observations",
      operation: "read",
    });
    expect(careTeamScopePermissionSegments("timeline:read")).toEqual({
      resourceKind: "timeline",
      operation: "read",
    });
    expect(careTeamScopePermissionSegments("intent:read")).toEqual({
      resourceKind: "intent",
      operation: "read",
    });
  });

  it("READ-ONLY by construction: no entry carries a non-read operation", () => {
    for (const permission of CARE_TEAM_SCOPE_PERMISSIONS) {
      expect(careTeamScopePermissionSegments(permission).operation).toBe("read");
    }
    const writable = CARE_TEAM_SCOPE_PERMISSIONS.filter(
      (permission) => careTeamScopePermissionSegments(permission).operation !== "read",
    );
    expect(writable).toEqual([]);
  });
});
