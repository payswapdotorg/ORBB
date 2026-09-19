/**
 * Canonical JSON serialization for the FHIR boundary — the determinism
 * backbone (A46 hard requirement: "same input -> byte-identical JSON").
 *
 * RECORDED DECISIONS:
 *
 * - Canonical form (RFC 8785 / JCS-aligned where applicable): object keys
 *   are sorted by UTF-16 code unit order (ECMAScript default `sort()`),
 *   no insignificant whitespace, ECMAScript number-to-string semantics
 *   (the shortest round-tripping representation, spec-deterministic).
 *   Array order is PRESERVED — arrays are ordered collections in both
 *   the domain (e.g. AccessGrant.scope, methodOrder) and FHIR; canonical
 *   determinism means "same input, same bytes", never reordering domain
 *   data.
 * - Fail-closed on anything outside plain JSON: `undefined`, functions,
 *   symbols, `bigint`, non-finite numbers, and `Date` instances all
 *   throw {@link FhirMappingError}`("non-canonical-value")`. A smuggled
 *   Date means a mapper forgot to serialize a timestamp — the serializer
 *   is the last line of defense, and a `{"x":undefined}` hole can never
 *   leak into boundary bytes.
 * - `prettyCanonical` emits the SAME canonical structure (sorted keys)
 *   with 2-space indentation. It exists only so golden fixture files are
 *   human-reviewable and diff-stable; `serializeCanonical` is the
 *   byte-exact boundary form. Golden tests prove the two represent the
 *   same bytes by re-canonicalizing the parsed golden file.
 */
import { FhirMappingError } from "./errors.js";

/** Serializes a pure-JSON value to canonical compact JSON (sorted keys, no whitespace). */
export function serializeCanonical(value: unknown): string {
  return writeValue(value, { pretty: false }, 0, []).join("");
}

/** Serializes a pure-JSON value to canonical pretty JSON (sorted keys, 2-space indent). */
export function prettyCanonical(value: unknown): string {
  return writeValue(value, { pretty: true }, 0, []).join("");
}

interface WriteOptions {
  readonly pretty: boolean;
}

function nonCanonical(detail: string): FhirMappingError {
  return new FhirMappingError(
    "non-canonical-value",
    `Cannot canonicalize a value for the FHIR boundary: encountered ${detail}. The boundary form is plain JSON (objects with string keys, arrays, strings, finite numbers, booleans, null); timestamps must be pre-serialized ISO-8601 strings.`,
  );
}

function writeValue(
  value: unknown,
  options: WriteOptions,
  depth: number,
  out: string[],
): string[] {
  if (value === null) {
    out.push("null");
    return out;
  }
  switch (typeof value) {
    case "string":
      out.push(JSON.stringify(value));
      return out;
    case "boolean":
      out.push(value ? "true" : "false");
      return out;
    case "number":
      if (!Number.isFinite(value)) {
        throw nonCanonical("a non-finite number");
      }
      // ECMAScript number-to-string: deterministic, shortest round-trip form.
      out.push(String(value));
      return out;
    case "object":
      break;
    default:
      throw nonCanonical(`a value of type "${typeof value}"`);
  }

  if (value instanceof Date) {
    throw nonCanonical("a Date instance (timestamps must be pre-serialized ISO-8601 strings)");
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push("[]");
      return out;
    }
    out.push("[");
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        out.push(",");
      }
      indent(out, options, depth + 1);
      writeValue(value[index], options, depth + 1, out);
    }
    indent(out, options, depth);
    out.push("]");
    return out;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length === 0) {
    out.push("{}");
    return out;
  }
  out.push("{");
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    if (index > 0) {
      out.push(",");
    }
    indent(out, options, depth + 1);
    out.push(`${JSON.stringify(key)}:`);
    if (options.pretty) {
      out.push(" ");
    }
    writeValue(record[key], options, depth + 1, out);
  }
  indent(out, options, depth);
  out.push("}");
  return out;
}

function indent(out: string[], options: WriteOptions, depth: number): void {
  if (!options.pretty) {
    return;
  }
  out.push("\n");
  out.push("  ".repeat(depth));
}

/**
 * Serializes a `Date` to the boundary timestamp form: the exact
 * `Date.toISOString()` string (UTC, millisecond precision). FHIR dateTime
 * and instant accept this form, and it is deterministic for a given
 * instant — the mapper never formats wall-clock time of its own.
 */
export function toFhirTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new FhirMappingError(
      "invalid-input",
      "Invalid timestamp: expected a valid Date instance (the domain object carried an invalid or missing time).",
    );
  }
  return value.toISOString();
}
