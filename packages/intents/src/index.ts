/**
 * @orbb/intents — intent compiler core for ORBB (M5-A, Lane A).
 *
 * Public surface (A36–A38, architecture §4 intent family):
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
 *
 * RECORDED HANDOFFS (integration boundary, engine wiring arrives later):
 *   - @orbb/measurement wiring: the compiler consumes the metric catalog
 *     and method registry through THIN LOCAL PORTS
 *     (`MetricCatalogPort` / `MeasurementMethodIndexPort`) that
 *     `@orbb/measurement`'s in-memory registries satisfy STRUCTURALLY.
 *     This package's dependency budget is @orbb/domain + @orbb/testkit
 *     only (per packet), so no @orbb/measurement import exists here; at
 *     integration, pass the real engine instances where tests use fakes.
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
