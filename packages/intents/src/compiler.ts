/**
 * A38 — IntentCompiler: the deterministic protocol compiler of the intent
 * family (architecture §4, M5 milestone). Compiles an intent (goal +
 * constraints) plus the ACTIVE version of an EvidencePack into a
 * candidate plan set for human review.
 *
 * DETERMINISM AND PURITY: compilation reads ONLY its inputs — the goal,
 * the constraints, the injected registry / catalog / method index (pure
 * in-memory read-models), and the injected clock. No ambient state, no
 * wall clock, no I/O, no randomness. Same inputs + same injected
 * read-model/clock state => byte-identical output (asserted by
 * `serializeIntentCompilation` + `hashIntentCompilation` in tests — the
 * strongest reading of the packet's rule: because candidate plan ids are
 * CONTENT-DERIVED, even re-compiling on the SAME instance yields the
 * identical serialized output).
 *
 * RECORDED DECISIONS:
 *   - Candidate plan ids are CONTENT-DERIVED (domain-separated SHA-256
 *     over the semantic identity: person, intent, pack, pack version,
 *     metric, method) with the frozen domain `plan_` prefix, mirroring the
 *     measurement lane's A30 precedent for replay-stable identity. The
 *     injected `IdFactory` is carried in the deps because the packet's
 *     dependency list names it, but `compile` deliberately does NOT
 *     consume it: creation-scoped ids (proposal artifacts persisted by
 *     the review/publish workflow, A43) arrive in later M5 packets; using
 *     the factory here would make output depend on call sequence and
 *     break the byte-identical contract. Handoff recorded in index.ts.
 *   - The measurement read-models are consumed through THIN LOCAL PORTS
 *     (`MetricCatalogPort`, `MeasurementMethodIndexPort`) that
 *     @orbb/measurement's in-memory registries satisfy structurally; this
 *     package's dependency budget is @orbb/domain + @orbb/testkit only
 *     (engine wiring lands at integration — handoff recorded).
 *   - Expansion: for each goal metric WITH pack coverage, one candidate
 *     is emitted PER usable method — "usable" meaning a method REGISTERED
 *     for the metric that at least one pack entry CLAIMS (capability
 *     gating: pack entries must claim a usable method). The candidate set
 *     is ordered by the frozen domain least-burden comparator semantics
 *     (ascending `relativeBurden`), with metric id then method id as the
 *     deterministic tiebreaks — the same total order the measurement lane
 *     prescribes for suggestion UX.
 *   - Goal metrics unknown to the catalog are typed rejections
 *     (deny-by-default on unknown metric ids). Goal metrics with no pack
 *     coverage (or no usable method, or fully excluded by constraints)
 *     are NOT errors: they are reported in the `gated` audit list with a
 *     typed deny reason, so the future IntentProposer (A42) can explain
 *     every gap.
 *   - Each candidate carries a structured EXPLAINABILITY object (audit
 *     trail, not prose): which pack entries contributed, which methods,
 *     which coverage windows, the pack version + content hash, and the
 *     method's burden and evidence label.
 *   - Output plans are DRAFTS ONLY: the compiler never publishes or
 *     activates. Publication stays a DOMAIN transition — use
 *     {@link applyPlanTransition}, which invokes the frozen
 *     `assertPlanTransition` guard (draft -> published -> active ->
 *     completed | cancelled).
 */
import type {
  EvidenceLabel,
  IntentId,
  MeasurementPlan,
  MeasurementMethod,
  MetricDefinition,
  PersonId,
  PlanId,
  PlanState,
} from "@orbb/domain";
import {
  ID_PREFIXES,
  assertMeasurementPlan,
  assertPlanTransition,
  compareMethodsByBurden,
  DomainInvariantError,
  isIdOf,
} from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import { canonicalJsonStringify, hashWithDomainBase64Url, sha256Hex } from "./canonical.js";
import { err, ok, type IntentResult } from "./result.js";
import { isEvidencePackId, type EvidencePackId } from "./ids.js";
import type { CoverageWindow, ProvenanceActorClass } from "./evidencePack.js";
import type { EvidencePackRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Thin local ports over the measurement read-model (integration wiring
// handoff: @orbb/measurement's InMemoryMetricCatalog and
// InMemoryMeasurementMethodRegistry satisfy these structurally).
// ---------------------------------------------------------------------------

/**
 * Read-only metric catalog port: resolves the ACTIVE `MetricDefinition`
 * for a metric id. Structurally satisfied by
 * `@orbb/measurement`'s `MetricCatalog` (resolveActive signature).
 */
export interface MetricCatalogPort {
  resolveActive(metricId: string): MetricDefinition | undefined;
}

/**
 * Read-only measurement-method index port. Structurally satisfied by
 * `@orbb/measurement`'s `MeasurementMethodRegistry` (find/listForMetric
 * signatures).
 */
export interface MeasurementMethodIndexPort {
  find(methodId: string): MeasurementMethod | undefined;
  listForMetric(metricId: string): readonly MeasurementMethod[];
}

// ---------------------------------------------------------------------------
// Goal + constraints (the structured intent input the compiler consumes).
// ---------------------------------------------------------------------------

/** One metric a goal commits to measure (opaque catalog id). */
export interface GoalMetric {
  readonly metricId: string;
}

/**
 * The structured goal (the domain `HealthIntent.objective` stays free
 * text in M0; structured goals are an intent-lane concern until the
 * kernel owns a Goal aggregate — handoff recorded in index.ts).
 */
export interface IntentGoal {
  readonly metrics: readonly GoalMetric[];
}

/**
 * Compilation constraints (all optional, all validated; deterministic
 * effects only). RECORDED ASSUMPTION: the packet names "constraints"
 * without a fixed vocabulary; the three knobs below are the minimal,
 * safe, purely-functional set for M5-A. Richer constraint kinds (cadence
 * caps, burden ceilings, time windows) belong to A39/A40.
 */
export interface IntentConstraints {
  /** Method ids excluded from candidate expansion. */
  readonly excludedMethodIds?: readonly string[];
  /** Maximum candidates emitted per goal metric (>= 1; least-burden kept). */
  readonly maxCandidatesPerMetric?: number;
  /**
   * Minimum observation count a pack entry must summarize for the entry
   * to claim its method (>= 1; default 1 — any entry claims).
   */
  readonly minCoverageCount?: number;
}

/** Compile input: identities + goal + constraints + pack reference. */
export interface CompileIntentInput {
  readonly personId: PersonId;
  readonly intentId: IntentId;
  /** The EvidencePack whose ACTIVE version feeds compilation. */
  readonly packId: EvidencePackId;
  readonly goal: IntentGoal;
  readonly constraints?: IntentConstraints;
}

// ---------------------------------------------------------------------------
// Explainability (audit trail object, not prose).
// ---------------------------------------------------------------------------

/** One pack entry that contributed to a candidate, with its coverage window. */
export interface ContributingPackEntry {
  readonly entryId: string;
  readonly metricId: string;
  readonly methodId: string;
  readonly window: CoverageWindow;
  readonly count: number;
  readonly provenanceActorClass: ProvenanceActorClass;
}

/** The explainability audit trail of one candidate. */
export interface CandidateExplainability {
  readonly packId: EvidencePackId;
  readonly packVersion: number;
  readonly packContentHash: string;
  readonly metricId: string;
  readonly conceptCode: string;
  readonly methodId: string;
  readonly methodRelativeBurden: number;
  readonly methodEvidenceLabel: EvidenceLabel;
  /** Which pack entries contributed (their windows + counts + actor classes). */
  readonly contributingEntries: readonly ContributingPackEntry[];
  /** Total observations summarized by the contributing entries. */
  readonly totalObservationCount: number;
}

// ---------------------------------------------------------------------------
// Candidates + compilation output.
// ---------------------------------------------------------------------------

/** One candidate: a DRAFT domain plan + the method it proposes + why. */
export interface PlanCandidate {
  /** Domain `MeasurementPlan` in the `draft` state (publication is a separate domain transition). */
  readonly plan: MeasurementPlan;
  readonly metricId: string;
  readonly conceptCode: string;
  /** The method this candidate proposes (already least-burden-ordered in the set). */
  readonly methodId: string;
  /** Ordered method chain of this candidate (the proposed method). */
  readonly methodOrder: readonly string[];
  readonly explainability: CandidateExplainability;
}

/** Typed reason a goal metric was gated out of candidate expansion. */
export type GatedGoalMetricReason =
  | "no-pack-coverage"
  | "insufficient-coverage"
  | "no-usable-method"
  | "all-methods-excluded";

/** A goal metric that produced no candidates, and the typed reason why. */
export interface GatedGoalMetric {
  readonly metricId: string;
  readonly reason: GatedGoalMetricReason;
  /** Number of pack entries the metric had (audit context). */
  readonly packEntryCount: number;
}

/** Compile output: the burden-ordered candidate set + the gated audit + pack identity. */
export interface IntentCompilationOutput {
  readonly intentId: IntentId;
  readonly personId: PersonId;
  readonly packId: EvidencePackId;
  readonly packVersion: number;
  readonly packContentHash: string;
  /** Candidates ordered by (burden asc, metricId asc, methodId asc). */
  readonly candidates: readonly PlanCandidate[];
  /** Goal metrics that produced no candidates, in goal order (audit). */
  readonly gated: readonly GatedGoalMetric[];
  /** Compilation instant (injected clock — deterministic per clock state). */
  readonly compiledAt: Date;
}

// ---------------------------------------------------------------------------
// Typed compile rejections (PHID-safe: structural context only).
// ---------------------------------------------------------------------------

export type IntentCompileError =
  | { readonly kind: "invalid-person-id" }
  | { readonly kind: "invalid-intent-id" }
  | { readonly kind: "invalid-pack-id" }
  | { readonly kind: "unknown-pack" }
  | { readonly kind: "pack-person-mismatch" }
  | { readonly kind: "invalid-goal" }
  | { readonly kind: "no-goal-metrics" }
  | { readonly kind: "invalid-goal-metric"; readonly metricIndex: number }
  | { readonly kind: "duplicate-goal-metric"; readonly metricIndex: number }
  | { readonly kind: "unknown-goal-metric"; readonly metricIndex: number }
  | { readonly kind: "invalid-constraints" }
  | { readonly kind: "invalid-plan" };

// ---------------------------------------------------------------------------
// Compiler.
// ---------------------------------------------------------------------------

/** Domain-separation tag for candidate plan id derivation. */
const CANDIDATE_PLAN_ID_DOMAIN = "orbb/intents/candidate-plan-id/v1";

/** Constructor deps for the compiler (all injectable; no ambient access). */
export interface IntentCompilerDeps {
  readonly registry: EvidencePackRegistry;
  readonly catalog: MetricCatalogPort;
  readonly methods: MeasurementMethodIndexPort;
  readonly clock: Clock;
  /**
   * Carried per the packet's dependency list but deliberately NOT
   * consumed by `compile` (see module header: content-derived candidate
   * ids keep compilation a pure function of its inputs; creation-scoped
   * ids arrive with the proposal/review packets).
   */
  readonly ids: IdFactory;
}

/**
 * Intent compiler — deterministic, pure, no I/O. Produces burden-ordered
 * DRAFT plan candidates (plus a typed gated audit) from a goal +
 * constraints and the ACTIVE EvidencePack version.
 */
export class IntentCompiler {
  readonly #registry: EvidencePackRegistry;
  readonly #catalog: MetricCatalogPort;
  readonly #methods: MeasurementMethodIndexPort;
  readonly #clock: Clock;

  constructor(deps: IntentCompilerDeps) {
    this.#registry = deps.registry;
    this.#catalog = deps.catalog;
    this.#methods = deps.methods;
    this.#clock = deps.clock;
  }

  compile(input: CompileIntentInput): IntentResult<IntentCompilationOutput, IntentCompileError> {
    if (typeof input !== "object" || input === null) {
      // Non-object input: rejected as the first field's validation failure.
      return err({ kind: "invalid-person-id" });
    }
    if (!isIdOf("person", input.personId)) {
      return err({ kind: "invalid-person-id" });
    }
    if (!isIdOf("intent", input.intentId)) {
      return err({ kind: "invalid-intent-id" });
    }
    if (!isEvidencePackId(input.packId)) {
      return err({ kind: "invalid-pack-id" });
    }

    // The ACTIVE EvidencePack version (deny-by-default on unknown packs).
    const activeRecord = this.#registry.resolveActive(input.packId);
    if (activeRecord === undefined) {
      return err({ kind: "unknown-pack" });
    }
    if (activeRecord.personId !== input.personId) {
      // A person's intent may only compile against that person's pack.
      return err({ kind: "pack-person-mismatch" });
    }

    // Goal validation (deny-by-default, typed).
    const goal = input.goal;
    if (typeof goal !== "object" || goal === null || !Array.isArray(goal.metrics)) {
      return err({ kind: "invalid-goal" });
    }
    if (goal.metrics.length === 0) {
      return err({ kind: "no-goal-metrics" });
    }
    const seenMetricIds = new Set<string>();
    const resolvedGoalMetrics: { metricId: string; conceptCode: string }[] = [];
    for (const [metricIndex, metric] of goal.metrics.entries()) {
      if (typeof metric !== "object" || metric === null || typeof metric.metricId !== "string" || metric.metricId.length === 0) {
        return err({ kind: "invalid-goal-metric", metricIndex });
      }
      if (seenMetricIds.has(metric.metricId)) {
        return err({ kind: "duplicate-goal-metric", metricIndex });
      }
      seenMetricIds.add(metric.metricId);
      // Unknown metric ids are denied by default (catalog is the authority).
      const definition = this.#catalog.resolveActive(metric.metricId);
      if (definition === undefined) {
        return err({ kind: "unknown-goal-metric", metricIndex });
      }
      resolvedGoalMetrics.push({ metricId: metric.metricId, conceptCode: definition.conceptCode });
    }

    // Constraints validation (validated when present; defaults applied below).
    const constraints = input.constraints;
    if (constraints !== undefined) {
      if (typeof constraints !== "object" || constraints === null) {
        return err({ kind: "invalid-constraints" });
      }
      if (
        constraints.excludedMethodIds !== undefined &&
        (!Array.isArray(constraints.excludedMethodIds) ||
          constraints.excludedMethodIds.some(
            (methodId) => typeof methodId !== "string" || methodId.length === 0,
          ))
      ) {
        return err({ kind: "invalid-constraints" });
      }
      if (
        constraints.maxCandidatesPerMetric !== undefined &&
        (!Number.isInteger(constraints.maxCandidatesPerMetric) ||
          constraints.maxCandidatesPerMetric < 1)
      ) {
        return err({ kind: "invalid-constraints" });
      }
      if (
        constraints.minCoverageCount !== undefined &&
        (!Number.isInteger(constraints.minCoverageCount) || constraints.minCoverageCount < 1)
      ) {
        return err({ kind: "invalid-constraints" });
      }
    }
    const excludedMethodIds = new Set<string>(constraints?.excludedMethodIds ?? []);
    const maxCandidatesPerMetric = constraints?.maxCandidatesPerMetric ?? Number.POSITIVE_INFINITY;
    const minCoverageCount = constraints?.minCoverageCount ?? 1;

    // Expansion (deterministic; clock read once per compilation).
    const compiledAt = this.#clock.now();
    const candidates: PlanCandidate[] = [];
    const gated: GatedGoalMetric[] = [];

    for (const goalMetric of resolvedGoalMetrics) {
      const metricId = goalMetric.metricId;
      const conceptCode = goalMetric.conceptCode;

      const entriesForMetric = activeRecord.entries.filter((entry) => entry.metricId === metricId);
      if (entriesForMetric.length === 0) {
        gated.push({ metricId, reason: "no-pack-coverage", packEntryCount: 0 });
        continue;
      }

      const coverageEntries =
        minCoverageCount > 1
          ? entriesForMetric.filter((entry) => entry.count >= minCoverageCount)
          : entriesForMetric;
      if (coverageEntries.length === 0) {
        gated.push({
          metricId,
          reason: "insufficient-coverage",
          packEntryCount: entriesForMetric.length,
        });
        continue;
      }

      // Capability gating: a method is usable iff REGISTERED for the metric
      // AND claimed by at least one (sufficient-coverage) pack entry.
      const claimedMethodIds = new Set(coverageEntries.map((entry) => entry.methodId));
      const registered = this.#methods.listForMetric(metricId);
      const usable = registered.filter((method) => claimedMethodIds.has(method.id));
      if (usable.length === 0) {
        gated.push({
          metricId,
          reason: "no-usable-method",
          packEntryCount: entriesForMetric.length,
        });
        continue;
      }

      const unexcluded = usable.filter((method) => !excludedMethodIds.has(method.id));
      if (unexcluded.length === 0) {
        gated.push({
          metricId,
          reason: "all-methods-excluded",
          packEntryCount: entriesForMetric.length,
        });
        continue;
      }

      // Least-burden-first (frozen domain comparator) with deterministic
      // id tiebreak — the same order the measurement lane prescribes.
      const ordered = [...unexcluded].sort(
        (a, b) => compareMethodsByBurden(a, b) || (a.id < b.id ? -1 : 1),
      );
      const capped = ordered.slice(0, maxCandidatesPerMetric);

      for (const method of capped) {
        const contributing = coverageEntries.filter((entry) => entry.methodId === method.id);
        const planId = this.#deriveCandidatePlanId(
          input.personId,
          input.intentId,
          activeRecord.packId,
          activeRecord.version,
          metricId,
          method.id,
        );
        const plan: MeasurementPlan = {
          id: planId,
          personId: input.personId,
          intentId: input.intentId,
          state: "draft",
          metrics: [conceptCode],
          createdAt: compiledAt,
        };
        try {
          assertMeasurementPlan(plan);
        } catch (error) {
          if (error instanceof DomainInvariantError) {
            return err({ kind: "invalid-plan" });
          }
          throw error;
        }
        candidates.push({
          plan,
          metricId,
          conceptCode,
          methodId: method.id,
          methodOrder: [method.id],
          explainability: {
            packId: activeRecord.packId,
            packVersion: activeRecord.version,
            packContentHash: activeRecord.contentHash,
            metricId,
            conceptCode,
            methodId: method.id,
            methodRelativeBurden: method.relativeBurden,
            methodEvidenceLabel: method.evidenceLabel,
            contributingEntries: contributing.map((entry) => ({
              entryId: entry.entryId,
              metricId: entry.metricId,
              methodId: entry.methodId,
              window: { startsAt: entry.window.startsAt, endsAt: entry.window.endsAt },
              count: entry.count,
              provenanceActorClass: entry.provenanceActorClass,
            })),
            totalObservationCount: contributing.reduce((sum, entry) => sum + entry.count, 0),
          },
        });
      }
    }

    // Global deterministic total order: burden asc, then metricId, then methodId.
    candidates.sort(
      (a, b) =>
        a.explainability.methodRelativeBurden - b.explainability.methodRelativeBurden ||
        (a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0) ||
        (a.methodId < b.methodId ? -1 : a.methodId > b.methodId ? 1 : 0),
    );

    return ok({
      intentId: input.intentId,
      personId: input.personId,
      packId: activeRecord.packId,
      packVersion: activeRecord.version,
      packContentHash: activeRecord.contentHash,
      candidates,
      gated,
      compiledAt,
    });
  }

  /**
   * Content-derived candidate plan id (replay-stable): the frozen domain
   * `plan_` prefix plus a domain-separated digest of the semantic
   * identity. Deliberately excludes `compiledAt` so re-compilation of the
   * same semantic candidate yields the same id.
   */
  #deriveCandidatePlanId(
    personId: PersonId,
    intentId: IntentId,
    packId: EvidencePackId,
    packVersion: number,
    metricId: string,
    methodId: string,
  ): PlanId {
    const digest = hashWithDomainBase64Url(CANDIDATE_PLAN_ID_DOMAIN, {
      personId,
      intentId,
      packId,
      packVersion,
      metricId,
      methodId,
    });
    return `${ID_PREFIXES.plan}_${digest}` as PlanId;
  }
}

/**
 * Invokes the frozen domain plan state machine: returns the plan with the
 * new state, or lets the domain `DomainInvariantError` propagate (illegal
 * transitions are programmer/authoring mistakes, not typed compiler
 * rejections — the domain guard is the authority). The COMPILER never
 * calls this; the human review/publish workflow (A43) does.
 * `draft -> published -> active -> completed | cancelled`.
 */
export function applyPlanTransition(plan: MeasurementPlan, to: PlanState): MeasurementPlan {
  assertPlanTransition(plan.state, to);
  return { ...plan, state: to };
}

// ---------------------------------------------------------------------------
// Deterministic serialization of compilation outputs (determinism proof).
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of a compilation output (sorted keys, Dates as
 * epoch ms, undefined dropped). Pure and deterministic — the byte-identity
 * witness for the compiler's determinism contract.
 */
export function serializeIntentCompilation(output: IntentCompilationOutput): string {
  return canonicalJsonStringify(output);
}

/**
 * Hex SHA-256 of {@link serializeIntentCompilation} — the deterministic
 * serialization hash asserted by the compiler's determinism tests.
 */
export function hashIntentCompilation(output: IntentCompilationOutput): string {
  return sha256Hex(serializeIntentCompilation(output));
}
