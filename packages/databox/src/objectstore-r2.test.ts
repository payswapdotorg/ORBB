import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { ObjectStoreError } from "./errors.js";
import { R2ObjectStore } from "./objectstore-r2.js";
import { EMPTY_PAYLOAD_SHA256_HEX } from "./sigv4.js";

/**
 * A16 R2 adapter tests — SHAPE-VERIFIED, NOT LIVE-VERIFIED (deliberately
 * labeled): every request is captured from an injected fetch stub and
 * checked for method, path-style URL, SigV4 auth headers, and expiry.
 * Signatures are additionally re-computed INDEPENDENTLY from the captured
 * wire request (test-side SigV4 reimplementation) so the issued signature
 * is provably consistent with the request it authorizes. No network.
 */
const NOW_MS = Date.UTC(2025, 0, 15, 12, 0, 0);
const ENDPOINT = "https://testacct.r2.cloudflarestorage.com";
const ACCESS_KEY_ID = "AKIDEXAMPLEKEY0001";
const SECRET_ACCESS_KEY = "wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLE";
const BUCKET = "orbb-evidence-test";

const CONFIG = {
  endpoint: ENDPOINT,
  region: "auto",
  accessKeyId: ACCESS_KEY_ID,
  secretAccessKey: SECRET_ACCESS_KEY,
  bucket: BUCKET,
} as const;

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array | undefined;
}

interface FetchHarness {
  readonly fetchImpl: typeof fetch;
  readonly requests: CapturedRequest[];
}

function createHarness(respond: (request: CapturedRequest) => Response): FetchHarness {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: Uint8Array | undefined;
    if (init?.body !== undefined) {
      body = new Uint8Array(await new Response(init.body as NonNullable<RequestInit["body"]>).arrayBuffer());
    }
    const request: CapturedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body,
    };
    requests.push(request);
    return respond(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function makeStore(harness: FetchHarness, nowMs: () => number = () => NOW_MS): R2ObjectStore {
  return new R2ObjectStore({ ...CONFIG }, { fetchImpl: harness.fetchImpl, nowMs });
}

// ---------------------------------------------------------------------------
// Independent test-side SigV4 recomputation (from the captured wire form).
// ---------------------------------------------------------------------------

function testUriEncode(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function testSha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function testHmac(key: Uint8Array | string, data: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(data, "utf8").digest());
}

function testSigningKey(secret: string, scopeDate: string, region: string, service: string): Uint8Array {
  return testHmac(testHmac(testHmac(testHmac(`AWS4${secret}`, scopeDate), region), service), "aws4_request");
}

function testCanonicalQuery(url: URL, excludeSignature: boolean): string {
  const pairs = [...url.searchParams.entries()].filter(
    ([key]) => !(excludeSignature && key === "X-Amz-Signature"),
  );
  return pairs
    .map(([key, value]) => [testUriEncode(key), testUriEncode(value)] as const)
    .sort(([aKey, aVal], [bKey, bVal]) =>
      aKey === bKey ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) : aKey < bKey ? -1 : 1,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** Re-derives the Authorization signature from the captured request. */
function verifyHeaderSignature(request: CapturedRequest): void {
  const url = new URL(request.url);
  const authorization = request.headers["authorization"] ?? "";
  const credential = /Credential=([^,]+)/.exec(authorization)?.[1];
  const signedHeaders = /SignedHeaders=([^,]+)/.exec(authorization)?.[1];
  const signature = /Signature=([0-9a-f]{64})$/.exec(authorization)?.[1];
  expect(credential, "authorization carries a Credential").toBeDefined();
  expect(signedHeaders, "authorization carries SignedHeaders").toBeDefined();
  expect(signature, "authorization carries a 64-hex Signature").toBeDefined();

  const amzDate = request.headers["x-amz-date"] ?? "";
  const payloadHash = request.headers["x-amz-content-sha256"] ?? "";
  const headerValues: Record<string, string> = { host: url.host };
  for (const [name, value] of Object.entries(request.headers)) {
    headerValues[name.toLowerCase()] = value;
  }
  const canonicalHeaders =
    (signedHeaders ?? "")
      .split(";")
      .map((name) => `${name}:${(headerValues[name] ?? "").trim()}`)
      .sort()
      .join("\n") + "\n";
  const canonicalRequest = [
    request.method,
    url.pathname,
    testCanonicalQuery(url, false),
    canonicalHeaders,
    signedHeaders ?? "",
    payloadHash,
  ].join("\n");
  const scope = (credential ?? "").split("/").slice(1).join("/");
  const [scopeDate = "", region = "", service = ""] = scope.split("/");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, testSha256Hex(canonicalRequest)].join("\n");
  const expected = createHmac("sha256", testSigningKey(SECRET_ACCESS_KEY, scopeDate, region, service))
    .update(stringToSign, "utf8")
    .digest("hex");
  expect(signature).toBe(expected);
}

/** Re-derives the X-Amz-Signature of a presigned URL from its wire form. */
function verifyPresignedSignature(urlString: string, method: string, boundHeaders: Record<string, string> = {}): void {
  const url = new URL(urlString);
  const signature = url.searchParams.get("X-Amz-Signature");
  expect(signature).toMatch(/^[0-9a-f]{64}$/);
  const amzDate = url.searchParams.get("X-Amz-Date") ?? "";
  const credential = url.searchParams.get("X-Amz-Credential") ?? "";
  const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
  const scope = credential.split("/").slice(1).join("/");
  const [scopeDate = "", region = "", service = ""] = scope.split("/");
  const canonicalHeaders =
    signedHeaders
      .split(";")
      .map((name) => (name === "host" ? `host:${url.host}` : `${name}:${boundHeaders[name] ?? ""}`))
      .sort()
      .join("\n") + "\n";
  const canonicalRequest = [
    method,
    url.pathname,
    testCanonicalQuery(url, true),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, testSha256Hex(canonicalRequest)].join("\n");
  const expected = createHmac("sha256", testSigningKey(SECRET_ACCESS_KEY, scopeDate, region, service))
    .update(stringToSign, "utf8")
    .digest("hex");
  expect(signature).toBe(expected);
}

// ---------------------------------------------------------------------------
// put / get / delete / exists / list.
// ---------------------------------------------------------------------------

describe("R2ObjectStore.put (shape-verified, not live-verified)", () => {
  it("issues a SigV4-signed PUT to the path-style object URL", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const harness = createHarness(() => new Response(null, { status: 200 }));
    const store = makeStore(harness);
    const key = "evidence/v1/evid_TESTobjectid000001/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    const summary = await store.put(key, { bytes, contentType: "image/jpeg" });

    expect(summary).toEqual({ key, sizeBytes: 5, contentType: "image/jpeg" });
    expect(harness.requests).toHaveLength(1);
    const request = harness.requests[0]!;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(`${ENDPOINT}/${BUCKET}/${key}`);
    expect(request.headers["content-type"]).toBe("image/jpeg");
    expect(request.headers["x-amz-date"]).toBe("20250115T120000Z");
    expect(request.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(request.headers["authorization"]).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/20250115/auto/s3/aws4_request, ` +
          "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, " +
          "Signature=[0-9a-f]{64}$",
      ),
    );
    expect("host" in request.headers).toBe(false); // host is set by the HTTP layer, signed implicitly
    expect(request.body).toBeDefined();
    expect([...(request.body ?? [])]).toEqual([...bytes]);
    verifyHeaderSignature(request);
  });

  it("percent-encodes unsafe key characters per segment in the URL and signature", async () => {
    const harness = createHarness(() => new Response(null, { status: 200 }));
    const store = makeStore(harness);
    const key = "evidence/v1/evid_TESTobjectid000001/a b+c";

    await store.put(key, { bytes: new Uint8Array([7]), contentType: "text/plain" });

    const request = harness.requests[0]!;
    expect(request.url).toBe(`${ENDPOINT}/${BUCKET}/evidence/v1/evid_TESTobjectid000001/a%20b%2Bc`);
    verifyHeaderSignature(request);
  });

  it("rejects invalid keys before any request is issued", async () => {
    const harness = createHarness(() => new Response(null, { status: 200 }));
    const store = makeStore(harness);
    await expect(
      store.put("/absolute/key", { bytes: new Uint8Array([1]), contentType: "text/plain" }),
    ).rejects.toThrowError(RangeError);
    await expect(
      store.put("", { bytes: new Uint8Array([1]), contentType: "text/plain" }),
    ).rejects.toThrowError(RangeError);
    expect(harness.requests).toHaveLength(0);
  });
});

describe("R2ObjectStore.get", () => {
  it("issues a signed GET and returns the stored object", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const harness = createHarness(
      () => new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    const store = makeStore(harness);
    const key = "evidence/v1/evid_TESTobjectid000001/deadbeef";

    const record = await store.get(key);

    expect(record).toEqual({
      key,
      data: { bytes, contentType: "application/pdf" },
      sizeBytes: 3,
    });
    const request = harness.requests[0]!;
    expect(request.method).toBe("GET");
    expect(request.url).toBe(`${ENDPOINT}/${BUCKET}/${key}`);
    expect(request.headers["x-amz-content-sha256"]).toBe(EMPTY_PAYLOAD_SHA256_HEX);
    verifyHeaderSignature(request);
  });

  it("maps 404 to undefined", async () => {
    const harness = createHarness(() => new Response(null, { status: 404 }));
    const store = makeStore(harness);
    expect(await store.get("evidence/v1/missing/key")).toBeUndefined();
    expect(harness.requests).toHaveLength(1);
  });
});

describe("R2ObjectStore.delete", () => {
  it("issues a signed DELETE and resolves on 204", async () => {
    const harness = createHarness(() => new Response(null, { status: 204 }));
    const store = makeStore(harness);
    await expect(store.delete("evidence/v1/evid_TESTobjectid000001/x")).resolves.toBeUndefined();
    const request = harness.requests[0]!;
    expect(request.method).toBe("DELETE");
    verifyHeaderSignature(request);
  });
});

describe("R2ObjectStore.exists", () => {
  it("HEADs the object: 200 => true, 404 => false", async () => {
    const harness = createHarness((request) =>
      request.url.endsWith("/present") ? new Response(null, { status: 200 }) : new Response(null, { status: 404 }),
    );
    const store = makeStore(harness);
    expect(await store.exists("evidence/v1/evid_TESTobjectid000001/present")).toBe(true);
    expect(await store.exists("evidence/v1/evid_TESTobjectid000001/absent")).toBe(false);
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0]!.method).toBe("HEAD");
    verifyHeaderSignature(harness.requests[0]!);
  });
});

describe("R2ObjectStore.list (ListObjectsV2 + HEAD follow-up)", () => {
  const PAGE_1 = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${BUCKET}</Name>
  <Prefix>evidence/v1/</Prefix>
  <KeyCount>2</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>1ueGcxLPRa1Ax/2Y/mximI==</NextContinuationToken>
  <Contents><Key>evidence/v1/evid_A0001</Key><LastModified>2025-01-15T12:00:00.000Z</LastModified><Size>11</Size><StorageClass>STANDARD</StorageClass></Contents>
  <Contents><Key>evidence/v1/evid_B0002</Key><LastModified>2025-01-15T12:00:00.000Z</LastModified><Size>7</Size><StorageClass>STANDARD</StorageClass></Contents>
</ListBucketResult>`;
  const PAGE_2 = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${BUCKET}</Name>
  <Prefix>evidence/v1/</Prefix>
  <KeyCount>1</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>evidence/v1/evid_C&amp;D</Key><LastModified>2025-01-15T12:00:00.000Z</LastModified><Size>42</Size><StorageClass>STANDARD</StorageClass></Contents>
</ListBucketResult>`;

  function listHarness(): FetchHarness {
    const contentTypes: Record<string, string> = {
      "evidence/v1/evid_A0001": "image/jpeg",
      "evidence/v1/evid_B0002": "text/plain",
      "evidence/v1/evid_C&D": "application/json",
    };
    return createHarness((request) => {
      const url = new URL(request.url);
      if (request.method === "HEAD") {
        const key = decodeURIComponent(url.pathname.replace(`/${BUCKET}/`, ""));
        const contentType = contentTypes[key];
        if (contentType === undefined) {
          return new Response(null, { status: 404 });
        }
        return new Response(null, { status: 200, headers: { "content-type": contentType } });
      }
      if (request.method === "GET" && url.pathname === `/${BUCKET}/`) {
        const token = url.searchParams.get("continuation-token");
        return new Response(token === null ? PAGE_1 : PAGE_2, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      return new Response(null, { status: 500 });
    });
  }

  it("paginates, decodes XML entities, and HEAD-fills content types", async () => {
    const harness = listHarness();
    const store = makeStore(harness);
    const summaries = await store.list("evidence/v1/");

    expect(summaries).toEqual([
      { key: "evidence/v1/evid_A0001", sizeBytes: 11, contentType: "image/jpeg" },
      { key: "evidence/v1/evid_B0002", sizeBytes: 7, contentType: "text/plain" },
      { key: "evidence/v1/evid_C&D", sizeBytes: 42, contentType: "application/json" },
    ]);

    // 2 list pages + 3 HEADs.
    expect(harness.requests).toHaveLength(5);
    const firstList = new URL(harness.requests[0]!.url);
    const secondList = new URL(harness.requests[1]!.url);
    expect(firstList.searchParams.get("list-type")).toBe("2");
    expect(firstList.searchParams.get("prefix")).toBe("evidence/v1/");
    expect(firstList.searchParams.get("continuation-token")).toBeNull();
    expect(secondList.searchParams.get("continuation-token")).toBe("1ueGcxLPRa1Ax/2Y/mximI==");
    verifyHeaderSignature(harness.requests[0]!);
    verifyHeaderSignature(harness.requests[1]!);
    verifyHeaderSignature(harness.requests[2]!);
  });

  it("malformed list XML fails loudly", async () => {
    const harness = createHarness(
      () => new Response("<ListBucketResult><Contents><Size>3</Size></Contents></ListBucketResult>", { status: 200 }),
    );
    const store = makeStore(harness);
    await expect(store.list()).rejects.toThrowError(ObjectStoreError);
  });
});

describe("R2ObjectStore error mapping", () => {
  it("maps non-2xx to ObjectStoreError with status + provider code, never echoing the body", async () => {
    const harness = createHarness(
      () =>
        new Response(
          "<Error><Code>AccessDenied</Code><Message>SENSITIVE-BODY-MARKER</Message></Error>",
          { status: 403, headers: { "content-type": "application/xml" } },
        ),
    );
    const store = makeStore(harness);
    const error = await store.put("evidence/v1/k", { bytes: new Uint8Array([1]), contentType: "text/plain" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ObjectStoreError);
    const storeError = error as ObjectStoreError;
    expect(storeError.status).toBe(403);
    expect(storeError.providerCode).toBe("AccessDenied");
    expect(storeError.message).toContain("403");
    expect(storeError.message).toContain("AccessDenied");
    expect(storeError.message).not.toContain("SENSITIVE-BODY-MARKER");
  });
});

// ---------------------------------------------------------------------------
// Presigned PUT/GET (SigV4 query auth, short TTL).
// ---------------------------------------------------------------------------

describe("R2ObjectStore.presignUpload", () => {
  const KEY = "evidence/v1/evid_TESTobjectid000001/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

  it("issues a short-TTL presigned PUT URL binding the content type (shape-verified)", async () => {
    const harness = createHarness(() => new Response(null, { status: 200 }));
    const store = makeStore(harness);

    const presigned = await store.presignUpload({
      key: KEY,
      contentType: "image/jpeg",
      sizeBytes: 5,
      ttlSeconds: 300,
    });

    expect(presigned.method).toBe("PUT");
    expect(presigned.contentType).toBe("image/jpeg");
    expect(presigned.expiresAt.getTime()).toBe(NOW_MS + 300_000);

    const url = new URL(presigned.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${ENDPOINT}/${BUCKET}/${KEY}`);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe(`${ACCESS_KEY_ID}/20250115/auto/s3/aws4_request`);
    expect(url.searchParams.get("X-Amz-Date")).toBe("20250115T120000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    const signature = url.searchParams.get("X-Amz-Signature");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(presigned.url.endsWith(`&X-Amz-Signature=${signature}`)).toBe(true);
    verifyPresignedSignature(presigned.url, "PUT", { "content-type": "image/jpeg" });
    expect(harness.requests).toHaveLength(0); // presigning is pure URL construction
  });

  it("is deterministic for a fixed clock and varies with time", async () => {
    const harness = createHarness(() => new Response(null, { status: 200 }));
    let now = NOW_MS;
    const store = makeStore(harness, () => now);
    const first = await store.presignUpload({ key: KEY, contentType: "image/jpeg", sizeBytes: 5, ttlSeconds: 60 });
    const second = await store.presignUpload({ key: KEY, contentType: "image/jpeg", sizeBytes: 5, ttlSeconds: 60 });
    expect(second.url).toBe(first.url);

    now = NOW_MS + 1_000;
    const third = await store.presignUpload({ key: KEY, contentType: "image/jpeg", sizeBytes: 5, ttlSeconds: 60 });
    expect(third.url).not.toBe(first.url);
    expect(new URL(third.url).searchParams.get("X-Amz-Date")).toBe("20250115T120001Z");
  });

  it("enforces the S3 TTL bounds", async () => {
    const harness = createHarness(() => new Response(null, { status: 200 }));
    const store = makeStore(harness);
    await expect(
      store.presignUpload({ key: KEY, contentType: "image/jpeg", sizeBytes: 5, ttlSeconds: 0 }),
    ).rejects.toThrowError(RangeError);
    await expect(
      store.presignUpload({ key: KEY, contentType: "image/jpeg", sizeBytes: 5, ttlSeconds: 604_801 }),
    ).rejects.toThrowError(RangeError);
  });
});

describe("R2ObjectStore.presignGet", () => {
  it("issues a host-only presigned GET URL with the requested TTL", async () => {
    const harness = createHarness(() => new Response(null, { status: 200 }));
    const store = makeStore(harness);
    const presigned = await store.presignGet("evidence/v1/evid_TESTobjectid000001/abc", 60);
    expect(presigned.method).toBe("GET");
    expect(presigned.expiresAt.getTime()).toBe(NOW_MS + 60_000);
    const url = new URL(presigned.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    verifyPresignedSignature(presigned.url, "GET");
  });

  it("defaults to the adapter default TTL (900s) when none is passed", async () => {
    const harness = createHarness(() => new Response(null, { status: 200 }));
    const store = makeStore(harness);
    const presigned = await store.presignGet("evidence/v1/evid_TESTobjectid000001/abc");
    expect(new URL(presigned.url).searchParams.get("X-Amz-Expires")).toBe("900");
  });
});

// ---------------------------------------------------------------------------
// Config validation.
// ---------------------------------------------------------------------------

describe("R2ObjectStore config validation", () => {
  const harness = createHarness(() => new Response(null, { status: 200 }));

  it("rejects malformed endpoints, credentials, buckets, and regions", () => {
    expect(() => new R2ObjectStore({ ...CONFIG, endpoint: "not-a-url" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
    expect(() => new R2ObjectStore({ ...CONFIG, endpoint: "ftp://example.com" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
    expect(() => new R2ObjectStore({ ...CONFIG, endpoint: "https://example.com/?x=1" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
    expect(() => new R2ObjectStore({ ...CONFIG, accessKeyId: "" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
    expect(() => new R2ObjectStore({ ...CONFIG, secretAccessKey: "" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
    expect(() => new R2ObjectStore({ ...CONFIG, bucket: "ab" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
    expect(() => new R2ObjectStore({ ...CONFIG, bucket: "Invalid_Bucket" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
    expect(() => new R2ObjectStore({ ...CONFIG, region: "" }, { fetchImpl: harness.fetchImpl })).toThrowError(RangeError);
  });
});
