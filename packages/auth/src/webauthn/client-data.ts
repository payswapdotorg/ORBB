/**
 * WebAuthn client data (collected client data JSON) — W3C WebAuthn L3 §5.8.1
 * and the challenge/origin checks of the §7.1 / §7.2 verification steps.
 *
 * Recorded decisions:
 *   - The `challenge` in client data is base64url WITHOUT padding per the
 *     serialization rules; decoding is lenient about echoed padding and
 *     strict about the alphabet.
 *   - Challenge comparison is timing-safe over the decoded bytes.
 *   - `crossOrigin` is parsed but not enforced (not a pass/fail step in
 *     the L3 registration/assertion verification procedures).
 *   - Origin matching is exact string membership in the allowlist (the
 *     Relying Party must list its exact origins; no scheme/hostname
 *     fuzzy matching, deny-by-default).
 */
import { fromBase64Url, timingSafeEqualUint8 } from "../crypto.js";
import { AuthInvariantError } from "../errors.js";

/** Client data ceremony types (W3C WebAuthn L3). */
export type ClientDataType = "webauthn.create" | "webauthn.get";

/** Parsed client data JSON. */
export interface ParsedClientData {
  readonly type: string;
  /** base64url-encoded challenge as it appeared in the JSON. */
  readonly challenge: string;
  readonly origin: string;
  readonly crossOrigin?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses and shape-validates the client data JSON (malformed input throws
 * {@link AuthInvariantError}; the caller maps it to a typed failure code).
 */
export function parseClientDataJSON(bytes: Uint8Array): ParsedClientData {
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new AuthInvariantError("client data: not valid JSON");
  }
  if (!isPlainObject(raw)) {
    throw new AuthInvariantError("client data: expected a JSON object at the top level");
  }
  const type = raw["type"];
  const challenge = raw["challenge"];
  const origin = raw["origin"];
  if (typeof type !== "string" || type.length === 0) {
    throw new AuthInvariantError("client data: expected a non-empty string 'type'");
  }
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/u.test(challenge)) {
    throw new AuthInvariantError("client data: expected 'challenge' to be a base64url string");
  }
  if (typeof origin !== "string" || origin.length === 0) {
    throw new AuthInvariantError("client data: expected a non-empty string 'origin'");
  }
  const crossOrigin = raw["crossOrigin"];
  if (crossOrigin !== undefined && typeof crossOrigin !== "boolean") {
    throw new AuthInvariantError("client data: expected 'crossOrigin' to be a boolean when present");
  }
  return {
    type,
    challenge,
    origin,
    ...(crossOrigin !== undefined ? { crossOrigin } : {}),
  };
}

/** Accepts a challenge as base64url text or raw bytes and normalizes to bytes. */
export function challengeToBytes(challenge: string | Uint8Array): Uint8Array {
  if (typeof challenge !== "string") {
    return challenge;
  }
  return fromBase64Url(challenge);
}

/** The failure kinds of `checkClientData` (mapped to typed codes by callers). */
export type ClientDataCheckFailure = "TYPE_MISMATCH" | "CHALLENGE_MISMATCH" | "ORIGIN_MISMATCH";

/**
 * Runs the L3 client-data verification steps: ceremony type, challenge
 * (timing-safe, decoded bytes), origin allowlist. Returns the first
 * failure, or `undefined` when every check passes.
 */
export function checkClientData(
  clientData: ParsedClientData,
  expected: {
    readonly type: ClientDataType;
    readonly challenge: Uint8Array;
    readonly allowedOrigins: readonly string[];
  },
): ClientDataCheckFailure | undefined {
  if (clientData.type !== expected.type) {
    return "TYPE_MISMATCH";
  }
  const provided = fromBase64Url(clientData.challenge);
  if (!timingSafeEqualUint8(provided, expected.challenge)) {
    return "CHALLENGE_MISMATCH";
  }
  if (!expected.allowedOrigins.includes(clientData.origin)) {
    return "ORIGIN_MISMATCH";
  }
  return undefined;
}

const clientDataDecoder = new TextDecoder("utf-8", { fatal: true });

function utf8Decode(bytes: Uint8Array): string {
  return clientDataDecoder.decode(bytes);
}
