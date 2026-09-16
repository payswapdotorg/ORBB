/**
 * Canonical serialization + deterministic digests for the adherence
 * engine (M6-B B10, Lane C).
 *
 * This is a deliberate DISCIPLINE MIRROR of `@orbb/intents`'s
 * `canonical.ts` (canonical JSON with sorted keys + SHA-256 hex digests)
 * and of `@orbb/measurement`'s deterministic-id derivation: the adherence
 * engine must be replayable — the same inputs must always produce the
 * same evaluations and the same enforcement decisions — and the only
 * way to PROVE that across processes is a canonical serialization whose
 * digest can be compared. No randomness, no wall-clock reads, no
 * external inputs: everything is derived from the caller-provided value.
 */
import { createHash } from "node:crypto";

/**
 * Canonical JSON serialization: object keys sorted lexicographically,
 * arrays in order, `Date` values as ISO-8601 UTC strings, primitives as
 * themselves. Deterministic for structurally equal values.
 */
export function canonicalJsonStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot serialize non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serialize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${JSON.stringify(key)}:${serialize(record[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON cannot serialize values of type ${typeof value}.`);
}

/** SHA-256 hex digest of a UTF-8 string (deterministic, collision-safe). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
