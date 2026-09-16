/**
 * Mobile restriction-posture view model (M6 EXIT, Lane B) — pure data +
 * pure functions, the mirror of the web
 * `apps/web/src/lib/adherence/{types,catalog,store}.ts` (same field-for-
 * field B10 vocabulary, same two fixture worlds).
 *
 * THE DEFAULT IS OBSERVE-ONLY (binding): no policy is configured —
 * "No restrictions are configured — nothing happens when you miss a
 * measurement." is the loudest, default truth. The configured-policy
 * fixture VARIANT demonstrates the `restriction-authorized` vocabulary
 * (explicit policy + authorization grant + bounded restriction) behind
 * an explicit SYNTH label; it is never the default posture.
 *
 * Why a local mirror (the `lib/reminders/model.ts` rationale):
 * `apps/mobile` declares only `@orbb/ui` as a workspace dependency —
 * recorded handoff: at engine wiring the mirrors swap for the real
 * `@orbb/adherence` exports with no call-site changes.
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; zero PHI (ids + vocabulary only — the B10 PHID-safe audit
 * discipline); deterministic per calendar day.
 */

import type { TodaySession, TodayTaskRecord } from "../today/model";
import { TODAY_ESCALATION_GRACE_MS } from "../reminders/model";

// ---------------------------------------------------------------------------
// The frozen B10 vocabulary mirrors (pinned by contract tests).
// ---------------------------------------------------------------------------

/** Mirror of the frozen `ADHERENCE_STATES`. */
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
// The two fixture worlds (the web catalog's mirror).
// ---------------------------------------------------------------------------

/** The SYNTH policy id of the configured-policy fixture variant. */
export const TODAY_ADHERENCE_POLICY_ID = "SYNTH-policy-evening-focus-0001";

/** The pinned SYNTH access grant that authorizes the fixture policy. */
export const TODAY_ADHERENCE_GRANT_ID = "grant_SYNTH-adherence-demo-0001";

/** The permission the fixture policy requires (the B10 convention). */
export const TODAY_ADHERENCE_PERMISSION = "adherence:restrict:ios-focus";

/** The bounded restriction duration of the fixture policy: 2 hours. */
export const TODAY_ADHERENCE_RESTRICTION_MS = 2 * 60 * 60 * 1_000;

/** The LOUDEST default truth — the work order's verbatim line. */
export const TODAY_ADHERENCE_DEFAULT_LINE =
  "No restrictions are configured — nothing happens when you miss a measurement.";

/** The honest disclaimer carried by the configured-policy fixture variant. */
export const TODAY_ADHERENCE_VARIANT_DISCLAIMER =
  "SYNTH fixture variant — demonstrates the vocabulary only. No policy is configured for you; nothing happens when you miss a measurement.";

// ---------------------------------------------------------------------------
// Wire views (the screen's render shapes).
// ---------------------------------------------------------------------------

/** The policy summary view — every B10 schema field, verbatim. */
export interface TodayAdherencePolicyView {
  readonly policyId: string;
  readonly version: number;
  readonly capability: string;
  readonly capabilityLabel: string;
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
  readonly restriction: { readonly durationMs: number };
  readonly durationLabel: string;
}

/** The enforcement decision view (the B10 vocabulary, text-carried). */
export interface TodayAdherenceDecisionView {
  readonly kind: "no-enforcement" | "enforcement-refused" | "restriction-authorized";
  readonly reason?: string;
  readonly decisionLabel: string;
  readonly evaluation: {
    readonly taskId: string;
    readonly state: string;
    readonly reason: string;
    readonly evaluatedAtIso: string;
  };
  readonly restriction?: {
    readonly kind: string;
    readonly decisionId: string;
    readonly policyId: string;
    readonly capability: string;
    readonly authorization: { readonly permission: string; readonly verifiedAtIso: string };
    readonly decidedAtIso: string;
    readonly expiresAtIso: string;
    readonly durationLabel: string;
  };
  readonly auditSteps: readonly { readonly step: string; readonly detail?: string }[];
}

/** The restriction-posture view (the authorization-status surface). */
export interface TodayAdherencePostureView {
  readonly variant: "observe-only" | "configured-policy";
  readonly variantLabel: string;
  readonly defaultLine: string;
  readonly summaryLine: string;
  readonly decision: TodayAdherenceDecisionView;
  readonly policy?: TodayAdherencePolicyView;
}

// ---------------------------------------------------------------------------
// Fixture derivation (pure, per session).
// ---------------------------------------------------------------------------

/** Finds the seeded missed body-weight task record of the session. */
export function findMissedWeightRecord(session: TodaySession): TodayTaskRecord {
  const record = session.tasks.find(
    (candidate) =>
      candidate.task.id === "task_SYNTH-today-wt-000003" && candidate.task.state === "open",
  );
  if (record === undefined) {
    throw new Error("The seeded missed body-weight task fixture is missing.");
  }
  return record;
}

/** The miss-detection instant (window end + escalation grace). */
export function todayMissDetectionInstant(record: TodayTaskRecord): number {
  return new Date(record.task.window.endsAt).getTime() + TODAY_ESCALATION_GRACE_MS;
}

/** Formats a bounded duration honestly (never an open-ended promise). */
function durationLabelOf(durationMs: number): string {
  const hours = durationMs / 3_600_000;
  const unit = hours === 1 ? "hour" : "hours";
  return `${hours} ${unit} (bounded — restrictions are at most 24 hours)`;
}

/**
 * The DEFAULT posture: observe-only, no policy, the fail-closed
 * no-enforcement / no-policy decision for the missed task.
 */
export function todayDefaultPosture(session: TodaySession): TodayAdherencePostureView {
  const record = findMissedWeightRecord(session);
  const decidedAtMs = todayMissDetectionInstant(record);
  return {
    variant: "observe-only",
    variantLabel: "Restriction posture: observe-only (the default)",
    defaultLine: TODAY_ADHERENCE_DEFAULT_LINE,
    summaryLine:
      "Missing a measurement records adherence state and nothing else. A restriction can exist only under an explicit, authorized, configured policy — and none is configured.",
    decision: {
      kind: "no-enforcement",
      reason: "no-policy",
      decisionLabel: "Observe-only — nothing restrictive happens",
      evaluation: {
        taskId: record.task.id,
        state: "missed",
        reason: "window-elapsed",
        evaluatedAtIso: new Date(decidedAtMs).toISOString(),
      },
      auditSteps: [{ step: "policy-resolution", detail: "absent:policy" }],
    },
  };
}

/**
 * The configured-policy fixture variant (explicitly labeled, never the
 * default): every B10 gate passes — explicit policy, authorization grant
 * affirmed at decision time, available OS capability — minting the
 * bounded restriction-authorized token.
 */
export function todayConfiguredPolicyVariant(
  session: TodaySession,
): TodayAdherencePostureView {
  const record = findMissedWeightRecord(session);
  const decidedAtMs = todayMissDetectionInstant(record);
  return {
    variant: "configured-policy",
    variantLabel: "Restriction posture: configured policy (SYNTH fixture variant)",
    defaultLine: TODAY_ADHERENCE_VARIANT_DISCLAIMER,
    summaryLine:
      "What the posture looks like when every gate passes: an explicit policy, an authorization grant affirmed at decision time, an available OS capability — and a bounded restriction.",
    decision: {
      kind: "restriction-authorized",
      decisionLabel:
        "Restriction authorized — under an explicit, authorized, configured policy only",
      evaluation: {
        taskId: record.task.id,
        state: "missed",
        reason: "window-elapsed",
        evaluatedAtIso: new Date(decidedAtMs).toISOString(),
      },
      restriction: {
        kind: TODAY_RESTRICTION_DECISION_KIND,
        decisionId: "SYNTH-DECISION-evening-focus-wt-0001",
        policyId: TODAY_ADHERENCE_POLICY_ID,
        capability: "ios-focus",
        authorization: {
          permission: TODAY_ADHERENCE_PERMISSION,
          verifiedAtIso: new Date(decidedAtMs).toISOString(),
        },
        decidedAtIso: new Date(decidedAtMs).toISOString(),
        expiresAtIso: new Date(decidedAtMs + TODAY_ADHERENCE_RESTRICTION_MS).toISOString(),
        durationLabel: durationLabelOf(TODAY_ADHERENCE_RESTRICTION_MS),
      },
      auditSteps: [
        { step: "policy-resolution", detail: `${TODAY_ADHERENCE_POLICY_ID}:v1:ios-focus` },
        { step: "trigger-evaluation", detail: "state=missed" },
        { step: "scope-check", detail: "in-scope" },
        { step: "authorization-gate", detail: "authorized" },
        { step: "capability-detection", detail: "state=available" },
        { step: "restriction-authorized", detail: "ios-focus" },
      ],
    },
    policy: {
      policyId: TODAY_ADHERENCE_POLICY_ID,
      version: 1,
      capability: "ios-focus",
      capabilityLabel: "iOS Focus (SYNTH OS seam)",
      triggerOn: "missed",
      authorization: {
        permissions: [TODAY_ADHERENCE_PERMISSION],
        grantId: TODAY_ADHERENCE_GRANT_ID,
      },
      scope: {
        personIds: ["prsn_SYNTH-person-0001"],
        planIds: ["plan_SYNTH-today-wt-mornings-0003"],
        metricIds: ["SYNTH-metric-body-weight"],
      },
      restriction: { durationMs: TODAY_ADHERENCE_RESTRICTION_MS },
      durationLabel: durationLabelOf(TODAY_ADHERENCE_RESTRICTION_MS),
    },
  };
}

// ---------------------------------------------------------------------------
// Model invariants (programming errors — the fixtures are typed data).
// ---------------------------------------------------------------------------

/**
 * Model invariants: the default is observe-only with NO policy and a
 * no-enforcement/no-policy decision; `restriction-authorized` appears
 * only on the configured variant, which carries both a policy and an
 * authorization record; the policy fields are legal per the frozen B10
 * schema; the audit steps use the B10 vocabulary only.
 */
export function assertTodayAdherenceModelInvariants(session: TodaySession): void {
  const posture = todayDefaultPosture(session);
  if (posture.variant !== "observe-only" || posture.policy !== undefined) {
    throw new Error("The default posture must be observe-only with NO policy.");
  }
  if (
    posture.decision.kind !== "no-enforcement" ||
    posture.decision.reason !== "no-policy"
  ) {
    throw new Error("The default decision must be no-enforcement / no-policy.");
  }

  const variant = todayConfiguredPolicyVariant(session);
  if (variant.variant !== "configured-policy" || variant.policy === undefined) {
    throw new Error("The configured variant must carry the policy summary.");
  }
  if (variant.decision.kind !== "restriction-authorized") {
    throw new Error("The configured variant demonstrates restriction-authorized.");
  }
  const policy = variant.policy;
  if (
    !(TODAY_ADHERENCE_CAPABILITY_IDS as readonly string[]).includes(policy.capability) ||
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
  const restriction = variant.decision.restriction;
  if (
    restriction === undefined ||
    restriction.kind !== TODAY_RESTRICTION_DECISION_KIND ||
    new Date(restriction.expiresAtIso).getTime() -
      new Date(restriction.decidedAtIso).getTime() !==
      policy.restriction.durationMs
  ) {
    throw new Error("The restriction token must be bounded exactly.");
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
  }
}
