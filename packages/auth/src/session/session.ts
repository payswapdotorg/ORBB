/**
 * Session record shapes and typed verify-path results (§3 A22).
 *
 * A session token is OPAQUE (random ≥ 128 bits, base64url) and is stored
 * only as its SHA-256 digest; the record carries the full binding set:
 * {personId, accountId?, createdAt, expiresAt, lastSeenAt, revokedAt}.
 *
 * Deny-by-default: every verify/rotate path returns a typed result —
 * user-facing outcomes never throw and never carry detail beyond the
 * failure code.
 */
import type { PersonId } from "@orbb/domain";
import type { AccountId } from "../ids.js";

/** Typed failure codes for session verify/rotate paths (never thrown). */
export type SessionFailureCode = "INVALID_TOKEN" | "EXPIRED" | "REVOKED";

/** Public view of a session (the stored record minus the token digest). */
export interface SessionRecord {
  /** Opaque record id (`sess_<body>`, from the IdFactory seam). */
  readonly id: string;
  readonly personId: PersonId;
  readonly accountId?: AccountId;
  readonly createdAt: Date;
  /** Exclusive validity horizon: the session is expired when `now >= expiresAt`. */
  readonly expiresAt: Date;
  readonly lastSeenAt?: Date;
  readonly revokedAt?: Date;
}

/**
 * What a {@link SessionStore} actually persists: the record plus the
 * SHA-256 digest of the opaque token (lowercase hex, 64 chars — the
 * `SHA256_HEX_PATTERN` grammar). The token itself never persists.
 */
export interface StoredSession extends SessionRecord {
  readonly tokenHash: string;
}

/** Result of issuing a session (the token is returned exactly once). */
export interface SessionIssueResult {
  readonly ok: true;
  /** Opaque token (>= 128 bits). Shown once; only its digest is stored. */
  readonly token: string;
  readonly session: SessionRecord;
}

/** Result of rotating a session: old token invalidated, new token issued. */
export type SessionRotationResult =
  | { readonly ok: true; readonly token: string; readonly session: SessionRecord }
  | { readonly ok: false; readonly code: SessionFailureCode };

/** Result of verifying (and touching) a session token. */
export type SessionVerificationResult =
  | { readonly ok: true; readonly session: SessionRecord }
  | { readonly ok: false; readonly code: SessionFailureCode };

/** Strips the token digest from a stored session (public record view). */
export function toSessionRecord(stored: StoredSession): SessionRecord {
  return {
    id: stored.id,
    personId: stored.personId,
    ...(stored.accountId !== undefined ? { accountId: stored.accountId } : {}),
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    ...(stored.lastSeenAt !== undefined ? { lastSeenAt: stored.lastSeenAt } : {}),
    ...(stored.revokedAt !== undefined ? { revokedAt: stored.revokedAt } : {}),
  };
}
