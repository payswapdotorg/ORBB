/**
 * Authenticator data parser — W3C WebAuthn L3 §6.1 (authenticator data
 * structure: rpIdHash ‖ flags ‖ signCount ‖ [attested credential data]
 * ‖ [extensions]).
 *
 * Flag bits (L3): UP=0x01, UV=0x04, BE=0x08, BS=0x10, AT=0x40, ED=0x80.
 * Parsing is strict: minimum 37 bytes, credential ids must be non-empty,
 * the COSE key is parsed self-delimitingly (it may be followed by the
 * extensions map), and every input byte must be accounted for.
 */
import { AuthInvariantError } from "../errors.js";
import { decodeCborItem, type CborKey, type CborValue } from "./cbor.js";

/** Authenticator flag bits (W3C WebAuthn L3 §6.1). */
export const AUTHENTICATOR_FLAG_BITS = {
  /** User Present. */
  UP: 0x01,
  /** User Verified. */
  UV: 0x04,
  /** Backup Eligible. */
  BE: 0x08,
  /** Backup State. */
  BS: 0x10,
  /** Attested credential data included. */
  AT: 0x40,
  /** Extensions included. */
  ED: 0x80,
} as const;

/** Decoded authenticator flag semantics. */
export interface AuthenticatorFlags {
  readonly up: boolean;
  readonly uv: boolean;
  readonly be: boolean;
  readonly bs: boolean;
  readonly at: boolean;
  readonly ed: boolean;
}

/** Attested credential data (present when AT is set). */
export interface AttestedCredentialData {
  /** 16-byte AAGUID (authenticator model identifier — not PHI). */
  readonly aaguid: Uint8Array;
  readonly credentialId: Uint8Array;
  /** Raw COSE public key bytes (self-delimiting CBOR). */
  readonly credentialPublicKey: Uint8Array;
}

/** Parsed authenticator data. */
export interface AuthenticatorData {
  /** SHA-256 hash of the RP ID (32 bytes). */
  readonly rpIdHash: Uint8Array;
  readonly flags: AuthenticatorFlags;
  /** Signature counter (big-endian uint32; 0 = no counter support). */
  readonly signCount: number;
  readonly attestedCredentialData?: AttestedCredentialData;
  readonly extensions?: ReadonlyMap<CborKey, CborValue>;
}

const MIN_AUTHENTICATOR_DATA_LENGTH = 37;

function malformed(detail: string): AuthInvariantError {
  return new AuthInvariantError(`authenticator data: ${detail}`);
}

/**
 * Parses authenticator data (shape errors throw {@link AuthInvariantError};
 * verify paths map them to typed failure codes).
 */
export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < MIN_AUTHENTICATOR_DATA_LENGTH) {
    throw malformed("truncated (minimum 37 bytes)");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flagsByte = bytes[32] as number;
  const flagBits = AUTHENTICATOR_FLAG_BITS;
  const flags: AuthenticatorFlags = {
    up: (flagsByte & flagBits.UP) !== 0,
    uv: (flagsByte & flagBits.UV) !== 0,
    be: (flagsByte & flagBits.BE) !== 0,
    bs: (flagsByte & flagBits.BS) !== 0,
    at: (flagsByte & flagBits.AT) !== 0,
    ed: (flagsByte & flagBits.ED) !== 0,
  };
  const signCount = view.getUint32(33);
  const rpIdHash = bytes.subarray(0, 32);

  let cursor = MIN_AUTHENTICATOR_DATA_LENGTH;
  let attestedCredentialData: AttestedCredentialData | undefined;
  if (flags.at) {
    if (bytes.length < cursor + 16) {
      throw malformed("truncated aaguid");
    }
    const aaguid = bytes.subarray(cursor, cursor + 16);
    cursor += 16;
    if (bytes.length < cursor + 2) {
      throw malformed("truncated credential id length");
    }
    const credentialIdLength = view.getUint16(cursor);
    cursor += 2;
    if (credentialIdLength === 0) {
      throw malformed("credential id must not be empty");
    }
    if (bytes.length < cursor + credentialIdLength) {
      throw malformed("truncated credential id");
    }
    const credentialId = bytes.subarray(cursor, cursor + credentialIdLength);
    cursor += credentialIdLength;
    const keyItem = decodeCborItem(bytes, cursor);
    attestedCredentialData = {
      aaguid,
      credentialId,
      credentialPublicKey: bytes.subarray(cursor, keyItem.nextOffset),
    };
    cursor = keyItem.nextOffset;
  }

  let extensions: ReadonlyMap<CborKey, CborValue> | undefined;
  if (flags.ed) {
    const item = decodeCborItem(bytes, cursor);
    if (!(item.value instanceof Map)) {
      throw malformed("extensions must be a CBOR map");
    }
    extensions = item.value;
    cursor = item.nextOffset;
  }

  if (cursor !== bytes.length) {
    throw malformed("trailing bytes");
  }

  return {
    rpIdHash,
    flags,
    signCount,
    ...(attestedCredentialData !== undefined ? { attestedCredentialData } : {}),
    ...(extensions !== undefined ? { extensions } : {}),
  };
}
