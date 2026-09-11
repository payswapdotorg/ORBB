/**
 * Canonical identity id grammar + injectable id/clock defaults.
 *
 * `AccountId` follows the `acct_<body>` grammar precedent defined by
 * `@orbb/db` (packages/db/src/contracts.ts) — the grammar is frozen
 * architecture, so this package re-declares the brand locally rather
 * than depending on the persistence package (dependency direction:
 * persistence adapters for these seams arrive in the API-integration
 * packet and depend on THIS package, not the reverse).
 *
 * `RandomIdFactory` / `systemClock` are the production defaults for the
 * `IdFactory` / `Clock` seams (both defined by `@orbb/testkit`); tests
 * inject `DeterministicIdFactory` / `DeterministicClock` instead.
 */
import { randomBytes } from "node:crypto";
import { isPersonId, type PersonId } from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import { AuthInvariantError } from "./errors.js";

// ---------------------------------------------------------------------------
// AccountId — local brand mirroring the @orbb/db acct_ grammar precedent.
// ---------------------------------------------------------------------------

declare const accountIdBrand: unique symbol;

/** Branded canonical account identifier: `acct_<body>`. */
export type AccountId = string & { readonly [accountIdBrand]: "AccountId" };

/** Fixed kind prefix for canonical account ids (mirrors @orbb/db). */
export const ACCOUNT_ID_PREFIX = "acct";

/** Valid body segment of a canonical id: 16–128 URL-safe characters. */
export const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a canonical `acct_<body>` id? */
export function isAccountId(value: unknown): value is AccountId {
  return (
    typeof value === "string" &&
    value.startsWith(`${ACCOUNT_ID_PREFIX}_`) &&
    ID_BODY_PATTERN.test(value.slice(ACCOUNT_ID_PREFIX.length + 1))
  );
}

/**
 * Parses and validates a raw value as an {@link AccountId}.
 * Throws {@link AuthInvariantError} describing the expected grammar —
 * the offending value is never echoed back.
 */
export function parseAccountId(value: unknown): AccountId {
  if (!isAccountId(value)) {
    throw new AuthInvariantError(
      `Invalid account id: expected "${ACCOUNT_ID_PREFIX}_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

// Re-exported from @orbb/domain via src/index.ts (PersonId / isPersonId);
// here they are only consumed for the requirePersonId guard below.

// ---------------------------------------------------------------------------
// Session id prefix (opaque record ids issued by the IdFactory seam).
// ---------------------------------------------------------------------------

/** Opaque session record ids issued through the `IdFactory` seam. */
export const SESSION_ID_PREFIX = "sess";

/** Opaque OTP challenge record ids issued through the `IdFactory` seam. */
export const OTP_ID_PREFIX = "otp";

// ---------------------------------------------------------------------------
// Random body generation shared by the id factory and idempotency keys.
// ---------------------------------------------------------------------------

/** 24 random bytes → 32 base64url characters (no padding): a valid id body. */
function randomIdBody(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Production `IdFactory`: crypto-random bodies under caller-supplied
 * prefixes. Output satisfies the canonical `<prefix>_<body>` grammar, so
 * `parseAccountId`/`isPersonId` guards accept it. Deterministic factories
 * (`DeterministicIdFactory` from @orbb/testkit) are the test double.
 */
export class RandomIdFactory implements IdFactory {
  next(prefix: string): string {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(prefix)) {
      throw new AuthInvariantError("RandomIdFactory prefix must be 1-32 characters of [A-Za-z0-9_-].");
    }
    return `${prefix}_${randomIdBody()}`;
  }
}

/** Random idempotency key for mutations whose caller supplied none. */
export function randomIdempotencyKey(): string {
  return `idem_${randomBytes(16).toString("hex")}`;
}

/** Production `Clock`: wall-clock time. Tests inject a deterministic clock. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/** Validates `value` as a `prsn_<body>` person id (programmer error, not user-facing). */
export function requirePersonId(value: unknown): PersonId {
  if (!isPersonId(value)) {
    throw new AuthInvariantError(
      'Invalid person id: expected "prsn_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].',
    );
  }
  return value;
}
