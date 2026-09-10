import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import {
  ID_PREFIXES,
  isDeviceId,
  isIdOf,
  isPersonId,
  isProvenanceId,
  parseDeviceId,
  parseId,
  parsePersonId,
  parseProvenanceId,
  parseSourceId,
  type CanonicalIdKind,
} from "./ids.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

function canonicalId(kind: CanonicalIdKind, body: string = BODY): string {
  return `${ID_PREFIXES[kind]}_${body}`;
}

describe("canonical ids", () => {
  it("parses a canonical id for every kind", () => {
    const kinds: readonly CanonicalIdKind[] = [
      "person",
      "intent",
      "observation",
      "evidence",
      "plan",
      "task",
      "grant",
      "device",
      "source",
      "provenance",
    ];
    for (const kind of kinds) {
      const id = canonicalId(kind);
      expect(parseId(kind, id)).toBe(id);
      expect(isIdOf(kind, id)).toBe(true);
    }
  });

  it("rejects ids carrying the wrong kind prefix", () => {
    expect(() => parsePersonId(canonicalId("device"))).toThrow(DomainInvariantError);
    expect(() => parseDeviceId(canonicalId("person"))).toThrow(DomainInvariantError);
    expect(() => parseProvenanceId(canonicalId("task"))).toThrow(DomainInvariantError);
  });

  it("rejects malformed id bodies", () => {
    expect(() => parsePersonId("prsn_short")).toThrow(DomainInvariantError);
    expect(() => parsePersonId("prsn_")).toThrow(DomainInvariantError);
    expect(() => parsePersonId(`prsn_${"x".repeat(129)}`)).toThrow(DomainInvariantError);
    expect(() => parsePersonId(`prsn_${"!".repeat(26)}`)).toThrow(DomainInvariantError);
    expect(() => parsePersonId("prsn")).toThrow(DomainInvariantError);
  });

  it("rejects non-string values", () => {
    expect(() => parsePersonId(42)).toThrow(DomainInvariantError);
    expect(() => parsePersonId(null)).toThrow(DomainInvariantError);
    expect(() => parsePersonId(undefined)).toThrow(DomainInvariantError);
    expect(() => parsePersonId({ id: "prsn_01h45y6e8x2xq4n8v3m2k9abcd" })).toThrow(
      DomainInvariantError,
    );
  });

  it("error messages describe the grammar without echoing the value", () => {
    let message = "";
    try {
      parsePersonId("prsn_leaky!value-that-must-not-appear");
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("prsn");
    expect(message).not.toContain("leaky-value-that-must-not-appear");
  });

  it("type guards narrow to the branded types", () => {
    expect(isPersonId(canonicalId("person"))).toBe(true);
    expect(isPersonId(canonicalId("device"))).toBe(false);
    expect(isPersonId(123)).toBe(false);
    expect(isDeviceId(canonicalId("device"))).toBe(true);
    expect(isProvenanceId(canonicalId("provenance"))).toBe(true);
    expect(isIdOf("grant", canonicalId("grant"))).toBe(true);
    expect(isIdOf("grant", canonicalId("plan"))).toBe(false);
  });

  it("exposes exactly one fixed prefix per kind", () => {
    expect(ID_PREFIXES).toEqual({
      person: "prsn",
      intent: "intent",
      observation: "obs",
      evidence: "evid",
      plan: "plan",
      task: "task",
      grant: "grant",
      device: "dev",
      source: "src",
      provenance: "prov",
    });
  });

  it("round-trips prefixed ULID-shaped and UUID-shaped bodies", () => {
    expect(parseDeviceId("dev_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(
      "dev_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    );
    expect(parseSourceId("src_3f2b8a4c1d9e0f7a6b5c4d3e2f1a0b9c")).toBe(
      "src_3f2b8a4c1d9e0f7a6b5c4d3e2f1a0b9c",
    );
  });
});
