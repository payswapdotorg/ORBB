/**
 * The SMART token-exchange seam (M7-A A47).
 *
 * `SmartTokenExchange` is the BOUNDARY CONTRACT: exchange a validated
 * launch context plus our client credentials for an access token that
 * carries the validated, narrowed launch context. This package ships
 * BOUNDARY LOGIC, not an OAuth server: both implementations are SYNTH
 * DOUBLES with zero network calls —
 *
 *   - {@link InMemoryTokenExchange} — the lightweight test double: the
 *     full lifecycle (issue launch handle -> exchange -> verify ->
 *     revoke) against in-memory registrations.
 *   - {@link SynthEhrExchange} (synth-ehr.ts) — the DOCUMENTED provider
 *     contract: what a real EHR handshake needs (client registration,
 *     keyset) as types, plus a deterministic SYNTH implementation.
 *
 * Token discipline (mirrored from @orbb/auth, never weakened):
 *   - tokens are OPAQUE: 32 random bytes, base64url — NEVER a JWT, so no
 *     PHI can ever be embedded in the token itself;
 *   - hashed-at-rest: only the lowercase-hex SHA-256 digest of the token
 *     is ever stored by the doubles;
 *   - verification looks up by digest and every outcome is a typed,
 *     deny-by-default result (`INVALID_TOKEN` | `EXPIRED` | `REVOKED`);
 *   - client-secret comparisons are timing-safe over the digests.
 *
 * The boundary NEVER widens: the granted scope set of a token record is
 * the INTERSECTION of what ORBB requested, what the registered client is
 * allowed, and (when the launch handle carries its own ceiling) what the
 * launch itself allows — never more. `scopeNarrowed` reports when the
 * exchange granted less than requested.
 *
 * Every exchange/verification outcome carries an audit-record shape
 * (injected clock + id factory, iss host only — see audit.ts).
 */
import type { Clock, IdFactory } from "@orbb/testkit";
import { toSmartLaunchAuditRecord, type SmartLaunchAuditRecord } from "./audit.js";
import { randomOpaqueToken, sha256Hex, timingSafeEqualHex } from "./crypto.js";
import { SmartInvariantError } from "./errors.js";
import { SMART_TOKEN_ID_PREFIX, SMART_AUDIT_ID_PREFIX, SYNTH_LAUNCH_HANDLE_PREFIX, SmartRandomIdFactory, systemClock } from "./ids.js";
import { isSmartLaunchContext, normalizeSmartIssuer, type SmartLaunchContext } from "./launch-context.js";
import { formatSmartScope, parseSmartScopeSet, type SmartScope } from "./scopes.js";

// ---------------------------------------------------------------------------
// Failure vocabulary + input/output shapes.
// ---------------------------------------------------------------------------

/** Typed failure codes for the exchange path (deny-by-default, never thrown). */
export const SMART_EXCHANGE_FAILURE_CODES = [
  "UNKNOWN_ISSUER",
  "AUDIENCE_MISMATCH",
  "INVALID_CLIENT",
  "LAUNCH_HANDLE_UNKNOWN",
  "LAUNCH_HANDLE_EXPIRED",
  "LAUNCH_HANDLE_CONSUMED",
  "REQUESTED_SCOPE_INVALID",
  "EXCHANGE_UNAVAILABLE",
] as const;

/** Typed failure codes for the exchange path (deny-by-default, never thrown). */
export type SmartExchangeFailureCode = (typeof SMART_EXCHANGE_FAILURE_CODES)[number];

/** Our client credentials as presented to the EHR (one auth shape only). */
export interface SmartClientCredentials {
  /** The OAuth client id registered with the launching EHR. */
  readonly clientId: string;
  /** Shared-secret client authentication (confidential clients). */
  readonly clientSecret?: string;
  /**
   * private_key_jwt client authentication. SHAPE-ONLY in the SYNTH
   * double: a real adapter must verify a signed JWT against the
   * registered keyset — see synth-ehr.ts for the recorded handoff.
   */
  readonly clientAssertion?: string;
}

/** Input for `SmartTokenExchange.exchange`. */
export interface SmartTokenExchangeInput {
  /** The validated launch context (from `parseSmartLaunchContext`). */
  readonly context: SmartLaunchContext;
  /** Our client credentials for this EHR. */
  readonly client: SmartClientCredentials;
  /** The scopes ORBB requests for this launch (space-delimited SMART grammar). */
  readonly requestedScopes: string;
}

/**
 * The token record — what a launch actually granted. Carries
 * IDENTIFIERS ONLY (the EHR patient identifier is an opaque record
 * locator; demographics never ride here).
 */
export interface SmartLaunchTokenRecord {
  /** Opaque token-record id (`smarttok_<body>`). */
  readonly id: string;
  /** Launching EHR's normalized base URL. */
  readonly iss: string;
  /** Launching EHR's host (audit-safe identifier). */
  readonly issHost: string;
  /** The audience the token was issued for (our client id). */
  readonly audience: string;
  /** The granted (already-narrowed) scope set. */
  readonly scopes: readonly SmartScope[];
  /** The granted scope set as the canonical space-delimited SMART string. */
  readonly scope: string;
  /** The EHR patient identifier in context, when the launch established one. */
  readonly patient: string | null;
  readonly createdAt: Date;
  /** Exclusive validity horizon: the token is expired when `now >= expiresAt`. */
  readonly expiresAt: Date;
  readonly revokedAt?: Date;
}

/** What the exchange double persists: the record plus the token DIGEST. */
export interface StoredSmartLaunchToken extends SmartLaunchTokenRecord {
  readonly tokenHash: string;
}

/** Result of `SmartTokenExchange.exchange`. */
export type SmartTokenExchangeResult =
  | {
      readonly ok: true;
      /** Opaque token (>= 128 bits). Returned exactly once; only its digest is stored. */
      readonly token: string;
      readonly record: SmartLaunchTokenRecord;
      /** True when the granted set is strictly smaller than requested. */
      readonly scopeNarrowed: boolean;
      readonly audit: SmartLaunchAuditRecord;
    }
  | {
      readonly ok: false;
      readonly code: SmartExchangeFailureCode;
      /** Shape description — never echoes raw input. */
      readonly message: string;
      readonly audit: SmartLaunchAuditRecord;
    };

/** Result of `SmartTokenExchange.verify`. */
export type SmartTokenVerificationResult =
  | { readonly ok: true; readonly record: SmartLaunchTokenRecord; readonly audit: SmartLaunchAuditRecord }
  | {
      readonly ok: false;
      readonly code: "INVALID_TOKEN" | "EXPIRED" | "REVOKED";
      readonly audit: SmartLaunchAuditRecord;
    };

/** The token-exchange seam. Implementations MUST be fail-closed and network-free in this package. */
export interface SmartTokenExchange {
  exchange(input: SmartTokenExchangeInput): Promise<SmartTokenExchangeResult>;
  verify(token: string): Promise<SmartTokenVerificationResult>;
  /** Idempotent revocation (unknown/already-revoked -> false). */
  revoke(token: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Shared helpers for the doubles.
// ---------------------------------------------------------------------------

/** Default launch-handle TTL: 5 minutes (SMART handles are short-lived). */
export const DEFAULT_SMART_HANDLE_TTL_MS = 300_000;

/** Default access-token TTL: 1 hour (short-lived by doctrine). */
export const DEFAULT_SMART_TOKEN_TTL_MS = 3_600_000;

/** Intersects parsed scope sets at the (formatted scope) level, preserving first-set order. */
export function intersectScopeSets(
  requested: readonly SmartScope[],
  ceiling: readonly SmartScope[],
): readonly SmartScope[] {
  const allowed = new Set(ceiling.map((scope) => formatSmartScope(scope)));
  return requested.filter((scope) => allowed.has(formatSmartScope(scope)));
}

/** Formats a scope set as the canonical space-delimited SMART string. */
export function formatSmartScopeSet(scopes: readonly SmartScope[]): string {
  return scopes.map((scope) => formatSmartScope(scope)).join(" ");
}

/** Public view of a stored token (digest stripped). */
export function toSmartLaunchTokenRecord(
  stored: StoredSmartLaunchToken,
): SmartLaunchTokenRecord {
  return {
    id: stored.id,
    iss: stored.iss,
    issHost: stored.issHost,
    audience: stored.audience,
    scopes: stored.scopes,
    scope: stored.scope,
    patient: stored.patient,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    ...(stored.revokedAt !== undefined ? { revokedAt: stored.revokedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// InMemoryTokenExchange — the lightweight SYNTH double (tests).
// ---------------------------------------------------------------------------

/** A registered EHR + client for the in-memory double. */
export interface InMemorySmartRegistration {
  /** The EHR's FHIR base URL (compared against the NORMALIZED launch iss). */
  readonly issuer: string;
  readonly clientId: string;
  /** Optional shared secret; when present, presented secrets must match (timing-safe). */
  readonly clientSecret?: string;
  /** The scope ceiling this client may ever be granted (space-delimited SMART grammar). */
  readonly grantedScopes: string;
  /** Launch-handle TTL in ms. Default: {@link DEFAULT_SMART_HANDLE_TTL_MS}. */
  readonly handleTtlMs?: number;
  /** Access-token TTL in ms. Default: {@link DEFAULT_SMART_TOKEN_TTL_MS}. */
  readonly tokenTtlMs?: number;
}

interface StoredHandle {
  readonly issuer: string;
  readonly patient: string | null;
  /** Optional per-launch scope ceiling (narrower than the registration's). */
  readonly scopes: readonly SmartScope[] | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  consumedAt: Date | null;
}

/** Options for {@link InMemoryTokenExchange}. */
export interface InMemoryTokenExchangeOptions {
  readonly registrations: readonly InMemorySmartRegistration[];
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
}

/** Input for {@link InMemoryTokenExchange.issueLaunchHandle}. */
export interface IssueLaunchHandleInput {
  /** The registered issuer the launch starts from. */
  readonly issuer: string;
  /** The EHR patient identifier in context (identifier only). */
  readonly patient: string | null;
  /** Optional per-launch scope ceiling (space-delimited SMART grammar). */
  readonly scopes?: string;
  readonly ttlMs?: number;
}

/**
 * In-memory SYNTH double for the token-exchange seam (tests).
 *
 * Models the EHR-side handshake shape: launch handles are minted
 * single-use with a TTL (`issueLaunchHandle` stands in for the EHR
 * starting a launch — production code NEVER mints handles, the EHR
 * does), the exchange enforces issuer registration, audience match,
 * client authentication, single-use handle redemption, and scope
 * narrowing, and tokens are opaque + hashed-at-rest per the @orbb/auth
 * discipline. ZERO network calls.
 */
export class InMemoryTokenExchange implements SmartTokenExchange {
  readonly #registrations: readonly InMemorySmartRegistration[];
  readonly #secrets: ReadonlyMap<string, string>;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #handles = new Map<string, StoredHandle>();
  readonly #tokens = new Map<string, StoredSmartLaunchToken>();

  constructor(options: InMemoryTokenExchangeOptions) {
    if (typeof options !== "object" || options === null || !Array.isArray(options.registrations)) {
      throw new SmartInvariantError("InMemoryTokenExchange requires a registrations array.");
    }
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.idFactory ?? new SmartRandomIdFactory();
    const secrets = new Map<string, string>();
    const registrations: InMemorySmartRegistration[] = [];
    for (const registration of options.registrations) {
      const ceiling = parseSmartScopeSet(registration.grantedScopes);
      if (!ceiling.ok) {
        // Fail-closed double configuration: a grammar-violating ceiling
        // must never silently widen or drop.
        throw new SmartInvariantError(
          `InMemorySmartRegistration.grantedScopes violates the frozen scope grammar (${ceiling.reason} at token index ${ceiling.scopeIndex}).`,
        );
      }
      if (
        typeof registration.issuer !== "string" ||
        registration.issuer.length === 0 ||
        typeof registration.clientId !== "string" ||
        registration.clientId.length === 0
      ) {
        throw new SmartInvariantError(
          "InMemorySmartRegistration requires a non-empty issuer and clientId.",
        );
      }
      if (registration.clientSecret !== undefined && registration.clientSecret.length === 0) {
        throw new SmartInvariantError(
          "InMemorySmartRegistration.clientSecret, when present, must be a non-empty string.",
        );
      }
      if (registration.clientSecret !== undefined) {
        secrets.set(registration.clientId, sha256Hex(registration.clientSecret));
      }
      // Registration issuers are normalized into the same canonical space
      // as parsed launch `iss` values, so comparisons never miss on a
      // trailing slash (programmer error when the issuer is not https).
      registrations.push({ ...registration, issuer: normalizeSmartIssuer(registration.issuer) });
    }
    this.#registrations = registrations;
    this.#secrets = secrets;
  }

  /**
   * SYNTH-ONLY: mints a single-use launch handle (the EHR-side start of
   * a launch). Production code never calls this — real EHRs mint their
   * own handles; ORBB only ever receives them.
   */
  async issueLaunchHandle(input: IssueLaunchHandleInput): Promise<string> {
    const registration = this.#registrationFor(normalizeSmartIssuer(input.issuer));
    if (registration === undefined) {
      throw new SmartInvariantError(
        "issueLaunchHandle requires an issuer registered with this exchange.",
      );
    }
    if (input.patient !== null && (typeof input.patient !== "string" || input.patient.length === 0)) {
      throw new SmartInvariantError(
        "issueLaunchHandle.patient must be null or a non-empty identifier string.",
      );
    }
    let scopes: readonly SmartScope[] | null = null;
    if (input.scopes !== undefined) {
      const parsed = parseSmartScopeSet(input.scopes);
      if (!parsed.ok) {
        throw new SmartInvariantError(
          `issueLaunchHandle.scopes violates the frozen scope grammar (${parsed.reason}).`,
        );
      }
      scopes = parsed.scopes;
    }
    const now = this.#clock.now();
    const ttl = input.ttlMs ?? registration.handleTtlMs ?? DEFAULT_SMART_HANDLE_TTL_MS;
    const handle = this.#ids.next(SYNTH_LAUNCH_HANDLE_PREFIX);
    this.#handles.set(handle, {
      issuer: registration.issuer,
      patient: input.patient,
      scopes,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      consumedAt: null,
    });
    return handle;
  }

  async exchange(input: SmartTokenExchangeInput): Promise<SmartTokenExchangeResult> {
    if (!isSmartLaunchContext(input.context)) {
      // The context is OUR parser's output — a foreign shape here is a
      // programmer error, not an external outcome.
      throw new SmartInvariantError(
        "SmartTokenExchangeInput.context must be a SmartLaunchContext from parseSmartLaunchContext.",
      );
    }
    const context = input.context;
    const auditId = this.#ids.next(SMART_AUDIT_ID_PREFIX);
    const now = this.#clock.now();
    const deny = (
      code: SmartExchangeFailureCode,
      message: string,
    ): SmartTokenExchangeResult => ({
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
    if (input.client.clientId !== registration.clientId) {
      return deny("INVALID_CLIENT", "client credentials do not match the registration");
    }
    if (registration.clientSecret !== undefined) {
      const presented = input.client.clientSecret;
      if (presented === undefined) {
        return deny("INVALID_CLIENT", "client credentials do not match the registration");
      }
      const expected = this.#secrets.get(registration.clientId) ?? "";
      if (!timingSafeEqualHex(expected, sha256Hex(presented))) {
        return deny("INVALID_CLIENT", "client credentials do not match the registration");
      }
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
    const ceiling = parseSmartScopeSet(registration.grantedScopes);
    if (!ceiling.ok) {
      // Unreachable: registrations are validated at construction.
      return deny("EXCHANGE_UNAVAILABLE", "the exchange is misconfigured and denied the launch");
    }
    const launchCeiling = handle.scopes ?? ceiling.scopes;
    const granted = intersectScopeSets(
      intersectScopeSets(requested.scopes, launchCeiling),
      ceiling.scopes,
    );

    // Single-use redemption, marked BEFORE the token is minted so a
    // re-entrant exchange with the same handle can never win twice.
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

  #registrationFor(issuer: string): InMemorySmartRegistration | undefined {
    return this.#registrations.find(
      (registration) => registration.issuer === issuer,
    );
  }
}
