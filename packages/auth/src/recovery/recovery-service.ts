/**
 * `RecoveryService` — generate / rotate / verify single-use recovery
 * codes for account recovery flows (§3 A22).
 *
 * Recorded decisions:
 *   - Code grammar: 10 characters from a 31-symbol unambiguous alphabet
 *     (A–Z minus O/I, digits 2–9 minus 0/1) rendered `XXXXX-XXXXX`
 *     (~50 bits per code). Verification attempts are throttled through
 *     the platform `RateLimiter` (A25), which bounds brute force; the
 *     per-code entropy is deliberately human-transportable, not
 *     token-grade.
 *   - Codes are normalized (uppercase, separators stripped) before the
 *     timing-safe digest comparison; only digests persist.
 *   - Rotation replaces the entire set atomically and returns the
 *     plaintext list exactly once.
 *   - Verification is throttled via an OPTIONAL `RateLimiter` keyed by
 *     the account id (account ids are not PHI; the rate-limit provider
 *     only ever sees the opaque id).
 */
import { randomInt } from "node:crypto";
import type { RateLimiter } from "@orbb/platform";
import type { Clock } from "@orbb/testkit";
import type { Logger } from "@orbb/observability";
import { sha256Hex, timingSafeEqualHex } from "../crypto.js";
import { systemClock, type AccountId } from "../ids.js";
import type { RecoveryCodeRecord, RecoveryCodeStore } from "./recovery-store.js";

/** Typed failure codes for recovery verification. */
export type RecoveryFailureCode = "NO_CODES" | "INVALID_CODE" | "RATE_LIMITED";

/** Result of rotating a recovery set: the plaintext codes, shown once. */
export type RecoveryRotationResult =
  | { readonly ok: true; readonly codes: readonly string[] }
  | { readonly ok: false; readonly code: RecoveryFailureCode; readonly retryAtMs?: number };

/** Result of verifying a recovery code. */
export type RecoveryVerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: RecoveryFailureCode; readonly retryAtMs?: number };

/** Options for constructing a {@link RecoveryService}. */
export interface RecoveryServiceOptions {
  readonly store: RecoveryCodeStore;
  readonly clock?: Clock;
  /** Optional verification-attempt throttle (the @orbb/platform `RateLimiter`). */
  readonly verifyLimiter?: RateLimiter;
  /** Verify allowance per window when a limiter is configured. Default: 10. */
  readonly verifyLimit?: number;
  /** Verify fixed-window length in seconds. Default: 600 (10 min). */
  readonly verifyWindowSeconds?: number;
  /** Codes per set (>= 4). Default: 10. */
  readonly codeCount?: number;
  readonly logger?: Logger;
}

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_CODE_COUNT = 10;
const CODE_LENGTH = 10;
const DEFAULT_VERIFY_LIMIT = 10;
const DEFAULT_VERIFY_WINDOW_SECONDS = 600;

/** Normalizes a user-typed recovery code: separators out, uppercase in. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/gu, "").toUpperCase();
}

function generateRecoveryCode(): string {
  let body = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    body += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
  }
  return `${body.slice(0, 5)}-${body.slice(5)}`;
}

/** Single-use recovery-code lifecycle service. */
export class RecoveryService {
  readonly #store: RecoveryCodeStore;
  readonly #clock: Clock;
  readonly #limiter: RateLimiter | undefined;
  readonly #verifyLimit: number;
  readonly #verifyWindow: number;
  readonly #codeCount: number;
  readonly #log: Logger | undefined;

  constructor(options: RecoveryServiceOptions) {
    this.#store = options.store;
    this.#clock = options.clock ?? systemClock;
    this.#limiter = options.verifyLimiter;
    this.#verifyLimit = options.verifyLimit ?? DEFAULT_VERIFY_LIMIT;
    this.#verifyWindow = options.verifyWindowSeconds ?? DEFAULT_VERIFY_WINDOW_SECONDS;
    this.#codeCount = options.codeCount ?? DEFAULT_CODE_COUNT;
    if (!Number.isInteger(this.#codeCount) || this.#codeCount < 4 || this.#codeCount > 64) {
      throw new RangeError("RecoveryServiceOptions.codeCount must be an integer between 4 and 64.");
    }
    if (!Number.isInteger(this.#verifyLimit) || this.#verifyLimit < 1) {
      throw new RangeError("RecoveryServiceOptions.verifyLimit must be an integer >= 1.");
    }
    if (!Number.isFinite(this.#verifyWindow) || this.#verifyWindow < 1) {
      throw new RangeError("RecoveryServiceOptions.verifyWindowSeconds must be a finite number >= 1.");
    }
    this.#log = options.logger;
  }

  /**
   * Rotates the recovery set for an account: generates a fresh set,
   * atomically replaces the old one (all previous codes die), and
   * returns the plaintext codes exactly once.
   */
  async rotate(accountId: AccountId): Promise<RecoveryRotationResult> {
    const now = this.#clock.now();
    const records: RecoveryCodeRecord[] = [];
    const codes: string[] = [];
    for (let i = 0; i < this.#codeCount; i += 1) {
      const code = generateRecoveryCode();
      codes.push(code);
      records.push({ codeHash: sha256Hex(normalizeRecoveryCode(code)), createdAt: now });
    }
    await this.#store.replace(accountId, records, now);
    this.#log?.info("recovery codes rotated", {
      event: "auth.recovery.rotated",
      accountId,
    });
    return { ok: true, codes };
  }

  /**
   * Verifies (and atomically consumes) one recovery code for an account.
   * Throttled when a limiter is configured. Deny-by-default.
   */
  async verify(accountId: AccountId, code: string): Promise<RecoveryVerificationResult> {
    if (this.#limiter !== undefined) {
      const decision = await this.#limiter.limit(`auth:recovery:verify:${accountId}`, {
        limit: this.#verifyLimit,
        windowSeconds: this.#verifyWindow,
      });
      if (!decision.allowed) {
        this.#log?.warn("recovery verification throttled", { event: "auth.recovery.throttled" });
        return { ok: false, code: "RATE_LIMITED", retryAtMs: decision.resetAtMs };
      }
    }
    const set = await this.#store.findSet(accountId);
    if (set === undefined || set.codes.length === 0) {
      this.#log?.warn("recovery verification failed: no codes", { event: "auth.recovery.verify_failed" });
      return { ok: false, code: "NO_CODES" };
    }
    const codeHash = sha256Hex(normalizeRecoveryCode(code));
    const match = set.codes.some((record) => timingSafeEqualHex(record.codeHash, codeHash));
    if (!match) {
      this.#log?.warn("recovery verification failed: invalid code", {
        event: "auth.recovery.verify_failed",
      });
      return { ok: false, code: "INVALID_CODE" };
    }
    const consumed = await this.#store.consume(accountId, codeHash, this.#clock.now());
    if (!consumed) {
      // A concurrent verification won the single-use commit.
      this.#log?.warn("recovery verification failed: code already consumed", {
        event: "auth.recovery.verify_failed",
      });
      return { ok: false, code: "INVALID_CODE" };
    }
    this.#log?.info("recovery code verified", { event: "auth.recovery.verified", accountId });
    return { ok: true };
  }
}
