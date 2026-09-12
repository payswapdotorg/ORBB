/**
 * Canonical JSON serialization + SHA-256 content hashing (A36).
 *
 * DETERMINISM CONTRACT: `canonicalJsonStringify` is a pure function of its
 * input VALUE (not of property insertion order, key order, or Date
 * object identity):
 *   - object entries are emitted in lexicographically sorted key order
 *     (UTF-16 code units, `Array.prototype.sort` default),
 *   - `Date` values are serialized as their epoch-millisecond integer,
 *     so two Dates representing the same instant serialize identically,
 *   - `undefined`-valued object properties are dropped (an absent optional
 *     field and a present-but-undefined field serialize the same — mirrors
 *     `JSON.stringify` semantics under `exactOptionalPropertyTypes`),
 *   - arrays preserve element order (order is semantic),
 *   - strings escape exactly as `JSON.stringify` escapes them,
 *   - numbers serialize via `JSON.stringify` (ECMAScript-specified
 *     shortest round-trip representation — same value, same string).
 *
 * Non-canonicalizable values (functions, symbols, bigints, non-finite
 * numbers, invalid Dates, cyclic structures) throw
 * {@link IntentEngineError} — they are programming errors, never expected
 * domain rejections (the typed-result discipline lives in `result.ts`).
 *
 * Content hashing: `sha256Hex` / `sha256Base64Url` digest a canonical
 * string; `hashWithDomainBase64Url` domain-separates a hash by a lane tag
 * so equal content under different entity kinds can never collide (the
 * same hygiene as the measurement lane's A30 id derivation).
 */
import { createHash } from "node:crypto";
import { IntentEngineError } from "./errors.js";

/** Maximum nesting depth accepted before serialization refuses (cycle guard). */
const MAX_CANONICAL_DEPTH = 64;

/**
 * Serializes `value` into the canonical JSON form described in the module
 * header. Pure and deterministic: two structurally equal values (up to key
 * order and Date identity) always produce the SAME string.
 */
export function canonicalJsonStringify(value: unknown): string {
  return serializeCanonical(value, 0);
}

function serializeCanonical(value: unknown, depth: number): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new IntentEngineError(
      "invariant-violation",
      "Canonical JSON serialization exceeded the maximum nesting depth (cyclic structure?).",
    );
  }
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new IntentEngineError(
          "invariant-violation",
          "Canonical JSON serialization requires finite numbers.",
        );
      }
      return JSON.stringify(value);
    }
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (value instanceof Date) {
        const ms = value.getTime();
        if (Number.isNaN(ms)) {
          throw new IntentEngineError(
            "invariant-violation",
            "Canonical JSON serialization requires valid Dates.",
          );
        }
        return String(ms);
      }
      if (Array.isArray(value)) {
        const elements = value.map((element) => serializeCanonical(element, depth + 1));
        return `[${elements.join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const propertyValue = record[key];
        if (propertyValue === undefined) {
          // Absent and present-but-undefined are the same canonical form.
          continue;
        }
        parts.push(`${JSON.stringify(key)}:${serializeCanonical(propertyValue, depth + 1)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new IntentEngineError(
        "invariant-violation",
        "Canonical JSON serialization requires JSON-shaped values (no functions, symbols, or bigints).",
      );
  }
}

/** SHA-256 of the UTF-8 encoding of `input`, as a 64-character hex string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 of the UTF-8 encoding of `input`, as unpadded URL-safe base64 (43 chars). */
export function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("base64url");
}

/**
 * Domain-separated content digest: the base64url SHA-256 of the canonical
 * JSON of `{ domain, value }`. Two different `domain` tags never produce
 * the same digest for related content (entity-kind separation).
 */
export function hashWithDomainBase64Url(domain: string, value: unknown): string {
  return sha256Base64Url(canonicalJsonStringify({ domain, value }));
}
