/**
 * @orbb/consent — consent boundary package (M0).
 *
 * Future responsibility (architecture §2, §7): owns ConsentPolicy,
 * AccessGrant, Purpose, Recipient, DataScope, AccessDecision,
 * AccessAudit, and Revocation — evaluating access deny-by-default from
 * subject + recipient + resource + purpose + operation + time + consent
 * + policy + relationship + emergency state, and emitting
 * ACCESS_GRANTED / ACCESS_REVOKED with immutable audit events.
 *
 * M0 boundary: no runtime behavior yet. Re-exports (type-only) the
 * access-plane types from @orbb/domain that this lane will own.
 */
export type { AccessGrant, GrantId, GrantState } from "@orbb/domain";
