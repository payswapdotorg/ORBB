import { describe, expect, it } from "vitest";
import {
  SMART_ACCESS_ACTIONS,
  SMART_SCOPE_CONTEXT,
  SMART_SCOPE_MODIFIERS,
  SMART_SCOPE_RESOURCE_TYPES,
  formatSmartScope,
  parseSmartScope,
  parseSmartScopeSet,
  scopeGrantsAction,
  smartScopeActions,
  type ScopeValidationReason,
} from "./scopes.js";
import { SmartInvariantError } from "./errors.js";

const producedReasons = new Set<ScopeValidationReason>();

describe("parseSmartScope (frozen grammar)", () => {
  it("accepts every allow-listed resource type with the frozen modifier", () => {
    for (const resourceType of SMART_SCOPE_RESOURCE_TYPES) {
      const result = parseSmartScope(`patient/${resourceType}.rs`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scope).toEqual({ resourceType, modifier: "rs" });
        expect(formatSmartScope(result.scope)).toBe(`patient/${resourceType}.rs`);
      }
    }
  });

  const rejections: readonly { token: string; reason: ScopeValidationReason }[] = [
    // unknown resource type (wrong case, misspelling, wildcard, empty)
    { token: "patient/observation.rs", reason: "SCOPE_UNKNOWN_RESOURCE" },
    { token: "patient/Observations.rs", reason: "SCOPE_UNKNOWN_RESOURCE" },
    { token: "patient/*.rs", reason: "SCOPE_UNKNOWN_RESOURCE" },
    { token: "patient/.rs", reason: "SCOPE_UNKNOWN_RESOURCE" },
    { token: "patient/DiagnosticReport.rs", reason: "SCOPE_UNKNOWN_RESOURCE" },
    // unknown modifier (missing, write-shaped, duplicated letters, spaces)
    { token: "patient/Observation", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.rsd", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.c", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.s", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.crud", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.r s", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.RS", reason: "SCOPE_UNKNOWN_MODIFIER" },
    // wrong / missing context prefix
    { token: "Observation.rs", reason: "SCOPE_MISSING_CONTEXT" },
    { token: "user/Observation.rs", reason: "SCOPE_UNKNOWN_CONTEXT" },
    { token: "system/Observation.rs", reason: "SCOPE_UNKNOWN_CONTEXT" },
    { token: "PATIENT/Observation.rs", reason: "SCOPE_UNKNOWN_CONTEXT" },
    { token: "patient /Observation.rs", reason: "SCOPE_UNKNOWN_CONTEXT" },
    { token: "*/Observation.rs", reason: "SCOPE_UNKNOWN_CONTEXT" },
    { token: "patient*/Observation.rs", reason: "SCOPE_UNKNOWN_CONTEXT" },
    // structural surprises (permissive-grammar adversarial strings)
    { token: "", reason: "SCOPE_MALFORMED" },
    { token: "patient/Observation/rs.rs", reason: "SCOPE_MALFORMED" },
    { token: "patient/Observation..rs", reason: "SCOPE_MALFORMED" },
    { token: "patient//Observation.rs", reason: "SCOPE_MALFORMED" },
    { token: "patient/Observation.rs.d", reason: "SCOPE_MALFORMED" },
    { token: " patient/Observation.rs", reason: "SCOPE_UNKNOWN_CONTEXT" },
    { token: "patient/Observation.rs ", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.rs\n", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Observation.rs%00", reason: "SCOPE_UNKNOWN_MODIFIER" },
    { token: "patient/Ob servation.rs", reason: "SCOPE_UNKNOWN_RESOURCE" },
    { token: "patient/Observation.rs;drop", reason: "SCOPE_UNKNOWN_MODIFIER" },
  ];

  for (const { token, reason } of rejections) {
    it(`rejects ${JSON.stringify(token)} with ${reason}`, () => {
      const result = parseSmartScope(token);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(reason);
        producedReasons.add(result.reason);
        // No-echo discipline: the message describes the grammar, never the token.
        if (token.trim().length > 0) {
          expect(result.message).not.toContain(token.trim());
        }
      }
    });
  }

  it("covers every distinct scope rejection class at least once", () => {
    expect(producedReasons.has("SCOPE_MALFORMED")).toBe(true);
    expect(producedReasons.has("SCOPE_MISSING_CONTEXT")).toBe(true);
    expect(producedReasons.has("SCOPE_UNKNOWN_CONTEXT")).toBe(true);
    expect(producedReasons.has("SCOPE_UNKNOWN_RESOURCE")).toBe(true);
    expect(producedReasons.has("SCOPE_UNKNOWN_MODIFIER")).toBe(true);
  });

  it("throws a programmer error for a non-string token", () => {
    expect(() => parseSmartScope(42 as unknown as string)).toThrow(SmartInvariantError);
  });

  it("rejects case-folding and trimming by construction (exact match only)", () => {
    for (const sneaky of ["Patient/Observation.rs", "patient/OBSERVATION.rs", " patient/Observation.rs"]) {
      const result = parseSmartScope(sneaky);
      expect(result.ok).toBe(false);
    }
  });
});

describe("parseSmartScopeSet (space-delimited wire format)", () => {
  it("parses the full allow-list set", () => {
    const wire = SMART_SCOPE_RESOURCE_TYPES.map((type) => `patient/${type}.rs`).join(" ");
    const result = parseSmartScopeSet(wire);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scopes).toHaveLength(SMART_SCOPE_RESOURCE_TYPES.length);
    }
  });

  it("treats the empty set as VALID (grants nothing)", () => {
    for (const wire of ["", " ", "   "]) {
      const result = parseSmartScopeSet(wire);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scopes).toEqual([]);
      }
    }
  });

  it("collapses runs of spaces and deduplicates (first occurrence wins)", () => {
    const result = parseSmartScopeSet(
      "patient/Observation.rs  patient/Patient.rs patient/Observation.rs",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scopes.map((scope) => formatSmartScope(scope))).toEqual([
        "patient/Observation.rs",
        "patient/Patient.rs",
      ]);
    }
  });

  it("rejects the WHOLE set when one token is invalid (fail-closed, no partial)", () => {
    const result = parseSmartScopeSet("patient/Observation.rs patient/ImagingStudy.rs");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SCOPE_UNKNOWN_RESOURCE");
      expect(result.scopeIndex).toBe(1);
    }
  });

  it("reports the index of the first invalid token", () => {
    const result = parseSmartScopeSet("user/Patient.rs patient/Observation.rs patient/*.*");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.scopeIndex).toBe(0);
      expect(result.reason).toBe("SCOPE_UNKNOWN_CONTEXT");
    }
  });

  it("carries the failing token index from single-parse rejections", () => {
    const result = parseSmartScopeSet("patient/Condition.rs patient/Condition.c");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SCOPE_UNKNOWN_MODIFIER");
      expect(result.scopeIndex).toBe(1);
    }
  });
});

describe("modifier semantics", () => {
  it("maps rs to exactly read + search, in the frozen order", () => {
    const scope = { resourceType: "Observation" as const, modifier: "rs" as const };
    expect(smartScopeActions(scope)).toEqual(["read", "search"]);
    expect(smartScopeActions(scope)).toEqual([...SMART_ACCESS_ACTIONS]);
    expect(scopeGrantsAction(scope, "read")).toBe(true);
    expect(scopeGrantsAction(scope, "search")).toBe(true);
  });

  it("keeps the vocabularies frozen (doctrine guards)", () => {
    expect(SMART_SCOPE_CONTEXT).toBe("patient");
    expect([...SMART_SCOPE_MODIFIERS]).toEqual(["rs"]);
    expect([...SMART_SCOPE_RESOURCE_TYPES]).toEqual([
      "Patient",
      "Observation",
      "Condition",
      "DocumentReference",
    ]);
    expect([...SMART_ACCESS_ACTIONS]).toEqual(["read", "search"]);
  });

  it("throws on scopes from outside the frozen vocabularies", () => {
    expect(() => scopeGrantsAction({ resourceType: "Nope" as "Observation", modifier: "rs" }, "read")).toThrow(
      SmartInvariantError,
    );
    expect(() => formatSmartScope({ resourceType: "Observation", modifier: "zz" as "rs" })).toThrow(
      SmartInvariantError,
    );
  });
});
