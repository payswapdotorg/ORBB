/**
 * Scope evaluation for the SMART launch boundary — deny-by-default,
 * mirroring the kernel access discipline (@orbb/domain `evaluateAccess`).
 *
 * Two pure primitives, deliberately layered:
 *
 * 1. `evaluateSmartScope(grantedScopes, request)` — does the LAUNCH's
 *    granted scope set cover a requested (resourceType, access) action?
 *    Deny-by-default: empty grants deny; unknown resource types deny;
 *    unknown access actions deny; malformed granted tokens deny (the
 *    granted scope string is EXTERNAL data — an EHR response — so a
 *    corrupted token is a typed denial, never a thrown crash and never a
 *    best-effort parse).
 *
 * 2. `effectiveLaunchAccess(launchScopes, standingAccess)` — the
 *    boundary-never-widens intersection: the effective set is the
 *    launch's granted actions INTERSECTED with the person's existing
 *    grants (translated into SMART grammar by the composition layer).
 *    A launch ALONE grants NOTHING: an empty standing set yields an
 *    empty effective set, always.
 *
 * COMPOSITION CONTRACT (recorded — this package does NOT duplicate the
 * kernel): serving data through this boundary requires BOTH
 *   (a) `evaluateSmartScope(...)` over the launch's granted scopes to
 *       ALLOW, AND
 *   (b) the kernel access evaluation (@orbb/domain `evaluateAccess`)
 *       over the person's consent grants to ALLOW.
 * The launch boundary narrows; it never widens. `effectiveLaunchAccess`
 * is the pure helper for composing (a) with the standing capability set
 * derived from (b).
 */
import {
  SMART_ACCESS_ACTIONS,
  isSmartScopeResourceType,
  parseSmartScopeSet,
  scopeGrantsAction,
  type SmartAccessAction,
  type SmartScope,
  type SmartScopeResourceType,
} from "./scopes.js";

/** A requested FHIR interaction, as seen by the boundary. */
export interface SmartResourceActionRequest {
  /** Raw resource type label (unknown labels are denied, never guessed). */
  readonly resourceType: string;
  /** Raw access action label (unknown actions are denied, never guessed). */
  readonly access: string;
}

/** A single effective (post-intersection) access capability. */
export interface SmartGrantedAccess {
  readonly resourceType: SmartScopeResourceType;
  readonly access: SmartAccessAction;
}

/** Typed deny reasons for {@link evaluateSmartScope}. */
export const SMART_SCOPE_DENY_REASONS = [
  "NO_GRANTS",
  "RESOURCE_NOT_GRANTED",
  "ACTION_NOT_GRANTED",
  "UNKNOWN_RESOURCE_TYPE",
  "UNKNOWN_ACCESS_ACTION",
  "GRANTED_SCOPE_MALFORMED",
] as const;

/** Typed deny reasons for {@link evaluateSmartScope}. */
export type SmartScopeDenyReason = (typeof SMART_SCOPE_DENY_REASONS)[number];

/** The deny-by-default result of {@link evaluateSmartScope}. */
export type ScopeEvaluation =
  | { readonly decision: "ALLOW"; readonly granted: SmartScope }
  | {
      readonly decision: "DENY";
      readonly reason: SmartScopeDenyReason;
      readonly message: string;
    };

/**
 * Pure, deny-by-default evaluation of a requested resource action
 * against the launch's granted scope set.
 *
 * `grantedScopes` is the space-delimited SMART scope string the token
 * exchange carried (external data — malformed tokens DENY with
 * `GRANTED_SCOPE_MALFORMED`, index included in the message, never the
 * raw token). `request` is the raw requested (resourceType, access)
 * pair; unknown labels DENY.
 */
export function evaluateSmartScope(
  grantedScopes: string,
  request: SmartResourceActionRequest,
): ScopeEvaluation {
  if (typeof grantedScopes !== "string") {
    throw new TypeError("evaluateSmartScope requires a string of granted scopes.");
  }
  const parsed = parseSmartScopeSet(grantedScopes);
  if (!parsed.ok) {
    return {
      decision: "DENY",
      reason: "GRANTED_SCOPE_MALFORMED",
      message: `granted scope token at index ${parsed.scopeIndex} violates the frozen scope grammar (${parsed.reason})`,
    };
  }
  if (parsed.scopes.length === 0) {
    return {
      decision: "DENY",
      reason: "NO_GRANTS",
      message: "no scopes granted by this launch",
    };
  }
  if (!isSmartScopeResourceType(request.resourceType)) {
    return {
      decision: "DENY",
      reason: "UNKNOWN_RESOURCE_TYPE",
      message: "requested resource type is not in the frozen allow-list",
    };
  }
  const accessActions: readonly string[] = SMART_ACCESS_ACTIONS;
  if (!accessActions.includes(request.access)) {
    return {
      decision: "DENY",
      reason: "UNKNOWN_ACCESS_ACTION",
      message: "requested access action is not one of the read-shaped actions (read, search)",
    };
  }
  const access = request.access as SmartAccessAction;
  const covering = parsed.scopes.find(
    (scope) =>
      scope.resourceType === request.resourceType && scopeGrantsAction(scope, access),
  );
  if (covering === undefined) {
    const resourceCovered = parsed.scopes.some((scope) => scope.resourceType === request.resourceType);
    return {
      decision: "DENY",
      reason: resourceCovered ? "ACTION_NOT_GRANTED" : "RESOURCE_NOT_GRANTED",
      message: resourceCovered
        ? "the launch grants the resource type but not the requested action"
        : "the launch does not grant the requested resource type",
    };
  }
  return { decision: "ALLOW", granted: covering };
}

/** Flattens parsed scopes into the (resourceType, access) capabilities they grant. */
export function grantedAccessOf(scopes: readonly SmartScope[]): readonly SmartGrantedAccess[] {
  const out: SmartGrantedAccess[] = [];
  for (const scope of scopes) {
    for (const access of SMART_ACCESS_ACTIONS) {
      if (scopeGrantsAction(scope, access)) {
        out.push({ resourceType: scope.resourceType, access });
      }
    }
  }
  return out;
}

/**
 * The boundary-never-widens intersection (pure).
 *
 * `launchScopes` — what the token exchange granted for THIS launch.
 * `standingAccess` — the person's existing grants, translated into
 * SMART grammar by the composition layer (from kernel AccessGrants,
 * e.g. scope entry `observation:read` -> `(Observation, read)`).
 *
 * The result is the set of (resourceType, access) pairs present in BOTH
 * inputs: provably a subset of each. A launch alone grants NOTHING —
 * empty standing access yields an empty effective set for ANY launch
 * scope set.
 */
export function effectiveLaunchAccess(
  launchScopes: readonly SmartScope[],
  standingAccess: readonly SmartGrantedAccess[],
): readonly SmartGrantedAccess[] {
  const standing = new Set<string>();
  for (const entry of standingAccess) {
    standing.add(`${entry.resourceType}:${entry.access}`);
  }
  const effective: SmartGrantedAccess[] = [];
  for (const granted of grantedAccessOf(launchScopes)) {
    if (standing.has(`${granted.resourceType}:${granted.access}`)) {
      effective.push(granted);
    }
  }
  return effective;
}
