/**
 * A16 — Cloudflare R2 object-store adapter (S3-compatible API).
 *
 * Implements the frozen `@orbb/platform` `ObjectStore` interface via
 * fetch-based SigV4-signed requests (path-style addressing:
 * `{endpoint}/{bucket}/{key}`). NO aws-sdk dependency — SigV4 is
 * hand-rolled in `./sigv4.ts` (recorded decision: dependency-light and
 * provider-portable).
 *
 * VERIFICATION STATUS (honest label): SHAPE-VERIFIED, NOT LIVE-VERIFIED.
 * Unit tests drive the adapter against an injected fetch stub and assert
 * request shape (method, path, auth headers, expiry) plus internal
 * signature consistency (the test recomputes the signature from the
 * captured wire request). No live R2 account is contacted — live
 * verification belongs to a deployment packet with credentials; behavior
 * is covered in tests through the in-memory ObjectStore.
 *
 * Recorded design decisions:
 *   - Path-style URLs ({endpoint}/{bucket}/{key}): R2's recommended form
 *     for the S3 API; also unambiguous with `/`-containing object keys.
 *   - The `host` header is implicit (set by the HTTP layer from the
 *     endpoint authority) and is signed with the endpoint's authority.
 *     It is deliberately not passed in fetch headers.
 *   - `exists` (HEAD) and presigned PUT/GET URL generation (SigV4 query
 *     auth, short TTL) extend the platform interface without modifying it.
 *   - `list` uses ListObjectsV2 with pagination; because S3-compatible
 *     listing does not return content types, each key is HEAD-followed to
 *     satisfy the platform `ObjectRecordSummary.contentType` contract
 *     (honest correctness over chattiness; platform handoff recorded).
 *   - Presigned PUTs sign `host` + `content-type`: the uploader must send
 *     exactly the bound Content-Type, which is the first media-type
 *     consistency gate; finalize re-verifies from stored metadata.
 *   - `sizeBytes` on a presign request is advisory only: signing
 *     Content-Length is brittle with chunked uploads; size is enforced at
 *     finalize (§6 step 5).
 */
import type { ObjectData, ObjectRecord, ObjectRecordSummary, ObjectStore } from "@orbb/platform";
import { ObjectStoreError } from "./errors.js";
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
  S3_SERVICE,
  sha256Hex,
  UNSIGNED_PAYLOAD,
  uriEncode,
} from "./sigv4.js";
import type { PresignUploadRequest, PresignedUploadUrl } from "./upload/contracts.js";

/** Typed constructor config for the R2 (S3-compatible) adapter. */
export interface R2ObjectStoreConfig {
  /**
   * S3-compatible endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com`
   * (http allowed for local MinIO-style harnesses). No query or fragment.
   */
  readonly endpoint: string;
  /** Region for SigV4 scopes; R2 uses `auto`. */
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/** Injectable seams for the adapter (tests inject both). */
export interface R2ObjectStoreOptions {
  /** Fetch implementation (default: global fetch). */
  readonly fetchImpl?: typeof fetch;
  /** Time source for SigV4 dates (default: `Date.now`). */
  readonly nowMs?: () => number;
  /** Default presigned-URL TTL in seconds (default 900; max 604800). */
  readonly presignTtlSeconds?: number;
}

/** A presigned GET URL (download), short-lived. */
export interface PresignedGetUrl {
  readonly url: string;
  readonly method: "GET";
  readonly expiresAt: Date;
}

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z0-9-]{1,32}$/;
const MAX_OBJECT_KEY_LENGTH = 1024;
const MAX_LIST_PAGES = 100;
const MAX_LIST_KEYS = 100_000;
const DEFAULT_PRESIGN_TTL_SECONDS = 900;

/**
 * Cloudflare R2 object store: `ObjectStore` (platform) + `exists` +
 * presigned PUT/GET (SigV4 query auth, short TTL). Structural typing also
 * satisfies the `UploadUrlPresigner` contract of the upload service.
 */
export class R2ObjectStore implements ObjectStore {
  readonly #baseUrl: string;
  readonly #endpoint: URL;
  readonly #region: string;
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;
  readonly #bucket: string;
  readonly #fetchImpl: typeof fetch;
  readonly #nowMs: () => number;
  readonly #presignTtlSeconds: number;

  constructor(config: R2ObjectStoreConfig, options: R2ObjectStoreOptions = {}) {
    let endpoint: URL;
    try {
      endpoint = new URL(config.endpoint);
    } catch {
      throw new RangeError("R2 endpoint must be a valid absolute http(s) URL.");
    }
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new RangeError("R2 endpoint must use the http or https protocol.");
    }
    if (endpoint.search !== "" || endpoint.hash !== "") {
      throw new RangeError("R2 endpoint must not include a query string or fragment.");
    }
    if (typeof config.accessKeyId !== "string" || config.accessKeyId.trim().length === 0) {
      throw new RangeError("R2 access key id must be a non-empty string.");
    }
    if (typeof config.secretAccessKey !== "string" || config.secretAccessKey.length === 0) {
      throw new RangeError("R2 secret access key must be a non-empty string.");
    }
    if (typeof config.bucket !== "string" || !BUCKET_PATTERN.test(config.bucket)) {
      throw new RangeError(
        "R2 bucket must be 3-63 lowercase alphanumeric characters or hyphens.",
      );
    }
    if (typeof config.region !== "string" || !REGION_PATTERN.test(config.region)) {
      throw new RangeError("R2 region must be 1-32 lowercase alphanumeric characters or hyphens.");
    }
    this.#endpoint = endpoint;
    this.#baseUrl = endpoint.toString().replace(/\/+$/, "");
    this.#region = config.region;
    this.#accessKeyId = config.accessKeyId;
    this.#secretAccessKey = config.secretAccessKey;
    this.#bucket = config.bucket;
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#presignTtlSeconds = options.presignTtlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS;
  }

  async put(key: string, data: ObjectData): Promise<ObjectRecordSummary> {
    assertObjectKey(key);
    const path = this.#objectPath(key);
    const payloadHash = sha256Hex(data.bytes);
    await this.#send("PUT", path, {
      headers: { "content-type": data.contentType },
      body: data.bytes,
      payloadHash,
      operation: "put",
    });
    return {
      key,
      sizeBytes: data.bytes.byteLength,
      contentType: data.contentType,
    };
  }

  async get(key: string): Promise<ObjectRecord | undefined> {
    assertObjectKey(key);
    const res = await this.#send("GET", this.#objectPath(key), {
      operation: "get",
      allowNotFound: true,
    });
    if (res.status === 404) {
      return undefined;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return { key, data: { bytes, contentType }, sizeBytes: bytes.byteLength };
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    await this.#send("DELETE", this.#objectPath(key), {
      operation: "delete",
      allowNotFound: true,
    });
  }

  async list(prefix?: string): Promise<readonly ObjectRecordSummary[]> {
    const effectivePrefix = prefix ?? "";
    if (typeof effectivePrefix !== "string" || effectivePrefix.includes("?") || effectivePrefix.includes("#")) {
      throw new RangeError("List prefix must be a plain string without query or fragment characters.");
    }
    const keys: string[] = [];
    const sizes = new Map<string, number>();
    let continuationToken: string | undefined;
    let pages = 0;
    let truncated = false;
    do {
      if (pages >= MAX_LIST_PAGES || keys.length >= MAX_LIST_KEYS) {
        throw new ObjectStoreError(
          `Object store list exceeded the safety bound (${MAX_LIST_KEYS} keys); refusing an unbounded scan.`,
        );
      }
      const query: Array<[string, string]> = [
        ["list-type", "2"],
        ["max-keys", "1000"],
      ];
      if (effectivePrefix !== "") {
        query.push(["prefix", effectivePrefix]);
      }
      if (continuationToken !== undefined) {
        query.push(["continuation-token", continuationToken]);
      }
      const res = await this.#send("GET", this.#listPath(), {
        query,
        operation: "list",
      });
      const page = parseListObjectsV2Page(await res.text());
      for (const entry of page.entries) {
        if (keys.length >= MAX_LIST_KEYS) {
          throw new ObjectStoreError(
            `Object store list exceeded the safety bound (${MAX_LIST_KEYS} keys); refusing an unbounded scan.`,
          );
        }
        keys.push(entry.key);
        sizes.set(entry.key, entry.sizeBytes);
      }
      continuationToken = page.nextToken;
      truncated = page.truncated;
      pages += 1;
    } while (truncated && continuationToken !== undefined);

    // S3-compatible listing does not return content types; HEAD each key to
    // honor the platform ObjectRecordSummary contract (recorded trade-off).
    const summaries: ObjectRecordSummary[] = [];
    for (const key of keys) {
      const contentType = await this.#headContentType(key);
      summaries.push({
        key,
        sizeBytes: sizes.get(key) ?? 0,
        contentType,
      });
    }
    return summaries;
  }

  /** Does the object exist? (HEAD; false on 404.) */
  async exists(key: string): Promise<boolean> {
    assertObjectKey(key);
    const res = await this.#send("HEAD", this.#objectPath(key), {
      operation: "head",
      allowNotFound: true,
    });
    return res.status !== 404;
  }

  /**
   * Issues a short-lived presigned PUT URL bound to `content-type`
   * (the uploader must send exactly that Content-Type). Implements the
   * upload service's `UploadUrlPresigner` contract.
   */
  async presignUpload(request: PresignUploadRequest): Promise<PresignedUploadUrl> {
    assertObjectKey(request.key);
    assertTtlSeconds(request.ttlSeconds);
    if (typeof request.contentType !== "string" || request.contentType.length === 0) {
      throw new RangeError("Presign request content type must be a non-empty string.");
    }
    const signedHeaders = "content-type;host";
    const canonicalHeaders = `content-type:${request.contentType}\nhost:${this.#endpoint.host}\n`;
    const url = this.#presign("PUT", this.#objectPath(request.key), signedHeaders, canonicalHeaders, request.ttlSeconds);
    const now = this.#nowMs();
    return {
      url,
      method: "PUT",
      expiresAt: new Date(now + request.ttlSeconds * 1_000),
      contentType: request.contentType,
    };
  }

  /** Issues a short-lived presigned GET URL (download). */
  async presignGet(key: string, ttlSeconds: number = this.#presignTtlSeconds): Promise<PresignedGetUrl> {
    assertObjectKey(key);
    assertTtlSeconds(ttlSeconds);
    const url = this.#presign("GET", this.#objectPath(key), "host", `host:${this.#endpoint.host}\n`, ttlSeconds);
    const now = this.#nowMs();
    return {
      url,
      method: "GET",
      expiresAt: new Date(now + ttlSeconds * 1_000),
    };
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  /** Path-style object path: `/bucket/<encoded key>`. */
  #objectPath(key: string): string {
    const encodedKey = key
      .split("/")
      .map((segment) => uriEncode(segment))
      .join("/");
    return `/${this.#bucket}/${encodedKey}`;
  }

  /** Path-style bucket listing path: `/bucket/`. */
  #listPath(): string {
    return `/${this.#bucket}/`;
  }

  /**
   * Assembles, signs, and sends one SigV4 header-authenticated request.
   * Returns the raw Response; throws `ObjectStoreError` on non-2xx (404 is
   * returned, not thrown, when `allowNotFound`).
   */
  async #send(
    method: string,
    path: string,
    details: {
      readonly headers?: Readonly<Record<string, string>>;
      readonly query?: ReadonlyArray<readonly [string, string]>;
      readonly body?: Uint8Array;
      readonly payloadHash?: string;
      readonly operation: string;
      readonly allowNotFound?: boolean;
    },
  ): Promise<Response> {
    const now = this.#nowMs();
    const amzDate = formatAmzDate(now);
    const payloadHash = details.payloadHash ?? EMPTY_PAYLOAD_SHA256_HEX;
    const headers: Record<string, string> = {
      ...(details.headers ?? {}),
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    };
    const { canonical, signed } = buildCanonicalHeaders({ host: this.#endpoint.host, ...headers });
    const canonicalQuery = buildCanonicalQuery(details.query ?? []);
    const canonicalRequest = buildCanonicalRequest({
      method,
      canonicalUri: path,
      canonicalQuery,
      canonicalHeaders: canonical,
      signedHeaders: signed,
      payloadHash,
    });
    const scopeDate = formatScopeDate(now);
    const scope = credentialScope(scopeDate, this.#region, S3_SERVICE);
    const stringToSign = buildStringToSign(amzDate, scope, canonicalRequest);
    const signingKey = deriveSigningKey(this.#secretAccessKey, scopeDate, this.#region, S3_SERVICE);
    const signature = computeSignatureHex(signingKey, stringToSign);
    const authorization = buildAuthorizationHeader(this.#accessKeyId, scope, signed, signature);

    const url =
      this.#baseUrl + path + (canonicalQuery !== "" ? `?${canonicalQuery}` : "");
    const init: RequestInit = {
      method,
      headers: { ...headers, authorization },
    };
    if (details.body !== undefined) {
      init.body = details.body;
    }
    const response = await this.#fetchImpl(url, init);
    if (response.status === 404 && details.allowNotFound === true) {
      return response;
    }
    if (!response.ok) {
      throw await objectStoreError(response, details.operation);
    }
    return response;
  }

  /** Builds a presigned (query-auth) URL for `method` + `path`. */
  #presign(
    method: "PUT" | "GET",
    path: string,
    signedHeaders: string,
    canonicalHeaders: string,
    ttlSeconds: number,
  ): string {
    const now = this.#nowMs();
    const amzDate = formatAmzDate(now);
    const scopeDate = formatScopeDate(now);
    const scope = credentialScope(scopeDate, this.#region, S3_SERVICE);
    const presignedQuery = buildPresignedQuery(
      { accessKeyId: this.#accessKeyId, secretAccessKey: this.#secretAccessKey },
      scope,
      amzDate,
      signedHeaders,
      ttlSeconds,
    );
    const canonicalRequest = buildCanonicalRequest({
      method,
      canonicalUri: path,
      canonicalQuery: presignedQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash: UNSIGNED_PAYLOAD,
    });
    const stringToSign = buildStringToSign(amzDate, scope, canonicalRequest);
    const signingKey = deriveSigningKey(this.#secretAccessKey, scopeDate, this.#region, S3_SERVICE);
    const signature = computeSignatureHex(signingKey, stringToSign);
    return `${this.#baseUrl}${path}?${presignedQuery}&X-Amz-Signature=${signature}`;
  }

  /** HEADs a key purely to read its content type (list() support). */
  async #headContentType(key: string): Promise<string> {
    const res = await this.#send("HEAD", this.#objectPath(key), {
      operation: "head",
      allowNotFound: true,
    });
    if (res.status === 404) {
      throw new ObjectStoreError("Object store list/head mismatch: a listed object vanished mid-listing.");
    }
    return res.headers.get("content-type") ?? "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Module-level validation + S3 XML helpers.
// ---------------------------------------------------------------------------

function assertObjectKey(key: string): void {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_OBJECT_KEY_LENGTH ||
    key.startsWith("/") ||
    key.includes("?") ||
    key.includes("#")
  ) {
    throw new RangeError(
      "Object key must be 1-1024 characters, relative (no leading slash), with no query or fragment characters.",
    );
  }
}

function assertTtlSeconds(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 604_800) {
    throw new RangeError("Presigned URL TTL must be an integer between 1 and 604800 seconds.");
  }
}

/** Maps a failed provider response to a PHID-safe ObjectStoreError. */
async function objectStoreError(response: Response, operation: string): Promise<ObjectStoreError> {
  let providerCode: string | undefined;
  try {
    providerCode = extractXmlTag(await response.text(), "Code") ?? undefined;
  } catch {
    providerCode = undefined;
  }
  return new ObjectStoreError(
    `Object store ${operation} failed with HTTP ${response.status}${providerCode === undefined ? "" : ` (provider code: ${providerCode})`}.`,
    response.status,
    providerCode,
  );
}

/** One listing page parsed from ListObjectsV2 XML. */
interface ListObjectsPage {
  readonly entries: ReadonlyArray<{ key: string; sizeBytes: number }>;
  readonly truncated: boolean;
  readonly nextToken: string | undefined;
}

/**
 * Minimal ListObjectsV2 XML reader: extracts `<Contents>` blocks'
 * `<Key>`/`<Size>`, `<IsTruncated>`, and `<NextContinuationToken>`.
 * Deliberately NOT a general XML parser — sufficient and safe for this
 * fixed response shape (shape-verified in tests, not live-verified).
 */
function parseListObjectsV2Page(xml: string): ListObjectsPage {
  const entries: Array<{ key: string; sizeBytes: number }> = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1] ?? "";
    const key = extractXmlTag(block, "Key");
    const sizeText = extractXmlTag(block, "Size");
    if (key === undefined || sizeText === undefined) {
      throw new ObjectStoreError("Object store list response was malformed (incomplete Contents entry).");
    }
    const sizeBytes = Number.parseInt(sizeText, 10);
    if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
      throw new ObjectStoreError("Object store list response was malformed (invalid Size value).");
    }
    entries.push({ key: decodeXmlEntities(key), sizeBytes });
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
  const nextToken = extractXmlTag(xml, "NextContinuationToken");
  return { entries, truncated, nextToken: nextToken ?? undefined };
}

/** First match of `<tag>…</tag>` (raw inner text, entities undecoded). */
function extractXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1];
}

/** Decodes the five predefined XML entities plus numeric references. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      safeCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "\uFFFD";
  }
}
