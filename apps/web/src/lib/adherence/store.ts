/**
 * Adherence posture store (M6 EXIT, Lane B): the wire projections of the
 * SYNTH restriction-posture fixtures — the provenance-style status
 * surface's read model.
 *
 * Pure derivation (no module state): the posture views are computed from
 * the seeded missed-task record at read time, mirroring how the B10
 * engine derives its decision from (policy, evaluation, scope, gate,
 * prober, now). The DEFAULT posture is observe-only and carries NO
 * policy; the configured-policy fixture variant demonstrates the
 * `restriction-authorized` vocabulary behind an explicit label.
 *
 * NON-GAMIFICATION (binding, §Design system + AGENTS.md): the posture
 * vocabulary contains no streaks, scores, points, badges, levels,
 * penalties, or escalation constructs; states are text-carried, never
 * color alone; conservative clinical styling only. The default line is
 * the loudest truth on the surface.
 */

import type {
  AdherencePolicy,
  EnforcementDecision,
} from "@orbb/adherence";
import {
  findMissedWeightRecord,
  todayConfiguredDecisionFixture,
  todayConfiguredPolicyFixture,
  todayDefaultDecisionFixture,
  TODAY_ADHERENCE_POLICY_ID,
} from "./catalog";
import {
  TODAY_ADHERENCE_CAPABILITY_IDS,
  TODAY_MAX_RESTRICTION_DURATION_MS,
  TODAY_RESTRICTION_DECISION_KIND,
  type TodayAdherenceDecisionWire,
  type TodayAdherencePolicyWire,
  type TodayAdherencePostureWire,
} from "./types";

// ---------------------------------------------------------------------------
// Display labels (conservative clinical framing, never gamified).
// ---------------------------------------------------------------------------

/** The LOUDEST default truth — the work order's verbatim line. */
export const TODAY_ADHERENCE_DEFAULT_LINE =
  "No restrictions are configured — nothing happens when you miss a measurement.";

/** The honest disclaimer carried by the configured-policy fixture variant. */
export const TODAY_ADHERENCE_VARIANT_DISCLAIMER =
  "SYNTH fixture variant — demonstrates the vocabulary only. No policy is configured for you; nothing happens when you miss a measurement.";

/** Capability display labels (the closed OS-surface set). */
const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  "ios-focus": "iOS Focus (SYNTH OS seam)",
  "android-usage-access": "Android usage access (SYNTH OS seam)",
};

/** Formats a bounded duration honestly (never an open-ended promise). */
function durationLabelOf(durationMs: number): string {
  const hours = durationMs / 3_600_000;
  const unit = hours === 1 ? "hour" : "hours";
  return `${hours} ${unit} (bounded — restrictions are at most 24 hours)`;
}

// ---------------------------------------------------------------------------
// Wire projections (pure).
// ---------------------------------------------------------------------------

/** Projects the REAL policy schema into the wire view (fields verbatim). */
export function toTodayAdherencePolicyWire(
  policy: AdherencePolicy,
): TodayAdherencePolicyWire {
  return {
    policyId: policy.policyId,
    version: policy.version,
    capability: policy.capability,
    capabilityLabel: CAPABILITY_LABELS[policy.capability] ?? policy.capability,
    triggerOn: policy.triggerOn,
    authorization: {
      permissions: [...policy.authorization.permissions],
      ...(policy.authorization.grantId !== undefined
        ? { grantId: policy.authorization.grantId }
        : {}),
    },
    scope: {
      ...(policy.scope.personIds !== undefined
        ? { personIds: [...policy.scope.personIds] }
        : {}),
      ...(policy.scope.planIds !== undefined
        ? { planIds: [...policy.scope.planIds] }
        : {}),
      ...(policy.scope.metricIds !== undefined
        ? { metricIds: [...policy.scope.metricIds] }
        : {}),
    },
    restriction: { durationMs: policy.restriction.durationMs },
    durationLabel: durationLabelOf(policy.restriction.durationMs),
  };
}

/** The decision kind's human label (text-carried, never gamified). */
function decisionLabelOf(decision: EnforcementDecision): string {
  if (decision.kind === "restriction-authorized") {
    return "Restriction authorized — under an explicit, authorized, configured policy only";
  }
  if (decision.kind === "enforcement-refused") {
    return "Enforcement refused — configured but not authorized; nothing happens";
  }
  return "Observe-only — nothing restrictive happens";
}

/** Projects the REAL decision into the wire view (vocabulary verbatim). */
export function toTodayAdherenceDecisionWire(
  decision: EnforcementDecision,
): TodayAdherenceDecisionWire {
  const restriction =
    decision.kind === "restriction-authorized"
      ? {
          kind: TODAY_RESTRICTION_DECISION_KIND,
          decisionId: decision.decision.decisionId,
          policyId: decision.decision.policyId,
          policyVersion: decision.decision.policyVersion,
          capability: decision.decision.capability,
          authorization: {
            permission: decision.decision.authorization.permission,
            verifiedAtIso: new Date(
              decision.decision.authorization.verifiedAtMs,
            ).toISOString(),
          },
          scope: { ...decision.decision.scope },
          detection: { ...decision.decision.detection },
          decidedAtIso: new Date(decision.decision.decidedAtMs).toISOString(),
          expiresAtIso: new Date(decision.decision.expiresAtMs).toISOString(),
        }
      : undefined;
  return {
    kind: decision.kind,
    ...(decision.kind !== "restriction-authorized"
      ? { reason: decision.reason }
      : {}),
    decisionLabel: decisionLabelOf(decision),
    evaluation: {
      taskId: decision.evaluation.taskId,
      state: decision.evaluation.state,
      reason: decision.evaluation.reason,
      evaluatedAtIso: new Date(decision.evaluation.evaluatedAtMs).toISOString(),
      auditSteps: decision.evaluation.steps.map((step) => ({ ...step })),
    },
    ...(restriction !== undefined ? { restriction } : {}),
    auditSteps: decision.audit.steps.map((step) => ({ ...step })),
  };
}

/** The DEFAULT posture: observe-only, no policy, nothing configured. */
export function todayDefaultPosture(now: Date): TodayAdherencePostureWire {
  const record = findMissedWeightRecord(now);
  return {
    variant: "observe-only",
    variantLabel: "Restriction posture: observe-only (the default)",
    defaultLine: TODAY_ADHERENCE_DEFAULT_LINE,
    summaryLine:
      "Missing a measurement records adherence state and nothing else. A restriction can exist only under an explicit, authorized, configured policy — and none is configured.",
    decision: toTodayAdherenceDecisionWire(todayDefaultDecisionFixture(record)),
  };
}

/** The configured-policy fixture variant (explicitly labeled, never default). */
export function todayConfiguredPolicyVariant(
  now: Date,
): TodayAdherencePostureWire {
  const record = findMissedWeightRecord(now);
  return {
    variant: "configured-policy",
    variantLabel:
      "Restriction posture: configured policy (SYNTH fixture variant)",
    defaultLine: TODAY_ADHERENCE_VARIANT_DISCLAIMER,
    summaryLine:
      "What the posture looks like when every gate passes: an explicit policy, an authorization grant affirmed at decision time, an available OS capability — and a bounded restriction.",
    decision: toTodayAdherenceDecisionWire(todayConfiguredDecisionFixture(record)),
    policy: toTodayAdherencePolicyWire(todayConfiguredPolicyFixture()),
  };
}

// ---------------------------------------------------------------------------
// Store invariants (programming errors — the fixtures are typed data).
// ---------------------------------------------------------------------------

/**
 * Store invariants (the observe-only-by-default proof surface):
 *   - the DEFAULT posture is observe-only, carries NO policy, and its
 *     decision is `no-enforcement` / `no-policy` (fail-closed posture);
 *   - `restriction-authorized` appears ONLY on the configured variant,
 *     which carries BOTH a policy and an authorization record;
 *   - the policy fields are legal per the frozen B10 schema (closed-set
 *     capability, literal "missed" trigger, non-empty permissions,
 *     non-empty scope, bounded duration);
 *   - the decision audit steps use the B10 step vocabulary only;
 *   - the default line is the loudest truth on both variants (the
 *     variant carries the honest disclaimer);
 *   - every identity-like string is SYNTH-marked.
 */
export function assertTodayAdherenceStoreInvariants(now: Date): void {
  const posture = todayDefaultPosture(now);
  if (posture.variant !== "observe-only" || posture.policy !== undefined) {
    throw new Error("The default posture must be observe-only with NO policy.");
  }
  if (
    posture.decision.kind !== "no-enforcement" ||
    posture.decision.reason !== "no-policy"
  ) {
    throw new Error(
      "The default decision must be no-enforcement / no-policy (fail-closed).",
    );
  }
  if (posture.defaultLine !== TODAY_ADHERENCE_DEFAULT_LINE) {
    throw new Error("The default line must be the loudest, verbatim truth.");
  }

  const variant = todayConfiguredPolicyVariant(now);
  if (variant.variant !== "configured-policy" || variant.policy === undefined) {
    throw new Error("The configured variant must carry the policy summary.");
  }
  if (variant.decision.kind !== "restriction-authorized") {
    throw new Error(
      "The configured variant demonstrates the restriction-authorized vocabulary.",
    );
  }
  const policy = variant.policy;
  if (
    !(TODAY_ADHERENCE_CAPABILITY_IDS as readonly string[]).includes(
      policy.capability,
    ) ||
    policy.triggerOn !== "missed" ||
    policy.authorization.permissions.length === 0 ||
    (policy.scope.personIds ?? []).length +
      (policy.scope.planIds ?? []).length +
      (policy.scope.metricIds ?? []).length ===
      0 ||
    policy.restriction.durationMs < 1 ||
    policy.restriction.durationMs > TODAY_MAX_RESTRICTION_DURATION_MS
  ) {
    throw new Error("The fixture policy violates the frozen B10 schema bounds.");
  }
  if (!policy.policyId.startsWith("SYNTH-")) {
    throw new Error(`Policy id is not SYNTH-marked: ${policy.policyId}`);
  }
  const grantId = policy.authorization.grantId ?? "";
  if (!grantId.startsWith("grant_SYNTH-")) {
    throw new Error(`Grant id is not SYNTH-marked: ${grantId}`);
  }
  const restriction = variant.decision.restriction;
  if (
    restriction === undefined ||
    restriction.kind !== TODAY_RESTRICTION_DECISION_KIND ||
    restriction.policyId !== TODAY_ADHERENCE_POLICY_ID ||
    new Date(restriction.expiresAtIso).getTime() -
      new Date(restriction.decidedAtIso).getTime() !==
      policy.restriction.durationMs
  ) {
    throw new Error(
      "The restriction token must be bounded by the policy duration exactly.",
    );
  }

  const allowedSteps = new Set([
    "policy-resolution",
    "trigger-evaluation",
    "scope-check",
    "authorization-gate",
    "capability-detection",
    "restriction-authorized",
  ]);
  for (const decision of [posture.decision, variant.decision]) {
    for (const step of decision.auditSteps) {
      if (!allowedSteps.has(step.step)) {
        throw new Error(`Audit step outside the B10 vocabulary: ${step.step}`);
      }
    }
    if (decision.evaluation.state !== "missed") {
      throw new Error("The evaluated task must carry the missed state.");
    }
  }
}
