/**
 * Adherence posture wire types (M6 EXIT, Lane B) — the journey-#7
 * "authorized restriction applied only if configured" leg's type layer,
 * mirroring the REAL `@orbb/adherence` (B10) shapes.
 *
 * THE LIB/ WIRE-TYPE PATTERN: `@orbb/adherence` is READ-ONLY and resolves
 * at runtime to an unbuilt `dist/` entry, so the restriction-posture
 * surface consumes TYPED SYNTH FIXTURES. The stored fixture records are
 * typed by the REAL package types — `import type` only (the same recorded
 * handoff as `lib/today/types.ts` for `@orbb/measurement`). At engine
 * wiring the fixtures swap for real `AdherenceEnforcementEngine` outputs
 * with no call-site changes.
 *
 * WHAT IS MIRRORED (the B10 contract, verbatim vocabulary):
 *   - the policy schema fields: `policyId`, `version`, `capability`
 *     (closed set `ios-focus` | `android-usage-access`), `triggerOn`
 *     (the LITERAL `"missed"` — the only legal trigger; recovery and
 *     on-track can never trigger enforcement), `authorization`
 *     (`permissions` + optional pinned `grantId`), `scope` (person/plan/
 *     metric axes — no global catch-all), `restriction` (`durationMs`,
 *     bounded by the recorded 24h maximum);
 *   - the enforcement decision vocabulary: `no-enforcement` (observe-only
 *     degrade, with reason) | `enforcement-refused` (fail-closed typed
 *     refusal) | `restriction-authorized` (the bounded token — the ONLY
 *     value OS capability adapters accept as authorization to act);
 *   - the adherence evaluation vocabulary: states
 *     `on-track | missed | recovered` with PHID-safe reason codes.
 *
 * OBSERVE-ONLY BY DEFAULT (binding): the DEFAULT posture fixture carries
 * NO policy — "No restrictions are configured — nothing happens when you
 * miss a measurement" is the loudest, default truth. A configured-policy
 * fixture VARIANT exists to demonstrate the vocabulary; it is explicitly
 * labeled as a SYNTH fixture variant and is never the default.
 */

import type {
  AdherenceCapabilityId,
  AdherencePolicy,
  AdherenceState,
  AdherenceStateReason,
  EnforcementDecision,
  EnforcementRefusalReason,
  NoEnforcementReason,
  RestrictionDecision,
} from "@orbb/adherence";

// ---------------------------------------------------------------------------
// Runtime vocabulary mirrors (B10 closed sets — pinned by contract tests).
// ---------------------------------------------------------------------------

/** Mirror of the frozen `ADHERENCE_STATES` (`on-track | missed | recovered`). */
export const TODAY_ADHERENCE_STATES = ["on-track", "missed", "recovered"] as const;

/** Mirror of the frozen `ADHERENCE_CAPABILITY_IDS` (closed OS-surface set). */
export const TODAY_ADHERENCE_CAPABILITY_IDS = [
  "ios-focus",
  "android-usage-access",
] as const;

/** Mirror of the frozen `RESTRICTION_DECISION_KIND` discriminant literal. */
export const TODAY_RESTRICTION_DECISION_KIND =
  "orbb/adherence/restriction-decision/v1" as const;

/** Mirror of the recorded 24h maximum restriction duration. */
export const TODAY_MAX_RESTRICTION_DURATION_MS = 24 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Stored fixture records — the REAL B10 shapes.
// ---------------------------------------------------------------------------

/** A stored policy fixture: the REAL `AdherencePolicy` schema, verbatim. */
export type TodayAdherencePolicyFixture = AdherencePolicy;

/** A stored decision fixture: the REAL `EnforcementDecision` union. */
export type TodayEnforcementDecisionFixture = EnforcementDecision;

/** The REAL restriction token shape (wire-friendly: numbers and strings). */
export type TodayRestrictionDecisionFixture = RestrictionDecision;

// ---------------------------------------------------------------------------
// Wire views (client <-> /api/today/adherence).
// ---------------------------------------------------------------------------

/** The policy summary in wire form — every B10 schema field, verbatim. */
export interface TodayAdherencePolicyWire {
  readonly policyId: string;
  readonly version: number;
  readonly capability: AdherenceCapabilityId;
  /** Human label for the OS capability surface (display only). */
  readonly capabilityLabel: string;
  /** The LITERAL `"missed"` — the only legal trigger state. */
  readonly triggerOn: "missed";
  readonly authorization: {
    readonly permissions: readonly string[];
    readonly grantId?: string;
  };
  readonly scope: {
    readonly personIds?: readonly string[];
    readonly planIds?: readonly string[];
    readonly metricIds?: readonly string[];
  };
  readonly restriction: {
    readonly durationMs: number;
  };
  /** Display label, e.g. "2 hours (bounded — restrictions are at most 24 hours)". */
  readonly durationLabel: string;
}

/** The evaluation summary in wire form (PHID-safe: ids + vocabulary only). */
export interface TodayAdherenceEvaluationWire {
  readonly taskId: string;
  readonly state: AdherenceState;
  readonly reason: AdherenceStateReason;
  readonly evaluatedAtIso: string;
  readonly auditSteps: readonly { readonly step: string; readonly detail?: string }[];
}

/** The enforcement decision in wire form (the B10 vocabulary, text-carried). */
export interface TodayAdherenceDecisionWire {
  readonly kind: "no-enforcement" | "enforcement-refused" | "restriction-authorized";
  /** Present on no-enforcement / refused decisions (the typed reason). */
  readonly reason?: NoEnforcementReason | EnforcementRefusalReason;
  /** Human label, e.g. "Observe-only — nothing restrictive happens". */
  readonly decisionLabel: string;
  readonly evaluation: TodayAdherenceEvaluationWire;
  /** Present exactly on `restriction-authorized` (the bounded token). */
  readonly restriction?: {
    readonly kind: typeof TODAY_RESTRICTION_DECISION_KIND;
    readonly decisionId: string;
    readonly policyId: string;
    readonly policyVersion: number;
    readonly capability: AdherenceCapabilityId;
    readonly authorization: { readonly permission: string; readonly verifiedAtIso: string };
    readonly scope: {
      readonly personId: string;
      readonly planId: string;
      readonly metricId: string;
    };
    readonly detection: { readonly state: string; readonly reason?: string };
    readonly decidedAtIso: string;
    readonly expiresAtIso: string;
  };
  readonly auditSteps: readonly { readonly step: string; readonly detail?: string }[];
}

/**
 * The restriction-posture view — the provenance-style status surface's
 * payload. `variant` discriminates the DEFAULT observe-only posture from
 * the explicitly-labeled SYNTH configured-policy fixture variant.
 */
export interface TodayAdherencePostureWire {
  readonly variant: "observe-only" | "configured-policy";
  /** Variant display label (e.g. "Restriction posture: observe-only (the default)"). */
  readonly variantLabel: string;
  /** The LOUDEST default truth (shown first, always). */
  readonly defaultLine: string;
  readonly summaryLine: string;
  readonly decision: TodayAdherenceDecisionWire;
  /** Present exactly on the configured-policy variant (the policy summary). */
  readonly policy?: TodayAdherencePolicyWire;
}

/** `GET /api/today/adherence` response body. */
export interface TodayAdherenceResponse {
  readonly synthetic: true;
  readonly personId: string;
  /** The DEFAULT posture (observe-only — nothing is configured). */
  readonly posture: TodayAdherencePostureWire;
  /** The explicitly-labeled SYNTH configured-policy fixture variant. */
  readonly fixtureVariant: TodayAdherencePostureWire;
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Client-side payload guards (untrusted JSON from our own route).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type guard: is `payload` a successful adherence-posture response? */
export function isTodayAdherenceResponse(
  payload: unknown,
): payload is TodayAdherenceResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true || !isNonEmptyString(payload.personId)) {
    return false;
  }
  return isPlainObject(payload.posture) && isPlainObject(payload.fixtureVariant);
}
