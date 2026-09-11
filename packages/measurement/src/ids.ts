/**
 * Domain-separated deterministic identifier derivation.
 *
 * RECORDED CHOICE (A30 idempotency requirement): task ids are derived by
 * domain-separated SHA-256 hashing over the semantic identity of the
 * entity — NOT by the testkit `IdFactory` counter. Reason: the scheduler
 * must be idempotent per (plan, window): re-running the scheduler (same
 * clock instant, fresh or pre-populated store) has to produce the SAME
 * task ids, and a counter-based factory makes identity depend on call
 * sequence. Content-derived ids are stable across processes, replays, and
 * store rebuilds. The testkit `IdFactory` seam stays the source for
 * creation-scoped identities (plans, attempts, reconciliation
 * replacements/provenance) where sequence-dependence is the desired
 * semantics.
 *
 * Hash construction (collision-safe, ambiguity-free):
 *   sha256( domain-tag || length-prefixed canonical parts... )
 * encoded as URL-safe base64 (43 chars, `[A-Za-z0-9_-]`) — always within
 * the canonical 16–128 character body grammar of `@orbb/domain` ids, so
 * derived ids pass the domain guards (`parseTaskId`, `isIdOf`, ...).
 */
import { createHash } from "node:crypto";

/** Prefix applied to plan-metric ids (measurement-lane-local id space). */
export const PLAN_METRIC_ID_PREFIX = "pm";

/** Length of the URL-safe base64 SHA-256 digest (no padding). */
const SHA256_BASE64URL_LENGTH = 43;

/** Canonical serialization separator between length-prefixed parts. */
const PART_SEPARATOR = "|";

/**
 * Derives a deterministic id `"<prefix>_<digest>"` from a domain tag and
 * ordered semantic parts. Same tag + same parts => same id, always.
 */
export function deriveDeterministicId(
  prefix: string,
  domain: string,
  parts: readonly (string | number)[],
): string {
  const canonical = [domain, ...parts]
    .map((part) => `${String(part).length}:${String(part)}`)
    .join(PART_SEPARATOR);
  const digest = createHash("sha256").update(canonical, "utf8").digest("base64url");
  const body = digest.slice(0, SHA256_BASE64URL_LENGTH);
  const id = `${prefix}_${body}`;
  if (body.length !== SHA256_BASE64URL_LENGTH) {
    // Defensive: sha256 base64url is always 43 unpadded chars.
    throw new RangeError("Deterministic id derivation produced an unexpected digest length.");
  }
  return id;
}
