/**
 * `PasskeyService` — WebAuthn ceremony orchestration (§3 A22).
 *
 * Composes the PURE verifiers (`verifyAttestation`, `verifyAssertion`)
 * with:
 *   - a single-use `ChallengeStore` (RP-issued challenges; TTL; consumed
 *     atomically at ceremony completion — replay is denied), and
 *   - a `PasskeyCredentialStore` (persisted credential records:
 *     {credentialId, publicKey, signCount, transports} — NO PHI; the
 *     person/account bindings are opaque ids only).
 *
 * Recorded assumptions:
 *   - Challenge TTL default: 120 s (WebAuthn ceremonies are interactive).
 *   - Challenges are bound to the person at issuance for REGISTRATION
 *     (person-binding is enforced at consumption); assertion challenges
 *     MAY be anonymous (discoverable-credential flows) and then accept
 *     any credential.
 *   - Challenge lookup at consumption is by SHA-256 of the challenge
 *     bytes echoed in client data; consumption is atomic, so a ceremony
 *     response can never be replayed.
 *   - Callers MAY also pass an explicit `expectedChallenge`; it must
 *     still match the client data AND the challenge must exist in the
 *     store (deny-by-default: the store governs).
 *   - The wire encoding of `credentialId` is base64url everywhere.
 */
import { randomBytes } from "node:crypto";
import type { PersonId } from "@orbb/domain";
import type { Clock } from "@orbb/testkit";
import type { Logger } from "@orbb/observability";
import { sha256Hex, toBase64Url } from "../crypto.js";
import { requirePersonId, systemClock, type AccountId } from "../ids.js";
import { verifyAttestation, type AttestationFailureCode, type AttestationVerificationResult } from "./attestation.js";
import { verifyAssertion, type AssertionFailureCode, type AssertionVerificationResult } from "./assertion.js";

// ---------------------------------------------------------------------------
// Credential persistence seam.
// ---------------------------------------------------------------------------

/**
 * Persisted passkey credential — NO PHI by packet contract: exactly
 * {credentialId, publicKey, signCount, transports} (+ opaque bindings,
 * algorithm tag, and timestamps for operational hygiene).
 */
export interface PasskeyCredentialRecord {
  /** Credential id (base64url of the raw 16+ byte id). */
  readonly credentialId: string;
  readonly personId: PersonId;
  readonly accountId?: AccountId;
  /** Raw COSE public key bytes (the at-rest format). */
  readonly publicKeyCose: Uint8Array;
  /** COSE algorithm identifier (e.g. -7 ES256). */
  readonly alg: number;
  /** Last observed signature counter (0 = no counter support). */
  readonly signCount: number;
  /** Client-reported transports ("internal", "hybrid", …) — advisory. */
  readonly transports?: readonly string[];
  readonly createdAt: Date;
  readonly lastUsedAt?: Date;
}

/** Injectable credential persistence (db-backed adapter arrives with API integration). */
export interface PasskeyCredentialStore {
  insert(credential: PasskeyCredentialRecord): Promise<PasskeyCredentialRecord>;
  findByCredentialId(credentialId: string): Promise<PasskeyCredentialRecord | undefined>;
  listByPerson(personId: PersonId): Promise<readonly PasskeyCredentialRecord[]>;
  /** Persists the post-assertion counter/usage state. */
  updateAfterUse(
    credentialId: string,
    patch: { readonly signCount: number; readonly lastUsedAt: Date },
  ): Promise<PasskeyCredentialRecord | undefined>;
  /** Removes a credential. Returns false when it did not exist. */
  remove(credentialId: string): Promise<boolean>;
}

/** In-memory reference `PasskeyCredentialStore`. */
export class InMemoryPasskeyCredentialStore implements PasskeyCredentialStore {
  readonly #records = new Map<string, PasskeyCredentialRecord>();

  async insert(credential: PasskeyCredentialRecord): Promise<PasskeyCredentialRecord> {
    this.#records.set(credential.credentialId, credential);
    return credential;
  }

  async findByCredentialId(credentialId: string): Promise<PasskeyCredentialRecord | undefined> {
    return this.#records.get(credentialId);
  }

  async listByPerson(personId: PersonId): Promise<readonly PasskeyCredentialRecord[]> {
    return [...this.#records.values()].filter((record) => record.personId === personId);
  }

  async updateAfterUse(
    credentialId: string,
    patch: { readonly signCount: number; readonly lastUsedAt: Date },
  ): Promise<PasskeyCredentialRecord | undefined> {
    const record = this.#records.get(credentialId);
    if (record === undefined) {
      return undefined;
    }
    const updated: PasskeyCredentialRecord = { ...record, ...patch };
    this.#records.set(credentialId, updated);
    return updated;
  }

  async remove(credentialId: string): Promise<boolean> {
    return this.#records.delete(credentialId);
  }

  /** Test/inspection surface: all stored credential records. */
  snapshot(): readonly PasskeyCredentialRecord[] {
    return [...this.#records.values()];
  }

  /** Clears the store (test-reset convenience). */
  clear(): void {
    this.#records.clear();
  }
}

// ---------------------------------------------------------------------------
// Challenge persistence seam (single-use).
// ---------------------------------------------------------------------------

/** Ceremony kinds. */
export type ChallengePurpose = "registration" | "assertion";

/** An RP-issued challenge awaiting consumption. */
export interface StoredChallenge {
  /** SHA-256 hex of the raw challenge bytes (never the bytes themselves). */
  readonly challengeHash: string;
  /** Person binding; undefined = anonymous (allowed for assertion). */
  readonly personId?: PersonId;
  readonly purpose: ChallengePurpose;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * Injectable challenge persistence. `consume` MUST remove the challenge
 * atomically (single-use) and return it regardless of expiry — the
 * service applies the TTL decision so expired challenges still burn.
 */
export interface ChallengeStore {
  insert(challenge: StoredChallenge): Promise<void>;
  consume(challengeHash: string): Promise<StoredChallenge | undefined>;
}

/** In-memory reference `ChallengeStore`. */
export class InMemoryChallengeStore implements ChallengeStore {
  readonly #challenges = new Map<string, StoredChallenge>();

  async insert(challenge: StoredChallenge): Promise<void> {
    this.#challenges.set(challenge.challengeHash, challenge);
  }

  async consume(challengeHash: string): Promise<StoredChallenge | undefined> {
    const challenge = this.#challenges.get(challengeHash);
    if (challenge === undefined) {
      return undefined;
    }
    this.#challenges.delete(challengeHash);
    return challenge;
  }

  /** Test/inspection surface: all stored challenges (hashes only). */
  snapshot(): readonly StoredChallenge[] {
    return [...this.#challenges.values()];
  }

  /** Clears the store (test-reset convenience). */
  clear(): void {
    this.#challenges.clear();
  }
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

/** Options for constructing a {@link PasskeyService}. */
export interface PasskeyServiceOptions {
  readonly credentials: PasskeyCredentialStore;
  readonly challenges: ChallengeStore;
  /** Relying Party id (e.g. "orbb.health") — verified against rpIdHash. */
  readonly rpId: string;
  /** Exact origin allowlist (deny-by-default). */
  readonly allowedOrigins: readonly string[];
  readonly clock?: Clock;
  /** Challenge TTL in seconds (finite >= 30). Default: 120. */
  readonly challengeTtlSeconds?: number;
  readonly logger?: Logger;
}

/** A freshly issued ceremony challenge (base64url, shown to the client once). */
export interface IssuedChallenge {
  readonly challenge: string;
  readonly expiresAt: Date;
}

/** Registration ceremony failure codes (pure verifier codes + challenge policy). */
export type PasskeyRegistrationFailureCode = AttestationFailureCode | "INVALID_CHALLENGE" | "CHALLENGE_EXPIRED";

/** Registration ceremony result. */
export type PasskeyRegistrationResult =
  | { readonly ok: true; readonly credential: PasskeyCredentialRecord }
  | { readonly ok: false; readonly code: PasskeyRegistrationFailureCode };

/** Assertion ceremony failure codes. */
export type PasskeyAssertionFailureCode =
  | AssertionFailureCode
  | "INVALID_CHALLENGE"
  | "CHALLENGE_EXPIRED"
  | "UNKNOWN_CREDENTIAL";

/** Assertion ceremony result. */
export type PasskeyAssertionResult =
  | { readonly ok: true; readonly credential: PasskeyCredentialRecord }
  | { readonly ok: false; readonly code: PasskeyAssertionFailureCode };

/** Client-supplied registration response. */
export interface PasskeyRegistrationRequest {
  readonly clientDataJSON: Uint8Array;
  readonly attestationObject: Uint8Array;
  /** Client-reported transports (advisory metadata, never PHI). */
  readonly transports?: readonly string[];
  /** Caller-managed expected challenge (must ALSO exist in the store). */
  readonly expectedChallenge?: string | Uint8Array;
}

/** Client-supplied assertion response. */
export interface PasskeyAssertionRequest {
  /** Credential id echoed by the client (base64url). */
  readonly credentialId: string;
  readonly clientDataJSON: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly signature: Uint8Array;
  /** Caller-managed expected challenge (must ALSO exist in the store). */
  readonly expectedChallenge?: string | Uint8Array;
  /** Require the UV flag for this assertion. Default: false. */
  readonly requireUserVerification?: boolean;
}

const DEFAULT_CHALLENGE_TTL_SECONDS = 120;
const MIN_CHALLENGE_TTL_SECONDS = 30;
const CHALLENGE_BYTES = 32;

/** WebAuthn ceremony orchestration over the pure verifiers. */
export class PasskeyService {
  readonly #credentials: PasskeyCredentialStore;
  readonly #challenges: ChallengeStore;
  readonly #rpId: string;
  readonly #allowedOrigins: readonly string[];
  readonly #clock: Clock;
  readonly #challengeTtl: number;
  readonly #log: Logger | undefined;

  constructor(options: PasskeyServiceOptions) {
    this.#credentials = options.credentials;
    this.#challenges = options.challenges;
    this.#rpId = options.rpId;
    this.#allowedOrigins = options.allowedOrigins;
    this.#clock = options.clock ?? systemClock;
    this.#challengeTtl = options.challengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS;
    if (!Number.isFinite(this.#challengeTtl) || this.#challengeTtl < MIN_CHALLENGE_TTL_SECONDS) {
      throw new RangeError(
        `PasskeyServiceOptions.challengeTtlSeconds must be a finite number >= ${MIN_CHALLENGE_TTL_SECONDS}.`,
      );
    }
    this.#log = options.logger;
  }

  /** Issues a single-use registration challenge bound to a person. */
  async beginRegistration(personId: PersonId): Promise<IssuedChallenge> {
    requirePersonId(personId);
    return this.#issueChallenge("registration", personId);
  }

  /** Issues a single-use assertion challenge (optionally person-bound). */
  async beginAssertion(personId?: PersonId): Promise<IssuedChallenge> {
    return this.#issueChallenge("assertion", personId);
  }

  async #issueChallenge(purpose: ChallengePurpose, personId?: PersonId): Promise<IssuedChallenge> {
    const challenge = randomBytes(CHALLENGE_BYTES);
    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + this.#challengeTtl * 1_000);
    await this.#challenges.insert({
      challengeHash: sha256Hex(challenge),
      ...(personId !== undefined ? { personId } : {}),
      purpose,
      createdAt: now,
      expiresAt,
    });
    return { challenge: toBase64Url(challenge), expiresAt };
  }

  /**
   * Completes a registration ceremony: consumes the challenge (single
   * use, person-bound, TTL-checked), runs the pure attestation
   * verification, and persists the credential. Deny-by-default.
   */
  async register(
    personId: PersonId,
    request: PasskeyRegistrationRequest,
    options?: { readonly accountId?: AccountId },
  ): Promise<PasskeyRegistrationResult> {
    requirePersonId(personId);
    const challengeOutcome = await this.#consumeChallenge(request, personId, "registration");
    if (challengeOutcome.ok === false) {
      return { ok: false, code: challengeOutcome.code };
    }
    const verification: AttestationVerificationResult = verifyAttestation({
      clientDataJSON: request.clientDataJSON,
      attestationObject: request.attestationObject,
      expectedChallenge: challengeOutcome.challenge,
      allowedOrigins: this.#allowedOrigins,
      rpId: this.#rpId,
    });
    if (!verification.ok) {
      this.#log?.warn(`passkey registration failed: ${verification.code}`, {
        event: "auth.passkey.registration_failed",
      });
      return { ok: false, code: verification.code };
    }
    const now = this.#clock.now();
    const credential: PasskeyCredentialRecord = {
      credentialId: verification.credential.credentialIdBase64Url,
      personId,
      ...(options?.accountId !== undefined ? { accountId: options.accountId } : {}),
      publicKeyCose: verification.credential.publicKeyCose,
      alg: verification.credential.alg,
      signCount: verification.credential.signCount,
      ...(request.transports !== undefined ? { transports: [...request.transports] } : {}),
      createdAt: now,
    };
    await this.#credentials.insert(credential);
    this.#log?.info("passkey registered", {
      event: "auth.passkey.registered",
      ...(credential.accountId !== undefined ? { accountId: credential.accountId } : {}),
    });
    return { ok: true, credential };
  }

  /**
   * Completes an assertion ceremony: locates the credential, consumes the
   * challenge (single-use, TTL-checked), runs the pure assertion
   * verification, and persists the new signature counter. On success the
   * returned credential carries the updated `signCount`/`lastUsedAt`.
   */
  async assert(request: PasskeyAssertionRequest): Promise<PasskeyAssertionResult> {
    const credential = await this.#credentials.findByCredentialId(request.credentialId);
    if (credential === undefined) {
      this.#log?.warn("passkey assertion failed: unknown credential", {
        event: "auth.passkey.assertion_failed",
      });
      return { ok: false, code: "UNKNOWN_CREDENTIAL" };
    }
    const challengeOutcome = await this.#consumeChallenge(request, credential.personId, "assertion");
    if (challengeOutcome.ok === false) {
      return { ok: false, code: challengeOutcome.code };
    }
    const verification: AssertionVerificationResult = verifyAssertion(
      {
        clientDataJSON: request.clientDataJSON,
        authenticatorData: request.authenticatorData,
        signature: request.signature,
        ...(request.credentialId !== undefined ? { credentialId: request.credentialId } : {}),
      },
      {
        credentialId: credential.credentialId,
        publicKeyCose: credential.publicKeyCose,
        signCount: credential.signCount,
      },
      {
        expectedChallenge: challengeOutcome.challenge,
        allowedOrigins: this.#allowedOrigins,
        rpId: this.#rpId,
        ...(request.requireUserVerification !== undefined
          ? { requireUserVerification: request.requireUserVerification }
          : {}),
      },
    );
    if (!verification.ok) {
      this.#log?.warn(`passkey assertion failed: ${verification.code}`, {
        event: "auth.passkey.assertion_failed",
      });
      return { ok: false, code: verification.code };
    }
    const now = this.#clock.now();
    const updated = await this.#credentials.updateAfterUse(credential.credentialId, {
      signCount: verification.signCount,
      lastUsedAt: now,
    });
    if (updated === undefined) {
      // The credential vanished mid-ceremony (concurrent removal): deny.
      return { ok: false, code: "UNKNOWN_CREDENTIAL" };
    }
    this.#log?.info("passkey assertion succeeded", {
      event: "auth.passkey.asserted",
      ...(updated.accountId !== undefined ? { accountId: updated.accountId } : {}),
    });
    return { ok: true, credential: updated };
  }

  /** Lists a person's registered credentials (no PHI). */
  async listCredentials(personId: PersonId): Promise<readonly PasskeyCredentialRecord[]> {
    return this.#credentials.listByPerson(personId);
  }

  /** Removes a credential (returns false when it did not exist). */
  async removeCredential(credentialId: string): Promise<boolean> {
    return this.#credentials.remove(credentialId);
  }

  /**
   * Challenge policy: extract the echoed challenge from client data,
   * honor an explicit expected challenge, consume the stored challenge
   * atomically, enforce purpose/person/TTL. Returns the challenge bytes
   * the pure verifiers should pin.
   */
  async #consumeChallenge(
    request: { readonly clientDataJSON: Uint8Array; readonly expectedChallenge?: string | Uint8Array },
    personId: PersonId,
    purpose: ChallengePurpose,
  ): Promise<
    | { readonly ok: true; readonly challenge: Uint8Array }
    | { readonly ok: false; readonly code: "INVALID_CHALLENGE" | "CHALLENGE_EXPIRED" }
  > {
    // Client-echoed challenge (parse failures are shape errors → typed deny).
    const echoed = this.#echoedChallenge(request.clientDataJSON);
    if (echoed === undefined) {
      return { ok: false, code: "INVALID_CHALLENGE" };
    }
    // Explicit expected challenge must match the echoed one.
    if (request.expectedChallenge !== undefined) {
      const expected =
        typeof request.expectedChallenge === "string"
          ? this.#decodeBase64Url(request.expectedChallenge)
          : request.expectedChallenge;
      if (expected === undefined || !bytesEqual(expected, echoed)) {
        return { ok: false, code: "INVALID_CHALLENGE" };
      }
    }
    // Store governs: single-use consumption by challenge digest.
    const stored = await this.#challenges.consume(sha256Hex(echoed));
    if (stored === undefined) {
      this.#log?.warn("passkey ceremony rejected: invalid challenge", {
        event: "auth.passkey.challenge_rejected",
      });
      return { ok: false, code: "INVALID_CHALLENGE" };
    }
    if (stored.purpose !== purpose) {
      return { ok: false, code: "INVALID_CHALLENGE" };
    }
    if (stored.personId !== undefined && stored.personId !== personId) {
      return { ok: false, code: "INVALID_CHALLENGE" };
    }
    const now = this.#clock.now();
    if (now.getTime() >= stored.expiresAt.getTime()) {
      this.#log?.warn("passkey ceremony rejected: expired challenge", {
        event: "auth.passkey.challenge_rejected",
      });
      return { ok: false, code: "CHALLENGE_EXPIRED" };
    }
    return { ok: true, challenge: echoed };
  }

  #echoedChallenge(clientDataJSON: Uint8Array): Uint8Array | undefined {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(clientDataJSON);
      const parsed = JSON.parse(text) as { challenge?: unknown };
      if (typeof parsed.challenge !== "string") {
        return undefined;
      }
      return this.#decodeBase64Url(parsed.challenge);
    } catch {
      return undefined;
    }
  }

  #decodeBase64Url(value: string): Uint8Array | undefined {
    try {
      const normalized = value.replace(/=+$/u, "");
      if (!/^[A-Za-z0-9_-]+$/u.test(normalized)) {
        return undefined;
      }
      return new Uint8Array(Buffer.from(normalized, "base64url"));
    } catch {
      return undefined;
    }
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
