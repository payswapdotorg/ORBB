import { describe, expect, it } from "vitest";
import { AuthInvariantError } from "../errors.js";
import { decodeCbor, decodeCborItem, encodeCbor, type CborValue } from "./cbor.js";

describe("cbor codec", () => {
  describe("round-trips", () => {
    it.each([
      0, 1, 23, 24, 255, 256, 65_535, 65_536, 4_294_967_295, -1, -24, -25, -256, -4_294_967_296,
    ])("integer %j", (value: number) => {
      const encoded = encodeCbor(value);
      expect(decodeCbor(encoded)).toBe(value);
    });

    it("uint64 above the safe integer range stays a bigint", () => {
      const big = 2n ** 63n - 1n;
      expect(decodeCbor(encodeCbor(big))).toBe(big);
    });

    it.each([new Uint8Array(0), new Uint8Array([0, 1, 2, 255])])(
      "byte string %j",
      (value: Uint8Array) => {
        expect(decodeCbor(encodeCbor(value))).toEqual(value);
      },
    );

    it.each(["", "webauthn.create", "ünicode ✓"])("text string %j", (value: string) => {
      expect(decodeCbor(encodeCbor(value))).toBe(value);
    });

    it.each([true, false, null])("simple value %j", (value: boolean | null) => {
      expect(decodeCbor(encodeCbor(value))).toBe(value);
    });

    it("arrays (nested)", () => {
      const value: CborValue[] = [1, [2, 3], [4, [5, new Uint8Array([9])]]];
      expect(decodeCbor(encodeCbor(value))).toEqual(value);
    });

    it("maps with cose-style negative keys", () => {
      const value = new Map<number, CborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(32).fill(0xab)],
      ]);
      const decoded = decodeCbor(encodeCbor(value));
      expect(decoded).toBeInstanceOf(Map);
      const map = decoded as Map<number, CborValue>;
      expect(map.size).toBe(4);
      expect(map.get(1)).toBe(2);
      expect(map.get(3)).toBe(-7);
      expect(map.get(-2)).toEqual(new Uint8Array(32).fill(0xab));
    });

    it("empty map and empty array", () => {
      expect(decodeCbor(encodeCbor([]))).toEqual([]);
      const decodedMap = decodeCbor(encodeCbor(new Map<number, CborValue>()));
      expect(decodedMap).toBeInstanceOf(Map);
      expect((decodedMap as Map<number, CborValue>).size).toBe(0);
    });
  });

  describe("decoder rejects", () => {
    it("trailing bytes after the top-level item", () => {
      const bytes = new Uint8Array([...encodeCbor(1), 0x00]);
      expect(() => decodeCbor(bytes)).toThrowError(AuthInvariantError);
    });

    it("indefinite-length byte strings", () => {
      expect(() => decodeCbor(Uint8Array.of(0x5f, 0x41, 0x01, 0xff))).toThrowError(
        AuthInvariantError,
      );
    });

    it("tags", () => {
      expect(() => decodeCbor(Uint8Array.of(0xc0, 0x00))).toThrowError(AuthInvariantError);
    });

    it("floats", () => {
      expect(() => decodeCbor(Uint8Array.of(0xf9, 0x3c, 0x00))).toThrowError(AuthInvariantError);
    });

    it("non-primitive simple values", () => {
      expect(() => decodeCbor(Uint8Array.of(0xf8, 0x20))).toThrowError(AuthInvariantError);
    });

    it("truncated arguments", () => {
      expect(() => decodeCbor(Uint8Array.of(0x18))).toThrowError(AuthInvariantError);
      expect(() => decodeCbor(Uint8Array.of(0x19, 0x01))).toThrowError(AuthInvariantError);
    });

    it("truncated byte strings", () => {
      expect(() => decodeCbor(Uint8Array.of(0x43, 0x01, 0x02))).toThrowError(AuthInvariantError);
    });

    it("invalid UTF-8 text", () => {
      expect(() => decodeCbor(Uint8Array.of(0x02, 0xc3, 0x28))).toThrowError(AuthInvariantError);
    });

    it("duplicate map keys (canonical CBOR)", () => {
      expect(() => decodeCbor(Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02))).toThrowError(
        AuthInvariantError,
      );
    });

    it("array/map lengths that overflow the remaining input", () => {
      expect(() => decodeCbor(Uint8Array.of(0x9a, 0xff, 0xff, 0xff, 0xff, 0x01))).toThrowError(
        AuthInvariantError,
      );
    });

    it("empty input", () => {
      expect(() => decodeCbor(new Uint8Array(0))).toThrowError(AuthInvariantError);
    });
  });

  describe("decoder accepts", () => {
    it("decodeCborItem returns the offset just past the item (self-delimiting)", () => {
      const key = encodeCbor(1);
      const buffer = new Uint8Array([...key, 0xde, 0xad]);
      const item = decodeCborItem(buffer, 0);
      expect(item.value).toBe(1);
      expect(item.nextOffset).toBe(key.length);
    });
  });

  describe("encoder rejects", () => {
    it("non-integer numbers", () => {
      expect(() => encodeCbor(1.5)).toThrowError(AuthInvariantError);
    });

    it("unsupported value forms", () => {
      expect(() => encodeCbor(undefined as unknown as CborValue)).toThrowError(AuthInvariantError);
      expect(() => encodeCbor({} as unknown as CborValue)).toThrowError(AuthInvariantError);
    });

    it("unsupported map key forms", () => {
      const bad = new Map<unknown, CborValue>([[true as unknown as number, 1]]);
      expect(() => encodeCbor(bad as unknown as Map<number, CborValue>)).toThrowError(
        AuthInvariantError,
      );
    });
  });

  it("head encoding is minimal-length", () => {
    expect(encodeCbor(0)).toEqual(Uint8Array.of(0x00));
    expect(encodeCbor(23)).toEqual(Uint8Array.of(0x17));
    expect(encodeCbor(24)).toEqual(Uint8Array.of(0x18, 24));
    expect(encodeCbor(256)).toEqual(Uint8Array.of(0x19, 0x01, 0x00));
    expect(encodeCbor(65_536)).toEqual(Uint8Array.of(0x1a, 0x00, 0x01, 0x00, 0x00));
    expect(encodeCbor(-1)).toEqual(Uint8Array.of(0x20));
  });
});
