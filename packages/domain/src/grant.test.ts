import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import { parseGrantId, parsePersonId } from "./ids.js";
import {
  GRANT_STATE_TRANSITIONS,
  allowedGrantTransitions,
  assertGrantTransition,
  canTransitionGrant,
  isGrantState,
  parseGrantState,
  type AccessGrant,
} from "./grant.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

describe("grant state machine", () => {
  it("allows active -> revoked", () => {
    expect(canTransitionGrant("active", "revoked")).toBe(true);
    expect(() => assertGrantTransition("active", "revoked")).not.toThrow();
  });

  it("rejects illegal transitions out of and into terminal or current states", () => {
    expect(canTransitionGrant("revoked", "active")).toBe(false);
    expect(canTransitionGrant("active", "active")).toBe(false);
    expect(canTransitionGrant("revoked", "revoked")).toBe(false);
    expect(() => assertGrantTransition("revoked", "active")).toThrow(DomainInvariantError);
    expect(() => assertGrantTransition("active", "active")).toThrow(DomainInvariantError);
  });

  it("treats revoked as terminal", () => {
    expect(allowedGrantTransitions("revoked")).toEqual([]);
    expect(GRANT_STATE_TRANSITIONS.revoked).toEqual([]);
  });

  it("parses legal states and rejects unknown state names", () => {
    expect(parseGrantState("active")).toBe("active");
    expect(isGrantState("revoked")).toBe(true);
    expect(isGrantState("expired")).toBe(false);
    expect(() => parseGrantState("expired")).toThrow(DomainInvariantError);
    expect(() => parseGrantState([])).toThrow(DomainInvariantError);
  });

  it("accepts a well-formed AccessGrant", () => {
    const grant: AccessGrant = {
      id: parseGrantId(`grant_${BODY}`),
      subjectId: parsePersonId(`prsn_${BODY}`),
      recipientId: "recipient-clinic-42",
      purpose: "CARE_MANAGEMENT",
      scope: ["observations:read", "intent:read"],
      state: "active",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(grant.state).toBe("active");
    expect(grant.scope).toEqual(["observations:read", "intent:read"]);
  });
});
