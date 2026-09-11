import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildAuthorizationHeader,
  buildCanonicalHeaders,
  buildCanonicalQuery,
  buildCanonicalRequest,
  buildPresignedQuery,
  buildStringToSign,
  computeSignatureHex,
  credentialScope,
  deriveSigningKey,
  EMPTY_PAYLOAD_SHA256_HEX,
  formatAmzDate,
  formatScopeDate,
  sha256Hex,
  uriEncode,
} from "./sigv4.js";

const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const EPOCH_2025_01_15_NOON = Date.UTC(2025, 0, 15, 12, 0, 0);

describe("uriEncode (strict RFC 3986, uppercase hex)", () => {
  it("keeps unreserved characters", () => {
    expect(uriEncode("AZaz09-._~")).toBe("AZaz09-._~");
  });

  it("encodes spaces as %20 and plus as %2B", () => {
    expect(uriEncode("a b+c")).toBe("a%20b%2Bc");
  });

  it("encodes slash by default and preserves it when told to", () => {
    expect(uriEncode("a/b")).toBe("a%2Fb");
    expect(uriEncode("a/b", false)).toBe("a/b");
  });

  it("emits uppercase percent-hex", () => {
    expect(uriEncode("\n")).toBe("%0A");
    expect(uriEncode("=")).toBe("%3D");
  });

  it("encodes non-ASCII as UTF-8 percent sequences", () => {
    expect(uriEncode("é")).toBe("%C3%A9");
    expect(uriEncode("心率")).toBe("%E5%BF%83%E7%8E%87");
  });
});

describe("hashing primitives", () => {
  it("sha256Hex matches the known digests for 'hello' and empty input", () => {
    expect(sha256Hex("hello")).toBe(HELLO_SHA256);
    expect(sha256Hex("")).toBe(EMPTY_PAYLOAD_SHA256_HEX);
    expect(sha256Hex(new Uint8Array())).toBe(EMPTY_PAYLOAD_SHA256_HEX);
    expect(sha256Hex(new Uint8Array([104, 101, 108, 108, 111]))).toBe(HELLO_SHA256);
  });

  it("computeSignatureHex equals a direct node:crypto HMAC", () => {
    const key = new Uint8Array([1, 2, 3, 4]);
    const expected = createHmac("sha256", key).update("data").digest("hex");
    expect(computeSignatureHex(key, "data")).toBe(expected);
  });
});

describe("date formatting", () => {
  it("formats amzDate as YYYYMMDDTHHMMSSZ (UTC)", () => {
    expect(formatAmzDate(0)).toBe("19700101T000000Z");
    expect(formatAmzDate(EPOCH_2025_01_15_NOON)).toBe("20250115T120000Z");
  });

  it("formats the scope date as YYYYMMDD", () => {
    expect(formatScopeDate(0)).toBe("19700101");
    expect(formatScopeDate(EPOCH_2025_01_15_NOON)).toBe("20250115");
  });

  it("builds the credential scope with the aws4_request terminator", () => {
    expect(credentialScope("20250115", "auto", "s3")).toBe("20250115/auto/s3/aws4_request");
  });
});

describe("canonical query", () => {
  it("sorts by encoded key (then value) and joins with &", () => {
    expect(buildCanonicalQuery([["b", "2"], ["a", "1"]])).toBe("a=1&b=2");
    expect(buildCanonicalQuery([["a", "2"], ["a", "1"]])).toBe("a=1&a=2");
  });

  it("strictly encodes keys and values", () => {
    expect(buildCanonicalQuery([["x y", "a/b"]])).toBe("x%20y=a%2Fb");
  });

  it("empty input yields the empty string", () => {
    expect(buildCanonicalQuery([])).toBe("");
  });
});

describe("canonical headers", () => {
  it("lowercases, sorts, trims, and collapses sequential spaces", () => {
    const { canonical, signed } = buildCanonicalHeaders({
      "X-Amz-Date": "20250115T120000Z",
      Host: "example.com",
      "Content-Type": "image/jpeg",
    });
    expect(signed).toBe("content-type;host;x-amz-date");
    expect(canonical).toBe("content-type:image/jpeg\nhost:example.com\nx-amz-date:20250115T120000Z\n");
  });

  it("requires the host header", () => {
    expect(() => buildCanonicalHeaders({ "x-amz-date": "x" })).toThrowError(RangeError);
  });
});

describe("canonical request / string to sign / signature", () => {
  const canonicalRequest = buildCanonicalRequest({
    method: "PUT",
    canonicalUri: "/bucket/evidence/v1/key",
    canonicalQuery: "",
    canonicalHeaders: "host:example.com\n",
    signedHeaders: "host",
    payloadHash: HELLO_SHA256,
  });

  it("joins the six canonical parts with newlines", () => {
    expect(canonicalRequest).toBe(
      ["PUT", "/bucket/evidence/v1/key", "", "host:example.com\n", "host", HELLO_SHA256].join("\n"),
    );
  });

  it("string to sign embeds the algorithm, date, scope, and canonical-request hash", () => {
    const sts = buildStringToSign("20250115T120000Z", "20250115/auto/s3/aws4_request", canonicalRequest);
    expect(sts).toBe(
      ["AWS4-HMAC-SHA256", "20250115T120000Z", "20250115/auto/s3/aws4_request", sha256Hex(canonicalRequest)].join("\n"),
    );
  });

  it("deriveSigningKey matches an independent HMAC chain and is deterministic", () => {
    const secret = "wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLE";
    const chain = (key: Uint8Array | string, data: string): Uint8Array =>
      new Uint8Array(createHmac("sha256", key).update(data, "utf8").digest());
    const expected = chain(
      chain(chain(chain(`AWS4${secret}`, "20250115"), "auto"), "s3"),
      "aws4_request",
    );
    const actual = deriveSigningKey(secret, "20250115", "auto", "s3");
    expect([...actual]).toEqual([...expected]);
    expect([...deriveSigningKey(secret, "20250115", "auto", "s3")]).toEqual([...expected]);
    expect([...deriveSigningKey(secret, "20250116", "auto", "s3")]).not.toEqual([...expected]);
  });

  it("builds the documented Authorization header format", () => {
    expect(buildAuthorizationHeader("AKID", "20250115/auto/s3/aws4_request", "host", "abc123")).toBe(
      "AWS4-HMAC-SHA256 Credential=AKID/20250115/auto/s3/aws4_request, SignedHeaders=host, Signature=abc123",
    );
  });
});

describe("presigned query", () => {
  it("contains the five query-auth parameters in canonical order", () => {
    const query = buildPresignedQuery(
      { accessKeyId: "AKID", secretAccessKey: "secret" },
      "20250115/auto/s3/aws4_request",
      "20250115T120000Z",
      "host",
      300,
    );
    expect(query).toBe(
      "X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKID%2F20250115%2Fauto%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20250115T120000Z" +
        "&X-Amz-Expires=300" +
        "&X-Amz-SignedHeaders=host",
    );
  });

  it("encodes the semicolons in signed header lists", () => {
    const query = buildPresignedQuery(
      { accessKeyId: "AKID", secretAccessKey: "secret" },
      "20250115/auto/s3/aws4_request",
      "20250115T120000Z",
      "content-type;host",
      60,
    );
    expect(query).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
  });

  it("enforces the S3 TTL bounds (1 .. 604800 integer)", () => {
    const args = [
      { accessKeyId: "AKID", secretAccessKey: "secret" },
      "20250115/auto/s3/aws4_request",
      "20250115T120000Z",
      "host",
    ] as const;
    expect(() => buildPresignedQuery(...args, 0)).toThrowError(RangeError);
    expect(() => buildPresignedQuery(...args, 604_801)).toThrowError(RangeError);
    expect(() => buildPresignedQuery(...args, 1.5)).toThrowError(RangeError);
    expect(() => buildPresignedQuery(...args, 1)).not.toThrow();
    expect(() => buildPresignedQuery(...args, 604_800)).not.toThrow();
  });
});
