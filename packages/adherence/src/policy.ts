/**
 * B10 — The {@link AdherencePolicy} model: the ONLY way a restriction can
 * exist (golden journey #7, Lane C packet M6-B).
 *
 * OBSERVE-ONLY BY DEFAULT: a missing, empty, or malformed policy
 * type-encodes to NO-ENFORCEMENT. {@link resolveAdherencePolicy} returns
 * `{ kind: "no-enforcement" }` for every invalid shape — the same
 * "ESCALATE-never-publishes" discipline as the `@orbb/intents`
 * SafetyRuleEngine: the only way to reach an enforceable policy is
 * through validation, and this package exports NO function that turns a
 * rejection into an enforceable one (proven by construction; the
 * enforcement engine consumes `AdherencePolicy` values, which the type
 * system only lets flow out of a successful resolution).
 *
 * A VALID policy is explicit about all four dimensions the work order
 * requires — WHICH restriction capability, under WHICH authorization,
 * for WHICH scope, for how long:
 *   - `capability`: one id of the closed set
 *     {@link ADHERENCE_CAPABILITY_IDS} (`ios-focus`,
 *     `android-usage-access`) — an OS focus/usage surface the restriction
 *     may drive. There is deliberately no capability for third-party
 *     notification or escalation.
 *   - `triggerOn`: the literal `"missed"` — the ONLY trigger state the
 *     type can express. `recovered` (the person DID complete, late) and
 *     `on-track` can never trigger enforcement: punishing recovery or
 *     compliance would violate the non-punitive rule.
 *   - `authorization`: the permission ids the injected gate must affirm
 *     AT DECISION TIME (plus an optional pinned `grantId`).
 *   - `scope`: the policy must name at least one of person ids, plan
 *     ids, or metric ids — there is no global catch-all (recorded
 *     assumption: explicit scoping; anything broader would let one
 *     policy reach every person's device).
 *   - `restriction.durationMs`: restrictions are BOUNDED by
 *     construction. RECORDED ASSUMPTION: the maximum enforceable
 *     restriction duration is 24h — an open-ended "temporary" restriction
 *     would be punitive; anything longer must be re-authorized daily.
 *
 * Validation is STRICT (fail-closed): unknown top-level or nested fields
 * reject the policy — a typo like `capabilityy` or a smuggled punitive
 * construct like a `penalty` field cannot configure enforcement, because
 * the schema has no words for them and refuses to guess.
 */
import { isIdOf, type GrantId, type PersonId, type PlanId } from "@orbb/domain";
import { isAdherenceCapabilityId } from "./states.js";

// ---------------------------------------------------------------------------
// The policy model (validated shape).
// ---------------------------------------------------------------------------

/** The authorization requirement a policy declares for its capability. */
export interface AdherencePolicyAuthorization {
  /**
   * Permission ids the injected authorization gate must affirm at
   * decision time. Convention (recorded): the adherence restriction
   * permission vocabulary is `"adherence:restrict"` and the
   * capability-scoped `"adherence:restrict:<capability>"`; grants carry
   * the entries that satisfy it.
   */
  readonly permissions: readonly string[];
  /** Optionally pin the decision to one specific access grant. */
  readonly grantId?: GrantId;
}

/** The scope a policy applies to (at least one axis must be named). */
export interface AdherencePolicyScope {
  readonly personIds?: readonly PersonId[];
  readonly planIds?: readonly PlanId[];
  readonly metricIds?: readonly string[];
}

/** The bounded restriction a policy may apply. */
export interface AdherencePolicyRestriction {
  /** Positive integer milliseconds, at most {@link MAX_RESTRICTION_DURATION_MS}. */
  readonly durationMs: number;
}

/**
 * An adherence enforcement policy. NOTE the absence (by design, proven
 * by the vocabulary test) of any punitive construct: no streaks, no
 * scores, no points, no badges, no levels, no penalties, no third-party
 * escalation.
 */
export interface AdherencePolicy {
  readonly policyId: string;
  /** Monotonic configuration version (positive integer). */
  readonly version: number;
  readonly capability: (typeof ADHERENCE_POLICY_CAPABILITIES)[number];
  /** The ONLY legal trigger state — literal type, one value. */
  readonly triggerOn: "missed";
  readonly authorization: AdherencePolicyAuthorization;
  readonly scope: AdherencePolicyScope;
  readonly restriction: AdherencePolicyRestriction;
}

/** `AdherencePolicy["capability"]`, spelled via the closed capability set. */
export const ADHERENCE_POLICY_CAPABILITIES = ["ios-focus", "android-usage-access"] as const;

/**
 * RECORDED ASSUMPTION: maximum restriction duration is 24 hours —
 * restrictions must be bounded to stay non-punitive; longer restriction
 * requires a fresh authorized decision.
 */
export const MAX_RESTRICTION_DURATION_MS = 24 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Resolution: raw config -> enforceable policy, or NO-ENFORCEMENT.
// ---------------------------------------------------------------------------

/** Why a raw policy value resolved to no-enforcement. */
export type PolicyResolutionReason = "absent" | "malformed";

/** PHID-safe rejection detail: the structural field path that failed. */
export interface PolicyRejectionDetail {
  readonly field: string;
}

/**
 * The resolution of a raw policy value. `{ kind: "no-enforcement" }` is
 * the fail-closed outcome for absent/malformed input; `{ kind:
 * "enforceable" }` is the ONLY path to an {@link AdherencePolicy}.
 */
export type ResolvedAdherencePolicy =
  | {
      readonly kind: "no-enforcement";
      readonly reason: PolicyResolutionReason;
      readonly detail?: PolicyRejectionDetail;
    }
  | {
      readonly kind: "enforceable";
      readonly policy: AdherencePolicy;
    };

const POLICY_TOP_LEVEL_FIELDS = [
  "policyId",
  "version",
  "capability",
  "triggerOn",
  "authorization",
  "scope",
  "restriction",
] as const;

/**
 * Validates a RAW policy value (from config, a store, or an operator) and
 * resolves it to an enforceable {@link AdherencePolicy} — or to
 * NO-ENFORCEMENT. Deterministic; never throws; PHID-safe details (field
 * paths only, values never echoed).
 */
export function resolveAdherencePolicy(raw: unknown): ResolvedAdherencePolicy {
  if (raw === null || raw === undefined) {
    return { kind: "no-enforcement", reason: "absent" };
  }
  if (!isPlainObject(raw)) {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "policy" } };
  }
  for (const key of Object.keys(raw)) {
    if (!(POLICY_TOP_LEVEL_FIELDS as readonly string[]).includes(key)) {
      return { kind: "no-enforcement", reason: "malformed", detail: { field: key } };
    }
  }

  const policyId = raw["policyId"];
  if (typeof policyId !== "string" || policyId.length === 0 || policyId.length > 128) {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "policyId" } };
  }

  const version = raw["version"];
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "version" } };
  }

  const capability = raw["capability"];
  if (!isAdherenceCapabilityId(capability)) {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "capability" } };
  }

  const triggerOn = raw["triggerOn"];
  if (triggerOn !== "missed") {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "triggerOn" } };
  }

  const authorization = resolveAuthorization(raw["authorization"]);
  if (authorization === undefined) {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "authorization" } };
  }

  const scope = resolveScope(raw["scope"]);
  if (scope === undefined) {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "scope" } };
  }

  const restriction = resolveRestriction(raw["restriction"]);
  if (restriction === undefined) {
    return { kind: "no-enforcement", reason: "malformed", detail: { field: "restriction" } };
  }

  return {
    kind: "enforceable",
    policy: {
      policyId,
      version: version as number,
      capability,
      triggerOn: "missed",
      authorization,
      scope,
      restriction,
    },
  };
}

function resolveAuthorization(raw: unknown): AdherencePolicyAuthorization | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "permissions" && key !== "grantId") {
      return undefined;
    }
  }
  const permissions = raw["permissions"];
  if (
    !Array.isArray(permissions) ||
    permissions.length === 0 ||
    permissions.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    return undefined;
  }
  const grantId = raw["grantId"];
  if (grantId !== undefined && !isIdOf("grant", grantId)) {
    return undefined;
  }
  const permissionList = [...(permissions as readonly string[])];
  if (grantId !== undefined) {
    return { permissions: permissionList, grantId };
  }
  return { permissions: permissionList };
}

function resolveScope(raw: unknown): AdherencePolicyScope | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "personIds" && key !== "planIds" && key !== "metricIds") {
      return undefined;
    }
  }
  const personIds = raw["personIds"];
  const planIds = raw["planIds"];
  const metricIds = raw["metricIds"];
  if (personIds === undefined && planIds === undefined && metricIds === undefined) {
    // No catch-all policies: at least one scope axis must be named.
    return undefined;
  }
  const scope: {
    personIds?: readonly PersonId[];
    planIds?: readonly PlanId[];
    metricIds?: readonly string[];
  } = {};
  if (personIds !== undefined) {
    if (
      !Array.isArray(personIds) ||
      personIds.length === 0 ||
      personIds.some((entry) => !isIdOf("person", entry))
    ) {
      return undefined;
    }
    scope.personIds = [...(personIds as readonly PersonId[])];
  }
  if (planIds !== undefined) {
    if (
      !Array.isArray(planIds) ||
      planIds.length === 0 ||
      planIds.some((entry) => !isIdOf("plan", entry))
    ) {
      return undefined;
    }
    scope.planIds = [...(planIds as readonly PlanId[])];
  }
  if (metricIds !== undefined) {
    if (
      !Array.isArray(metricIds) ||
      metricIds.length === 0 ||
      metricIds.some((entry) => typeof entry !== "string" || entry.length === 0)
    ) {
      return undefined;
    }
    scope.metricIds = [...(metricIds as readonly string[])];
  }
  return scope;
}

function resolveRestriction(raw: unknown): AdherencePolicyRestriction | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "durationMs") {
      return undefined;
    }
  }
  const durationMs = raw["durationMs"];
  if (
    !Number.isInteger(durationMs) ||
    (durationMs as number) < 1 ||
    (durationMs as number) > MAX_RESTRICTION_DURATION_MS
  ) {
    return undefined;
  }
  return { durationMs: durationMs as number };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
