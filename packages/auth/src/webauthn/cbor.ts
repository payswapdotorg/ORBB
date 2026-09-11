/**
 * Minimal CBOR codec — the exact subset WebAuthn needs (W3C WebAuthn L3
 * authenticator data / attestation objects use CTAP2 canonical CBOR).
 *
 * Supported (recorded decision — dependency-free pure implementation):
 *   - Major 0: unsigned integers (argument forms 0–23 / 24 / 25 / 26 / 27;
 *     values above Number.MAX_SAFE_INTEGER decode as `bigint`).
 *   - Major 1: negative integers (`-1 - n`).
 *   - Major 2: definite-length byte strings → `Uint8Array`.
 *   - Major 3: definite-length UTF-8 text strings (fatal decoding).
 *   - Major 4: definite-length arrays.
 *   - Major 5: definite-length maps with number/bigint/string keys →
 *     `Map` (duplicate keys are rejected, per canonical CBOR).
 *   - Major 7: `false` / `true` / `null` only.
 * Explicitly rejected: indefinite lengths (0x1f), tags (major 6), floats
 * and other simple values, reserved argument forms — authenticators do
 * not emit any of those for the WebAuthn surfaces we parse.
 *
 * The encoder is minimal-length (canonical head encoding) and emits map
 * entries in insertion order. It exists primarily to build synthetic
 * test vectors (round-trip `decodeCbor(encodeCbor(x))` is proven in
 * tests) and to keep the whole package dependency-free.
 */
import { AuthInvariantError } from "../errors.js";

/** Map key forms allowed by the supported subset. */
export type CborKey = number | bigint | string;

/** Decoded/encodable value forms of the supported subset. */
export type CborValue =
  | number
  | bigint
  | boolean
  | null
  | Uint8Array
  | string
  | CborValue[]
  | Map<CborKey, CborValue>;

/** One decoded item plus the offset just past it (self-delimiting parse). */
export interface CborItem {
  readonly value: CborValue;
  readonly nextOffset: number;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

function malformed(detail: string): AuthInvariantError {
  return new AuthInvariantError(`cbor: ${detail}`);
}

interface Argument {
  readonly value: number | bigint;
  readonly next: number;
}

/** Reads the argument following an initial byte (definite lengths only). */
function readArgument(bytes: Uint8Array, position: number, info: number): Argument {
  if (info <= 23) {
    return { value: info, next: position };
  }
  if (position >= bytes.length) {
    throw malformed("truncated argument");
  }
  switch (info) {
    case 24: {
      return { value: bytes[position] as number, next: position + 1 };
    }
    case 25: {
      if (position + 2 > bytes.length) {
        throw malformed("truncated uint16 argument");
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { value: view.getUint16(position), next: position + 2 };
    }
    case 26: {
      if (position + 4 > bytes.length) {
        throw malformed("truncated uint32 argument");
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { value: view.getUint32(position), next: position + 4 };
    }
    case 27: {
      if (position + 8 > bytes.length) {
        throw malformed("truncated uint64 argument");
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { value: view.getBigUint64(position), next: position + 8 };
    }
    default:
      throw malformed("reserved additional-information value");
  }
}

/** Converts a decoded argument to a JS number, keeping bigints above the safe range. */
function toInteger(value: number | bigint): number | bigint {
  if (typeof value === "number") {
    return value;
  }
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value;
}

/** Length arguments must be plain safe integers bounded by the remaining bytes. */
function toLength(value: number | bigint, remaining: number): number {
  if (typeof value === "bigint" || !Number.isSafeInteger(value) || value > remaining) {
    throw malformed("length exceeds the remaining input");
  }
  return value;
}

/** Decodes one CBOR item starting at `offset` (self-delimiting). */
export function decodeCborItem(bytes: Uint8Array, offset: number): CborItem {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) {
    throw malformed("truncated item");
  }
  const initial = bytes[offset] as number;
  const major = initial >> 5;
  const info = initial & 0x1f;
  if (info === 31) {
    throw malformed("indefinite-length items are not supported");
  }
  const { value: argument, next } = readArgument(bytes, offset + 1, info);

  switch (major) {
    case 0: {
      return { value: toInteger(argument), nextOffset: next };
    }
    case 1: {
      if (typeof argument === "bigint") {
        return { value: -1n - argument, nextOffset: next };
      }
      return { value: -1 - argument, nextOffset: next };
    }
    case 2: {
      const length = toLength(argument, bytes.length - next);
      const end = next + length;
      if (end > bytes.length) {
        throw malformed("truncated byte string");
      }
      return { value: bytes.subarray(next, end), nextOffset: end };
    }
    case 3: {
      const length = toLength(argument, bytes.length - next);
      const end = next + length;
      if (end > bytes.length) {
        throw malformed("truncated text string");
      }
      try {
        return { value: utf8Decoder.decode(bytes.subarray(next, end)), nextOffset: end };
      } catch {
        throw malformed("text string is not valid UTF-8");
      }
    }
    case 4: {
      // Each element consumes at least one byte, so the count is bounded
      // by the remaining input (DoS guard).
      const length = toLength(argument, bytes.length - next);
      const items: CborValue[] = [];
      let cursor = next;
      for (let i = 0; i < length; i += 1) {
        const item = decodeCborItem(bytes, cursor);
        items.push(item.value);
        cursor = item.nextOffset;
      }
      return { value: items, nextOffset: cursor };
    }
    case 5: {
      const length = toLength(argument, bytes.length - next);
      const map = new Map<CborKey, CborValue>();
      let cursor = next;
      for (let i = 0; i < length; i += 1) {
        const keyItem = decodeCborItem(bytes, cursor);
        cursor = keyItem.nextOffset;
        const key = keyItem.value;
        if (typeof key !== "number" && typeof key !== "bigint" && typeof key !== "string") {
          throw malformed("map keys must be integers or text strings");
        }
        const valueItem = decodeCborItem(bytes, cursor);
        cursor = valueItem.nextOffset;
        if (map.has(key)) {
          throw malformed("duplicate map key");
        }
        map.set(key, valueItem.value);
      }
      return { value: map, nextOffset: cursor };
    }
    case 6: {
      throw malformed("tags are not supported");
    }
    default: {
      // Major 7: only the three primitive simple values are accepted.
      if (info === 20) {
        return { value: false, nextOffset: offset + 1 };
      }
      if (info === 21) {
        return { value: true, nextOffset: offset + 1 };
      }
      if (info === 22) {
        return { value: null, nextOffset: offset + 1 };
      }
      throw malformed("floats and non-primitive simple values are not supported");
    }
  }
}

/** Decodes exactly one top-level CBOR item (trailing bytes are rejected). */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const item = decodeCborItem(bytes, 0);
  if (item.nextOffset !== bytes.length) {
    throw malformed("trailing bytes after the top-level item");
  }
  return item.value;
}

// ---------------------------------------------------------------------------
// Encoder (minimal-length heads; insertion-order map entries).
// ---------------------------------------------------------------------------

/** Encodes a supported value to canonical-head CBOR bytes. */
export function encodeCbor(value: CborValue): Uint8Array {
  const chunks: Uint8Array[] = [];
  encodeInto(value, chunks);
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeInto(value: CborValue, chunks: Uint8Array[]): void {
  if (value === null) {
    chunks.push(Uint8Array.of(0xf6));
    return;
  }
  if (typeof value === "boolean") {
    chunks.push(Uint8Array.of(value ? 0xf5 : 0xf4));
    return;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    if (typeof value === "number" && !Number.isInteger(value)) {
      throw malformed("encoding non-integer numbers is not supported");
    }
    if (value < 0) {
      const magnitude = typeof value === "bigint" ? -1n - value : -1 - value;
      chunks.push(encodeHead(1, magnitude));
    } else {
      chunks.push(encodeHead(0, value));
    }
    return;
  }
  if (typeof value === "string") {
    const encoded = utf8Encoder.encode(value);
    chunks.push(encodeHead(3, encoded.length), encoded);
    return;
  }
  if (value instanceof Uint8Array) {
    chunks.push(encodeHead(2, value.length), value);
    return;
  }
  if (Array.isArray(value)) {
    chunks.push(encodeHead(4, value.length));
    for (const element of value) {
      encodeInto(element, chunks);
    }
    return;
  }
  if (value instanceof Map) {
    chunks.push(encodeHead(5, value.size));
    for (const [key, entry] of value) {
      if (typeof key !== "number" && typeof key !== "bigint" && typeof key !== "string") {
        throw malformed("map keys must be integers or text strings");
      }
      encodeInto(key, chunks);
      encodeInto(entry, chunks);
    }
    return;
  }
  throw malformed("unsupported value form");
}

/** Encodes a major type + argument head with minimal length. */
function encodeHead(major: number, argument: number | bigint): Uint8Array {
  const value = typeof argument === "bigint" ? argument : BigInt(argument);
  if (value < 0n) {
    throw malformed("head argument must be non-negative");
  }
  const prefix = major << 5;
  if (value <= 23n) {
    return Uint8Array.of(prefix | Number(value));
  }
  if (value <= 0xffn) {
    return Uint8Array.of(prefix | 24, Number(value));
  }
  if (value <= 0xffffn) {
    const out = new Uint8Array(3);
    out[0] = prefix | 25;
    new DataView(out.buffer).setUint16(1, Number(value));
    return out;
  }
  if (value <= 0xffff_ffffn) {
    const out = new Uint8Array(5);
    out[0] = prefix | 26;
    new DataView(out.buffer).setUint32(1, Number(value));
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = prefix | 27;
  new DataView(out.buffer).setBigUint64(1, value);
  return out;
}
