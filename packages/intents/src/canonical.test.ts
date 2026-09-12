import { describe, expect, it } from "vitest";
import {
  canonicalJsonStringify,
  hashWithDomainBase64Url,
  sha256Base64Url,
  sha256Hex,
} from "./canonical.js";
import { IntentEngineError } from "./errors.js";

describe("canonical JSON serialization (A36 determinism core)", () => {
  it("sorts object keys lexicographically at every level", () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe(
      canonicalJsonStringify({ a: 2, b: 1 }),
    );
    expect(canonicalJsonStringify({ z: { d: 1, c: 2 }, a: [3, 1] })).toBe(
      '{"a":[3,1],"z":{"c":2,"d":1}}',
    );
  });

  it("preserves array element order (order is semantic)", () => {
    expect(canonicalJsonStringify([2, 1])).toBe("[2,1]");
    expect(canonicalJsonStringify([2, 1])).not.toBe(canonicalJsonStringify([1, 2]));
  });

  it("serializes Dates as epoch milliseconds (same instant, same string)", () => {
    expect(canonicalJsonStringify(new Date(1_000))).toBe("1000");
    expect(canonicalJsonStringify({ at: new Date(5_000) })).toBe('{"at":5000}');
    expect(canonicalJsonStringify({ at: new Date(5_000) })).toBe(
      canonicalJsonStringify({ at: new Date(5_000) }),
    );
  });

  it("drops undefined-valued properties (absent == present-undefined)", () => {
    expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJsonStringify({ b: 1 })).toBe('{"b":1}');
  });

  it("escapes strings exactly like JSON.stringify", () => {
    expect(canonicalJsonStringify('a"b\\c\n')).toBe(JSON.stringify('a"b\\c\n'));
  });

  it("serializes primitives and null", () => {
    expect(canonicalJsonStringify(null)).toBe("null");
    expect(canonicalJsonStringify(true)).toBe("true");
    expect(canonicalJsonStringify(false)).toBe("false");
    expect(canonicalJsonStringify(42)).toBe("42");
    expect(canonicalJsonStringify(0.5)).toBe("0.5");
  });

  it("throws typed IntentEngineError on non-canonicalizable values", () => {
    expect(() => canonicalJsonStringify(Number.NaN)).toThrow(IntentEngineError);
    expect(() => canonicalJsonStringify(Number.POSITIVE_INFINITY)).toThrow(IntentEngineError);
    expect(() => canonicalJsonStringify(() => 1)).toThrow(IntentEngineError);
    expect(() => canonicalJsonStringify(new Date(Number.NaN))).toThrow(IntentEngineError);
  });

  it("throws typed IntentEngineError on cyclic structures (depth guard)", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJsonStringify(cyclic)).toThrow(IntentEngineError);
  });
});

describe("content digests (A36 hashing)", () => {
  it("sha256Hex matches the well-known empty-input digest", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("sha256Hex produces a 64-char hex digest; equal input, equal digest", () => {
    const digest = sha256Hex("orbb");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("orbb")).toBe(digest);
    expect(sha256Hex("orbb2")).not.toBe(digest);
  });

  it("sha256Base64Url produces a 43-char URL-safe digest", () => {
    const digest = sha256Base64Url("orbb");
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Base64Url("orbb")).toBe(digest);
  });

  it("hashWithDomainBase64Url domain-separates identical content", () => {
    const value = { a: 1 };
    expect(hashWithDomainBase64Url("orbb/one", value)).not.toBe(
      hashWithDomainBase64Url("orbb/two", value),
    );
    expect(hashWithDomainBase64Url("orbb/one", value)).toBe(
      hashWithDomainBase64Url("orbb/one", { a: 1 }),
    );
  });
});
