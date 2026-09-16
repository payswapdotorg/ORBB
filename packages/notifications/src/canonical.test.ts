import { describe, expect, it } from "vitest";
import {
  canonicalJsonStringify,
  hashWithDomainBase64Url,
  sha256Hex,
} from "./canonical.js";
import { NotificationEngineError } from "./errors.js";

describe("B8 canonical JSON serialization — the determinism kernel", () => {
  it("is invariant to property insertion order", () => {
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe(
      canonicalJsonStringify({ a: 1, b: 2 }),
    );
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("serializes Dates as epoch-millisecond integers (same instant, same string)", () => {
    expect(canonicalJsonStringify({ at: new Date(1234) })).toBe('{"at":1234}');
    expect(canonicalJsonStringify({ at: new Date(1234) })).toBe(
      canonicalJsonStringify({ at: new Date(1234) }),
    );
  });

  it("drops undefined-valued properties (absent == present-but-undefined)", () => {
    expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJsonStringify({ b: 1 })).toBe(canonicalJsonStringify({ a: undefined, b: 1 }));
  });

  it("preserves array element order (order is semantic)", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJsonStringify(["b", "a"])).toBe('["b","a"]');
  });

  it("escapes strings exactly as JSON.stringify does", () => {
    expect(canonicalJsonStringify({ s: 'a"b\\c\nd' })).toBe(
      JSON.stringify({ s: 'a"b\\c\nd' }),
    );
  });

  it("hashes deterministically with domain separation", () => {
    expect(sha256Hex("orbb")).toHaveLength(64);
    expect(sha256Hex("orbb")).toBe(sha256Hex("orbb"));
    expect(hashWithDomainBase64Url("domain-a", { x: 1 })).not.toBe(
      hashWithDomainBase64Url("domain-b", { x: 1 }),
    );
    expect(hashWithDomainBase64Url("d", { x: 1 })).toHaveLength(43);
  });

  it("rejects non-canonicalizable values with the engine error taxonomy", () => {
    expect(() => canonicalJsonStringify(Number.NaN)).toThrow(NotificationEngineError);
    expect(() => canonicalJsonStringify(Number.POSITIVE_INFINITY)).toThrow(
      NotificationEngineError,
    );
    expect(() => canonicalJsonStringify(new Date(Number.NaN))).toThrow(NotificationEngineError);
    expect(() => canonicalJsonStringify(() => 1)).toThrow(NotificationEngineError);
    expect(() => canonicalJsonStringify(Symbol("x"))).toThrow(NotificationEngineError);
    expect(() => canonicalJsonStringify(1n)).toThrow(NotificationEngineError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJsonStringify(cyclic)).toThrow(NotificationEngineError);
  });
});
