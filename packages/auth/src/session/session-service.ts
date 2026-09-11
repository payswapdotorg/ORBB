/**
 * `SessionService` — issue / verify / rotate / revoke opaque session
 * tokens (§3 A22).
 *
 * Seams (all injectable): `SessionStore` (persistence), `Clock` (time),
 * `IdFactory` (record ids), `Logger` (observability, PHI-redacted).
 *
 * Recorded assumptions:
 *   - Default TTL: 12 hours (43 200 s). No session TTL is specified by
 *     the frozen architecture; 12 h covers a clinical workday while
 *     staying far below refresh-token horizons. Callers override per
 *     issue/rotate via `ttlSeconds`.
 *   - Expiry is exclusive: a session is EXPIRED when `now >= expiresAt`
 *     (matches the @orbb/platform in-memory TTL convention).
 *   - Rotation always re-issues from the CURRENT time with the caller's
 *     (or default) TTL; the old token is invalidated atomically by the
 *     store's `rotate`.
 *   - Token lookup is by SHA-256 digest (fixed 64-char hex). The digest
 *     comparison is timing-safe in practice for this design: digests are
 *     length-uniform, preimage-resistant, and their equality is already
 *     public signal (the verify outcome itself).
 */
import type { PersonId } from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import type { Logger } from "@orbb/observability";
import {
  RandomIdFactory,
  requirePersonId,
  SESSION_ID_PREFIX,
  systemClock,
  type AccountId,
} from "../ids.js";
import { randomToken, sha256Hex } from "../crypto.js";
import type {
  SessionIssueResult,
  SessionRotationResult,
  SessionVerificationResult,
  StoredSession,
} from "./session.js";
import { toSessionRecord } from "./session.js";
import type { SessionStore } from "./session-store.js";

/** Options for constructing a {@link SessionService}. */
export interface SessionServiceOptions {
  readonly store: SessionStore;
  /** Injectable time source. Default: wall clock. */
  readonly clock?: Clock;
  /** Injectable record-id source. Default: {@link RandomIdFactory}. */
  readonly idFactory?: IdFactory;
  /** Default session TTL in seconds (finite >= 60). Default: 43 200 (12 h). */
  readonly ttlSeconds?: number;
  /** PHI-redaction-safe structured logger. Default: silent. */
  readonly logger?: Logger;
}

/** Input for `SessionService.issue`. */
export interface IssueSessionInput {
  readonly personId: PersonId;
  readonly accountId?: AccountId;
  /** Per-issue TTL override (finite >= 60 seconds). */
  readonly ttlSeconds?: number;
}

/** Options for `SessionService.rotate`. */
export interface RotateSessionOptions {
  /** Per-rotation TTL override (finite >= 60 seconds). */
  readonly ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 43_200;
const MIN_TTL_SECONDS = 60;

function resolveTtl(ttl: number | undefined, source: string): number {
  const value = ttl ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(value) || value < MIN_TTL_SECONDS) {
    throw new RangeError(`${source} must be a finite number >= ${MIN_TTL_SECONDS} seconds.`);
  }
  return value;
}

/** Opaque-session lifecycle service. All verify paths return typed results. */
export class SessionService {
  readonly #store: SessionStore;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #log: Logger | undefined;

  constructor(options: SessionServiceOptions) {
    this.#store = options.store;
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.idFactory ?? new RandomIdFactory();
    // Validate the configured default eagerly (per-use TTL resolution).
    if (options.ttlSeconds !== undefined) {
      resolveTtl(options.ttlSeconds, "SessionServiceOptions.ttlSeconds");
    }
    this.#log = options.logger;
  }

  /**
   * Issues a new opaque session bound to a person (and optionally an
   * account). The token is returned exactly once; only its SHA-256
   * digest is persisted.
   */
  async issue(input: IssueSessionInput): Promise<SessionIssueResult> {
    requirePersonId(input.personId);
    const ttl = resolveTtl(input.ttlSeconds, "IssueSessionInput.ttlSeconds");
    const now = this.#clock.now();
    const token = randomToken(32);
    const stored: StoredSession = {
      id: this.#ids.next(SESSION_ID_PREFIX),
      personId: input.personId,
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1_000),
      tokenHash: sha256Hex(token),
    };
    await this.#store.create(stored);
    this.#log?.info("session issued", {
      event: "auth.session.issued",
      ...(stored.accountId !== undefined ? { accountId: stored.accountId } : {}),
      ttlSeconds: ttl,
    });
    return { ok: true, token, session: toSessionRecord(stored) };
  }

  /**
   * Verifies an opaque session token. Live sessions get `lastSeenAt`
   * touched. Deny-by-default: unknown/expired/revoked tokens each return
   * a typed failure code; nothing is thrown for auth outcomes.
   */
  async verify(token: string): Promise<SessionVerificationResult> {
    const tokenHash = sha256Hex(token);
    const stored = await this.#store.findByTokenHash(tokenHash);
    if (stored === undefined) {
      this.#log?.warn("session verification failed: invalid token", { event: "auth.session.verify_failed" });
      return { ok: false, code: "INVALID_TOKEN" };
    }
    if (stored.revokedAt !== undefined) {
      this.#log?.warn("session verification failed: revoked", { event: "auth.session.verify_failed" });
      return { ok: false, code: "REVOKED" };
    }
    const now = this.#clock.now();
    if (now.getTime() >= stored.expiresAt.getTime()) {
      this.#log?.warn("session verification failed: expired", { event: "auth.session.verify_failed" });
      return { ok: false, code: "EXPIRED" };
    }
    const touched = await this.#store.touch(tokenHash, now);
    return { ok: true, session: toSessionRecord(touched ?? stored) };
  }

  /**
   * Revokes the session bound to `token`. Idempotent: revoking an
   * already-revoked/unknown token returns `false`.
   */
  async revoke(token: string): Promise<boolean> {
    const revoked = await this.#store.revoke(sha256Hex(token), this.#clock.now());
    if (revoked) {
      this.#log?.info("session revoked", { event: "auth.session.revoked" });
    }
    return revoked;
  }

  /**
   * Rotates the session bound to `token`: the old token is invalidated
   * ATOMICALLY with the issuance of a fresh token (same person/account
   * binding, fresh TTL from the current time). Rotation of an invalid,
   * revoked, or expired session is a typed failure (deny-by-default).
   */
  async rotate(token: string, options?: RotateSessionOptions): Promise<SessionRotationResult> {
    const tokenHash = sha256Hex(token);
    const stored = await this.#store.findByTokenHash(tokenHash);
    if (stored === undefined) {
      return { ok: false, code: "INVALID_TOKEN" };
    }
    if (stored.revokedAt !== undefined) {
      return { ok: false, code: "REVOKED" };
    }
    const now = this.#clock.now();
    if (now.getTime() >= stored.expiresAt.getTime()) {
      return { ok: false, code: "EXPIRED" };
    }
    const ttl = resolveTtl(options?.ttlSeconds, "RotateSessionOptions.ttlSeconds");
    const nextToken = randomToken(32);
    const next: StoredSession = {
      id: this.#ids.next(SESSION_ID_PREFIX),
      personId: stored.personId,
      ...(stored.accountId !== undefined ? { accountId: stored.accountId } : {}),
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1_000),
      tokenHash: sha256Hex(nextToken),
    };
    const rotated = await this.#store.rotate(tokenHash, next, now);
    if (rotated === undefined) {
      // A concurrent revoke/rotate won the race: the old token is no
      // longer valid. Deny without further detail.
      this.#log?.warn("session rotation lost a concurrency race", { event: "auth.session.rotate_failed" });
      return { ok: false, code: "INVALID_TOKEN" };
    }
    this.#log?.info("session rotated", {
      event: "auth.session.rotated",
      ...(rotated.accountId !== undefined ? { accountId: rotated.accountId } : {}),
    });
    return { ok: true, token: nextToken, session: toSessionRecord(rotated) };
  }
}
