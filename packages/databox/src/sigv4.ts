/**
 * Hand-rolled AWS Signature Version 4 (SigV4) — pure functions, zero
 * dependencies beyond node:crypto.
 *
 * RECORDED DECISION (packet A16): no aws-sdk / @aws-sdk/s3-request-presigner
 * dependency. Hand-rolling SigV4 keeps @orbb/databox dependency-light and
 * provider-portable (any S3-compatible endpoint — Cloudflare R2, MinIO,
 * AWS S3 — accepts the same signature format), and avoids pulling a large
 * SDK into the DataBox boundary. Trade-off: this code is SHAPE-VERIFIED
 * (request structure and internal signature consistency asserted by unit
 * tests with an independent test-side recomputation) but NOT live-verified
 * against a real R2 account (no credentials in CI — the platform in-memory
 * ObjectStore covers behavior; live verification happens in a deployment
 * packet with credentials).
 *
 * Implements the SigV4 algorithm as documented by AWS:
 *   canonical request -> string to sign -> derived signing key -> signature.
 * Strict RFC 3986 URI encoding with uppercase percent-hex, as SigV4 requires.
 */
import { createHash, createHmac } from "node:crypto";

/** SHA-256 of the empty payload (the well-known empty-string digest). */
export const EMPTY_PAYLOAD_SHA256_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Marker used for presigned-URL payloads (body not signed). */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/** SigV4 algorithm identifier. */
export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";

/** SigV4 request-terminator appended to the credential scope. */
const TERMINATOR = "aws4_request";

/** S3 service name for credential scopes. */
export const S3_SERVICE = "s3";

/** Unreserved characters exempt from strict URI encoding. */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** Characters that survive canonical-header whitespace collapsing. */
const SEQUENTIAL_SPACES = / {2,}/g;

/**
 * Strict RFC 3986 percent-encoding with UPPERCASE hex, as required by the
 * SigV4 canonical form. Every byte outside [A-Za-z0-9\-._~] is encoded;
 * `/` is encoded unless `encodeSlash` is false (S3 canonical URIs keep
 * slash separators while encoding each segment's other bytes).
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (UNRESERVED.test(char)) {
      out += char;
    } else if (char === "/" && !encodeSlash) {
      out += "/";
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/** SHA-256 of a string (UTF-8) or byte payload, lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(typeof data === "string" ? Buffer.from(data, "utf8") : data);
  return hash.digest("hex");
}

/** HMAC-SHA256 with a key (bytes) over data (string or bytes). */
export function hmacSha256(key: Uint8Array, data: string | Uint8Array): Uint8Array {
  const mac = createHmac("sha256", key);
  mac.update(typeof data === "string" ? Buffer.from(data, "utf8") : data);
  return new Uint8Array(mac.digest());
}

/**
 * SigV4 signing-key derivation: the documented HMAC chain
 * `AWS4<secret>` -> date -> region -> service -> "aws4_request".
 */
export function deriveSigningKey(
  secretAccessKey: string,
  scopeDate: string,
  region: string,
  service: string,
): Uint8Array {
  const kDate = hmacSha256(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), scopeDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, TERMINATOR);
}

/** Formats epoch milliseconds as SigV4 `amzDate`: `YYYYMMDDTHHMMSSZ`. */
export function formatAmzDate(epochMs: number): string {
  const d = new Date(epochMs);
  const two = (n: number): string => n.toString().padStart(2, "0");
  const date = `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`;
  const time = `${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
  return `${date}T${time}Z`;
}

/** Formats epoch milliseconds as the scope date: `YYYYMMDD`. */
export function formatScopeDate(epochMs: number): string {
  const d = new Date(epochMs);
  const two = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`;
}

/** Credential scope string: `<date>/<region>/<service>/aws4_request`. */
export function credentialScope(scopeDate: string, region: string, service: string): string {
  return `${scopeDate}/${region}/${service}/${TERMINATOR}`;
}

/**
 * Canonical query string: parameters strictly encoded, sorted by encoded
 * key then encoded value, joined with `&`. Empty input yields "".
 */
export function buildCanonicalQuery(
  params: ReadonlyArray<readonly [string, string]>,
): string {
  return params
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([aKey, aVal], [bKey, bVal]) =>
      aKey === bKey ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) : aKey < bKey ? -1 : 1,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/**
 * Canonical headers + signed-headers list from a header record. Names are
 * lowercased (case-insensitive lookup — callers may pass `Host`,
 * `X-Amz-Date`, etc.) and sorted; values are trimmed with sequential
 * spaces collapsed. The `host` header MUST be present (SigV4 requirement).
 */
export function buildCanonicalHeaders(
  headers: Readonly<Record<string, string>>,
): { canonical: string; signed: string } {
  const lowered = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    lowered.set(name.toLowerCase(), value);
  }
  const names = [...lowered.keys()].sort();
  if (names.length === 0 || !names.includes("host")) {
    throw new RangeError("SigV4 canonical headers must include the host header.");
  }
  let canonical = "";
  for (const name of names) {
    const value = (lowered.get(name) ?? "").trim().replace(SEQUENTIAL_SPACES, " ");
    canonical += `${name}:${value}\n`;
  }
  return { canonical, signed: names.join(";") };
}

/** Canonical request string (the SigV4 step-1 document). */
export function buildCanonicalRequest(input: {
  readonly method: string;
  readonly canonicalUri: string;
  readonly canonicalQuery: string;
  readonly canonicalHeaders: string;
  readonly signedHeaders: string;
  readonly payloadHash: string;
}): string {
  return [
    input.method,
    input.canonicalUri,
    input.canonicalQuery,
    input.canonicalHeaders,
    input.signedHeaders,
    input.payloadHash,
  ].join("\n");
}

/** String to sign (the SigV4 step-2 document). */
export function buildStringToSign(
  amzDate: string,
  scope: string,
  canonicalRequest: string,
): string {
  return [SIGV4_ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
}

/** Hex signature of `stringToSign` under `signingKey`. */
export function computeSignatureHex(signingKey: Uint8Array, stringToSign: string): string {
  const mac = createHmac("sha256", signingKey);
  mac.update(Buffer.from(stringToSign, "utf8"));
  return mac.digest("hex");
}

/** Authorization header value for header-signed requests. */
export function buildAuthorizationHeader(
  accessKeyId: string,
  scope: string,
  signedHeaders: string,
  signature: string,
): string {
  return `${SIGV4_ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * Builds the presigned-URL query string (everything except the trailing
 * `X-Amz-Signature`): the five standard query-auth parameters, strictly
 * encoded and canonically sorted. `expiresInSeconds` bounds are the S3
 * limits (1 .. 604800) — enforced here because every S3-compatible
 * provider enforces them.
 */
export function buildPresignedQuery(
  credentials: { readonly accessKeyId: string; readonly secretAccessKey: string },
  scope: string,
  amzDate: string,
  signedHeaders: string,
  expiresInSeconds: number,
): string {
  if (
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > 604_800 ||
    !Number.isInteger(expiresInSeconds)
  ) {
    throw new RangeError(
      "Presigned URL expiry must be an integer between 1 and 604800 seconds (S3-compatible limit).",
    );
  }
  return buildCanonicalQuery([
    ["X-Amz-Algorithm", SIGV4_ALGORITHM],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", expiresInSeconds.toString()],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]);
}
