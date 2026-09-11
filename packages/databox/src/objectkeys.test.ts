import { describe, expect, it } from "vitest";
import { parseEvidenceId, parsePersonId } from "@orbb/domain";
import { UploadFlowError } from "./errors.js";
import { contentAddressedKey, isSha256Hex, parseSha256Hex } from "./objectkeys.js";

const OBJECT_ID = parseEvidenceId("evid_TESTobjectid000001");
const OTHER_OBJECT_ID = parseEvidenceId("evid_TESTobjectid000002");
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("contentAddressedKey", () => {
  it("is deterministic: same inputs produce the identical key", () => {
    const first = contentAddressedKey(OBJECT_ID, HELLO_SHA256);
    const second = contentAddressedKey(OBJECT_ID, HELLO_SHA256);
    expect(first).toBe(second);
  });

  it("addresses objects as opaque id + content hash under the evidence namespace", () => {
    const key = contentAddressedKey(OBJECT_ID, HELLO_SHA256);
    expect(key).toBe(`evidence/v1/${OBJECT_ID}/${HELLO_SHA256}`);
  });

  it("changes when the content hash changes", () => {
    expect(contentAddressedKey(OBJECT_ID, HELLO_SHA256)).not.toBe(
      contentAddressedKey(OBJECT_ID, EMPTY_SHA256),
    );
  });

  it("changes when the object id changes", () => {
    expect(contentAddressedKey(OBJECT_ID, HELLO_SHA256)).not.toBe(
      contentAddressedKey(OTHER_OBJECT_ID, HELLO_SHA256),
    );
  });

  it("rejects non-evidence ids without echoing the value", () => {
    const badId = parsePersonId("prsn_TESTpersonid00001") as unknown as typeof OBJECT_ID;
    expect(() => contentAddressedKey(badId, HELLO_SHA256)).toThrowError(UploadFlowError);
    expect(() => contentAddressedKey(badId, HELLO_SHA256)).toThrowError(
      expect.objectContaining({ code: "invalid-request" }),
    );
  });

  it("rejects invalid digests (uppercase, short, non-hex, non-string)", () => {
    const uppercase = HELLO_SHA256.toUpperCase();
    expect(() => contentAddressedKey(OBJECT_ID, uppercase)).toThrowError(
      expect.objectContaining({ code: "invalid-request" }),
    );
    expect(() => contentAddressedKey(OBJECT_ID, "abc123")).toThrowError(UploadFlowError);
    expect(() => contentAddressedKey(OBJECT_ID, 42 as unknown as string)).toThrowError(
      UploadFlowError,
    );
    expect(() => contentAddressedKey(OBJECT_ID, "")).toThrowError(UploadFlowError);
  });
});

describe("sha256 hex guard", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(isSha256Hex(HELLO_SHA256)).toBe(true);
    expect(isSha256Hex(EMPTY_SHA256)).toBe(true);
  });

  it("rejects uppercase, wrong length, and non-strings", () => {
    expect(isSha256Hex(HELLO_SHA256.toUpperCase())).toBe(false);
    expect(isSha256Hex("abc")).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
    expect(isSha256Hex(1234)).toBe(false);
  });

  it("parseSha256Hex returns the value for valid input and throws otherwise", () => {
    expect(parseSha256Hex(HELLO_SHA256)).toBe(HELLO_SHA256);
    expect(() => parseSha256Hex("nope")).toThrowError(UploadFlowError);
  });
});
