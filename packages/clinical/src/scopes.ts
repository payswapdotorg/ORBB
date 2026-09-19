/**
 * A45 — the frozen care-team scope permission vocabulary.
 *
 * Care-team scopes EXTEND the kernel grant-scope pattern
 * (`"<resourceKind>:<operation>"` entries on `AccessGrant.scope` — see
 * `@orbb/domain` `access.ts` `parseScopePermission`): every entry below is
 * a well-formed kernel scope permission, so an AccessGrant carrying these
 * entries is understood by the REAL kernel evaluator unchanged.
 *
 * READ-ONLY BY DEFAULT. The vocabulary contains `read` operations only —
 * there is no word for a write scope, so the care-team evaluator (which
 * only ever authorizes permissions from this closed set) cannot express
 * a write grant. RECORDED ASSUMPTION: write-scope vocabulary
 * (`observations:write`, workflow verbs, order entry) arrives with the
 * M7-B clinical workflow items under explicit tech-lead review — until
 * then a grant carrying a write entry simply has no care-team meaning.
 */
import { DomainInvariantError, parseScopePermission } from "@orbb/domain";

/**
 * The frozen care-team scope permission vocabulary (read-only defaults).
 * `timeline:read` is the longitudinal patient timeline (M7-A/B exit
 * direction: "clinician can request authorized data and reason over a
 * longitudinal patient timeline"); `observations:read` and `intent:read`
 * mirror the kernel's own scope examples.
 */
export const CARE_TEAM_SCOPE_PERMISSIONS = [
  "observations:read",
  "timeline:read",
  "intent:read",
] as const;

export type CareTeamScopePermission = (typeof CARE_TEAM_SCOPE_PERMISSIONS)[number];

export function isCareTeamScopePermission(value: unknown): value is CareTeamScopePermission {
  return (
    typeof value === "string" &&
    (CARE_TEAM_SCOPE_PERMISSIONS as readonly string[]).includes(value)
  );
}

export function parseCareTeamScopePermission(value: unknown): CareTeamScopePermission {
  if (!isCareTeamScopePermission(value)) {
    throw new DomainInvariantError(
      `Invalid care-team scope permission: expected one of ${CARE_TEAM_SCOPE_PERMISSIONS.join(" | ")} (read-only vocabulary; write scopes arrive with the M7-B workflow items).`,
    );
  }
  return value;
}

/**
 * Structural proof that every frozen vocabulary entry is itself a
 * well-formed kernel "<resourceKind>:<operation>" scope permission — the
 * extension point of the grant-scope pattern, verified at import time of
 * this module's tests (mirrored by the vocabulary test).
 */
export function careTeamScopePermissionSegments(permission: CareTeamScopePermission): {
  resourceKind: string;
  operation: string;
} {
  return parseScopePermission(permission);
}
