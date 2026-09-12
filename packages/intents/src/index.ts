/**
 * @orbb/intents — intent compiler core for ORBB (M5, Lane A).
 *
 * Public surface (A36–A41, architecture §4 intent family):
 *   - A36 `EvidencePack` schema — typed, PHI-free summary packs: pack id
 *     (opaque lane-local grammar), person scope, version (frozen domain
 *     guard `isEvidencePackVersion`), content-addressed entries (metric +
 *     method + window coverage + count + quality mix + provenance actor
 *     class — NO raw values), typed validation, append-only versioning
 *     (new version = new record referencing predecessor), canonical JSON
 *     serialization with content hash.
 *   - A37 `EvidencePackRegistry` port + in-memory implementation —
 *     register (creates version N+1 from predecessor, MetricCatalog
 *     supersession semantics), resolveActive, resolveVersion,
 *     listVersions with lineage; every record carries provenance
 *     (assembled-by actor, assembled-at via injected clock, source-entry
 *     references); deny-by-default typed rejections, never throws.
 *   - A38 `IntentCompiler` — pure, deterministic, no I/O: intent (goal +
 *     constraints) + EvidencePack (active version) -> burden-ordered
 *     candidate plan set with capability gating and per-candidate
 *     explainability audit trails. Output plans are DRAFTS ONLY —
 *     publication stays a domain transition (`applyPlanTransition`
 *     invokes the frozen `assertPlanTransition` guard).
 *   - A39 `BurdenOptimizer` (M5-B) — pure, deterministic Pareto prune of
 *     a candidate plan set under (total burden, coverage completeness)
 *     with an injectable burden model (per-method kind weights ordered
 *     manual > app > device, per-metric cadence costs, window-count
 *     weight; frozen default) and canonical tie-breaking by
 *     least-methods then lexicographic ids.
 *   - A40 `ResourceMatcher` (M5-B) — deny-by-default filter to EXECUTABLE
 *     candidates: every plan metric needs a usable method backed by BOTH
 *     an active registered source (manual/device/app kinds with
 *     capabilities) and EvidencePack coverage; typed drop reasons
 *     (metric-uncovered | no-method | no-source) and per-metric binding
 *     trails (which source + coverage entry satisfied each metric).
 *   - A41 `SafetyRuleEngine` (M5-B) — ordered deterministic rule set
 *     (DATA: a frozen default table) evaluated by one pure function:
 *     max-measurements-per-day guard, min-gap-between-metrics,
 *     forbidden metric combinations, cadence floor/ceiling per metric
 *     domain. Outcomes PASS | ESCALATE (human review REQUIRED —
 *     type-encoded never-publishable-without-review) | REJECT (typed
 *     reason), each carrying the rule id + inputs that fired. Safety
 *     rules are deterministic code, never AI calls (§8).
 *
 * RECORDED HANDOFFS (integration boundary, engine wiring arrives later):
 *   - @orbb/measurement wiring: the compiler consumes the metric catalog
 *     and method registry through THIN LOCAL PORTS
 *     (`MetricCatalogPort` / `MeasurementMethodIndexPort`) that
 *     `@orbb/measurement`'s in-memory registries satisfy STRUCTURALLY.
 *     This package's dependency budget is @orbb/domain + @orbb/testkit
 *     only (per packet), so no @orbb/measurement import exists here; at
 *     integration, pass the real engine instances where tests use fakes.
 *   - M5-B mirrors (never imports) the measurement lane's A28
 *     `RegisteredMeasurementSource` shape and deny-by-default capability
 *     resolution pattern in `matcher.ts` (`RegisteredResourceSource` is
 *     structurally identical); integration passes the same records.
 *   - M5-B stage inputs are THIN LOCAL structural interfaces
 *     (`PlanCandidateLike` adapters in optimizer/matcher/safety):
 *     M5-A `PlanCandidate` satisfies them structurally; M5-A→M5-B
 *     integration reconciles the candidate-plan contract via those
 *     adapters (kind lookups for burden weighting and per-metric
 *     domain/cadence metadata for safety come from the caller —
 *     recorded in each module header).
 *   - `IntentResult` is structurally identical to the measurement lane's
 *     `EngineResult` (redeclared locally for the same dependency-budget
 *     reason); values interoperate at the boundary. If the tech lead
 *     later prefers a shared result/crypto kernel package, both lanes
 *     can adopt it mechanically.
 *   - Domain `HealthIntent` carries `evidencePackVersion` (a per-intent
 *     pointer) but no pack-id reference; linking an intent to its pack id
 *     (and updating `evidencePackVersion` on recompile) is integration
 *     work outside this packet's scope.
 *   - The domain canonical id kinds are frozen without an evidence-pack
 *     kind; `EvidencePackId` stays a lane-local branded grammar. Promoting
 *     it into `@orbb/domain/ids.ts` is a domain change requiring tech-lead
 *     review (not made unilaterally here).
 *   - The ESCALATE outcome (A41) is type-encoded as never publishable
 *     without human review; the review workflow that clears escalations
 *     is M5-C's seam — this package exports no conversion function.
 */
export { IntentEngineError, type IntentEngineErrorCode } from "./errors.js";
export { ok, err, type IntentResult } from "./result.js";

export {
  canonicalJsonStringify,
  hashWithDomainBase64Url,
  sha256Base64Url,
  sha256Hex,
} from "./canonical.js";

export {
  EVIDENCE_PACK_ENTRY_ID_PREFIX,
  EVIDENCE_PACK_ID_PREFIX,
  isEvidencePackEntryId,
  isEvidencePackId,
  type EvidencePackId,
} from "./ids.js";

export {
  PROVENANCE_ACTOR_CLASSES,
  assembleEvidencePackEntry,
  deriveEvidencePackEntryId,
  hashEvidencePack,
  isProvenanceActorClass,
  serializeEvidencePack,
  validateEvidencePack,
  validateEvidencePackEntry,
  validateEvidencePackEntryContent,
  type CoverageWindow,
  type EvidenceLabelCounts,
  type EvidencePack,
  type EvidencePackEntry,
  type EvidencePackEntryContent,
  type EvidencePackEntryError,
  type EvidencePackValidationError,
  type ProvenanceActorClass,
  type QualityMix,
} from "./evidencePack.js";

export {
  EVIDENCE_PACK_VERSION_STATES,
  InMemoryEvidencePackRegistry,
  recordToEvidencePack,
  type EvidencePackRegistrationError,
  type EvidencePackRegistrationOutcome,
  type EvidencePackRegistry,
  type EvidencePackVersionRecord,
  type EvidencePackVersionState,
  type RegisterEvidencePackInput,
  type SupersededEvidencePackVersionPair,
} from "./registry.js";

export {
  IntentCompiler,
  applyPlanTransition,
  hashIntentCompilation,
  serializeIntentCompilation,
  type CandidateExplainability,
  type CompileIntentInput,
  type ContributingPackEntry,
  type GatedGoalMetric,
  type GatedGoalMetricReason,
  type GoalMetric,
  type IntentCompilationOutput,
  type IntentCompileError,
  type IntentCompilerDeps,
  type IntentConstraints,
  type IntentGoal,
  type MeasurementMethodIndexPort,
  type MetricCatalogPort,
  type PlanCandidate,
} from "./compiler.js";

// ---------------------------------------------------------------------------
// M5-B (Lane A, packet 2) — burden optimizer (A39), resource/capability
// matcher (A40), safety/escalation rule engine (A41). The three stages
// consume the M5-A compiler's candidates through THIN LOCAL structural
// interfaces (`OptimizableCandidate`, `MatchableCandidate`,
// `SafetyCandidate` + the `*FromPlanCandidate` adapters); `PlanCandidate`
// satisfies the adapter input (`PlanCandidateLike`) structurally.
// Handoffs are recorded in each module header and below.
// ---------------------------------------------------------------------------

export {
  BURDEN_METHOD_KINDS,
  BurdenOptimizer,
  DEFAULT_BURDEN_MODEL,
  hashBurdenOptimization,
  isBurdenMethodKind,
  optimizableFromPlanCandidate,
  runBurdenOptimization,
  serializeBurdenOptimization,
  type BurdenMethodKind,
  type BurdenModel,
  type BurdenOptimizeInput,
  type BurdenOptimizerError,
  type BurdenOptimizerOutput,
  type DominatedCandidate,
  type EvaluatedCandidate,
  type InvalidBurdenModelReason,
  type InvalidCandidateReason,
  type OptimizableCandidate,
  type OptimizableMethodRef,
  type PlanCandidateAdaptationError,
  type PlanCandidateLike,
} from "./optimizer.js";

export {
  RESOURCE_SOURCE_KINDS,
  ResourceMatcher,
  hashResourceMatch,
  isResourceSourceKind,
  matchableFromPlanCandidate,
  runResourceMatch,
  serializeResourceMatch,
  type CoverageSummaryEntry,
  type DroppedCandidate,
  type ExecutableCandidate,
  type InvalidCoverageEntryReason,
  type InvalidMatchCandidateReason,
  type InvalidSourceReason,
  type MatchableCandidate,
  type MatchableMetricMethods,
  type MetricMatchFailure,
  type MetricMatchFailureReason,
  type MetricMethodBinding,
  type RegisteredResourceSource,
  type ResourceMatchError,
  type ResourceMatchInput,
  type ResourceMatchOutput,
  type ResourceSourceKind,
} from "./matcher.js";

export {
  DEFAULT_SAFETY_RULE_TABLE,
  RULE_VIOLATION_OUTCOMES,
  SAFETY_RULE_KINDS,
  SafetyRuleEngine,
  evaluateSafetyCandidate,
  hashSafetyOutcomes,
  isPublishableOutcome,
  isRuleViolationOutcome,
  safetyCandidateFromMatchable,
  safetyCandidateFromPlanCandidate,
  serializeSafetyOutcomes,
  type EscalateOutcome,
  type FiredRuleInputs,
  type FiredRuleRecord,
  type InvalidSafetyCandidateReason,
  type InvalidSafetyRuleReason,
  type PassOutcome,
  type RejectOutcome,
  type RuleViolationOutcome,
  type SafetyAdaptationError,
  type SafetyCandidate,
  type SafetyEvaluationError,
  type SafetyMetricAssignment,
  type SafetyMetricMetadata,
  type SafetyOutcome,
  type SafetyRule,
  type SafetyRuleCode,
  type SafetyRuleKind,
  type SafetyRuleTable,
} from "./safety.js";
