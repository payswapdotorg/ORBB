/**
 * @orbb/measurement local test support — SYNTHETIC fixtures only.
 *
 * NOT exported from the package index (mirrors the @orbb/db `testing.ts`
 * precedent): this module exists so the engine's own tests (and the Lane
 * C E2E harness) can build deterministic, zero-PHI harnesses — every id,
 * name, and token is `SYNTH-`-marked testkit output; every observation is
 * a testkit `SyntheticObservation` with embedded provenance.
 *
 * Determinism contract: `buildEngineHarness` with the same seed/epoch and
 * the same call sequence replays byte-identically (testkit clock + id
 * factory are the only time/identity sources).
 */
import type { PersonId, PlanId } from "@orbb/domain";
import { parseIntentId, parsePersonId, parseQualityScore, type IntentId, type MeasurementPlan, type QualityScore } from "@orbb/domain";
import {
  DeterministicClock,
  DeterministicIdFactory,
  SyntheticFixtures,
  type SyntheticObservation,
} from "@orbb/testkit";
import type { RegisteredMeasurementSource } from "./capabilities.js";
import { InMemoryCapabilityIndex } from "./capabilities.js";
import { PlanCompiler, type PlanMetric } from "./compiler.js";
import { applyPlanTransition } from "./compiler.js";
import { AttemptRecorder } from "./attempts.js";
import { InMemoryMeasurementAttemptStore } from "./attempts.js";
import { ReconciliationService } from "./reconciliation.js";
import { InMemoryObservationArchive } from "./reconciliation.js";
import { TaskScheduler } from "./scheduler.js";
import { InMemoryMeasurementTaskStore } from "./scheduler.js";
import { SEEDED_METRIC_IDS, SEEDED_METHOD_IDS, seedMeasurementVocabulary } from "./seed.js";
import type { ProtocolDefinition, ScheduleRules } from "./protocol.js";

/** One millisecond/day in pure UTC arithmetic (DST-free). */
export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;

/** Canonical-id body reused across harness literals (26 chars, URL-safe). */
export const SYNTH_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

/** A canonical synthetic intent id for harness plans. */
export function harnessIntentId(): IntentId {
  return parseIntentId(`intent_${SYNTH_BODY}`);
}

/** A canonical synthetic person id for harness fixtures. */
export function harnessPersonId(): PersonId {
  return parsePersonId(`prsn_${SYNTH_BODY}`);
}

/** A canonical synthetic plan id (for direct task-store fixtures). */
export function harnessPlanId(): PlanId {
  return `plan_${SYNTH_BODY}` as PlanId;
}

/** The full engine harness: every service wired over in-memory doubles. */
export interface EngineHarness {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  readonly fixtures: SyntheticFixtures;
  readonly catalog: ReturnType<typeof seedMeasurementVocabulary>["catalog"];
  readonly methods: ReturnType<typeof seedMeasurementVocabulary>["methods"];
  readonly capabilityIndex: InMemoryCapabilityIndex;
  readonly compiler: PlanCompiler;
  readonly scheduler: TaskScheduler;
  readonly taskStore: InMemoryMeasurementTaskStore;
  readonly recorder: AttemptRecorder;
  readonly attemptStore: InMemoryMeasurementAttemptStore;
  readonly reconciler: ReconciliationService;
  readonly archive: InMemoryObservationArchive;
}

/** Options for {@link buildEngineHarness}. */
export interface EngineHarnessOptions {
  readonly seed?: string;
  readonly epochMs?: number;
}

/** Builds the engine harness with seeded real metric shapes. */
export function buildEngineHarness(options?: EngineHarnessOptions): EngineHarness {
  const seed = options?.seed ?? "m4a-seed";
  const epochMs = options?.epochMs ?? 0;
  const clock = new DeterministicClock({ epochMs });
  const ids = new DeterministicIdFactory({ seed });
  const fixtures = new SyntheticFixtures({ seed, epochMs });
  const { catalog, methods } = seedMeasurementVocabulary();
  const capabilityIndex = new InMemoryCapabilityIndex({ methods, catalog });
  const compiler = new PlanCompiler({ catalog, methods, clock, ids });
  const taskStore = new InMemoryMeasurementTaskStore();
  const scheduler = new TaskScheduler({ clock, store: taskStore });
  const attemptStore = new InMemoryMeasurementAttemptStore();
  const recorder = new AttemptRecorder({
    catalog,
    methods,
    capabilities: capabilityIndex,
    tasks: taskStore,
    attempts: attemptStore,
    clock,
    ids,
  });
  const archive = new InMemoryObservationArchive();
  const reconciler = new ReconciliationService({ catalog, clock, ids, archive });
  return {
    clock,
    ids,
    fixtures,
    catalog,
    methods,
    capabilityIndex,
    compiler,
    scheduler,
    taskStore,
    recorder,
    attemptStore,
    reconciler,
    archive,
  };
}

/**
 * Registers a synthetic measurement source for the person supporting the
 * given method ids (kind inferred: "manual" ids => manual, "app" ids =>
 * app, otherwise device).
 */
export function registerSource(
  harness: EngineHarness,
  personId: PersonId,
  methodIds: readonly string[],
  options?: { active?: boolean },
): RegisteredMeasurementSource {
  const first = methodIds[0] ?? "";
  const kind = first.includes("manual") ? "manual" : first.includes("app") ? "app" : "device";
  const source: RegisteredMeasurementSource = {
    sourceId: harness.fixtures.ids.next("src") as RegisteredMeasurementSource["sourceId"],
    personId,
    kind,
    supportedMethodIds: methodIds,
    active: options?.active ?? true,
  };
  const result = harness.capabilityIndex.registerSource(source);
  if (!result.ok) {
    throw new Error("Harness source registration failed (fixture integrity).");
  }
  return source;
}

/** A daily HR protocol authored against the seeded vocabulary. */
export function hrProtocol(schedule?: Partial<ScheduleRules>): ProtocolDefinition {
  const defaults: ScheduleRules = {
    intervalMs: MS_PER_DAY,
    windowDurationMs: MS_PER_HOUR,
    horizonMs: 2 * MS_PER_DAY,
    missedWindowPolicy: "roll-forward",
    anchorAt: new Date(0),
  };
  const merged: ScheduleRules = { ...defaults, ...schedule };
  return {
    protocolId: "SYNTH-protocol-hr-daily",
    metricSelectors: [{ metricId: SEEDED_METRIC_IDS.heartRate }],
    defaultSchedule: merged,
    methodPreferences: [
      {
        metricId: SEEDED_METRIC_IDS.heartRate,
        orderedMethodIds: [
          SEEDED_METHOD_IDS.heartRateWearable,
          SEEDED_METHOD_IDS.heartRateApp,
          SEEDED_METHOD_IDS.heartRateManual,
        ],
      },
    ],
  };
}

/** Compiles, publishes, and activates the protocol into a domain plan. */
export function compileActivePlan(
  harness: EngineHarness,
  protocol: ProtocolDefinition,
): { plan: MeasurementPlan; planMetrics: readonly PlanMetric[] } {
  const personId = harnessPersonId();
  const compiled = harness.compiler.compile({
    personId,
    intentId: harnessIntentId(),
    protocol,
  });
  if (!compiled.ok) {
    throw new Error("Harness plan compilation failed (fixture integrity).");
  }
  const published = applyPlanTransition(compiled.value.plan, "published");
  const active = applyPlanTransition(published, "active");
  return { plan: active, planMetrics: compiled.value.planMetrics };
}

/** Synthetic HR observation overrides aligned with the seeded HR metric. */
export interface HrObservationOverrides {
  personId?: PersonId;
  value?: number;
  quality?: number;
  methodId?: string;
  evidenceLabel?: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  effectiveAt?: Date;
  observedAt?: Date;
  validationState?: "pending" | "validated" | "rejected" | "superseded";
}

/** Builds a synthetic HR observation aligned with the seeded HR metric. */
export function hrObservation(
  harness: EngineHarness,
  overrides?: HrObservationOverrides,
): SyntheticObservation {
  const methodId = overrides?.methodId ?? SEEDED_METHOD_IDS.heartRateWearable;
  const evidenceLabel =
    overrides?.evidenceLabel ??
    (methodId === SEEDED_METHOD_IDS.heartRateApp ? "IMPORTED" : "MEASURED");
  const personId = overrides?.personId ?? harnessPersonId();
  const quality: QualityScore = parseQualityScore(overrides?.quality ?? 0.95);
  return harness.fixtures.observation({
    personId,
    conceptCode: "SYNTH-8867-4",
    value: overrides?.value ?? 72,
    unit: "beats/min",
    methodId,
    evidenceLabel,
    quality,
    validationState: overrides?.validationState ?? "pending",
    ...(overrides?.effectiveAt !== undefined ? { effectiveAt: overrides.effectiveAt } : {}),
    ...(overrides?.observedAt !== undefined ? { observedAt: overrides.observedAt } : {}),
  });
}
