/**
 * Application-layer envelope-encryption key management (architecture §7):
 * "application-layer envelope encryption behind a `KeyProvider` interface.
 * Each DataBox has one or more data-encryption keys; production key
 * management is pluggable so development can use a secret-backed provider
 * and regulated deployments can use a cloud KMS/HSM."
 *
 * Recorded design decisions:
 *   - The `KeyProvider` interface is ASYNC: cloud KMS/HSM providers are
 *     network-bound, so the seam is designed for the production case, not
 *     the development case. `SecretKeyProvider` is synchronous under the
 *     hood but satisfies the async contract.
 *   - `SecretKeyProvider` (development) derives its wrapping key from an
 *     INJECTED secret via HKDF-SHA256 with a fixed domain-separator salt
 *     and a key-space info label — the secret is never hardcoded in this
 *     package, never logged, and never derivable from the wrapped output
 *     without the provider that holds it.
 *   - Key wrap/unwrap uses AES-256-GCM (node:crypto) with a fresh 12-byte
 *     IV per wrap and an AAD label binding the wrapped blob to the
 *     DEK-wrap protocol, preventing cross-protocol replay of wrap output.
 *   - Minimum injected-secret length is 16 bytes/chars: a floor against
 *     accidentally empty/trivial dev secrets, not a substitute for real
 *     entropy in production (where a KMS provider replaces this class).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { EnvelopeCryptoError } from "../errors.js";

/** Data-encryption key (DEK) length: AES-256 => 32 bytes. */
export const DATA_KEY_LENGTH_BYTES = 32;

/** AES-GCM IV (nonce) length for both DEK wrap and payload encryption. */
export const GCM_IV_LENGTH_BYTES = 12;

/** AES-GCM authentication tag length. */
export const GCM_TAG_LENGTH_BYTES = 16;

/** Algorithm tag carried by wrapped keys (agility marker, M2 = AES-256-GCM). */
export const WRAPPED_KEY_ALGORITHM = "AES-256-GCM" as const;

/** HKDF domain-separator salt for the development wrapping key. */
const WRAPPING_KEY_SALT = "orbb-databox-wrapping-key-v1";

/** HKDF info label for the development wrapping key. */
const WRAPPING_KEY_INFO = "databox/envelope-wrapping";

/** AAD label binding DEK-wrap blobs to this protocol. */
const DEK_WRAP_AAD = "orbb-databox/dek-wrap/v1";

/** Minimum injected secret length (bytes for Uint8Array, chars for string). */
const MIN_SECRET_LENGTH = 16;

/** A generated data-encryption key: the plaintext DEK plus its wrapped form. */
export interface GeneratedDataKey {
  /** Plaintext DEK (32 bytes). Must never be persisted or logged. */
  readonly plaintext: DataKey;
  /** Wrapped (encrypted) DEK — safe to persist alongside ciphertext. */
  readonly wrapped: WrappedDataKey;
}

/** A data-encryption key. Exactly 32 bytes (AES-256). */
export interface DataKey {
  readonly bytes: Uint8Array;
}

/** A wrapped (encrypted) data-encryption key. */
export interface WrappedDataKey {
  readonly algorithm: "AES-256-GCM";
  /** 12-byte IV used for the wrap. */
  readonly iv: Uint8Array;
  /** Ciphertext of the 32-byte DEK (same length). */
  readonly ciphertext: Uint8Array;
  /** 16-byte GCM tag. */
  readonly tag: Uint8Array;
}

/**
 * Envelope-encryption key provider (architecture §7). Production
 * implementations wrap a cloud KMS/HSM; the development implementation is
 * {@link SecretKeyProvider}.
 */
export interface KeyProvider {
  /** Generates a fresh random DEK and returns it with its wrapped form. */
  generateDataKey(): Promise<GeneratedDataKey>;
  /** Wraps (encrypts) a plaintext DEK under the provider's wrapping key. */
  wrap(plaintext: DataKey): Promise<WrappedDataKey>;
  /**
   * Unwraps (decrypts) a wrapped DEK. Tampered or foreign wrapped keys MUST
   * fail with {@link EnvelopeCryptoError} code "key-unwrap-failure".
   */
  unwrap(wrapped: WrappedDataKey): Promise<DataKey>;
}

/** Options for constructing {@link SecretKeyProvider}. */
export interface SecretKeyProviderOptions {
  /**
   * Development secret the wrapping key is derived from. MUST be injected
   * by the caller (environment/secret store) — never hardcoded. Minimum
   * 16 bytes (Uint8Array) or 16 characters (string).
   */
  readonly secret: string | Uint8Array;
  /**
   * Key-space label folded into HKDF derivation (domain separation between
   * DataBoxes/tenants). Default "orbb/databox".
   */
  readonly keySpace?: string;
}

/**
 * Development `KeyProvider`: derives a 32-byte AES-256 wrapping key from an
 * injected secret via HKDF-SHA256 and wraps/unwraps DEKs with AES-256-GCM
 * (node:crypto). NOT a KMS: acceptable for local/preview only — regulated
 * deployments must substitute a KMS/HSM-backed provider behind the same
 * interface (recorded, architecture §7).
 */
export class SecretKeyProvider implements KeyProvider {
  readonly #wrappingKey: Uint8Array;

  constructor(options: SecretKeyProviderOptions) {
    const secretBytes =
      typeof options.secret === "string" ? Buffer.from(options.secret, "utf8") : options.secret;
    if (secretBytes.byteLength < MIN_SECRET_LENGTH) {
      throw new RangeError(
        "SecretKeyProvider secret must be at least 16 bytes; refusing a trivially small injected secret.",
      );
    }
    const keySpace = options.keySpace ?? "orbb/databox";
    const derived = hkdfSync(
      "sha256",
      secretBytes,
      Buffer.from(WRAPPING_KEY_SALT, "utf8"),
      Buffer.from(`${keySpace}/${WRAPPING_KEY_INFO}`, "utf8"),
      DATA_KEY_LENGTH_BYTES,
    );
    // hkdfSync returns an ArrayBuffer — copy into a plain Uint8Array so no
    // Buffer API leaks through the boundary.
    this.#wrappingKey = new Uint8Array(derived);
  }

  async generateDataKey(): Promise<GeneratedDataKey> {
    const plaintext: DataKey = { bytes: new Uint8Array(randomBytes(DATA_KEY_LENGTH_BYTES)) };
    const wrapped = await this.wrap(plaintext);
    return { plaintext, wrapped };
  }

  async wrap(plaintext: DataKey): Promise<WrappedDataKey> {
    if (
      !(plaintext.bytes instanceof Uint8Array) ||
      plaintext.bytes.byteLength !== DATA_KEY_LENGTH_BYTES
    ) {
      throw new EnvelopeCryptoError(
        "malformed-envelope",
        "Invalid data-encryption key: expected exactly 32 bytes (AES-256).",
      );
    }
    const iv = new Uint8Array(randomBytes(GCM_IV_LENGTH_BYTES));
    const cipher = createCipheriv("aes-256-gcm", this.#wrappingKey, iv);
    cipher.setAAD(Buffer.from(DEK_WRAP_AAD, "utf8"));
    const ciphertext = new Uint8Array(
      Buffer.concat([cipher.update(plaintext.bytes), cipher.final()]),
    );
    const tag = new Uint8Array(cipher.getAuthTag());
    return { algorithm: WRAPPED_KEY_ALGORITHM, iv, ciphertext, tag };
  }

  async unwrap(wrapped: WrappedDataKey): Promise<DataKey> {
    assertWrappedDataKeyShape(wrapped);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#wrappingKey, wrapped.iv);
      decipher.setAAD(Buffer.from(DEK_WRAP_AAD, "utf8"));
      decipher.setAuthTag(wrapped.tag);
      const bytes = new Uint8Array(
        Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]),
      );
      return { bytes };
    } catch {
      // Auth failure, malformed input, or a key wrapped under a different
      // secret — indistinguishable by design (no oracle beyond failure).
      throw new EnvelopeCryptoError(
        "key-unwrap-failure",
        "Wrapped key unwrap failed: tampered, malformed, or wrapped under a different provider secret.",
      );
    }
  }
}

/** Structural validation of a wrapped-key blob. */
export function assertWrappedDataKeyShape(wrapped: WrappedDataKey): void {
  if (
    wrapped.algorithm !== WRAPPED_KEY_ALGORITHM ||
    !(wrapped.iv instanceof Uint8Array) ||
    wrapped.iv.byteLength !== GCM_IV_LENGTH_BYTES ||
    !(wrapped.tag instanceof Uint8Array) ||
    wrapped.tag.byteLength !== GCM_TAG_LENGTH_BYTES ||
    !(wrapped.ciphertext instanceof Uint8Array) ||
    wrapped.ciphertext.byteLength !== DATA_KEY_LENGTH_BYTES
  ) {
    throw new EnvelopeCryptoError(
      "malformed-envelope",
      "Malformed wrapped key: expected AES-256-GCM with a 12-byte IV, a 16-byte tag, and a 32-byte DEK ciphertext.",
    );
  }
}
