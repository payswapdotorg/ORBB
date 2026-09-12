/**
 * A41 — SafetyRuleEngine: the safety/escalation gate of the intent
 * compiler pipeline (architecture §4 + §8, M5 milestone, Lane A packet
 * M5-B).
 *
 * An ORDERED, DETERMINISTIC rule set evaluated over candidate plans:
 *   - max-measurements-per-day guard (metric-agnostic burden guard),
 *   - min-gap-between-metrics (declared pairs; density analysis),
 *   - forbidden metric combinations (declared pairs),
 *   - cadence floor/ceiling per metric domain.
 * Outcomes per candidate: PASS | ESCALATE(reason codes, human review
 * required) | REJECT(typed reason). Rules are DATA — a frozen default
 * table (`DEFAULT_SAFETY_RULE_TABLE`) evaluated by ONE pure function
 * (`evaluateSafetyCandidate`); the engine class only injects the table.
 * Every outcome carries the rule id + the inputs that fired.
 *
 * SAFETY RULES ARE DETERMINISTIC CODE PATHS, NEVER AI CALLS (§8): the
 * rule table is declarative data and the evaluator is a pure function —
 * there is no model, network, or probabilistic step anywhere in this
 * module. The AI proposal service (M5-C) sits behind an interface far
 * upstream of this gate.
 *
 * ESCALATION IS A TYPED OUTCOME, NOT AN EXCEPTION (§8): an
 * {@link EscalateOutcome} is a first-class value that REQUIRES the
 * human-review workflow. The invariant "an ESCALATE candidate can NEVER
 * be published without the review workflow (M5-C)" is ENCODED IN THE
 * OUTCOME TYPE: only {@link PassOutcome} carries the literal
 * `publishable: true`; {@link EscalateOutcome} carries the literals
 * `requiresHumanReview: true` / `publishable: false`, and this package
 * exports NO function that converts an EscalateOutcome into a
 * publishable state (the review workflow owns that transition; the
 * type-level guard `isPublishableOutcome` narrows to PassOutcome only).
 *
 * DETERMINISM AND PURITY: evaluation reads ONLY its inputs — the
 * candidate and the rule table. No ambient state, no I/O, no clock, no
 * randomness. Rules are evaluated strictly in TABLE ORDER; fired-rule
 * records are collected in table order (cadence-bound rules append one
 * record per offending assignment, in candidate assignment order).
 * Outcomes for a batch (`evaluateAll`) preserve candidate input order.
 * Identical inputs always produce identical outputs (asserted via
 * `serializeSafetyOutcomes` + `hashSafetyOutcomes`).
 *
 * RECORDED DECISIONS (genuinely unspecified points; architecture-consistent
 * choices made here for tech-lead review):
 *   - VIOLATION OUTCOME PER RULE IS TABLE DATA: each rule declares
 *     `onViolation: "reject" | "escalate"`. The frozen DEFAULT table
 *     maps: max-measurements-per-day exceeded -> REJECT (a hard
 *     over-burden guard); forbidden metric combination -> REJECT (a
 *     declared hard stop); cadence above a domain ceiling -> REJECT
 *     (over-measurement guard); cadence below a domain floor ->
 *     ESCALATE (insufficient cadence is a clinical-judgment call a
 *     reviewer may legitimately accept); min-gap violated -> ESCALATE
 *     (timing feasibility needs human adjudication). A REJECT outcome's
 *     typed reason is the code of the FIRST reject-violating rule in
 *     table order; ALL fired rules (escalate ones included) ride on the
 *     outcome as audit records.
 *   - MIN-GAP-BETWEEN-METRICS SEMANTICS (density bound): candidates are
 *     prospective cadence plans, not schedules; the rule asks whether
 *     ANY schedule could keep the two metrics' measurements at least
 *     `minGapHours` apart. With the more-frequent metric measured
 *     `m` times/day evenly, every other measurement lands within
 *     `12 / m` hours of a frequent-metric measurement (nearest-point-on-
 *     grid bound; achievable by midpoint phasing) — so the best
 *     achievable minimum A-B gap is exactly `12 / max(cadenceA,
 *     cadenceB)` hours. The rule fires iff that bound is BELOW
 *     `minGapHours` (NO schedule can honor the gap). The bound is part
 *     of the fired-rule inputs (audit).
 *   - "METRIC DOMAIN" = the metric's declared grouping label (the
 *     domain `MetricDefinition.category`, e.g. "vital-signs"). The
 *     safety candidate carries `domain` per assignment explicitly, so
 *     the rule table keys cadence bounds by domain without importing
 *     the metric catalog. Metrics whose domain has no table entry pass
 *     the cadence rules (rules are data; only declared domains are
 *     checked — recorded).
 *   - DEFAULT TABLE VALUES are recorded assumptions pending clinical
 *     review: max 12 measurements/day total (generous guard: e.g. CGM
 *     6 + BP 3 + weight 1 + sleep 1 + activity 1); cadence bounds for
 *     the four seeded metric categories — vital-signs floor 1/day,
 *     ceiling 4/day; body-composition floor 1/7 per day (weekly),
 *     ceiling 2/day; activity floor 1/day, ceiling 24/day; sleep floor
 *     1/day, ceiling 4/day; NO declared pairs ship by default (metric
 *     ids are deployment-specific opaque strings — declaring a pair in
 *     a frozen default would be unsafe; deny-by-default: no pair is
 *     forbidden or gap-constrained until declared).
 *   - Expected rejections are TYPED RESULTS (never throws). Error
 *     payloads are PHID-safe: structural context only. OUTCOMES carry
 *     metric ids and rule inputs — they are explainability artifacts,
 *     mirroring the M5-A explainability discipline.
 */
import { canonicalJsonStringify, sha256Hex } from "./canonical.js";
import { err, ok, type IntentResult } from "./result.js";
import type { MatchableCandidate } from "./matcher.js";
import type { PlanCandidateLike } from "./optimizer.js";

/**
 * `Array.isArray` narrows `readonly T[]` to `any[]` (TS intersection with
 * `any[]`), silently de-typing downstream code; this predicate narrows to
 * `readonly unknown[]` instead, which intersects correctly. Local helper —
 * mirrors the private guard pattern of the sibling M5-A modules.
 */
function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Rule vocabulary.
// ---------------------------------------------------------------------------

/** The five rule kinds the engine evaluates (packet A41). */
export const SAFETY_RULE_KINDS = [
  "max-measurements-per-day",
  "min-gap-between-metrics",
  "forbidden-metric-combination",
  "cadence-floor",
  "cadence-ceiling",
] as const;

export type SafetyRuleKind = (typeof SAFETY_RULE_KINDS)[number];

/** What a rule's violation produces: a typed rejection or an escalation. */
export const RULE_VIOLATION_OUTCOMES = ["reject", "escalate"] as const;

export type RuleViolationOutcome = (typeof RULE_VIOLATION_OUTCOMES)[number];

/** Type guard: is `value` a rule violation outcome? */
export function isRuleViolationOutcome(value: unknown): value is RuleViolationOutcome {
  return (
    typeof value === "string" &&
    (RULE_VIOLATION_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * One rule — DATA, not code. Rules are evaluated strictly in table
 * order by the single pure function {@link evaluateSafetyCandidate}.
 */
export type SafetyRule =
  | {
      readonly kind: "max-measurements-per-day";
      readonly ruleId: string;
      /** Total measurements per day across ALL candidate metrics. */
      readonly maxPerDay: number;
      readonly onViolation: RuleViolationOutcome;
    }
  | {
      readonly kind: "min-gap-between-metrics";
      readonly ruleId: string;
      readonly metricA: string;
      readonly metricB: string;
      /** Minimum hours that must be kept between A and B measurements. */
      readonly minGapHours: number;
      readonly onViolation: RuleViolationOutcome;
    }
  | {
      readonly kind: "forbidden-metric-combination";
      readonly ruleId: string;
      readonly metricA: string;
      readonly metricB: string;
      readonly onViolation: RuleViolationOutcome;
    }
  | {
      readonly kind: "cadence-floor";
      readonly ruleId: string;
      /** Metric domain (the metric's category label) the bound applies to. */
      readonly domain: string;
      /** Minimum measurements per day for metrics of this domain. */
      readonly floorPerDay: number;
      readonly onViolation: RuleViolationOutcome;
    }
  | {
      readonly kind: "cadence-ceiling";
      readonly ruleId: string;
      readonly domain: string;
      /** Maximum measurements per day for metrics of this domain. */
      readonly ceilingPerDay: number;
      readonly onViolation: RuleViolationOutcome;
    };

/** An ORDERED rule table (evaluation order = table order). */
export interface SafetyRuleTable {
  readonly rules: readonly SafetyRule[];
}

/**
 * The frozen DEFAULT safety rule table (values are recorded assumptions
 * pending clinical review — see the module header). Metric-agnostic
 * guard first (deterministic REJECT reason precedence), then declared
 * pairs (none by default), then per-domain cadence bounds for the four
 * seeded metric categories.
 */
export const DEFAULT_SAFETY_RULE_TABLE: SafetyRuleTable = {
  rules: [
    {
      kind: "max-measurements-per-day",
      ruleId: "safety/max-measurements-per-day/v1",
      maxPerDay: 12,
      onViolation: "reject",
    },
    {
      kind: "cadence-floor",
      ruleId: "safety/cadence-floor/vital-signs/v1",
      domain: "vital-signs",
      floorPerDay: 1,
      onViolation: "escalate",
    },
    {
      kind: "cadence-ceiling",
      ruleId: "safety/cadence-ceiling/vital-signs/v1",
      domain: "vital-signs",
      ceilingPerDay: 4,
      onViolation: "reject",
    },
    {
      kind: "cadence-floor",
      ruleId: "safety/cadence-floor/body-composition/v1",
      domain: "body-composition",
      floorPerDay: 1 / 7,
      onViolation: "escalate",
    },
    {
      kind: "cadence-ceiling",
      ruleId: "safety/cadence-ceiling/body-composition/v1",
      domain: "body-composition",
      ceilingPerDay: 2,
      onViolation: "reject",
    },
    {
      kind: "cadence-floor",
      ruleId: "safety/cadence-floor/activity/v1",
      domain: "activity",
      floorPerDay: 1,
      onViolation: "escalate",
    },
    {
      kind: "cadence-ceiling",
      ruleId: "safety/cadence-ceiling/activity/v1",
      domain: "activity",
      ceilingPerDay: 24,
      onViolation: "reject",
    },
    {
      kind: "cadence-floor",
      ruleId: "safety/cadence-floor/sleep/v1",
      domain: "sleep",
      floorPerDay: 1,
      onViolation: "escalate",
    },
    {
      kind: "cadence-ceiling",
      ruleId: "safety/cadence-ceiling/sleep/v1",
      domain: "sleep",
      ceilingPerDay: 4,
      onViolation: "reject",
    },
  ],
};

// ---------------------------------------------------------------------------
// Safety candidates (thin local shape over any compatible producer).
// ---------------------------------------------------------------------------

/** One metric a candidate commits to measure, with cadence + domain. */
export interface SafetyMetricAssignment {
  readonly metricId: string;
  /** Metric domain (the metric's category label; table key for bounds). */
  readonly domain: string;
  /** Proposed measurements per day (finite, > 0; fractional allowed). */
  readonly cadencePerDay: number;
}

/**
 * The candidate shape the safety engine evaluates — a THIN LOCAL
 * INTERFACE (the M5-B contract seam). Cadence and domain are
 * prospective plan properties the M5-A `PlanCandidate` does not carry;
 * integration supplies them from the goal's cadence constraints or
 * method defaults (handoff recorded in src/index.ts).
 */
export interface SafetyCandidate {
  readonly candidateId: string;
  /** Non-empty; unique metric ids. */
  readonly assignments: readonly SafetyMetricAssignment[];
}

/** Per-metric metadata the safety adapters consume. */
export interface SafetyMetricMetadata {
  readonly domain: string;
  readonly cadencePerDay: number;
}

/** Typed reason a safety adaptation was rejected (PHID-safe). */
export type SafetyAdaptationError =
  | { readonly kind: "invalid-candidate" }
  | { readonly kind: "missing-metric-metadata"; readonly metricIndex: number }
  | { readonly kind: "invalid-metric-metadata"; readonly metricIndex: number };

/**
 * Adapts a {@link MatchableCandidate} (A40 output or the M5-A
 * projection) into a {@link SafetyCandidate} using a per-metric
 * metadata lookup (domain + cadence). Deny-by-default: a metric without
 * metadata, or malformed metadata, is a typed rejection.
 */
export function safetyCandidateFromMatchable(
  candidate: MatchableCandidate,
  metadataOf: (metricId: string) => SafetyMetricMetadata | undefined,
): IntentResult<SafetyCandidate, SafetyAdaptationError> {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.candidateId !== "string" ||
    candidate.candidateId.length === 0 ||
    !isReadonlyArray(candidate.metricMethods) ||
    candidate.metricMethods.length === 0
  ) {
    return err({ kind: "invalid-candidate" });
  }
  const assignments: SafetyMetricAssignment[] = [];
  for (const [metricIndex, assignment] of candidate.metricMethods.entries()) {
    const metadata = metadataOf(assignment.metricId);
    if (metadata === undefined) {
      return err({ kind: "missing-metric-metadata", metricIndex });
    }
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      typeof metadata.domain !== "string" ||
      metadata.domain.length === 0 ||
      typeof metadata.cadencePerDay !== "number" ||
      !Number.isFinite(metadata.cadencePerDay) ||
      metadata.cadencePerDay <= 0
    ) {
      return err({ kind: "invalid-metric-metadata", metricIndex });
    }
    assignments.push({
      metricId: assignment.metricId,
      domain: metadata.domain,
      cadencePerDay: metadata.cadencePerDay,
    });
  }
  return ok({ candidateId: candidate.candidateId, assignments });
}

/**
 * Adapts an M5-A `PlanCandidate` (structurally:
 * {@link PlanCandidateLike}) into a {@link SafetyCandidate} using a
 * per-metric metadata lookup. Convenience over
 * {@link safetyCandidateFromMatchable} for direct compiler output.
 */
export function safetyCandidateFromPlanCandidate(
  candidate: PlanCandidateLike,
  metadataOf: (metricId: string) => SafetyMetricMetadata | undefined,
): IntentResult<SafetyCandidate, SafetyAdaptationError> {
  return safetyCandidateFromMatchable(
    {
      candidateId: candidate.plan.id,
      metricMethods: [
        { metricId: candidate.metricId, methodIds: [...candidate.methodOrder] },
      ],
    },
    metadataOf,
  );
}

// ---------------------------------------------------------------------------
// Outcomes (the ESCALATE-never-publishes invariant is type-encoded).
// ---------------------------------------------------------------------------

/** Stable per-rule-kind code carried by fired records and verdicts. */
export type SafetyRuleCode =
  | "exceeds-max-measurements-per-day"
  | "min-gap-between-metrics"
  | "forbidden-metric-combination"
  | "cadence-below-floor"
  | "cadence-above-ceiling";

/** The offending inputs of one fired rule (audit; ids allowed — explainability). */
export type FiredRuleInputs =
  | {
      readonly kind: "max-measurements-per-day";
      readonly totalPerDay: number;
      readonly maxPerDay: number;
    }
  | {
      readonly kind: "min-gap-between-metrics";
      readonly metricA: string;
      readonly metricB: string;
      readonly cadenceAPerDay: number;
      readonly cadenceBPerDay: number;
      readonly bestAchievableMinGapHours: number;
      readonly minGapHours: number;
    }
  | {
      readonly kind: "forbidden-metric-combination";
      readonly metricA: string;
      readonly metricB: string;
    }
  | {
      readonly kind: "cadence-floor";
      readonly metricId: string;
      readonly domain: string;
      readonly cadencePerDay: number;
      readonly floorPerDay: number;
    }
  | {
      readonly kind: "cadence-ceiling";
      readonly metricId: string;
      readonly domain: string;
      readonly cadencePerDay: number;
      readonly ceilingPerDay: number;
    };

/** One rule that fired: its id, kind, code, outcome, and inputs. */
export interface FiredRuleRecord {
  readonly ruleId: string;
  readonly ruleKind: SafetyRuleKind;
  readonly code: SafetyRuleCode;
  readonly onViolation: RuleViolationOutcome;
  readonly inputs: FiredRuleInputs;
}

/** PASS: no rule fired. Publishable (via the standard review flow). */
export interface PassOutcome {
  readonly kind: "PASS";
  readonly candidateId: string;
  /** Literal false: no MANDATORY human-review gate attaches to a PASS. */
  readonly requiresHumanReview: false;
  /** Literal true: only PASS may ever be published. */
  readonly publishable: true;
  /** Every fired rule — always empty on PASS (uniform audit field). */
  readonly firedRules: readonly FiredRuleRecord[];
  /** Every rule consulted, in table order (audit of what was checked). */
  readonly evaluatedRuleIds: readonly string[];
}

/**
 * ESCALATE: at least one rule fired with `onViolation: "escalate"` (and
 * none with "reject"). INVARIANT (type-encoded): an ESCALATE verdict can
 * NEVER be published without the human-review workflow (M5-C) —
 * `requiresHumanReview: true` and `publishable: false` are LITERAL
 * types, and this package exports no conversion to a publishable
 * state. The review workflow owns that transition.
 */
export interface EscalateOutcome {
  readonly kind: "ESCALATE";
  readonly candidateId: string;
  /** Literal true: the MANDATORY human-review gate (type-encoded). */
  readonly requiresHumanReview: true;
  /** Literal false: not publishable absent review approval (type-encoded). */
  readonly publishable: false;
  /** Ordered unique codes of the fired escalate rules. */
  readonly reasonCodes: readonly SafetyRuleCode[];
  /** Every fired rule (audit), in table order. */
  readonly firedRules: readonly FiredRuleRecord[];
  /** Every rule consulted, in table order. */
  readonly evaluatedRuleIds: readonly string[];
}

/** REJECT: at least one rule fired with `onViolation: "reject"`. */
export interface RejectOutcome {
  readonly kind: "REJECT";
  readonly candidateId: string;
  readonly requiresHumanReview: false;
  readonly publishable: false;
  /** Typed reason: the code of the FIRST reject-violating rule in table order. */
  readonly reason: SafetyRuleCode;
  /** Every fired rule (escalate ones included — audit), in table order. */
  readonly firedRules: readonly FiredRuleRecord[];
  /** Every rule consulted, in table order. */
  readonly evaluatedRuleIds: readonly string[];
}

/** The safety verdict of one candidate. */
export type SafetyOutcome = PassOutcome | EscalateOutcome | RejectOutcome;

/**
 * Type-level guard for the publish path: narrows to PASS ONLY. An
 * ESCALATE (or REJECT) outcome never satisfies this guard — the
 * compiler enforces the "escalations are never published without the
 * review workflow" invariant at every call site.
 */
export function isPublishableOutcome(
  outcome: SafetyOutcome,
): outcome is PassOutcome {
  return outcome.kind === "PASS";
}

// ---------------------------------------------------------------------------
// Typed evaluation rejections (PHID-safe: structural context only).
// ---------------------------------------------------------------------------

/** Typed reason one rule was malformed. */
export type InvalidSafetyRuleReason =
  | "invalid-rule-id"
  | "invalid-rule-kind"
  | "invalid-rule-params"
  | "invalid-violation-outcome"
  | "same-metric-pair";

/** Typed reason one candidate was malformed. */
export type InvalidSafetyCandidateReason =
  | "invalid-candidate-id"
  | "no-assignments"
  | "invalid-assignment"
  | "duplicate-metric-assignment"
  | "invalid-domain"
  | "invalid-cadence";

/** Typed safety-evaluation rejections — never thrown, always a result. */
export type SafetyEvaluationError =
  | { readonly kind: "invalid-rule-table" }
  | { readonly kind: "invalid-rule"; readonly ruleIndex: number; readonly reason: InvalidSafetyRuleReason }
  | { readonly kind: "duplicate-rule-id"; readonly ruleIndex: number }
  | { readonly kind: "invalid-candidates" }
  | { readonly kind: "invalid-candidate"; readonly candidateIndex: number; readonly reason: InvalidSafetyCandidateReason };

// ---------------------------------------------------------------------------
// The one pure evaluation function.
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateRule(rule: SafetyRule): InvalidSafetyRuleReason | undefined {
  if (typeof rule !== "object" || rule === null) {
    return "invalid-rule-id";
  }
  if (!isNonEmptyString(rule.ruleId)) {
    return "invalid-rule-id";
  }
  if (!isRuleKindMember(rule.kind)) {
    return "invalid-rule-kind";
  }
  if (!isRuleViolationOutcome(rule.onViolation)) {
    return "invalid-violation-outcome";
  }
  switch (rule.kind) {
    case "max-measurements-per-day":
      if (!Number.isFinite(rule.maxPerDay) || rule.maxPerDay <= 0) {
        return "invalid-rule-params";
      }
      return undefined;
    case "min-gap-between-metrics":
    case "forbidden-metric-combination":
      if (!isNonEmptyString(rule.metricA) || !isNonEmptyString(rule.metricB)) {
        return "invalid-rule-params";
      }
      if (rule.metricA === rule.metricB) {
        return "same-metric-pair";
      }
      if (rule.kind === "min-gap-between-metrics" &&
        (!Number.isFinite(rule.minGapHours) || rule.minGapHours <= 0)) {
        return "invalid-rule-params";
      }
      return undefined;
    case "cadence-floor":
    case "cadence-ceiling": {
      const bound = rule.kind === "cadence-floor" ? rule.floorPerDay : rule.ceilingPerDay;
      if (!isNonEmptyString(rule.domain)) {
        return "invalid-rule-params";
      }
      if (!Number.isFinite(bound) || bound <= 0) {
        return "invalid-rule-params";
      }
      return undefined;
    }
  }
}

function isRuleKindMember(value: unknown): value is SafetyRuleKind {
  return (
    typeof value === "string" &&
    (SAFETY_RULE_KINDS as readonly string[]).includes(value)
  );
}

function validateSafetyCandidate(
  candidate: SafetyCandidate,
): InvalidSafetyCandidateReason | undefined {
  if (typeof candidate !== "object" || candidate === null) {
    return "invalid-candidate-id";
  }
  if (!isNonEmptyString(candidate.candidateId)) {
    return "invalid-candidate-id";
  }
  if (!isReadonlyArray(candidate.assignments) || candidate.assignments.length === 0) {
    return "no-assignments";
  }
  const seenMetrics = new Set<string>();
  for (const assignment of candidate.assignments) {
    if (typeof assignment !== "object" || assignment === null) {
      return "invalid-assignment";
    }
    if (!isNonEmptyString(assignment.metricId)) {
      return "invalid-assignment";
    }
    if (seenMetrics.has(assignment.metricId)) {
      return "duplicate-metric-assignment";
    }
    seenMetrics.add(assignment.metricId);
    if (!isNonEmptyString(assignment.domain)) {
      return "invalid-domain";
    }
    if (
      typeof assignment.cadencePerDay !== "number" ||
      !Number.isFinite(assignment.cadencePerDay) ||
      assignment.cadencePerDay <= 0
    ) {
      return "invalid-cadence";
    }
  }
  return undefined;
}

function ruleCodeFor(rule: SafetyRule): SafetyRuleCode {
  switch (rule.kind) {
    case "max-measurements-per-day":
      return "exceeds-max-measurements-per-day";
    case "min-gap-between-metrics":
      return "min-gap-between-metrics";
    case "forbidden-metric-combination":
      return "forbidden-metric-combination";
    case "cadence-floor":
      return "cadence-below-floor";
    case "cadence-ceiling":
      return "cadence-above-ceiling";
  }
}

/** Hours in one day (the min-gap density bound constant). */
const HOURS_PER_DAY = 24;

/**
 * THE one pure function that evaluates a candidate against a rule
 * table (rules are data; this is the only evaluator). Deterministic:
 * identical (candidate, table) inputs always produce the identical
 * outcome. Never throws — malformed tables/candidates are typed
 * rejections.
 */
export function evaluateSafetyCandidate(
  candidate: SafetyCandidate,
  table: SafetyRuleTable = DEFAULT_SAFETY_RULE_TABLE,
): IntentResult<SafetyOutcome, SafetyEvaluationError> {
  if (typeof table !== "object" || table === null || !isReadonlyArray(table.rules)) {
    return err({ kind: "invalid-rule-table" });
  }
  const seenRuleIds = new Set<string>();
  for (const [ruleIndex, rule] of table.rules.entries()) {
    const reason = validateRule(rule);
    if (reason !== undefined) {
      return err({ kind: "invalid-rule", ruleIndex, reason });
    }
    if (seenRuleIds.has(rule.ruleId)) {
      return err({ kind: "duplicate-rule-id", ruleIndex });
    }
    seenRuleIds.add(rule.ruleId);
  }

  const candidateReason = validateSafetyCandidate(candidate);
  if (candidateReason !== undefined) {
    return err({ kind: "invalid-candidate", candidateIndex: 0, reason: candidateReason });
  }

  const assignmentsByMetric = new Map(
    candidate.assignments.map((assignment) => [assignment.metricId, assignment]),
  );
  const totalPerDay = candidate.assignments.reduce(
    (sum, assignment) => sum + assignment.cadencePerDay,
    0,
  );

  const fired: FiredRuleRecord[] = [];
  const evaluatedRuleIds: string[] = [];

  for (const rule of table.rules) {
    evaluatedRuleIds.push(rule.ruleId);
    switch (rule.kind) {
      case "max-measurements-per-day": {
        if (totalPerDay > rule.maxPerDay) {
          fired.push({
            ruleId: rule.ruleId,
            ruleKind: rule.kind,
            code: ruleCodeFor(rule),
            onViolation: rule.onViolation,
            inputs: {
              kind: rule.kind,
              totalPerDay,
              maxPerDay: rule.maxPerDay,
            },
          });
        }
        break;
      }
      case "min-gap-between-metrics": {
        const a = assignmentsByMetric.get(rule.metricA);
        const b = assignmentsByMetric.get(rule.metricB);
        if (a !== undefined && b !== undefined) {
          // Best achievable minimum A-B gap over ALL schedules: 12h
          // divided by the more frequent per-day cadence (see module
          // header for the derivation). The rule fires iff NO schedule
          // can honor minGapHours.
          const bestAchievableMinGapHours =
            HOURS_PER_DAY / 2 / Math.max(a.cadencePerDay, b.cadencePerDay);
          if (bestAchievableMinGapHours < rule.minGapHours) {
            fired.push({
              ruleId: rule.ruleId,
              ruleKind: rule.kind,
              code: ruleCodeFor(rule),
              onViolation: rule.onViolation,
              inputs: {
                kind: rule.kind,
                metricA: rule.metricA,
                metricB: rule.metricB,
                cadenceAPerDay: a.cadencePerDay,
                cadenceBPerDay: b.cadencePerDay,
                bestAchievableMinGapHours,
                minGapHours: rule.minGapHours,
              },
            });
          }
        }
        break;
      }
      case "forbidden-metric-combination": {
        if (
          assignmentsByMetric.has(rule.metricA) &&
          assignmentsByMetric.has(rule.metricB)
        ) {
          fired.push({
            ruleId: rule.ruleId,
            ruleKind: rule.kind,
            code: ruleCodeFor(rule),
            onViolation: rule.onViolation,
            inputs: {
              kind: rule.kind,
              metricA: rule.metricA,
              metricB: rule.metricB,
            },
          });
        }
        break;
      }
      case "cadence-floor": {
        for (const assignment of candidate.assignments) {
          if (
            assignment.domain === rule.domain &&
            assignment.cadencePerDay < rule.floorPerDay
          ) {
            fired.push({
              ruleId: rule.ruleId,
              ruleKind: rule.kind,
              code: ruleCodeFor(rule),
              onViolation: rule.onViolation,
              inputs: {
                kind: rule.kind,
                metricId: assignment.metricId,
                domain: assignment.domain,
                cadencePerDay: assignment.cadencePerDay,
                floorPerDay: rule.floorPerDay,
              },
            });
          }
        }
        break;
      }
      case "cadence-ceiling": {
        for (const assignment of candidate.assignments) {
          if (
            assignment.domain === rule.domain &&
            assignment.cadencePerDay > rule.ceilingPerDay
          ) {
            fired.push({
              ruleId: rule.ruleId,
              ruleKind: rule.kind,
              code: ruleCodeFor(rule),
              onViolation: rule.onViolation,
              inputs: {
                kind: rule.kind,
                metricId: assignment.metricId,
                domain: assignment.domain,
                cadencePerDay: assignment.cadencePerDay,
                ceilingPerDay: rule.ceilingPerDay,
              },
            });
          }
        }
        break;
      }
    }
  }

  const firstReject = fired.find((record) => record.onViolation === "reject");
  if (firstReject !== undefined) {
    return ok({
      kind: "REJECT",
      candidateId: candidate.candidateId,
      requiresHumanReview: false,
      publishable: false,
      reason: firstReject.code,
      firedRules: fired,
      evaluatedRuleIds,
    });
  }
  if (fired.length > 0) {
    const reasonCodes: SafetyRuleCode[] = [];
    for (const record of fired) {
      if (!reasonCodes.includes(record.code)) {
        reasonCodes.push(record.code);
      }
    }
    return ok({
      kind: "ESCALATE",
      candidateId: candidate.candidateId,
      requiresHumanReview: true,
      publishable: false,
      reasonCodes,
      firedRules: fired,
      evaluatedRuleIds,
    });
  }
  return ok({
    kind: "PASS",
    candidateId: candidate.candidateId,
    requiresHumanReview: false,
    publishable: true,
    firedRules: [],
    evaluatedRuleIds,
  });
}

// ---------------------------------------------------------------------------
// Engine (table injectable with the frozen default).
// ---------------------------------------------------------------------------

/**
 * Safety rule engine — deterministic, pure, no I/O. Wraps the one pure
 * function {@link evaluateSafetyCandidate} with an injected (default:
 * frozen) {@link SafetyRuleTable}. The table and candidates are
 * validated per call (typed rejections), never at construction.
 */
export class SafetyRuleEngine {
  readonly #table: SafetyRuleTable;

  constructor(table: SafetyRuleTable = DEFAULT_SAFETY_RULE_TABLE) {
    this.#table = table;
  }

  /** Evaluates one candidate against the engine's rule table. */
  evaluate(
    candidate: SafetyCandidate,
  ): IntentResult<SafetyOutcome, SafetyEvaluationError> {
    return evaluateSafetyCandidate(candidate, this.#table);
  }

  /**
   * Evaluates a batch, preserving candidate input order. Fails fast on
   * the first malformed table/candidate (typed rejection with its
   * index) — a batch is all-or-nothing so downstream review never sees
   * a partially evaluated set.
   */
  evaluateAll(
    candidates: readonly SafetyCandidate[],
  ): IntentResult<readonly SafetyOutcome[], SafetyEvaluationError> {
    if (!isReadonlyArray(candidates)) {
      return err({ kind: "invalid-candidates" });
    }
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const reason = validateSafetyCandidate(candidate);
      if (reason !== undefined) {
        return err({ kind: "invalid-candidate", candidateIndex, reason });
      }
    }
    // Table validation happens inside evaluateSafetyCandidate on the
    // first call; validate it once up front for fail-fast symmetry.
    if (typeof this.#table !== "object" || this.#table === null || !isReadonlyArray(this.#table.rules)) {
      return err({ kind: "invalid-rule-table" });
    }
    const seenRuleIds = new Set<string>();
    for (const [ruleIndex, rule] of this.#table.rules.entries()) {
      const reason = validateRule(rule);
      if (reason !== undefined) {
        return err({ kind: "invalid-rule", ruleIndex, reason });
      }
      if (seenRuleIds.has(rule.ruleId)) {
        return err({ kind: "duplicate-rule-id", ruleIndex });
      }
      seenRuleIds.add(rule.ruleId);
    }
    const outcomes: SafetyOutcome[] = [];
    for (const candidate of candidates) {
      const outcome = evaluateSafetyCandidate(candidate, this.#table);
      if (!outcome.ok) {
        return outcome;
      }
      outcomes.push(outcome.value);
    }
    return ok(outcomes);
  }
}

// ---------------------------------------------------------------------------
// Deterministic serialization of outcomes (determinism proof).
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of safety outcomes (sorted keys, Dates as
 * epoch ms, undefined dropped). Pure and deterministic — the
 * byte-identity witness for the engine's determinism contract.
 */
export function serializeSafetyOutcomes(outcomes: readonly SafetyOutcome[]): string {
  return canonicalJsonStringify(outcomes);
}

/**
 * Hex SHA-256 of {@link serializeSafetyOutcomes} — the deterministic
 * serialization hash asserted by the safety engine's determinism tests.
 */
export function hashSafetyOutcomes(outcomes: readonly SafetyOutcome[]): string {
  return sha256Hex(serializeSafetyOutcomes(outcomes));
}
