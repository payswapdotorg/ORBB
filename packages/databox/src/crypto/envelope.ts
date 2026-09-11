/**
 * Envelope encryption (architecture §7): a fresh random data-encryption key
 * (DEK) encrypts each payload with AES-256-GCM; the DEK itself is wrapped
 * under the `KeyProvider`'s wrapping key and stored alongside the
 * ciphertext. Decrypting requires the provider (development: injected
 * secret; production: KMS/HSM) — ciphertext at rest is useless without it.
 *
 * Context binding: `encrypt(plaintext, context)` binds the ciphertext to a
 * caller-supplied {@link EncryptionContext} via GCM AAD. `decrypt` with a
 * different context is an authentication failure ("context-mismatch"),
 * even with the correct key — this binds DataBox metadata ciphertext to the
 * person/key-space it belongs to.
 *
 * Envelope shape (packet A19): { ciphertext, wrappedKey, iv, tag, context }
 * plus an explicit `algorithm` agility marker.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EnvelopeCryptoError } from "../errors.js";
import {
  assertWrappedDataKeyShape,
  GCM_IV_LENGTH_BYTES,
  GCM_TAG_LENGTH_BYTES,
  type KeyProvider,
} from "./keyprovider.js";

/** Payload-encryption algorithm tag (agility marker, M2 = AES-256-GCM). */
export const ENVELOPE_ALGORITHM = "AES-256-GCM" as const;

/**
 * Additional authenticated data context. Arbitrary string map; canonical
 * form (keys sorted, `k=v` joined by `;`) is the GCM AAD. Structural
 * canonicalization makes context equality order-independent.
 */
export type EncryptionContext = Readonly<Record<string, string>>;

/** One encrypted envelope: exactly the packet-A19 fields plus `algorithm`. */
export interface EncryptedEnvelope {
  readonly algorithm: "AES-256-GCM";
  /** Ciphertext of the payload (same length as the payload). */
  readonly ciphertext: Uint8Array;
  /** Wrapped DEK used for this envelope. */
  readonly wrappedKey: import("./keyprovider.js").WrappedDataKey;
  /** 12-byte payload-encryption IV. */
  readonly iv: Uint8Array;
  /** 16-byte GCM tag over ciphertext + canonical context AAD. */
  readonly tag: Uint8Array;
  /** The context the envelope was encrypted under (canonicalized copy). */
  readonly context: EncryptionContext;
}

/**
 * Envelope encryptor over an injected {@link KeyProvider}. Stateless per
 * call: every `encrypt` generates a fresh DEK and IV, so encrypting the
 * same plaintext twice yields different ciphertexts (semantic security),
 * both decryptable with the same provider.
 */
export class EnvelopeEncryptor {
  readonly #keys: KeyProvider;

  constructor(keyProvider: KeyProvider) {
    this.#keys = keyProvider;
  }

  /**
   * Encrypts `plaintext` under a fresh DEK bound to `context`.
   * Throws `EnvelopeCryptoError("invalid-context")` for a malformed context.
   */
  async encrypt(plaintext: Uint8Array, context: EncryptionContext): Promise<EncryptedEnvelope> {
    if (!(plaintext instanceof Uint8Array)) {
      throw new EnvelopeCryptoError(
        "malformed-envelope",
        "Invalid plaintext: expected a Uint8Array payload.",
      );
    }
    assertEncryptionContext(context);
    const canonicalContext = canonicalizeContext(context);
    const dek = await this.#keys.generateDataKey();
    const iv = new Uint8Array(randomBytes(GCM_IV_LENGTH_BYTES));
    const cipher = createCipheriv("aes-256-gcm", dek.plaintext.bytes, iv);
    cipher.setAAD(canonicalContextAad(canonicalContext));
    const ciphertext = new Uint8Array(
      Buffer.concat([cipher.update(plaintext), cipher.final()]),
    );
    const tag = new Uint8Array(cipher.getAuthTag());
    return {
      algorithm: ENVELOPE_ALGORITHM,
      ciphertext,
      wrappedKey: dek.wrapped,
      iv,
      tag,
      context: canonicalContext,
    };
  }

  /**
   * Decrypts an envelope. Failures are authentication failures by design:
   *   - context differs from the encryption context  -> "context-mismatch"
   *   - ciphertext/tag/wrappedKey tampered           -> "integrity-failure"
   *     or "key-unwrap-failure"
   *   - malformed envelope                           -> "malformed-envelope"
   */
  async decrypt(envelope: EncryptedEnvelope, context: EncryptionContext): Promise<Uint8Array> {
    assertEnvelopeShape(envelope);
    assertEncryptionContext(context);
    const provided = canonicalizeContext(context);
    const embedded = canonicalizeContext(envelope.context);
    if (canonicalContextString(embedded) !== canonicalContextString(provided)) {
      throw new EnvelopeCryptoError(
        "context-mismatch",
        "Envelope context mismatch: the decryption context does not bind to this envelope (authentication failure).",
      );
    }
    const dek = await this.#keys.unwrap(envelope.wrappedKey);
    try {
      const decipher = createDecipheriv("aes-256-gcm", dek.bytes, envelope.iv);
      decipher.setAAD(canonicalContextAad(provided));
      decipher.setAuthTag(envelope.tag);
      return new Uint8Array(
        Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]),
      );
    } catch {
      throw new EnvelopeCryptoError(
        "integrity-failure",
        "Envelope decryption failed: tampered ciphertext, IV, or tag.",
      );
    }
  }
}

/**
 * Validates an encryption context: at least one entry; every key and value
 * a non-empty string. Throws `EnvelopeCryptoError("invalid-context")`.
 */
export function assertEncryptionContext(context: EncryptionContext): void {
  if (typeof context !== "object" || context === null || context === undefined) {
    throw new EnvelopeCryptoError(
      "invalid-context",
      "Invalid encryption context: expected a non-empty record of non-empty string keys and values.",
    );
  }
  const entries = Object.entries(context);
  if (entries.length === 0) {
    throw new EnvelopeCryptoError(
      "invalid-context",
      "Invalid encryption context: expected a non-empty record of non-empty string keys and values.",
    );
  }
  for (const [key, value] of entries) {
    if (typeof key !== "string" || key.length === 0) {
      throw new EnvelopeCryptoError(
        "invalid-context",
        "Invalid encryption context: keys must be non-empty strings.",
      );
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new EnvelopeCryptoError(
        "invalid-context",
        "Invalid encryption context: values must be non-empty strings.",
      );
    }
  }
}

/** Returns a copy of `context` with keys inserted in sorted order. */
export function canonicalizeContext(context: EncryptionContext): EncryptionContext {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(context).sort()) {
    sorted[key] = context[key] as string;
  }
  return Object.freeze(sorted);
}

/** Canonical string form of a context (keys sorted, `k=v` joined by `;`). */
export function canonicalContextString(context: EncryptionContext): string {
  return Object.keys(context)
    .sort()
    .map((key) => `${key}=${context[key] as string}`)
    .join(";");
}

function canonicalContextAad(context: EncryptionContext): Uint8Array {
  return new Uint8Array(Buffer.from(canonicalContextString(context), "utf8"));
}

/** Structural validation of an envelope (lengths, algorithm, types). */
export function assertEnvelopeShape(envelope: EncryptedEnvelope): void {
  if (typeof envelope !== "object" || envelope === null) {
    throw new EnvelopeCryptoError("malformed-envelope", "Malformed envelope: expected an object.");
  }
  if (envelope.algorithm !== ENVELOPE_ALGORITHM) {
    throw new EnvelopeCryptoError(
      "malformed-envelope",
      "Malformed envelope: unsupported or missing algorithm tag.",
    );
  }
  if (
    !(envelope.ciphertext instanceof Uint8Array) ||
    !(envelope.iv instanceof Uint8Array) ||
    envelope.iv.byteLength !== GCM_IV_LENGTH_BYTES ||
    !(envelope.tag instanceof Uint8Array) ||
    envelope.tag.byteLength !== GCM_TAG_LENGTH_BYTES
  ) {
    throw new EnvelopeCryptoError(
      "malformed-envelope",
      "Malformed envelope: expected a ciphertext, a 12-byte IV, and a 16-byte tag.",
    );
  }
  try {
    assertWrappedDataKeyShape(envelope.wrappedKey);
  } catch {
    throw new EnvelopeCryptoError(
      "malformed-envelope",
      "Malformed envelope: the wrapped key is not a well-formed AES-256-GCM wrapped DEK.",
    );
  }
  if (typeof envelope.context !== "object" || envelope.context === null) {
    throw new EnvelopeCryptoError(
      "malformed-envelope",
      "Malformed envelope: missing the encryption context.",
    );
  }
}
