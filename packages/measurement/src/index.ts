/**
 * @orbb/measurement — measurement engine core (M4-A, Lane A).
 *
 * Public surface (A27–A31 + reconciliation, architecture §5 measurement
 * family):
 *   - A27 `MetricCatalog` — versioned registry of `MetricDefinition`s
 *     (supersession lifecycle mirroring the frozen domain semantics).
 *   - A28 `MeasurementMethodRegistry` + `CapabilityIndex` — methods and
 *     per-person usable-method resolution (deny-by-default, typed
 *     results).
 *   - A29 `PlanCompiler` — authored protocol definitions -> domain
 *     `MeasurementPlan` drafts + expanded `PlanMetric`s (deterministic,
 *     pure, no I/O); plan publication stays a domain transition.
 *   - A30 `TaskScheduler` — active plans -> `MeasurementTask`s with
 *     `MeasurementWindow`s (UTC ms window math, idempotent per (plan,
 *     window) via domain-separated deterministic ids, missed windows
 *     roll forward per recorded policy).
 *   - A31 `AttemptRecorder` — `MeasurementAttempt`s with completion
 *     quality states (complete/partial/low-quality over the domain
 *     quality vocabulary) and the method fallback chain.
 *   - `ReconciliationService` — two same-metric observations from
 *     different methods/sources reconcile into ONE canonical view with
 *     per-source provenance and a quality verdict; data is never
 *     discarded (domain supersession).
 *
 * Services are interface-driven: stores/registries/clock/id-factory are
 * injected ports; NO @orbb/db imports (db adapters arrive in a later
 * integration packet — handoff recorded). AI-boundary note (§8): attempt
 * records carry the evidence + confidence seams so AI extraction can
 * later attach source evidence, confidence, and model provenance without
 * schema changes.
 *
 * The M0 boundary type-only re-exports are retained for compatibility.
 */
export type {
  MeasurementPlan,
  Observation,
  ObservationId,
  ObservationValidationState,
  PlanId,
  PlanState,
  QualityScore,
  TaskId,
} from "@orbb/domain";

export { MeasurementEngineError, type MeasurementEngineErrorCode } from "./errors.js";
export { ok, err, type EngineResult } from "./result.js";
export { deriveDeterministicId, PLAN_METRIC_ID_PREFIX } from "./ids.js";

export {
  InMemoryMetricCatalog,
  METRIC_VERSION_STATES,
  type MetricCatalog,
  type MetricRegistrationError,
  type MetricRegistrationOutcome,
  type MetricVersionRecord,
  type MetricVersionState,
  type RegisterMetricInput,
  type SupersededMetricVersionPair,
} from "./catalog.js";

export {
  InMemoryMeasurementMethodRegistry,
  type MeasurementMethodRegistry,
  type MethodRegistrationError,
  type MethodRegistrationOutcome,
} from "./methods.js";

export {
  InMemoryCapabilityIndex,
  MEASUREMENT_SOURCE_KINDS,
  type CapabilityDenyReason,
  type CapabilityIndex,
  type CapabilityResolution,
  type MeasurementSourceKind,
  type RegisteredMeasurementSource,
  type ResolvedCapability,
  type SourceRegistrationError,
  isMeasurementSourceKind,
} from "./capabilities.js";

export {
  MISSED_WINDOW_POLICIES,
  isMissedWindowPolicy,
  type CadenceSpec,
  type MethodPreference,
  type MissedWindowPolicy,
  type MetricSelector,
  type ProtocolDefinition,
  type ScheduleOverride,
  type ScheduleRules,
} from "./protocol.js";

export {
  PlanCompiler,
  applyPlanTransition,
  type CompiledPlan,
  type CompileProtocolError,
  type CompileProtocolInput,
  type InvalidScheduleRule,
  type PlanCompilerDeps,
  type PlanMetric,
  type ResolvedSchedule,
} from "./compiler.js";

export {
  InMemoryMeasurementTaskStore,
  TASK_STATES,
  TaskScheduler,
  compareTasks,
  type MeasurementTask,
  type MeasurementTaskStore,
  type MeasurementWindow,
  type ScheduleTasksError,
  type ScheduleTasksInput,
  type ScheduleTasksOutcome,
  type TaskSchedulerDeps,
  type TaskState,
} from "./scheduler.js";

export {
  ATTEMPT_ID_PREFIX,
  COMPLETION_QUALITY_STATES,
  AttemptRecorder,
  InMemoryMeasurementAttemptStore,
  TypicalRangeQualityPolicy,
  isAttemptId,
  isCompletionQuality,
  type AttemptId,
  type AttemptRecorderDeps,
  type CompletionQuality,
  type MeasurementAttempt,
  type MeasurementAttemptStore,
  type QualityClassificationPolicy,
  type RecordAttemptError,
  type RecordAttemptInput,
  type RecordAttemptOutcome,
  type TypicalRangeQualityPolicyOptions,
} from "./attempts.js";

export {
  RECONCILIATION_VERDICTS,
  InMemoryObservationArchive,
  ReconciliationService,
  type CanonicalObservationView,
  type ObservationArchive,
  type ReconcileInput,
  type ReconcileOutcome,
  type ReconciliationError,
  type ReconciliationPolicy,
  type ReconciliationServiceDeps,
  type ReconciliationVerdict,
  type ReconciliationWindow,
  type SourceProvenanceRecord,
  type SourceRole,
  type SourcedObservation,
} from "./reconciliation.js";

export {
  SEEDED_METRIC_DEFINITIONS,
  SEEDED_METRIC_IDS,
  SEEDED_METHODS,
  SEEDED_METHOD_IDS,
  seedMeasurementVocabulary,
  type SeededMeasurementVocabulary,
} from "./seed.js";
