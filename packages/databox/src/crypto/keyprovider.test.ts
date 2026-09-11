import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { EnvelopeCryptoError } from "../errors.js";
import {
  DATA_KEY_LENGTH_BYTES,
  GCM_IV_LENGTH_BYTES,
  GCM_TAG_LENGTH_BYTES,
  SecretKeyProvider,
  type DataKey,
  type WrappedDataKey,
} from "./keyprovider.js";

const SECRET_A = "synthetic-dev-secret-AAAA-0001";
const SECRET_B = "synthetic-dev-secret-BBBB-0002";
const SECRET_A_BYTES = new Uint8Array(Buffer.from("synthetic-dev-secret-AAAA-0001", "utf8"));

function freshDataKey(): DataKey {
  return { bytes: new Uint8Array(randomBytes(DATA_KEY_LENGTH_BYTES)) };
}

function tamper(bytes: Uint8Array, index: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[index] = copy[index]! ^ 0xff;
  return copy;
}

describe("SecretKeyProvider construction", () => {
  it("refuses a missing/trivial injected secret (never falls back to a hardcoded one)", () => {
    expect(() => new SecretKeyProvider({ secret: "" })).toThrowError(RangeError);
    expect(() => new SecretKeyProvider({ secret: "short-secret" })).toThrowError(RangeError);
    expect(() => new SecretKeyProvider({ secret: new Uint8Array(4) })).toThrowError(RangeError);
  });

  it("accepts string and Uint8Array secrets of sufficient length", () => {
    expect(() => new SecretKeyProvider({ secret: SECRET_A })).not.toThrow();
    expect(() => new SecretKeyProvider({ secret: SECRET_A_BYTES })).not.toThrow();
  });
});

describe("SecretKeyProvider.generateDataKey", () => {
  it("returns a 32-byte plaintext DEK and a well-formed wrapped DEK", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const generated = await provider.generateDataKey();
    expect(generated.plaintext.bytes).toBeInstanceOf(Uint8Array);
    expect(generated.plaintext.bytes.byteLength).toBe(DATA_KEY_LENGTH_BYTES);
    expect(generated.wrapped.algorithm).toBe("AES-256-GCM");
    expect(generated.wrapped.iv.byteLength).toBe(GCM_IV_LENGTH_BYTES);
    expect(generated.wrapped.tag.byteLength).toBe(GCM_TAG_LENGTH_BYTES);
    expect(generated.wrapped.ciphertext.byteLength).toBe(DATA_KEY_LENGTH_BYTES);
  });

  it("generates different DEKs on successive calls", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const first = await provider.generateDataKey();
    const second = await provider.generateDataKey();
    expect([...first.plaintext.bytes]).not.toEqual([...second.plaintext.bytes]);
    expect([...first.wrapped.iv]).not.toEqual([...second.wrapped.iv]);
  });

  it("the wrapped DEK unwinds to the exact plaintext under the same secret", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const generated = await provider.generateDataKey();
    const unwrapped = await provider.unwrap(generated.wrapped);
    expect([...unwrapped.bytes]).toEqual([...generated.plaintext.bytes]);
  });
});

describe("SecretKeyProvider wrap/unwrap", () => {
  it("round-trips a data key", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const dataKey = freshDataKey();
    const wrapped = await provider.wrap(dataKey);
    const unwrapped = await provider.unwrap(wrapped);
    expect([...unwrapped.bytes]).toEqual([...dataKey.bytes]);
  });

  it("uses a fresh IV per wrap (same key, different wrap output)", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const dataKey = freshDataKey();
    const first = await provider.wrap(dataKey);
    const second = await provider.wrap(dataKey);
    expect([...first.iv]).not.toEqual([...second.iv]);
    expect([...first.ciphertext]).not.toEqual([...second.ciphertext]);
  });

  it("fails with key-unwrap-failure on a tampered DEK ciphertext", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const wrapped = await provider.wrap(freshDataKey());
    const tampered: WrappedDataKey = { ...wrapped, ciphertext: tamper(wrapped.ciphertext, 0) };
    await expect(provider.unwrap(tampered)).rejects.toThrowError(EnvelopeCryptoError);
    await expect(provider.unwrap(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: "key-unwrap-failure" }),
    );
  });

  it("fails with key-unwrap-failure on a tampered GCM tag", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const wrapped = await provider.wrap(freshDataKey());
    const tampered: WrappedDataKey = { ...wrapped, tag: tamper(wrapped.tag, 3) };
    await expect(provider.unwrap(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: "key-unwrap-failure" }),
    );
  });

  it("fails when unwrapping under a different secret (wrapped-key provenance binding)", async () => {
    const wrapping = new SecretKeyProvider({ secret: SECRET_A });
    const unwrapping = new SecretKeyProvider({ secret: SECRET_B });
    const wrapped = await wrapping.wrap(freshDataKey());
    await expect(unwrapping.unwrap(wrapped)).rejects.toThrowError(
      expect.objectContaining({ code: "key-unwrap-failure" }),
    );
  });

  it("fails across key spaces (HKDF domain separation)", async () => {
    const wrapping = new SecretKeyProvider({ secret: SECRET_A, keySpace: "orbb/databox/a" });
    const unwrapping = new SecretKeyProvider({ secret: SECRET_A, keySpace: "orbb/databox/b" });
    const wrapped = await wrapping.wrap(freshDataKey());
    await expect(unwrapping.unwrap(wrapped)).rejects.toThrowError(
      expect.objectContaining({ code: "key-unwrap-failure" }),
    );
  });

  it("rejects malformed wrapped keys before touching crypto", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const malformed: WrappedDataKey = {
      algorithm: "AES-256-GCM",
      iv: new Uint8Array(GCM_IV_LENGTH_BYTES - 1),
      ciphertext: new Uint8Array(DATA_KEY_LENGTH_BYTES),
      tag: new Uint8Array(GCM_TAG_LENGTH_BYTES),
    };
    await expect(provider.unwrap(malformed)).rejects.toThrowError(
      expect.objectContaining({ code: "malformed-envelope" }),
    );
  });

  it("refuses to wrap a wrong-length key", async () => {
    const provider = new SecretKeyProvider({ secret: SECRET_A });
    const bad: DataKey = { bytes: new Uint8Array(16) };
    await expect(provider.wrap(bad)).rejects.toThrowError(
      expect.objectContaining({ code: "malformed-envelope" }),
    );
  });
});
