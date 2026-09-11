/**
 * `EmailOtpService` — issuance, verification, resend throttling (§3 A22
 * + A25).
 *
 *   - Codes: numeric (default 6 digits), generated with `randomInt`
 *     (uniform), delivered ONLY through the transport; at rest only the
 *     SHA-256 digest is stored (compared timing-safe).
 *   - Single-use: a successful verification atomically consumes the
 *     challenge; a second use is denied.
 *   - TTL: default 300 s (exclusive expiry — `now >= expiresAt` is dead).
 *   - Attempt counting: max 5 failed verifications per challenge, then
 *     the challenge is dead (`TOO_MANY_ATTEMPTS`).
 *   - Resend throttling: the ISSUANCE path is guarded by the platform
 *     `RateLimiter` interface (@orbb/platform — architecture A25). The
 *     rate-limit key hashes the (person, email) pair so no address is
 *     ever shipped to a rate-limit provider; the in-memory
 *     implementation is the test path, the Upstash adapter is the
 *     production path (see ratelimit/upstash.ts).
 *
 * Deny-by-default: every outcome is a typed result; no user-facing
 * details are thrown or returned.
 */
import type { PersonId } from "@orbb/domain";
import type { RateLimiter } from "@orbb/platform";
import type { Clock, IdFactory } from "@orbb/testkit";
import type { Logger } from "@orbb/observability";
import { randomDigits, sha256Hex, timingSafeEqualHex } from "../crypto.js";
import { OTP_ID_PREFIX, RandomIdFactory, requirePersonId, systemClock, type AccountId } from "../ids.js";
import type { OtpChallengeRecord, OtpPurpose, OtpStore, OtpTransport } from "./otp-store.js";

/** Typed failure codes for OTP issuance. */
export type OtpIssueFailureCode = "RATE_LIMITED" | "DELIVERY_FAILED";

/** Typed failure codes for OTP verification. */
export type OtpVerifyFailureCode =
  | "NO_ACTIVE_CHALLENGE"
  | "EXPIRED"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_CODE";

/** Result of issuing an OTP (the code itself never appears here). */
export type OtpIssueResult =
  | { readonly ok: true; readonly expiresAt: Date }
  | {
      readonly ok: false;
      readonly code: OtpIssueFailureCode;
      /** When the issuance window resets (RATE_LIMITED only). */
      readonly retryAtMs?: number;
    };

/** Result of verifying an OTP. */
export type OtpVerifyResult =
  | {
      readonly ok: true;
      readonly personId: PersonId;
      readonly accountId?: AccountId;
    }
  | { readonly ok: false; readonly code: OtpVerifyFailureCode };

/** Options for constructing an {@link EmailOtpService}. */
export interface EmailOtpServiceOptions {
  readonly store: OtpStore;
  readonly transport: OtpTransport;
  /** Resend/issuance throttle (the @orbb/platform `RateLimiter`). */
  readonly limiter?: RateLimiter;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly logger?: Logger;
  /** Numeric code length (4–10). Default: 6. */
  readonly codeLength?: number;
  /** Challenge TTL in seconds (finite >= 60). Default: 300 (5 min). */
  readonly ttlSeconds?: number;
  /** Max failed verification attempts per challenge (>= 1). Default: 5. */
  readonly maxAttempts?: number;
  /** Issuance allowance per window when a limiter is configured. Default: 3. */
  readonly issueLimit?: number;
  /** Issuance fixed-window length in seconds. Default: 600 (10 min). */
  readonly issueWindowSeconds?: number;
}

/** Input for `EmailOtpService.issue`. */
export interface OtpIssueInput {
  readonly personId: PersonId;
  readonly accountId?: AccountId;
  readonly email: string;
  readonly purpose: OtpPurpose;
}

/** Input for `EmailOtpService.verify`. */
export interface OtpVerifyInput {
  readonly personId: PersonId;
  readonly email: string;
  readonly purpose: OtpPurpose;
  readonly code: string;
}

const DEFAULT_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_ISSUE_LIMIT = 3;
const DEFAULT_ISSUE_WINDOW_SECONDS = 600;

/**
 * Normalizes an email address for hashing/binding: trimmed + lowercase
 * (recorded assumption: addresses are treated case-insensitively, the
 * near-universal provider convention).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Single-use email OTP lifecycle service. */
export class EmailOtpService {
  readonly #store: OtpStore;
  readonly #transport: OtpTransport;
  readonly #limiter: RateLimiter | undefined;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #log: Logger | undefined;
  readonly #codeLength: number;
  readonly #ttl: number;
  readonly #maxAttempts: number;
  readonly #issueLimit: number;
  readonly #issueWindow: number;

  constructor(options: EmailOtpServiceOptions) {
    this.#store = options.store;
    this.#transport = options.transport;
    this.#limiter = options.limiter;
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.idFactory ?? new RandomIdFactory();
    this.#log = options.logger;
    this.#codeLength = options.codeLength ?? 6;
    this.#ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#issueLimit = options.issueLimit ?? DEFAULT_ISSUE_LIMIT;
    this.#issueWindow = options.issueWindowSeconds ?? DEFAULT_ISSUE_WINDOW_SECONDS;
    if (!Number.isInteger(this.#codeLength) || this.#codeLength < 4 || this.#codeLength > 10) {
      throw new RangeError("EmailOtpServiceOptions.codeLength must be an integer between 4 and 10.");
    }
    if (!Number.isFinite(this.#ttl) || this.#ttl < MIN_TTL_SECONDS) {
      throw new RangeError(`EmailOtpServiceOptions.ttlSeconds must be a finite number >= ${MIN_TTL_SECONDS}.`);
    }
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts < 1) {
      throw new RangeError("EmailOtpServiceOptions.maxAttempts must be an integer >= 1.");
    }
    if (!Number.isInteger(this.#issueLimit) || this.#issueLimit < 1) {
      throw new RangeError("EmailOtpServiceOptions.issueLimit must be an integer >= 1.");
    }
    if (!Number.isFinite(this.#issueWindow) || this.#issueWindow < 1) {
      throw new RangeError("EmailOtpServiceOptions.issueWindowSeconds must be a finite number >= 1.");
    }
  }

  /**
   * Issues a single-use OTP for (person, email, purpose): throttle
   * check → code generation → challenge replacement → delivery. The
   * plaintext code goes ONLY to the transport; the result carries just
   * the expiry (never the code).
   */
  async issue(input: OtpIssueInput): Promise<OtpIssueResult> {
    requirePersonId(input.personId);
    if (this.#limiter !== undefined) {
      // Hashed key: the rate-limit provider never sees the address.
      const rateKey = `auth:otp:issue:${sha256Hex(`${input.personId}:${normalizeEmail(input.email)}`)}`;
      const decision = await this.#limiter.limit(rateKey, {
        limit: this.#issueLimit,
        windowSeconds: this.#issueWindow,
      });
      if (!decision.allowed) {
        this.#log?.warn("otp issuance throttled", { event: "auth.otp.throttled" });
        return { ok: false, code: "RATE_LIMITED", retryAtMs: decision.resetAtMs };
      }
    }
    const now = this.#clock.now();
    const code = randomDigits(this.#codeLength);
    const record: OtpChallengeRecord = {
      id: this.#ids.next(OTP_ID_PREFIX),
      personId: input.personId,
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      emailHash: sha256Hex(normalizeEmail(input.email)),
      codeHash: sha256Hex(code),
      purpose: input.purpose,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.#ttl * 1_000),
      attempts: 0,
    };
    await this.#store.insert(record);
    try {
      await this.#transport.deliver({
        personId: input.personId,
        email: normalizeEmail(input.email),
        code,
        purpose: input.purpose,
        expiresAt: record.expiresAt,
      });
    } catch {
      // Operational delivery failure: the challenge exists but the code
      // never left the system; report it as a typed failure.
      this.#log?.warn("otp delivery failed", { event: "auth.otp.delivery_failed" });
      return { ok: false, code: "DELIVERY_FAILED" };
    }
    this.#log?.info("otp issued", {
      event: "auth.otp.issued",
      ...(record.accountId !== undefined ? { accountId: record.accountId } : {}),
    });
    return { ok: true, expiresAt: record.expiresAt };
  }

  /**
   * Verifies an OTP: active-challenge lookup, TTL, attempt budget,
   * timing-safe code comparison (digests), atomic single-use commit.
   */
  async verify(input: OtpVerifyInput): Promise<OtpVerifyResult> {
    requirePersonId(input.personId);
    const emailHash = sha256Hex(normalizeEmail(input.email));
    const record = await this.#store.findActive(input.personId, emailHash, input.purpose);
    if (record === undefined) {
      this.#log?.warn("otp verification failed: no active challenge", {
        event: "auth.otp.verify_failed",
      });
      return { ok: false, code: "NO_ACTIVE_CHALLENGE" };
    }
    const now = this.#clock.now();
    if (now.getTime() >= record.expiresAt.getTime()) {
      this.#log?.warn("otp verification failed: expired", { event: "auth.otp.verify_failed" });
      return { ok: false, code: "EXPIRED" };
    }
    if (record.attempts >= this.#maxAttempts) {
      this.#log?.warn("otp verification failed: attempt budget exhausted", {
        event: "auth.otp.verify_failed",
      });
      return { ok: false, code: "TOO_MANY_ATTEMPTS" };
    }
    // Timing-safe comparison over the digests (length-uniform, hashed).
    if (!timingSafeEqualHex(sha256Hex(input.code), record.codeHash)) {
      await this.#store.recordFailedAttempt(input.personId, emailHash, input.purpose);
      this.#log?.warn("otp verification failed: invalid code", { event: "auth.otp.verify_failed" });
      return { ok: false, code: "INVALID_CODE" };
    }
    const consumed = await this.#store.consume(input.personId, emailHash, input.purpose, now);
    if (!consumed) {
      // A concurrent verification won the single-use commit.
      this.#log?.warn("otp verification failed: challenge already consumed", {
        event: "auth.otp.verify_failed",
      });
      return { ok: false, code: "NO_ACTIVE_CHALLENGE" };
    }
    this.#log?.info("otp verified", {
      event: "auth.otp.verified",
      ...(record.accountId !== undefined ? { accountId: record.accountId } : {}),
    });
    return {
      ok: true,
      personId: record.personId,
      ...(record.accountId !== undefined ? { accountId: record.accountId } : {}),
    };
  }
}
