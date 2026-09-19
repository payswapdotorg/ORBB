/**
 * SynthEhrExchange — the DOCUMENTED provider contract for real EHR
 * integration, as TYPES + a deterministic SYNTH implementation (M7-A
 * A47). ZERO network calls, ZERO JWT creation/parsing, by binding
 * doctrine: "never a JWT with embedded PHI in this package's SYNTH
 * double".
 *
 * WHAT A REAL EHR HANDSHAKE NEEDS (the recorded handoff — a future
 * adapter package OWNS all of this; this package ships only the
 * contract):
 *
 *   1. Client registration (per EHR): `SmartEhrClientRegistration`
 *      below — client id, redirect URI, ONE client-authentication shape
 *      (`client_secret` or `private_key_jwt` keyset reference), the
 *      allowed scope ceiling, and the issuer base URL. Registration is
 *      an administrative act with the EHR operator (dynamic client
 *      registration is deliberately NOT modeled: it widens the
 *      boundary).
 *   2. Keysets: `SmartEhrKeyset` — for `private_key_jwt` clients, the
 *      PUBLIC key material registered with the EHR (a real adapter
 *      signs client assertions with the private half and the EHR
 *      verifies against the JWKS it holds; the EHR may also publish its
 *      own signing JWKS for id_token/access-token verification). A real
 *      adapter MUST fetch the EHR's `.well-known/smart-configuration`,
 *      verify TLS, fetch and pin the JWKS, and verify signatures
 *      cryptographically. THIS PACKAGE DOES NONE OF THAT — the SYNTH
 *      double checks the SHAPE of the assertion only.
 *   3. The handshake endpoints (documented, not called here):
 *      authorization endpoint (browser redirect with
 *      `response_type=code`, `client_id`, `redirect_uri`, `aud=iss`,
 *      `launch`, `scope`), and the token endpoint (POST with the
 *      authorization code + client authentication, returning the
 *      access token + granted `scope` + `patient` context).
 *   4. PKCE for public clients, state/nonce CSRF binding, and
 *      jurisdiction-specific governance BEFORE any real-world use
 *      (AGENTS.md operating rule — this package is boundary-shaped
 *      with SYNTH doubles only).
 *
 * The SYNTH implementation below enforces the same fail-closed order
 * as `InMemoryTokenExchange` (issuer registration -> audience ->
 * client authentication -> single-use handle with TTL -> scope
 * narrowing) and issues the same opaque, hashed-at-rest tokens, so
 * contract-shape tests written against it hold for the real adapter's
 * boundary behavior.
 */
import type { Clock, IdFactory } from "@orbb/testkit";
import { toSmartLaunchAuditRecord } from "./audit.js";
import { randomOpaqueToken, sha256Hex, timingSafeEqualHex } from "./crypto.js";
import { SmartInvariantError } from "./errors.js";
import { SMART_TOKEN_ID_PREFIX, SMART_AUDIT_ID_PREFIX, SYNTH_LAUNCH_HANDLE_PREFIX, SmartRandomIdFactory, systemClock } from "./ids.js";
import { isSmartLaunchContext, normalizeSmartIssuer } from "./launch-context.js";
import {
  DEFAULT_SMART_HANDLE_TTL_MS,
  DEFAULT_SMART_TOKEN_TTL_MS,
  type SmartClientCredentials,
  type SmartExchangeFailureCode,
  type SmartTokenExchange,
  type SmartTokenExchangeInput,
  type SmartTokenExchangeResult,
  type SmartTokenVerificationResult,
  type StoredSmartLaunchToken,
} from "./exchange.js";
import { toSmartLaunchTokenRecord, formatSmartScopeSet } from "./exchange.js";
import { parseSmartScopeSet } from "./scopes.js";

// ---------------------------------------------------------------------------
// The provider contract (TYPES + docs, zero network).
// ---------------------------------------------------------------------------

/** Client authentication shapes a real EHR handshake supports (as registered). */
export type SmartClientAuthentication =
  | { readonly kind: "client_secret"; readonly clientSecret: string }
  | { readonly kind: "private_key_jwt"; readonly keysetId: string };

/** A keyset registered for a client (or published by the EHR). */
export interface SmartEhrKeyset {
  /** Stable keyset identifier (referenced by `private_key_jwt` registrations). */
  readonly keysetId: string;
  /** What the keyset authenticates. */
  readonly purpose: "client_authentication" | "ehr_signing";
  /** Algorithm family a real adapter must support for this keyset. */
  readonly algorithm: "ES384" | "RS384";
  /**
   * Where a real adapter fetches the JWKS from (https). Recorded for
   * the handoff — NEVER fetched by this package.
   */
  readonly jwksUrl: string;
}

/** What a real EHR client registration carries (the administrative act). */
export interface SmartEhrClientRegistration {
  /** The EHR's FHIR base URL (https; compared against normalized launch iss). */
  readonly issuer: string;
  readonly clientId: string;
  /** https redirect URI registered with the EHR. */
  readonly redirectUri: string;
  /** Exactly one authentication shape. */
  readonly clientAuthentication: SmartClientAuthentication;
  /** The scope ceiling this client may ever be granted (space-delimited SMART grammar). */
  readonly allowedScopes: string;
  /** Token TTL in ms. Default: {@link DEFAULT_SMART_TOKEN_TTL_MS}. */
  readonly tokenTtlMs?: number;
  /** Launch-handle TTL in ms. Default: {@link DEFAULT_SMART_HANDLE_TTL_MS}. */
  readonly handleTtlMs?: number;
}

/** The SYNTH assertion marker: `synthkeyset.<keysetId>.<opaque>`. */
const SYNTH_ASSERTION_PREFIX = "synthkeyset.";

/** Options for constructing the SYNTH EHR directory + exchange. */
export interface SynthEhrExchangeOptions {
  /** Client registrations (validated fail-closed at construction). */
  readonly registrations: readonly SmartEhrClientRegistration[];
  /** Keysets referenced by `private_key_jwt` registrations. */
  readonly keysets?: readonly SmartEhrKeyset[];
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  /** Failure injection: when true, every exchange denies EXCHANGE_UNAVAILABLE. */
  readonly simulate?: { readonly exchangeUnavailable?: boolean };
}

interface StoredSynthHandle {
  readonly issuer: string;
  readonly patient: string | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  consumedAt: Date | null;
}

/**
 * The SYNTH EHR: a deterministic, network-free implementation of the
 * provider contract. `beginLaunch` stands in for the EHR-side start of
 * a launch (production code never calls it — real EHRs mint their own
 * handles); `exchange`/`verify`/`revoke` implement the
 * `SmartTokenExchange` seam under the documented contract.
 */
export class SynthEhrExchange implements SmartTokenExchange {
  readonly #registrations: readonly SmartEhrClientRegistration[];
  readonly #secrets: ReadonlyMap<string, string>;
  readonly #keysets: ReadonlyMap<string, SmartEhrKeyset>;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #exchangeUnavailable: boolean;
  readonly #handles = new Map<string, StoredSynthHandle>();
  readonly #tokens = new Map<string, StoredSmartLaunchToken>();

  constructor(options: SynthEhrExchangeOptions) {
    if (typeof options !== "object" || options === null || !Array.isArray(options.registrations)) {
      throw new SmartInvariantError("SynthEhrExchange requires a registrations array.");
    }
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.idFactory ?? new SmartRandomIdFactory();
    this.#exchangeUnavailable = options.simulate?.exchangeUnavailable === true;

    const keysets = new Map<string, SmartEhrKeyset>();
    for (const keyset of options.keysets ?? []) {
      this.#validateKeyset(keyset);
      if (keysets.has(keyset.keysetId)) {
        throw new SmartInvariantError(`Duplicate SYNTH keyset id "${keyset.keysetId}".`);
      }
      keysets.set(keyset.keysetId, keyset);
    }
    this.#keysets = keysets;

    const secrets = new Map<string, string>();
    const registrations: SmartEhrClientRegistration[] = [];
    for (const registration of options.registrations) {
      this.#validateRegistration(registration, keysets);
      if (registration.clientAuthentication.kind === "client_secret") {
        secrets.set(registration.clientId, sha256Hex(registration.clientAuthentication.clientSecret));
      }
      // Registration issuers are normalized into the same canonical
      // space as parsed launch `iss` values (trailing-slash safety).
      registrations.push({ ...registration, issuer: normalizeSmartIssuer(registration.issuer) });
    }
    this.#registrations = registrations;
    this.#secrets = secrets;
  }

  #validateKeyset(keyset: SmartEhrKeyset): void {
    if (
      typeof keyset.keysetId !== "string" ||
      keyset.keysetId.length === 0 ||
      (keyset.purpose !== "client_authentication" && keyset.purpose !== "ehr_signing") ||
      (keyset.algorithm !== "ES384" && keyset.algorithm !== "RS384") ||
      typeof keyset.jwksUrl !== "string" ||
      !/^https:\/\/[^\s/]+/u.test(keyset.jwksUrl)
    ) {
      throw new SmartInvariantError(
        "SmartEhrKeyset requires { keysetId, purpose, algorithm, jwksUrl } with a non-empty id, a known purpose, a known algorithm, and an https jwksUrl.",
      );
    }
  }

  #validateRegistration(
    registration: SmartEhrClientRegistration,
    keysets: ReadonlyMap<string, SmartEhrKeyset>,
  ): void {
    if (
      typeof registration.issuer !== "string" ||
      !/^https:\/\/[^\s/]+/u.test(registration.issuer) ||
      typeof registration.clientId !== "string" ||
      registration.clientId.length === 0 ||
      typeof registration.redirectUri !== "string" ||
      !/^https:\/\/[^\s/]+/u.test(registration.redirectUri)
    ) {
      throw new SmartInvariantError(
        "SmartEhrClientRegistration requires an https issuer, a non-empty clientId, and an https redirectUri.",
      );
    }
    if (
      typeof registration.clientAuthentication !== "object" ||
      registration.clientAuthentication === null
    ) {
      throw new SmartInvariantError(
        "SmartEhrClientRegistration requires a clientAuthentication shape.",
      );
    }
    const auth = registration.clientAuthentication;
    if (auth.kind === "client_secret") {
      if (typeof auth.clientSecret !== "string" || auth.clientSecret.length === 0) {
        throw new SmartInvariantError("client_secret authentication requires a non-empty secret.");
      }
    } else if (auth.kind === "private_key_jwt") {
      if (typeof auth.keysetId !== "string" || auth.keysetId.length === 0) {
        throw new SmartInvariantError("private_key_jwt authentication requires a keysetId.");
      }
      const keyset = keysets.get(auth.keysetId);
      if (keyset === undefined || keyset.purpose !== "client_authentication") {
        throw new SmartInvariantError(
          "private_key_jwt authentication requires a registered client_authentication keyset.",
        );
      }
    } else {
      throw new SmartInvariantError(
        "clientAuthentication.kind must be client_secret or private_key_jwt.",
      );
    }
    const ceiling = parseSmartScopeSet(registration.allowedScopes);
    if (!ceiling.ok) {
      throw new SmartInvariantError(
        `SmartEhrClientRegistration.allowedScopes violates the frozen scope grammar (${ceiling.reason} at token index ${ceiling.scopeIndex}).`,
      );
    }
    if (registration.tokenTtlMs !== undefined && (!Number.isFinite(registration.tokenTtlMs) || registration.tokenTtlMs < 1)) {
      throw new SmartInvariantError("SmartEhrClientRegistration.tokenTtlMs must be a positive integer.");
    }
    if (registration.handleTtlMs !== undefined && (!Number.isFinite(registration.handleTtlMs) || registration.handleTtlMs < 1)) {
      throw new SmartInvariantError("SmartEhrClientRegistration.handleTtlMs must be a positive integer.");
    }
  }

  /**
   * SYNTH-ONLY: the EHR-side start of a launch (mints a single-use
   * handle). Production code never calls this.
   */
  async beginLaunch(input: {
    readonly issuer: string;
    readonly patient: string | null;
    readonly ttlMs?: number;
  }): Promise<string> {
    const registration = this.#registrationFor(normalizeSmartIssuer(input.issuer));
    if (registration === undefined) {
      throw new SmartInvariantError("beginLaunch requires an issuer registered with this exchange.");
    }
    if (input.patient !== null && (typeof input.patient !== "string" || input.patient.length === 0)) {
      throw new SmartInvariantError(
        "beginLaunch.patient must be null or a non-empty identifier string.",
      );
    }
    const now = this.#clock.now();
    const ttl = input.ttlMs ?? registration.handleTtlMs ?? DEFAULT_SMART_HANDLE_TTL_MS;
    const handle = this.#ids.next(SYNTH_LAUNCH_HANDLE_PREFIX);
    this.#handles.set(handle, {
      issuer: registration.issuer,
      patient: input.patient,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      consumedAt: null,
    });
    return handle;
  }

  async exchange(input: SmartTokenExchangeInput): Promise<SmartTokenExchangeResult> {
    if (!isSmartLaunchContext(input.context)) {
      throw new SmartInvariantError(
        "SmartTokenExchangeInput.context must be a SmartLaunchContext from parseSmartLaunchContext.",
      );
    }
    const context = input.context;
    const auditId = this.#ids.next(SMART_AUDIT_ID_PREFIX);
    const now = this.#clock.now();
    const deny = (code: SmartExchangeFailureCode, message: string): SmartTokenExchangeResult => ({
      ok: false,
      code,
      message,
      audit: toSmartLaunchAuditRecord({
        id: auditId,
        stage: "token-exchange",
        decision: "DENY",
        reason: code,
        issHost: context.issHost,
        at: now,
      }),
    });

    if (this.#exchangeUnavailable) {
      // Fail-closed adapter posture: an unavailable exchange NEVER
      // grants — it denies with a typed code.
      return deny("EXCHANGE_UNAVAILABLE", "the exchange is unavailable and denied the launch");
    }

    const registration = this.#registrationFor(context.iss);
    if (registration === undefined) {
      return deny("UNKNOWN_ISSUER", "the launching issuer is not registered with this boundary");
    }
    if (context.audience !== registration.clientId) {
      return deny(
        "AUDIENCE_MISMATCH",
        "the launch audience does not match the registered client id for this issuer",
      );
    }
    if (!this.#clientAuthenticates(registration, input.client)) {
      return deny("INVALID_CLIENT", "client credentials do not match the registration");
    }

    const handle = this.#handles.get(context.launch);
    if (handle === undefined || handle.issuer !== registration.issuer) {
      return deny("LAUNCH_HANDLE_UNKNOWN", "the launch handle is unknown to this issuer");
    }
    if (handle.consumedAt !== null) {
      return deny("LAUNCH_HANDLE_CONSUMED", "the launch handle has already been redeemed");
    }
    if (now.getTime() >= handle.expiresAt.getTime()) {
      return deny("LAUNCH_HANDLE_EXPIRED", "the launch handle has expired");
    }

    const requested = parseSmartScopeSet(input.requestedScopes);
    if (!requested.ok) {
      return deny(
        "REQUESTED_SCOPE_INVALID",
        `requested scope token at index ${requested.scopeIndex} violates the frozen scope grammar (${requested.reason})`,
      );
    }
    const allowed = parseSmartScopeSet(registration.allowedScopes);
    if (!allowed.ok) {
      // Unreachable: validated at construction.
      return deny("EXCHANGE_UNAVAILABLE", "the exchange is misconfigured and denied the launch");
    }
    const granted = requested.scopes.filter((scope) =>
      allowed.scopes.some((candidate) =>
        candidate.resourceType === scope.resourceType && candidate.modifier === scope.modifier,
      ),
    );

    handle.consumedAt = now;

    const token = randomOpaqueToken(32);
    const tokenTtl = registration.tokenTtlMs ?? DEFAULT_SMART_TOKEN_TTL_MS;
    const stored: StoredSmartLaunchToken = {
      id: this.#ids.next(SMART_TOKEN_ID_PREFIX),
      iss: context.iss,
      issHost: context.issHost,
      audience: registration.clientId,
      scopes: granted,
      scope: formatSmartScopeSet(granted),
      patient: handle.patient,
      createdAt: now,
      expiresAt: new Date(now.getTime() + tokenTtl),
      tokenHash: sha256Hex(token),
    };
    this.#tokens.set(stored.tokenHash, stored);

    return {
      ok: true,
      token,
      record: toSmartLaunchTokenRecord(stored),
      scopeNarrowed: granted.length < requested.scopes.length,
      audit: toSmartLaunchAuditRecord({
        id: auditId,
        stage: "token-exchange",
        decision: "ALLOW",
        reason: "OK",
        issHost: context.issHost,
        at: now,
      }),
    };
  }

  async verify(token: string): Promise<SmartTokenVerificationResult> {
    const auditId = this.#ids.next(SMART_AUDIT_ID_PREFIX);
    const now = this.#clock.now();
    const deny = (
      code: "INVALID_TOKEN" | "EXPIRED" | "REVOKED",
      issHost: string | null,
    ): SmartTokenVerificationResult => ({
      ok: false,
      code,
      audit: toSmartLaunchAuditRecord({
        id: auditId,
        stage: "token-verification",
        decision: "DENY",
        reason: code,
        issHost,
        at: now,
      }),
    });

    if (typeof token !== "string" || token.length === 0) {
      return deny("INVALID_TOKEN", null);
    }
    const stored = this.#tokens.get(sha256Hex(token));
    if (stored === undefined) {
      return deny("INVALID_TOKEN", null);
    }
    if (stored.revokedAt !== undefined) {
      return deny("REVOKED", stored.issHost);
    }
    if (now.getTime() >= stored.expiresAt.getTime()) {
      return deny("EXPIRED", stored.issHost);
    }
    return {
      ok: true,
      record: toSmartLaunchTokenRecord(stored),
      audit: toSmartLaunchAuditRecord({
        id: auditId,
        stage: "token-verification",
        decision: "ALLOW",
        reason: "OK",
        issHost: stored.issHost,
        at: now,
      }),
    };
  }

  async revoke(token: string): Promise<boolean> {
    if (typeof token !== "string" || token.length === 0) {
      return false;
    }
    const tokenHash = sha256Hex(token);
    const stored = this.#tokens.get(tokenHash);
    if (stored === undefined || stored.revokedAt !== undefined) {
      return false;
    }
    this.#tokens.set(tokenHash, { ...stored, revokedAt: this.#clock.now() });
    return true;
  }

  /** Test/inspection surface: all stored token records (digests only, never tokens). */
  snapshot(): readonly StoredSmartLaunchToken[] {
    return [...this.#tokens.values()];
  }

  #registrationFor(issuer: string): SmartEhrClientRegistration | undefined {
    return this.#registrations.find((registration) => registration.issuer === issuer);
  }

  /**
   * Client authentication under the documented contract:
   *   - `client_secret` — timing-safe comparison of SHA-256 digests;
   *   - `private_key_jwt` — SHAPE verification only: the presented
   *     assertion must be `synthkeyset.<registeredKeysetId>.<opaque>`.
   *     A REAL adapter must cryptographically verify a signed JWT
   *     against the fetched, pinned JWKS (recorded handoff).
   */
  #clientAuthenticates(
    registration: SmartEhrClientRegistration,
    client: SmartClientCredentials,
  ): boolean {
    if (client.clientId !== registration.clientId) {
      return false;
    }
    if (registration.clientAuthentication.kind === "client_secret") {
      if (client.clientSecret === undefined) {
        return false;
      }
      const expected = this.#secrets.get(registration.clientId) ?? "";
      return timingSafeEqualHex(expected, sha256Hex(client.clientSecret));
    }
    const assertion = client.clientAssertion;
    if (assertion === undefined) {
      return false;
    }
    // Belt-and-braces: the referenced keyset must still be registered
    // for CLIENT AUTHENTICATION at authentication time (fail-closed).
    const keyset = this.#keysets.get(registration.clientAuthentication.keysetId);
    if (keyset === undefined || keyset.purpose !== "client_authentication") {
      return false;
    }
    const prefix = `${SYNTH_ASSERTION_PREFIX}${registration.clientAuthentication.keysetId}.`;
    return assertion.startsWith(prefix) && assertion.length > prefix.length;
  }
}

export { SYNTH_ASSERTION_PREFIX };
