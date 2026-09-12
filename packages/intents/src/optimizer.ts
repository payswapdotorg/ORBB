/**
 * A39 — BurdenOptimizer: the burden/pruning stage of the intent compiler
 * pipeline (architecture §4, M5 milestone, Lane A packet M5-B).
 *
 * Consumes a CANDIDATE PLAN SET (the output of the M5-A `IntentCompiler`,
 * or any structurally compatible producer) plus an injectable BURDEN MODEL
 * and returns the Pareto-minimal subset under the two objectives
 * (TOTAL BURDEN, COVERAGE COMPLETENESS), canonically ordered with
 * tie-breaking by least-methods then lexicographic ids.
 *
 * DETERMINISM AND PURITY: optimization reads ONLY its inputs — the
 * candidate set, the goal metric set (optional), and the burden model.
 * No ambient state, no I/O, no randomness, no clock. The output order is
 * a canonical TOTAL ORDER, so the result is additionally INDEPENDENT of
 * the input candidate order (asserted by tests via
 * `serializeBurdenOptimization` + `hashBurdenOptimization`: shuffled
 * inputs produce byte-identical output).
 *
 * RECORDED DECISIONS (genuinely unspecified points; architecture-consistent
 * choices made here for tech-lead review):
 *   - COVERAGE COMPLETENESS is ordered by METRIC-SET INCLUSION, not by a
 *     scalar: candidate Y dominates candidate X iff
 *     `Y.totalBurden <= X.totalBurden` AND `X.metrics ⊆ Y.metrics` AND at
 *     least one of the two comparisons is strict. Rationale: the compiled
 *     candidate set contains ALTERNATIVES for different goal metrics
 *     (M5-A emits one candidate per (metric, method) pair); a scalar
 *     coverage cardinality would let a cheap plan for metric A dominate an
 *     equally-covering plan for metric B, silently erasing the person's
 *     only option for B. Set-inclusion dominance keeps per-metric
 *     alternatives incomparable (both stay on the front) while still
 *     pruning strict trade-off dominations. Cardinality is reported per
 *     candidate for audit; an optional `goalMetrics` input additionally
 *     reports a coverage fraction (reporting only — never a dominance
 *     input).
 *   - TOTAL BURDEN of a candidate =
 *     Σ(method kind weights of the candidate's methods)
 *     + Σ(per-metric cadence costs of the candidate's covered metrics)
 *     + windowCountWeight × windowCount.
 *     The burden model owns the three components named by the packet:
 *     per-method burden weights ordered manual > app > device (the same
 *     ordering the measurement lane's seeded burden ranks record:
 *     passive device 1 < app sync 2 < manual entry 3), per-metric cadence
 *     cost (a LUMP cost per covered metric — M5-A candidates carry no
 *     explicit cadence; the model folds the metric's cadence burden into
 *     its per-metric table, with a default for unlisted metrics), and the
 *     window count contribution (weight × the number of measurement
 *     windows backing the candidate).
 *   - METHOD KIND is an optimizer-local vocabulary (`manual | app |
 *     device`) — the frozen domain `MeasurementMethod` has NO kind field.
 *     Candidates therefore carry their methods' kinds in the local
 *     {@link OptimizableCandidate} shape; `optimizableFromPlanCandidate`
 *     adapts M5-A {@link PlanCandidateLike} values via a caller-supplied
 *     kind lookup (deny-by-default: an unknown kind is a typed rejection).
 *     Integration derives kinds from the person's registered sources (a
 *     method served by a device source is a device-kind method) —
 *     handoff recorded in src/index.ts.
 *   - TIES SURVIVE the Pareto prune: two candidates with identical
 *     (totalBurden, metric set) are mutually non-dominated (dominance
 *     requires a strict improvement). The packet's "tie-breaking by
 *     least-methods then lexicographic ids" is implemented as the
 *     canonical OUTPUT ORDER (fewer methods first, then lexicographic
 *     candidate ids) — keeping equally-good alternatives preserves the
 *     downstream fallback chain when the least-burden candidate later
 *     fails resource matching (A40) or safety gating (A41).
 *   - The optimizer NEVER composes new candidates (no Cartesian product
 *     of per-metric options): it prunes the set it is given. Composite
 *     multi-metric candidates arrive when a richer compiler or the M5-C
 *     proposal service emits them; this module's local interface accepts
 *     them unchanged.
 *   - Expected rejections are TYPED RESULTS (never throws), mirroring
 *     the M5-A/M4-A result discipline. Error payloads are PHID-safe:
 *     structural context (candidate index, reason kind) only.
 */
import { canonicalJsonStringify, sha256Hex } from "./canonical.js";
import { err, ok, type IntentResult } from "./result.js";

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
// Vocabulary: burden method kinds (packet A39: manual > app > device).
// ---------------------------------------------------------------------------

/**
 * The three method kinds the burden model weights, ordered
 * manual (most burdensome) > app > device (least burdensome).
 * Optimizer-local vocabulary (the frozen domain method aggregate carries
 * no kind — see module header).
 */
export const BURDEN_METHOD_KINDS = ["manual", "app", "device"] as const;

export type BurdenMethodKind = (typeof BURDEN_METHOD_KINDS)[number];

/** Type guard: is `value` one of the three burden method kinds? */
export function isBurdenMethodKind(value: unknown): value is BurdenMethodKind {
  return (
    typeof value === "string" &&
    (BURDEN_METHOD_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Burden model (injectable; frozen default).
// ---------------------------------------------------------------------------

/**
 * The injectable burden model. All numbers must be finite and
 * non-negative; `methodKindWeights` MUST satisfy the packet's ordering
 * constraint `manual > app > device` (validated, typed rejection
 * otherwise — the ordering is a safety-relevant invariant, not a hint).
 */
export interface BurdenModel {
  /**
   * Burden weight per method kind. MUST satisfy
   * `manual > app > device` (each finite, > 0).
   */
  readonly methodKindWeights: Readonly<Record<BurdenMethodKind, number>>;
  /**
   * Per-metric cadence cost: the lump burden of covering one metric at
   * its intended cadence (metric id -> finite cost >= 0). Metrics not
   * listed use {@link BurdenModel.defaultMetricCadenceCost}.
   */
  readonly metricCadenceCosts: Readonly<Record<string, number>>;
  /** Cadence cost for metrics absent from `metricCadenceCosts` (>= 0). */
  readonly defaultMetricCadenceCost: number;
  /** Burden weight per measurement window backing the candidate (>= 0). */
  readonly windowCountWeight: number;
}

/**
 * The frozen DEFAULT burden model (recorded assumption; mirrors the
 * measurement lane's seeded burden ranks: passive device 1 < app sync 2 <
 * manual entry 3): device methods cost 1, app methods 2, manual methods 3;
 * every covered metric costs 1 by default (no per-metric overrides); each
 * measurement window costs 1.
 */
export const DEFAULT_BURDEN_MODEL: BurdenModel = {
  methodKindWeights: { manual: 3, app: 2, device: 1 },
  metricCadenceCosts: {},
  defaultMetricCadenceCost: 1,
  windowCountWeight: 1,
};

/** Typed reason a burden model was rejected (PHID-safe). */
export type InvalidBurdenModelReason =
  | "invalid-method-kind-weights"
  | "burden-order-violated"
  | "invalid-metric-cadence-costs"
  | "invalid-default-metric-cadence-cost"
  | "invalid-window-count-weight";

// ---------------------------------------------------------------------------
// Local candidate-plan shape (thin interface over any compatible producer).
// ---------------------------------------------------------------------------

/** One method a candidate proposes, with its burden kind. */
export interface OptimizableMethodRef {
  /** Opaque method code (measurement lane owns the vocabulary). */
  readonly methodId: string;
  /** The method's burden kind (manual | app | device). */
  readonly kind: BurdenMethodKind;
}

/**
 * The candidate-plan shape the optimizer consumes — a THIN LOCAL
 * INTERFACE (the M5-B/M5-A contract seam). M5-A `PlanCandidate` values
 * are adapted via {@link optimizableFromPlanCandidate}; richer producers
 * (multi-metric composites) satisfy it directly.
 */
export interface OptimizableCandidate {
  /** Unique candidate identity (M5-A: the content-derived plan id). */
  readonly candidateId: string;
  /** The distinct metric ids this candidate covers (non-empty, unique). */
  readonly metrics: readonly string[];
  /** The candidate's proposed methods (non-empty, unique method ids). */
  readonly methods: readonly OptimizableMethodRef[];
  /** Number of measurement windows backing the candidate (>= 0). */
  readonly windowCount: number;
}

/**
 * Structural (subset) view of the M5-A `PlanCandidate` the adapter
 * consumes — deliberately local so this module never imports the
 * compiler module (the M5-B/M5-A handoff seam; `PlanCandidate` from
 * `./compiler.js` satisfies this interface structurally at integration).
 */
export interface PlanCandidateLike {
  /** The DRAFT domain plan; only its identity is consumed here. */
  readonly plan: { readonly id: string };
  /** The single metric this M5-A candidate covers. */
  readonly metricId: string;
  /** Ordered method chain proposed by the candidate. */
  readonly methodOrder: readonly string[];
  /** Audit trail; only the contributing entries' count is consumed. */
  readonly explainability: { readonly contributingEntries: readonly unknown[] };
}

/** Typed reason a plan-candidate adaptation was rejected. */
export type PlanCandidateAdaptationError =
  | { readonly kind: "invalid-plan-candidate" }
  | { readonly kind: "unknown-method-kind"; readonly methodIndex: number };

/**
 * Adapts an M5-A `PlanCandidate` (structurally: {@link PlanCandidateLike})
 * into an {@link OptimizableCandidate}. `methodKindOf` resolves each
 * method's burden kind (integration derives it from the person's
 * registered sources); an unresolved kind is a typed rejection
 * (deny-by-default: burden cannot be computed for an unknown kind).
 */
export function optimizableFromPlanCandidate(
  candidate: PlanCandidateLike,
  methodKindOf: (methodId: string) => BurdenMethodKind | undefined,
): IntentResult<OptimizableCandidate, PlanCandidateAdaptationError> {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.plan !== "object" ||
    candidate.plan === null ||
    typeof candidate.plan.id !== "string" ||
    candidate.plan.id.length === 0 ||
    typeof candidate.metricId !== "string" ||
    candidate.metricId.length === 0 ||
    !isReadonlyArray(candidate.methodOrder) ||
    candidate.methodOrder.length === 0 ||
    !isReadonlyArray(candidate.explainability?.contributingEntries)
  ) {
    return err({ kind: "invalid-plan-candidate" });
  }
  const methods: OptimizableMethodRef[] = [];
  for (const [methodIndex, methodId] of candidate.methodOrder.entries()) {
    if (typeof methodId !== "string" || methodId.length === 0) {
      return err({ kind: "invalid-plan-candidate" });
    }
    const kind = methodKindOf(methodId);
    if (kind === undefined) {
      return err({ kind: "unknown-method-kind", methodIndex });
    }
    methods.push({ methodId, kind });
  }
  return ok({
    candidateId: candidate.plan.id,
    metrics: [candidate.metricId],
    methods,
    windowCount: candidate.explainability.contributingEntries.length,
  });
}

// ---------------------------------------------------------------------------
// Evaluated + output shapes.
// ---------------------------------------------------------------------------

/** A candidate with its deterministic burden evaluation (audit fields). */
export interface EvaluatedCandidate extends OptimizableCandidate {
  /** Σ method kind weights + Σ metric cadence costs + window weight × count. */
  readonly totalBurden: number;
  /** Number of proposed methods (the "least-methods" tie-break key). */
  readonly methodCount: number;
  /** Distinct covered metrics, sorted lexicographically (audit). */
  readonly metricsCovered: readonly string[];
  /** Coverage cardinality (audit scalar; dominance uses set inclusion). */
  readonly coverageCardinality: number;
  /** Covered-goal fraction; present iff `goalMetrics` was supplied. */
  readonly coverageFraction?: number;
}

/** A pruned (dominated) candidate, with the ids of its dominators (audit). */
export interface DominatedCandidate {
  readonly candidateId: string;
  /** Ids of every candidate that dominated it, in canonical output order. */
  readonly dominatedBy: readonly string[];
}

/** Optimization output: the Pareto-minimal set + the dominated audit. */
export interface BurdenOptimizerOutput {
  /**
   * The Pareto-minimal (non-dominated) candidates in the canonical total
   * order: totalBurden ASC, coverageCardinality DESC, methodCount ASC
   * (least-methods), candidateId ASC (lexicographic ids).
   */
  readonly paretoMinimal: readonly EvaluatedCandidate[];
  /** Pruned candidates and what dominated them (explainability audit). */
  readonly dominated: readonly DominatedCandidate[];
  /** Number of candidates evaluated (input cardinality). */
  readonly evaluatedCount: number;
}

// ---------------------------------------------------------------------------
// Typed optimizer rejections (PHID-safe: structural context only).
// ---------------------------------------------------------------------------

/** Typed reason one candidate was malformed (PHID-safe). */
export type InvalidCandidateReason =
  | "invalid-candidate-id"
  | "invalid-metrics"
  | "duplicate-metric"
  | "invalid-methods"
  | "invalid-method"
  | "duplicate-method"
  | "invalid-window-count";

/** Typed optimizer rejections — never thrown, always a result. */
export type BurdenOptimizerError =
  | { readonly kind: "invalid-candidates" }
  | { readonly kind: "invalid-candidate"; readonly index: number; readonly reason: InvalidCandidateReason }
  | { readonly kind: "duplicate-candidate-id"; readonly index: number }
  | { readonly kind: "invalid-burden-model"; readonly reason: InvalidBurdenModelReason }
  | { readonly kind: "invalid-goal-metrics" };

// ---------------------------------------------------------------------------
// Pure core.
// ---------------------------------------------------------------------------

/** Optimize input: the candidate set plus an optional goal metric set. */
export interface BurdenOptimizeInput {
  readonly candidates: readonly OptimizableCandidate[];
  /**
   * The goal's metric ids (optional). Used ONLY to report each
   * candidate's coverage fraction; dominance never consults it.
   */
  readonly goalMetrics?: readonly string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateBurdenModel(model: BurdenModel): InvalidBurdenModelReason | undefined {
  const weights = model?.methodKindWeights;
  if (typeof weights !== "object" || weights === null) {
    return "invalid-method-kind-weights";
  }
  for (const kind of BURDEN_METHOD_KINDS) {
    const weight = weights[kind];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      return "invalid-method-kind-weights";
    }
  }
  if (!(weights.manual > weights.app && weights.app > weights.device)) {
    // The packet's ordering constraint is a validated invariant.
    return "burden-order-violated";
  }
  const cadenceCosts = model.metricCadenceCosts;
  if (typeof cadenceCosts !== "object" || cadenceCosts === null) {
    return "invalid-metric-cadence-costs";
  }
  for (const cost of Object.values(cadenceCosts)) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      return "invalid-metric-cadence-costs";
    }
  }
  const defaultCost = model.defaultMetricCadenceCost;
  if (typeof defaultCost !== "number" || !Number.isFinite(defaultCost) || defaultCost < 0) {
    return "invalid-default-metric-cadence-cost";
  }
  const windowWeight = model.windowCountWeight;
  if (typeof windowWeight !== "number" || !Number.isFinite(windowWeight) || windowWeight < 0) {
    return "invalid-window-count-weight";
  }
  return undefined;
}

function validateCandidate(
  candidate: OptimizableCandidate,
): InvalidCandidateReason | undefined {
  if (typeof candidate !== "object" || candidate === null) {
    return "invalid-candidate-id";
  }
  if (!isNonEmptyString(candidate.candidateId)) {
    return "invalid-candidate-id";
  }
  if (!isReadonlyArray(candidate.metrics) || candidate.metrics.length === 0) {
    return "invalid-metrics";
  }
  const seenMetrics = new Set<string>();
  for (const metricId of candidate.metrics) {
    if (!isNonEmptyString(metricId)) {
      return "invalid-metrics";
    }
    if (seenMetrics.has(metricId)) {
      return "duplicate-metric";
    }
    seenMetrics.add(metricId);
  }
  if (!isReadonlyArray(candidate.methods) || candidate.methods.length === 0) {
    return "invalid-methods";
  }
  const seenMethodIds = new Set<string>();
  for (const method of candidate.methods) {
    if (
      typeof method !== "object" ||
      method === null ||
      !isNonEmptyString(method.methodId) ||
      !isBurdenMethodKind(method.kind)
    ) {
      return "invalid-method";
    }
    if (seenMethodIds.has(method.methodId)) {
      return "duplicate-method";
    }
    seenMethodIds.add(method.methodId);
  }
  const windowCount = candidate.windowCount;
  if (
    typeof windowCount !== "number" ||
    !Number.isInteger(windowCount) ||
    windowCount < 0
  ) {
    return "invalid-window-count";
  }
  return undefined;
}

/** Coverage completeness comparison: is `a` a subset of `b`? */
function metricsSubsetOf(a: readonly string[], b: readonly string[]): boolean {
  const superset = new Set(b);
  return a.every((metricId) => superset.has(metricId));
}

/**
 * Canonical total order over the Pareto front:
 * totalBurden ASC, coverageCardinality DESC, methodCount ASC
 * (least-methods tie-break), candidateId ASC (lexicographic ids
 * tie-break). A total order (ids are unique within a set) — the output
 * therefore does not depend on the input candidate order.
 */
function compareEvaluated(a: EvaluatedCandidate, b: EvaluatedCandidate): number {
  if (a.totalBurden !== b.totalBurden) {
    return a.totalBurden < b.totalBurden ? -1 : 1;
  }
  if (a.coverageCardinality !== b.coverageCardinality) {
    return a.coverageCardinality > b.coverageCardinality ? -1 : 1;
  }
  if (a.methodCount !== b.methodCount) {
    return a.methodCount < b.methodCount ? -1 : 1;
  }
  return a.candidateId < b.candidateId ? -1 : 1;
}

/**
 * The pure optimization core: identical inputs ALWAYS produce identical
 * outputs (byte-identical canonical serialization), independent of input
 * candidate order. See `serializeBurdenOptimization`.
 */
export function runBurdenOptimization(
  input: BurdenOptimizeInput,
  model: BurdenModel = DEFAULT_BURDEN_MODEL,
): IntentResult<BurdenOptimizerOutput, BurdenOptimizerError> {
  const modelReason = validateBurdenModel(model);
  if (modelReason !== undefined) {
    return err({ kind: "invalid-burden-model", reason: modelReason });
  }

  if (typeof input !== "object" || input === null || !isReadonlyArray(input.candidates)) {
    return err({ kind: "invalid-candidates" });
  }

  const goalMetrics = input.goalMetrics;
  let goalMetricSet: Set<string> | undefined;
  if (goalMetrics !== undefined) {
    if (
      !isReadonlyArray(goalMetrics) ||
      goalMetrics.length === 0 ||
      goalMetrics.some((metricId) => !isNonEmptyString(metricId)) ||
      new Set(goalMetrics).size !== goalMetrics.length
    ) {
      return err({ kind: "invalid-goal-metrics" });
    }
    goalMetricSet = new Set(goalMetrics);
  }

  const seenCandidateIds = new Set<string>();
  for (const [index, candidate] of input.candidates.entries()) {
    const reason = validateCandidate(candidate);
    if (reason !== undefined) {
      return err({ kind: "invalid-candidate", index, reason });
    }
    if (seenCandidateIds.has(candidate.candidateId)) {
      return err({ kind: "duplicate-candidate-id", index });
    }
    seenCandidateIds.add(candidate.candidateId);
  }

  // Deterministic burden evaluation (summation in candidate field order).
  const evaluated: EvaluatedCandidate[] = input.candidates.map((candidate) => {
    let totalBurden = 0;
    for (const method of candidate.methods) {
      totalBurden += model.methodKindWeights[method.kind];
    }
    for (const metricId of candidate.metrics) {
      const cost = model.metricCadenceCosts[metricId];
      totalBurden +=
        typeof cost === "number" ? cost : model.defaultMetricCadenceCost;
    }
    totalBurden += model.windowCountWeight * candidate.windowCount;
    const metricsCovered = [...candidate.metrics].sort();
    let coverageFraction: number | undefined;
    if (goalMetricSet !== undefined) {
      let covered = 0;
      for (const metricId of candidate.metrics) {
        if (goalMetricSet.has(metricId)) {
          covered += 1;
        }
      }
      coverageFraction = covered / goalMetricSet.size;
    }
    return {
      candidateId: candidate.candidateId,
      metrics: [...candidate.metrics],
      methods: candidate.methods.map((method) => ({ ...method })),
      windowCount: candidate.windowCount,
      totalBurden,
      methodCount: candidate.methods.length,
      metricsCovered,
      coverageCardinality: metricsCovered.length,
      ...(coverageFraction === undefined ? {} : { coverageFraction }),
    };
  });

  // Pareto prune under (total burden <=, metric-set inclusion) with
  // strictness in at least one axis. Ties (equal burden + equal metric
  // set) are mutually non-dominated and survive, ordered by the
  // canonical tie-breaks.
  const dominated: DominatedCandidate[] = [];
  const front: EvaluatedCandidate[] = [];
  for (const [index, candidate] of evaluated.entries()) {
    const dominators: string[] = [];
    for (const [otherIndex, other] of evaluated.entries()) {
      if (index === otherIndex) {
        continue;
      }
      const burdenAtLeastAsGood = other.totalBurden <= candidate.totalBurden;
      const coverageAtLeastAsGood = metricsSubsetOf(
        candidate.metricsCovered,
        other.metricsCovered,
      );
      const strict =
        other.totalBurden < candidate.totalBurden ||
        candidate.metricsCovered.length < other.metricsCovered.length ||
        !metricsSubsetOf(other.metricsCovered, candidate.metricsCovered);
      if (burdenAtLeastAsGood && coverageAtLeastAsGood && strict) {
        dominators.push(other.candidateId);
      }
    }
    if (dominators.length > 0) {
      // Canonical dominator order (input-order independent): sorted by
      // candidate id, like the dominated list itself.
      dominators.sort();
      dominated.push({
        candidateId: candidate.candidateId,
        dominatedBy: dominators,
      });
    } else {
      front.push(candidate);
    }
  }

  // Canonical output order (input-order independent).
  front.sort(compareEvaluated);
  dominated.sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1));

  return ok({
    paretoMinimal: front,
    dominated,
    evaluatedCount: evaluated.length,
  });
}

// ---------------------------------------------------------------------------
// Engine (model injectable with a frozen default).
// ---------------------------------------------------------------------------

/**
 * Burden optimizer — deterministic, pure, no I/O. Wraps
 * {@link runBurdenOptimization} with an injected (default: frozen)
 * {@link BurdenModel}. The model is validated per call (typed
 * rejection), never at construction.
 */
export class BurdenOptimizer {
  readonly #model: BurdenModel;

  constructor(model: BurdenModel = DEFAULT_BURDEN_MODEL) {
    this.#model = model;
  }

  optimize(
    input: BurdenOptimizeInput,
  ): IntentResult<BurdenOptimizerOutput, BurdenOptimizerError> {
    return runBurdenOptimization(input, this.#model);
  }
}

// ---------------------------------------------------------------------------
// Deterministic serialization of optimization outputs (determinism proof).
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of an optimization output (sorted keys, Dates
 * as epoch ms, undefined dropped). Pure and deterministic — the
 * byte-identity witness for the optimizer's determinism contract.
 */
export function serializeBurdenOptimization(output: BurdenOptimizerOutput): string {
  return canonicalJsonStringify(output);
}

/**
 * Hex SHA-256 of {@link serializeBurdenOptimization} — the deterministic
 * serialization hash asserted by the optimizer's determinism tests.
 */
export function hashBurdenOptimization(output: BurdenOptimizerOutput): string {
  return sha256Hex(serializeBurdenOptimization(output));
}
