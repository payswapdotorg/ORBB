/**
 * B10 — The adherence enforcement engine (golden journey #7, Lane C
 * packet M6-B): the ONLY place a restriction decision can be minted.
 *
 * SAFETY POSTURE (binding): OBSERVE-ONLY BY DEFAULT. A missed task
 * records adherence state and NOTHING restrictive happens unless ALL of
 * the following hold, in this fixed order, each step audited:
 *
 *   1. POLICY RESOLUTION — the raw policy value resolves to an
 *      enforceable {@link AdherencePolicy}. Absent/malformed =>
 *      no-enforcement (fail-closed, mirrors the intents
 *      SafetyRuleEngine's "ESCALATE-never-publishes" discipline).
 *   2. TRIGGER EVALUATION — the adherence evaluation's state is the
 *      policy's `triggerOn` (only ever `"missed"`). `on-track` and
 *      `recovered` => no-enforcement: recovery is never punished.
 *   3. SCOPE CHECK — the policy's declared scope covers this
 *      (person, plan, metric). Out of scope => no-enforcement.
 *   4. AUTHORIZATION GATE — the INJECTED, consent/access-grant-shaped
 *      predicate affirms the requirement NOW, at decision time.
 *      Configured-but-unauthorized => a typed REFUSAL with an audit
 *      record (fail-closed: never a silent pass, never a restriction).
 *   5. CAPABILITY DETECTION — the injected prober reports the named OS
 *      capability `available`. Unavailable/needs-permission/needs-config
 *      => no-enforcement with the accounted detection reason (graceful
 *      degrade to observe-only). Authorization is checked BEFORE the
 *      capability so a broken capability can never mask a
 *      configured-but-unauthorized alarm.
 *   6. MINT — only then is a {@link RestrictionDecision} minted: a
 *      bounded, auditable, point-in-time token carrying the policy
 *      identity, the affirmed authorization, the triggering evaluation,
 *      the scope, and the expiry (`decidedAtMs + durationMs`).
 *
 * THE TOKEN DISCIPLINE: `RestrictionDecision` is constructible ONLY by
 * this engine — the package exports no standalone constructor for it —
 * and it is the ONLY value the platform capability adapters accept as
 * authorization to act (they refuse anything structurally forged).
 * Mirrors the M5-A "only PassOutcome carries publishable: true" proof
 * by construction.
 *
 * DETERMINISM: identical inputs (policy, evaluation, scope, gate and
 * prober responses, `nowMs`) produce identical decisions — including the
 * derived `decisionId` digest — across calls, instances, and processes
 * (proven by the determinism and cross-instantiation tests).
 */
import type { PersonId, PlanId } from "@orbb/domain";
import { canonicalJsonStringify, sha256Hex } from "./canonical.js";
import type {
  AdherenceAuthorizationGate,
  RestrictionAuthorizationRequest,
} from "./authorization.js";
import type { AdherenceEvaluation } from "./evaluation.js";
import {
  resolveAdherencePolicy,
  type AdherencePolicy,
  type ResolvedAdherencePolicy,
} from "./policy.js";
import type {
  AdherenceCapabilityId,
  AdherenceState,
  AdherenceStateReason,
  CapabilityDetectionReport,
  CapabilityDetectionState,
} from "./states.js";
import { isCapabilityDetectionState } from "./states.js";

// ---------------------------------------------------------------------------
// The restriction decision token.
// ---------------------------------------------------------------------------

/** Discriminant literal of {@link RestrictionDecision}. */
export const RESTRICTION_DECISION_KIND = "orbb/adherence/restriction-decision/v1" as const;

/**
 * THE restriction token: proof that an explicit, authorized, configured
 * policy decided to restrict one capability for one scope until one
 * expiry. Constructible ONLY by {@link AdherenceEnforcementEngine} —
 * this package exports no other constructor (mirrored structurally by
 * `packages/platform/src/adherence/capabilities.ts`, whose adapters
 * verify the full shape and refuse forgeries).
 */
export interface RestrictionDecision {
  readonly kind: typeof RESTRICTION_DECISION_KIND;
  /** Deterministic digest of the decision's semantic content. */
  readonly decisionId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly capability: AdherenceCapabilityId;
  readonly authorization: {
    /** The permission the gate affirmed. */
    readonly permission: string;
    /** Decision instant at which the gate affirmed it. */
    readonly verifiedAtMs: number;
  };
  readonly evaluation: {
    readonly state: AdherenceState;
    readonly reason: AdherenceStateReason;
  };
  readonly scope: {
    readonly personId: PersonId;
    readonly planId: PlanId;
    readonly metricId: string;
  };
  readonly detection: {
    readonly state: CapabilityDetectionState;
    readonly reason?: string;
  };
  readonly decidedAtMs: number;
  /** `decidedAtMs + policy.restriction.durationMs` — restrictions are bounded. */
  readonly expiresAtMs: number;
}

// ---------------------------------------------------------------------------
// The engine's decision vocabulary.
// ---------------------------------------------------------------------------

/** Why the engine degraded to observe-only (nothing restrictive happens). */
export type NoEnforcementReason =
  /** Policy value absent (null/undefined). */
  | "no-policy"
  /** Policy present but invalid (typed detail rides the audit trail). */
  | "policy-malformed"
  /** Evaluation state did not equal the policy trigger (on-track/recovered). */
  | "state-not-triggering"
  /** (person, plan, metric) outside the policy's declared scope. */
  | "out-of-scope"
  /** The named OS capability is not currently invocable (accounted state). */
  | "capability-unavailable";

/** Why the engine REFUSED (fail-closed — distinct from observe-only). */
export type EnforcementRefusalReason =
  /** The authorization gate denied the requirement at decision time. */
  | "not-authorized"
  /** The injected gate threw (broken dependency => never a restriction). */
  | "authorization-gate-error"
  /** The injected prober threw or reported an invalid detection shape. */
  | "capability-probe-error";

/** One ordered audit step of an enforcement decision. */
export interface AdherenceDecisionStep {
  /** Machine code of the step (e.g. "authorization-gate"). */
  readonly step: string;
  /** PHID-safe structural detail (field paths / enum outcomes only). */
  readonly detail?: string;
}

/** The audit trail every decision carries. */
export interface AdherenceDecisionAudit {
  readonly decidedAtMs: number;
  readonly steps: readonly AdherenceDecisionStep[];
}

export type EnforcementDecision =
  | {
      /** Nothing restrictive happens; the adherence state is still recorded. */
      readonly kind: "no-enforcement";
      readonly reason: NoEnforcementReason;
      readonly evaluation: AdherenceEvaluation;
      readonly audit: AdherenceDecisionAudit;
    }
  | {
      /** Fail-closed refusal of a configured restriction (never silent). */
      readonly kind: "enforcement-refused";
      readonly reason: EnforcementRefusalReason;
      readonly evaluation: AdherenceEvaluation;
      readonly audit: AdherenceDecisionAudit;
    }
  | {
      /** All gates passed; the token authorizes exactly one bounded restriction. */
      readonly kind: "restriction-authorized";
      readonly evaluation: AdherenceEvaluation;
      readonly decision: RestrictionDecision;
      readonly audit: AdherenceDecisionAudit;
    };

// ---------------------------------------------------------------------------
// The capability prober seam (platform adapters implement detection).
// ---------------------------------------------------------------------------

/**
 * The engine's view of capability detection (implemented structurally by
 * the platform seam's `AdherenceCapabilityAdapter.detect()`).
 */
export interface AdherenceCapabilityProber {
  detectionState(capability: AdherenceCapabilityId): Promise<CapabilityDetectionReport>;
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

/** Engine input: everything a decision depends on. */
export interface EnforcementEvaluationInput {
  /** The RAW policy value (config boundary — validated inside). */
  readonly policy: unknown;
  /** The adherence evaluation of the task (from `evaluateAdherenceSnapshot`). */
  readonly evaluation: AdherenceEvaluation;
  readonly personId: PersonId;
  readonly planId: PlanId;
  readonly metricId: string;
  /** Decision instant (UTC epoch ms, from the injected clock). */
  readonly nowMs: number;
}

/** Constructor deps (gate + prober; all injectable). */
export interface AdherenceEnforcementEngineDeps {
  readonly gate: AdherenceAuthorizationGate;
  readonly prober: AdherenceCapabilityProber;
}

/**
 * The adherence enforcement engine. One instance is a pure decision
 * pipeline over injected dependencies — no stores, no clock reads, no
 * OS calls of its own; the prober is the only OS-adjacent seam and it
 * reports detection state only.
 */
export class AdherenceEnforcementEngine {
  readonly #gate: AdherenceAuthorizationGate;
  readonly #prober: AdherenceCapabilityProber;

  constructor(deps: AdherenceEnforcementEngineDeps) {
    this.#gate = deps.gate;
    this.#prober = deps.prober;
  }

  /**
   * Evaluates one enforcement decision. Never throws; every degradation
   * path is a typed decision carrying the evaluation + an audit trail.
   */
  async evaluate(input: EnforcementEvaluationInput): Promise<EnforcementDecision> {
    const steps: AdherenceDecisionStep[] = [];

    // 1. Policy resolution (absent/malformed => no-enforcement).
    const resolved: ResolvedAdherencePolicy = resolveAdherencePolicy(input.policy);
    if (resolved.kind === "no-enforcement") {
      steps.push({
        step: "policy-resolution",
        detail: `${resolved.reason}:${resolved.detail?.field ?? "policy"}`,
      });
      return noEnforcement(
        resolved.reason === "absent" ? "no-policy" : "policy-malformed",
        input,
        steps,
      );
    }
    const policy = resolved.policy;
    steps.push({
      step: "policy-resolution",
      detail: `${policy.policyId}:v${policy.version}:${policy.capability}`,
    });

    // 2. Trigger evaluation (only "missed" can ever trigger).
    if (input.evaluation.state !== policy.triggerOn) {
      steps.push({
        step: "trigger-evaluation",
        detail: `state=${input.evaluation.state}`,
      });
      return noEnforcement("state-not-triggering", input, steps);
    }
    steps.push({ step: "trigger-evaluation", detail: "state=missed" });

    // 3. Scope check (person, plan, metric).
    if (!scopeCovers(policy, input)) {
      steps.push({ step: "scope-check", detail: "out-of-scope" });
      return noEnforcement("out-of-scope", input, steps);
    }
    steps.push({ step: "scope-check", detail: "in-scope" });

    // 4. Authorization gate, NOW, at decision time.
    const request: RestrictionAuthorizationRequest = {
      personId: input.personId,
      capability: policy.capability,
      permissions: policy.authorization.permissions,
      ...(policy.authorization.grantId !== undefined
        ? { grantId: policy.authorization.grantId }
        : {}),
    };
    let authorized: boolean;
    try {
      authorized = await this.#gate.isRestrictionAuthorized(request);
    } catch {
      steps.push({ step: "authorization-gate", detail: "error" });
      return refused("authorization-gate-error", input, steps);
    }
    if (!authorized) {
      steps.push({ step: "authorization-gate", detail: "denied" });
      return refused("not-authorized", input, steps);
    }
    steps.push({ step: "authorization-gate", detail: "authorized" });

    // 5. Capability detection (graceful degrade to observe-only).
    let detection: CapabilityDetectionReport;
    try {
      detection = await this.#prober.detectionState(policy.capability);
    } catch {
      steps.push({ step: "capability-detection", detail: "error" });
      return refused("capability-probe-error", input, steps);
    }
    if (!isCapabilityDetectionState(detection?.state)) {
      steps.push({ step: "capability-detection", detail: "invalid-report" });
      return refused("capability-probe-error", input, steps);
    }
    if (detection.state !== "available") {
      steps.push({
        step: "capability-detection",
        detail: `state=${detection.state}${detection.reason ? `:reason=${detection.reason}` : ""}`,
      });
      return noEnforcement("capability-unavailable", input, steps);
    }
    steps.push({ step: "capability-detection", detail: "state=available" });

    // 6. Mint the bounded, auditable restriction decision.
    const expiresAtMs = input.nowMs + policy.restriction.durationMs;
    const permission = policy.authorization.permissions[0] ?? "";
    const decision: RestrictionDecision = {
      kind: RESTRICTION_DECISION_KIND,
      decisionId: restrictionDecisionId({
        policyId: policy.policyId,
        policyVersion: policy.version,
        capability: policy.capability,
        permission,
        state: input.evaluation.state,
        reason: input.evaluation.reason,
        personId: input.personId,
        planId: input.planId,
        metricId: input.metricId,
        decidedAtMs: input.nowMs,
        expiresAtMs,
        detectionState: detection.state,
      }),
      policyId: policy.policyId,
      policyVersion: policy.version,
      capability: policy.capability,
      authorization: {
        permission,
        verifiedAtMs: input.nowMs,
      },
      evaluation: {
        state: input.evaluation.state,
        reason: input.evaluation.reason,
      },
      scope: {
        personId: input.personId,
        planId: input.planId,
        metricId: input.metricId,
      },
      detection,
      decidedAtMs: input.nowMs,
      expiresAtMs,
    };
    steps.push({ step: "restriction-authorized", detail: `${policy.capability}` });
    return {
      kind: "restriction-authorized",
      evaluation: input.evaluation,
      decision,
      audit: { decidedAtMs: input.nowMs, steps },
    };
  }
}

/**
 * Deterministic digest of an enforcement decision (canonical JSON +
 * SHA-256) — the replay/idempotency proof token for the determinism
 * tests.
 */
export function enforcementDecisionDigest(decision: EnforcementDecision): string {
  return sha256Hex(
    canonicalJsonStringify({
      kind: decision.kind,
      reason: "reason" in decision ? decision.reason : decision.decision.decisionId,
      policyId: "decision" in decision ? decision.decision.policyId : undefined,
      state: decision.evaluation.state,
      steps: decision.audit.steps,
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function scopeCovers(policy: AdherencePolicy, input: EnforcementEvaluationInput): boolean {
  const { personIds, planIds, metricIds } = policy.scope;
  if (personIds !== undefined && !(personIds as readonly string[]).includes(input.personId)) {
    return false;
  }
  if (planIds !== undefined && !(planIds as readonly string[]).includes(input.planId)) {
    return false;
  }
  if (metricIds !== undefined && !metricIds.includes(input.metricId)) {
    return false;
  }
  return true;
}

function restrictionDecisionId(parts: {
  policyId: string;
  policyVersion: number;
  capability: AdherenceCapabilityId;
  permission: string;
  state: AdherenceState;
  reason: AdherenceStateReason;
  personId: PersonId;
  planId: PlanId;
  metricId: string;
  decidedAtMs: number;
  expiresAtMs: number;
  detectionState: CapabilityDetectionState;
}): string {
  return sha256Hex(canonicalJsonStringify(parts));
}

function noEnforcement(
  reason: NoEnforcementReason,
  input: EnforcementEvaluationInput,
  steps: readonly AdherenceDecisionStep[],
): EnforcementDecision {
  return {
    kind: "no-enforcement",
    reason,
    evaluation: input.evaluation,
    audit: { decidedAtMs: input.nowMs, steps: [...steps] },
  };
}

function refused(
  reason: EnforcementRefusalReason,
  input: EnforcementEvaluationInput,
  steps: readonly AdherenceDecisionStep[],
): EnforcementDecision {
  return {
    kind: "enforcement-refused",
    reason,
    evaluation: input.evaluation,
    audit: { decidedAtMs: input.nowMs, steps: [...steps] },
  };
}
