/**
 * Seeded adherence catalog (M6 EXIT, Lane B): the SYNTH restriction-posture
 * fixtures — typed by the REAL `@orbb/adherence` (B10) shapes.
 *
 * TWO DETERMINISTIC FIXTURE WORLDS (the journey-#7 "only if configured"
 * leg, both honest and clearly separated):
 *
 *   1. THE DEFAULT (observe-only) — the loud, default truth: NO policy is
 *      configured. The decision for the missed task is
 *      `{ kind: "no-enforcement", reason: "no-policy" }` with the B10
 *      audit step vocabulary. Nothing restrictive happens, ever.
 *
 *   2. THE CONFIGURED-POLICY FIXTURE VARIANT — an explicitly-labeled SYNTH
 *      variant demonstrating the vocabulary when ALL B10 gates pass: an
 *      `AdherencePolicy` (fields verbatim from the frozen schema), an
 *      authorization grant affirmed at decision time, an available OS
 *      capability — minting a `restriction-authorized` decision with the
 *      bounded `RestrictionDecision` token. The variant is DATA for the
 *      provenance-style status surface; it is never the default posture
 *      and the surface labels it as a SYNTH fixture variant.
 *
 * RECORDED ASSUMPTIONS (each mirrors a frozen B10 decision):
 *   - The missed task evaluated is the seeded body-weight task (the B4
 *     missed-window fixture) — the same task the rung-2 reminder serves.
 *   - The evaluation/decision instant anchors to the miss-detection
 *     moment: the window end plus the B8 escalation grace (the instant
 *     the fallback-offer reminder fires) — deterministic per calendar
 *     day. The B10 engine reads the decision instant from the injected
 *     clock; anchoring it to the fixture's detection moment keeps the
 *     posture record replayable.
 *   - The configured variant's bounded restriction duration is 2 hours
 *     (well under the recorded 24h maximum — restrictions must be
 *     bounded to stay non-punitive).
 *   - `decisionId` mirrors the token's field with a deterministic
 *     SYNTH-marked stand-in (the B10 digest kernel is the engine's
 *     internal; at wiring the real token flows through this seam).
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; zero PHI; PHID-safe audit details (field paths and enum
 * outcomes only — the B10 discipline).
 */

import type {
  AdherenceEvaluation,
  AdherencePolicy,
  EnforcementDecision,
} from "@orbb/adherence";
import { TODAY_ESCALATION_GRACE_MS } from "../reminders/profile";
import { TODAY_PERSON_ID } from "../today/catalog";
import { TODAY_TASK_WEIGHT_ID, listTodayTaskRecords } from "../today/store";
import type { TodayTaskRecord } from "../today/types";

// Branded id types, derived from the REAL policy schema via indexed access
// (apps/web declares no @orbb/domain dependency; the schema-derived aliases
// keep the fixture literals pinned to the exact branded types).
type TodayPersonId = NonNullable<AdherencePolicy["scope"]["personIds"]>[number];
type TodayPlanId = NonNullable<AdherencePolicy["scope"]["planIds"]>[number];
type TodayGrantId = NonNullable<AdherencePolicy["authorization"]["grantId"]>;

// ---------------------------------------------------------------------------
// The configured-policy fixture (fields VERBATIM from the B10 schema).
// ---------------------------------------------------------------------------

/** The SYNTH policy id of the configured-policy fixture variant. */
export const TODAY_ADHERENCE_POLICY_ID = "SYNTH-policy-evening-focus-0001";

/** The pinned SYNTH access grant that authorizes the fixture policy. */
export const TODAY_ADHERENCE_GRANT_ID = "grant_SYNTH-adherence-demo-0001";

/** The permission the fixture policy requires (the B10 convention). */
export const TODAY_ADHERENCE_PERMISSION = "adherence:restrict:ios-focus";

/** The bounded restriction duration of the fixture policy: 2 hours. */
export const TODAY_ADHERENCE_RESTRICTION_MS = 2 * 60 * 60 * 1_000;

/** The plan the fixture policy is scoped to (the missed-weight plan). */
export const TODAY_ADHERENCE_POLICY_PLAN_ID = "plan_SYNTH-today-wt-mornings-0003";

/** The metric the fixture policy is scoped to. */
export const TODAY_ADHERENCE_POLICY_METRIC_ID = "SYNTH-metric-body-weight";

/**
 * The configured-policy fixture — an `AdherencePolicy` value with every
 * frozen field: closed-set capability, the literal `"missed"` trigger,
 * explicit authorization (permissions + pinned grant), an explicitly
 * scoped policy (person + plan + metric — no global catch-all), and a
 * bounded restriction. NOTE the absence (by design) of any punitive
 * construct: no streaks, no scores, no penalties, no escalation.
 */
export function todayConfiguredPolicyFixture(): AdherencePolicy {
  return {
    policyId: TODAY_ADHERENCE_POLICY_ID,
    version: 1,
    capability: "ios-focus",
    triggerOn: "missed",
    authorization: {
      permissions: [TODAY_ADHERENCE_PERMISSION],
      grantId: TODAY_ADHERENCE_GRANT_ID as TodayGrantId,
    },
    scope: {
      personIds: [TODAY_PERSON_ID as TodayPersonId],
      planIds: [TODAY_ADHERENCE_POLICY_PLAN_ID as TodayPlanId],
      metricIds: [TODAY_ADHERENCE_POLICY_METRIC_ID],
    },
    restriction: { durationMs: TODAY_ADHERENCE_RESTRICTION_MS },
  };
}

// ---------------------------------------------------------------------------
// The missed-task evaluation anchor (deterministic per calendar day).
// ---------------------------------------------------------------------------

/** Finds the seeded missed body-weight task record. */
export function findMissedWeightRecord(now: Date): TodayTaskRecord {
  const record = listTodayTaskRecords(now).find(
    (candidate) => candidate.task.id === TODAY_TASK_WEIGHT_ID,
  );
  if (record === undefined) {
    throw new Error("The seeded missed body-weight task fixture is missing.");
  }
  return record;
}

/**
 * The miss-detection instant: the window end plus the B8 escalation
 * grace (the moment the fallback-offer reminder fires — the coherent
 * detection anchor for the posture record).
 */
export function todayMissDetectionInstant(record: TodayTaskRecord): number {
  return record.task.window.endsAt.getTime() + TODAY_ESCALATION_GRACE_MS;
}

/**
 * The missed-task adherence evaluation — the B10 `AdherenceEvaluation`
 * shape with the engine's step vocabulary: open task, elapsed window
 * => state `missed`, reason `window-elapsed`.
 */
export function todayMissedEvaluationFixture(
  record: TodayTaskRecord,
): AdherenceEvaluation {
  return {
    taskId: record.task.id,
    state: "missed",
    reason: "window-elapsed",
    steps: [
      { step: "task-state", detail: "open" },
      { step: "window-elapsed-check", detail: "endsAt<=now" },
    ],
    evaluatedAtMs: todayMissDetectionInstant(record),
  };
}

// ---------------------------------------------------------------------------
// The two decision fixtures (REAL `EnforcementDecision` shapes).
// ---------------------------------------------------------------------------

/**
 * The DEFAULT decision: no policy is configured, so the engine's first
 * gate fails closed — `{ kind: "no-enforcement", reason: "no-policy" }`
 * with the B10 audit step vocabulary. This is the posture of record.
 */
export function todayDefaultDecisionFixture(
  record: TodayTaskRecord,
): EnforcementDecision {
  const evaluation = todayMissedEvaluationFixture(record);
  return {
    kind: "no-enforcement",
    reason: "no-policy",
    evaluation,
    audit: {
      decidedAtMs: evaluation.evaluatedAtMs,
      steps: [{ step: "policy-resolution", detail: "absent:policy" }],
    },
  };
}

/**
 * The configured-policy variant's decision: every B10 gate passes in
 * order (policy resolution -> trigger -> scope -> authorization grant ->
 * capability detection), minting the bounded `restriction-authorized`
 * token. The audit trail uses the engine's exact step vocabulary.
 */
export function todayConfiguredDecisionFixture(
  record: TodayTaskRecord,
): EnforcementDecision {
  const evaluation = todayMissedEvaluationFixture(record);
  const decidedAtMs = evaluation.evaluatedAtMs;
  const policy = todayConfiguredPolicyFixture();
  return {
    kind: "restriction-authorized",
    evaluation,
    decision: {
      kind: "orbb/adherence/restriction-decision/v1",
      decisionId: "SYNTH-DECISION-evening-focus-wt-0001",
      policyId: policy.policyId,
      policyVersion: policy.version,
      capability: policy.capability,
      authorization: {
        permission: TODAY_ADHERENCE_PERMISSION,
        verifiedAtMs: decidedAtMs,
      },
      evaluation: { state: evaluation.state, reason: evaluation.reason },
      scope: {
        personId: TODAY_PERSON_ID as TodayPersonId,
        planId: TODAY_ADHERENCE_POLICY_PLAN_ID as TodayPlanId,
        metricId: TODAY_ADHERENCE_POLICY_METRIC_ID,
      },
      detection: { state: "available" },
      decidedAtMs,
      expiresAtMs: decidedAtMs + policy.restriction.durationMs,
    },
    audit: {
      decidedAtMs,
      steps: [
        {
          step: "policy-resolution",
          detail: `${policy.policyId}:v${policy.version}:${policy.capability}`,
        },
        { step: "trigger-evaluation", detail: "state=missed" },
        { step: "scope-check", detail: "in-scope" },
        { step: "authorization-gate", detail: "authorized" },
        { step: "capability-detection", detail: "state=available" },
        { step: "restriction-authorized", detail: `${policy.capability}` },
      ],
    },
  };
}
