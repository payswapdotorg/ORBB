import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Checksum } from "./checksum.js";

const HELLO_BYTES = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sha256Checksum (reference ChecksumVerifier)", () => {
  it("matches node:crypto for known input", () => {
    expect(sha256Checksum(HELLO_BYTES)).toBe(HELLO_SHA256);
    expect(sha256Checksum(HELLO_BYTES)).toBe(
      createHash("sha256").update(HELLO_BYTES).digest("hex"),
    );
  });

  it("hashes the empty payload to the well-known empty digest", () => {
    expect(sha256Checksum(new Uint8Array())).toBe(EMPTY_SHA256);
  });

  it("is deterministic and collision-free for distinct inputs", () => {
    const a = sha256Checksum(new Uint8Array([1, 2, 3]));
    const b = sha256Checksum(new Uint8Array([1, 2, 3]));
    const c = sha256Checksum(new Uint8Array([3, 2, 1]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("always emits 64 lowercase hex characters", () => {
    const digest = sha256Checksum(new Uint8Array([9, 9, 9]));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
