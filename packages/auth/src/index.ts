/**
 * @orbb/auth — identity and access boundary package (M3-C: §3 A22 + A25).
 *
 * Public surface (architecture-frozen responsibilities):
 *   - Opaque session tokens: issue / verify / rotate / revoke
 *     (`SessionService` + `SessionStore` seam).
 *   - Passkeys (WebAuthn L3, dependency-free verification): registration
 *     (trust-ignored attestation) and assertion verification (challenge,
 *     origin, RP ID, signature, signCount monotonicity) — `PasskeyService`
 *     over the pure `verifyAttestation` / `verifyAssertion` verifiers.
 *   - Email OTP: single-use, TTL, attempt counting, resend throttling
 *     through the @orbb/platform `RateLimiter` (`EmailOtpService`).
 *   - Recovery codes: generate / hash / verify / rotate, single-use
 *     (`RecoveryService`).
 *   - Upstash REST rate-limit adapter implementing the platform
 *     `RateLimiter` (`UpstashRateLimiter` — SHAPE-VERIFIED, NOT
 *     LIVE-VERIFIED).
 *   - Account lifecycle seams against the @orbb/db repository shapes
 *     (`AccountService`; db-backed adapters arrive with the
 *     API-integration packet).
 *
 * Invariants kept: no PHI in logs (routing through @orbb/observability's
 * deny-by-default redaction), no secrets in code, deny-by-default
 * authorization (typed results on every verify path), tokens opaque +
 * rotatable, zero runtime package dependencies (node:crypto only).
 */
export type { DeviceId, PersonId } from "@orbb/domain";

export * from "./errors.js";
export * from "./ids.js";
export * from "./crypto.js";
export * from "./logging.js";

export * from "./session/session.js";
export * from "./session/session-store.js";
export * from "./session/session-service.js";

export * from "./webauthn/cbor.js";
export * from "./webauthn/client-data.js";
export * from "./webauthn/authenticator-data.js";
export * from "./webauthn/cose.js";
export * from "./webauthn/signature.js";
export * from "./webauthn/attestation.js";
export * from "./webauthn/assertion.js";
export * from "./webauthn/passkey-service.js";

export * from "./otp/otp-store.js";
export * from "./otp/otp-service.js";

export * from "./recovery/recovery-store.js";
export * from "./recovery/recovery-service.js";

export * from "./ratelimit/upstash.js";

export * from "./account/account-store.js";
export * from "./account/account-service.js";
