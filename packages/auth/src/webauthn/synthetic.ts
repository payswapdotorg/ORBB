/**
 * Synthetic WebAuthn authenticator — TEST VECTOR BUILDER.
 *
 * Not part of the public surface (not re-exported from src/index.ts).
 * Generates REAL keypairs with node:crypto, builds CTAP2-canonical
 * authenticator data / attestation objects / assertions, and signs them
 * with real signatures, so the verifiers are exercised against genuine
 * cryptography — no live WebAuthn devices, no fixtures with secrets
 * (every keypair is generated in-test; nothing here is PHI).
 */
import { generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";
import { sha256, toBase64Url } from "../crypto.js";
import { encodeCbor, type CborKey, type CborValue } from "./cbor.js";
import { COSE_ALG } from "./cose.js";

/** Algorithms the synthetic authenticator can emulate. */
export type SyntheticAlgorithm = "es256" | "ed25519" | "rs256";

/** A synthetic authenticator (credential keypair + signing closures). */
export interface SyntheticAuthenticator {
  readonly algorithm: SyntheticAlgorithm;
  readonly coseAlg: number;
  readonly credentialId: Uint8Array;
  /** Encoded COSE public key (as embedded in attested credential data). */
  readonly coseKey: Uint8Array;
  /** Signs the WebAuthn signature base (raw r‖s for ES256). */
  sign(signatureBase: Uint8Array): Uint8Array;
}

/** Common test RP parameters. */
export const TEST_RP_ID = "orbb.test";
export const TEST_ALLOWED_ORIGINS = ["https://orbb.test"] as const;

/** Builds a synthetic authenticator with a fresh keypair. */
export function createSyntheticAuthenticator(algorithm: SyntheticAlgorithm): SyntheticAuthenticator {
  const credentialId = randomBytes(16);
  switch (algorithm) {
    case "es256": {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
      const coseKey = encodeCbor(
        new Map<CborKey, CborValue>([
          [1, 2],
          [3, COSE_ALG.ES256],
          [-1, 1],
          [-2, base64UrlToBytes(jwk.x)],
          [-3, base64UrlToBytes(jwk.y)],
        ]),
      );
      return {
        algorithm,
        coseAlg: COSE_ALG.ES256,
        credentialId,
        coseKey,
        sign(signatureBase: Uint8Array): Uint8Array {
          return cryptoSign("sha256", signatureBase, {
            key: privateKey,
            dsaEncoding: "ieee-p1363",
          });
        },
      };
    }
    case "ed25519": {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const jwk = publicKey.export({ format: "jwk" }) as { x: string };
      const coseKey = encodeCbor(
        new Map<CborKey, CborValue>([
          [1, 1],
          [3, COSE_ALG.ED25519],
          [-1, 6],
          [-2, base64UrlToBytes(jwk.x)],
        ]),
      );
      return {
        algorithm,
        coseAlg: COSE_ALG.ED25519,
        credentialId,
        coseKey,
        sign(signatureBase: Uint8Array): Uint8Array {
          return cryptoSign(null, signatureBase, privateKey);
        },
      };
    }
    case "rs256": {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
      const coseKey = encodeCbor(
        new Map<CborKey, CborValue>([
          [1, 3],
          [3, COSE_ALG.RS256],
          [-1, base64UrlToBytes(jwk.n)],
          [-2, base64UrlToBytes(jwk.e)],
        ]),
      );
      return {
        algorithm,
        coseAlg: COSE_ALG.RS256,
        credentialId,
        coseKey,
        sign(signatureBase: Uint8Array): Uint8Array {
          return cryptoSign("sha256", signatureBase, privateKey);
        },
      };
    }
  }
}

/** Authenticator flag byte used by the builders. */
export const SYNTH_FLAGS = {
  /** UP | UV (typical assert). */
  UP_UV: 0x01 | 0x04,
  /** UP only. */
  UP_ONLY: 0x01,
  /** UP | UV | AT (registration with attested credential data). */
  UP_UV_AT: 0x01 | 0x04 | 0x40,
  /** Nothing set (invalid assertion: no UP). */
  NONE: 0x00,
} as const;

/** Zero AAGUID (the "none"-format convention). */
export const ZERO_AAGUID = new Uint8Array(16);

/**
 * Builds authenticator data bytes.
 * `attested` requires {credentialId, coseKey}; aaguid defaults to zeros.
 */
export function buildAuthData(input: {
  readonly rpId: string;
  readonly flags: number;
  readonly signCount: number;
  readonly attested?: { readonly credentialId: Uint8Array; readonly coseKey: Uint8Array };
  readonly aaguid?: Uint8Array;
}): Uint8Array {
  const rpIdHash = sha256(input.rpId);
  const out = new Uint8Array(37);
  out.set(rpIdHash, 0);
  out[32] = input.flags;
  new DataView(out.buffer).setUint32(33, input.signCount >>> 0);
  if (input.attested === undefined) {
    return out;
  }
  const aaguid = input.aaguid ?? ZERO_AAGUID;
  if (aaguid.length !== 16) {
    throw new RangeError("synthetic aaguid must be 16 bytes");
  }
  const credIdLength = input.attested.credentialId.length;
  const head = new Uint8Array(18);
  head.set(aaguid, 0);
  new DataView(head.buffer).setUint16(16, credIdLength);
  const total = new Uint8Array(37 + 18 + credIdLength + input.attested.coseKey.length);
  total.set(out, 0);
  total.set(head, 37);
  total.set(input.attested.credentialId, 55);
  total.set(input.attested.coseKey, 55 + credIdLength);
  return total;
}

/** Builds client data JSON bytes. */
export function buildClientDataJSON(input: {
  readonly type: "webauthn.create" | "webauthn.get";
  readonly challenge: Uint8Array;
  readonly origin: string;
}): Uint8Array {
  const json = JSON.stringify({
    type: input.type,
    challenge: toBase64Url(input.challenge),
    origin: input.origin,
  });
  return new TextEncoder().encode(json);
}

/** Builds a full attestation object ({fmt, attStmt, authData} CBOR map). */
export function buildAttestationObject(input: {
  readonly fmt: string;
  readonly attStmt: Map<string, CborValue>;
  readonly authData: Uint8Array;
}): Uint8Array {
  return encodeCbor(
    new Map<CborKey, CborValue>([
      ["fmt", input.fmt],
      ["attStmt", input.attStmt],
      ["authData", input.authData],
    ]),
  );
}

/** WebAuthn signature base: authData ‖ SHA-256(clientDataJSON). */
export function signatureBase(authData: Uint8Array, clientDataJSON: Uint8Array): Uint8Array {
  const hash = sha256(clientDataJSON);
  const out = new Uint8Array(authData.length + hash.length);
  out.set(authData, 0);
  out.set(hash, authData.length);
  return out;
}

/** A complete packed self-attestation response, plus its parts for recomposition. */
export interface PackedSelfAttestationResponse {
  readonly clientDataJSON: Uint8Array;
  /** The authenticator data bytes (reusable to rebuild attestation objects). */
  readonly authData: Uint8Array;
  /** The self-attestation signature over authData ‖ SHA-256(clientDataJSON). */
  readonly signature: Uint8Array;
  readonly attestationObject: Uint8Array;
}

/** Builds a complete packed self-attestation registration response. */
export function buildPackedSelfAttestation(input: {
  readonly authenticator: SyntheticAuthenticator;
  readonly challenge: Uint8Array;
  readonly origin?: string;
  readonly rpId?: string;
  readonly signCount?: number;
}): PackedSelfAttestationResponse {
  const origin = input.origin ?? TEST_ALLOWED_ORIGINS[0];
  const rpId = input.rpId ?? TEST_RP_ID;
  const clientDataJSON = buildClientDataJSON({
    type: "webauthn.create",
    challenge: input.challenge,
    origin,
  });
  const authData = buildAuthData({
    rpId,
    flags: SYNTH_FLAGS.UP_UV_AT,
    signCount: input.signCount ?? 0,
    attested: {
      credentialId: input.authenticator.credentialId,
      coseKey: input.authenticator.coseKey,
    },
  });
  const signature = input.authenticator.sign(signatureBase(authData, clientDataJSON));
  const attestationObject = buildAttestationObject({
    fmt: "packed",
    attStmt: new Map<string, CborValue>([
      ["alg", input.authenticator.coseAlg],
      ["sig", signature],
    ]),
    authData,
  });
  return { clientDataJSON, authData, signature, attestationObject };
}

/** Builds a complete assertion response signed by the synthetic key. */
export function buildAssertion(input: {
  readonly authenticator: SyntheticAuthenticator;
  readonly challenge: Uint8Array;
  readonly origin?: string;
  readonly rpId?: string;
  readonly signCount?: number;
  readonly flags?: number;
}): {
  clientDataJSON: Uint8Array;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
} {
  const origin = input.origin ?? TEST_ALLOWED_ORIGINS[0];
  const rpId = input.rpId ?? TEST_RP_ID;
  const clientDataJSON = buildClientDataJSON({
    type: "webauthn.get",
    challenge: input.challenge,
    origin,
  });
  const authenticatorData = buildAuthData({
    rpId,
    flags: input.flags ?? SYNTH_FLAGS.UP_UV,
    signCount: input.signCount ?? 1,
  });
  const signature = input.authenticator.sign(signatureBase(authenticatorData, clientDataJSON));
  return { clientDataJSON, authenticatorData, signature };
}

function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
