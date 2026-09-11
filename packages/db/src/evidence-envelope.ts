/**
 * Envelope ↔ jsonb storage mapping (M2-D Lane A).
 *
 * The `evidence_objects.encrypted_metadata` column stores
 * @orbb/databox's `EncryptedEnvelope` (AES-256-GCM) as JSON: every byte
 * field (ciphertext, iv, tag, and the wrapped key's iv/ciphertext/tag)
 * is base64-encoded; `context` is stored verbatim (opaque string map).
 * The stored JSON therefore contains NO plaintext sensitive metadata —
 * only base64 ciphertext material and the context binding labels.
 *
 * Serialization re-uses databox's own `assertEnvelopeShape` guard (the
 * single source of truth for envelope structure); deserialization
 * validates the stored shape and converts back to `Uint8Array` fields,
 * failing with `PersistenceError("state-conflict")` on a corrupted row
 * (a malformed stored envelope means the row and the crypto layer
 * disagree — surfaced loudly, never silently coerced).
 */
import { assertEnvelopeShape, type EncryptedEnvelope, type WrappedDataKey } from "@orbb/databox";
import { PersistenceError } from "./errors.js";

/** The JSON form of a {@link EncryptedEnvelope} as stored in jsonb. */
export interface StoredEncryptedEnvelope {
  readonly algorithm: "AES-256-GCM";
  /** Base64-encoded payload ciphertext. */
  readonly ciphertext: string;
  /** The wrapped DEK, with byte fields base64-encoded. */
  readonly wrappedKey: {
    readonly algorithm: "AES-256-GCM";
    readonly iv: string;
    readonly ciphertext: string;
    readonly tag: string;
  };
  /** Base64-encoded 12-byte payload IV. */
  readonly iv: string;
  /** Base64-encoded 16-byte GCM tag. */
  readonly tag: string;
  /** Context the envelope was encrypted under (opaque string map). */
  readonly context: Record<string, string>;
}

/** Encodes bytes as base64 without leaking a Buffer type at the boundary. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Decodes base64; returns undefined for structurally invalid input. */
function fromBase64(value: string): Uint8Array | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    return undefined;
  }
}

function malformed(): PersistenceError {
  return new PersistenceError(
    "state-conflict",
    "The stored encrypted-metadata envelope is malformed (base64/shape validation failed); the row disagrees with the crypto layer.",
  );
}

/** Serializes a well-formed envelope into its stored JSON shape. */
export function serializeEncryptedEnvelope(envelope: EncryptedEnvelope): StoredEncryptedEnvelope {
  // databox's own guard: algorithm tag, IV/tag lengths, wrapped-key shape.
  assertEnvelopeShape(envelope);
  return {
    algorithm: envelope.algorithm,
    ciphertext: toBase64(envelope.ciphertext),
    wrappedKey: {
      algorithm: envelope.wrappedKey.algorithm,
      iv: toBase64(envelope.wrappedKey.iv),
      ciphertext: toBase64(envelope.wrappedKey.ciphertext),
      tag: toBase64(envelope.wrappedKey.tag),
    },
    iv: toBase64(envelope.iv),
    tag: toBase64(envelope.tag),
    context: { ...envelope.context },
  };
}

/** Deserializes a stored JSON envelope back into the runtime shape. */
export function deserializeEncryptedEnvelope(stored: unknown): EncryptedEnvelope {
  if (typeof stored !== "object" || stored === null) {
    throw malformed();
  }
  const candidate = stored as Partial<StoredEncryptedEnvelope> & {
    wrappedKey?: Partial<StoredEncryptedEnvelope["wrappedKey"]>;
  };
  if (
    candidate.algorithm !== "AES-256-GCM" ||
    typeof candidate.ciphertext !== "string" ||
    candidate.ciphertext.length === 0 ||
    typeof candidate.iv !== "string" ||
    typeof candidate.tag !== "string" ||
    typeof candidate.wrappedKey !== "object" ||
    candidate.wrappedKey === null
  ) {
    throw malformed();
  }
  const wrapped = candidate.wrappedKey as Partial<StoredEncryptedEnvelope["wrappedKey"]>;
  if (
    wrapped.algorithm !== "AES-256-GCM" ||
    typeof wrapped.iv !== "string" ||
    typeof wrapped.ciphertext !== "string" ||
    typeof wrapped.tag !== "string"
  ) {
    throw malformed();
  }
  const ciphertext = fromBase64(candidate.ciphertext);
  const iv = fromBase64(candidate.iv);
  const tag = fromBase64(candidate.tag);
  const wrappedIv = fromBase64(wrapped.iv);
  const wrappedCiphertext = fromBase64(wrapped.ciphertext);
  const wrappedTag = fromBase64(wrapped.tag);
  if (
    ciphertext === undefined ||
    iv === undefined ||
    tag === undefined ||
    wrappedIv === undefined ||
    wrappedCiphertext === undefined ||
    wrappedTag === undefined
  ) {
    throw malformed();
  }
  if (
    typeof candidate.context !== "object" ||
    candidate.context === null ||
    Object.entries(candidate.context).some(
      ([key, value]) => typeof key !== "string" || key.length === 0 || typeof value !== "string",
    )
  ) {
    throw malformed();
  }
  const wrappedKey: WrappedDataKey = {
    algorithm: "AES-256-GCM",
    iv: wrappedIv,
    ciphertext: wrappedCiphertext,
    tag: wrappedTag,
  };
  const envelope: EncryptedEnvelope = {
    algorithm: "AES-256-GCM",
    ciphertext,
    wrappedKey,
    iv,
    tag,
    context: { ...candidate.context },
  };
  // Final structural validation with databox's own guard (lengths,
  // algorithm tags, wrapped-key shape) — surfaces as a persistence state
  // conflict, never as a silently coerced envelope.
  try {
    assertEnvelopeShape(envelope);
  } catch {
    throw malformed();
  }
  return envelope;
}
