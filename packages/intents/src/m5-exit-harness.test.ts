/**
 * M5 EXIT HARNESS (Lane C packet M5-C) — the executable proof of the
 * Milestone 5 exit criterion:
 *
 *   "at least three intents generate explainable plans from versioned
 *    EvidencePacks; no plan executes before publication."
 *
 * Three distinct SYNTH intents (manage-blood-pressure, increase-activity,
 * improve-sleep) each run the FULL M5 pipeline through THIS packet's seam:
 *
 *   versioned EvidencePack (M5-A registry: v1 superseded by v2 — lineage)
 *     -> deterministic IntentCompiler (M5-A: burden-ordered DRAFT
 *        candidates with explainability audit trails)
 *     -> deterministic SafetyRuleEngine (M5-B: PASS / ESCALATE verdicts)
 *     -> [THIS PACKET] SyntheticProposalService (A42, SYNTH-model-01:
 *        proposal with provenance + rationale trail, NO decision authority)
 *     -> [THIS PACKET] InMemoryReviewWorkflow (A43: enqueue -> typed
 *        reviewer command -> DOMAIN transition draft->published through
 *        the frozen assertPlanTransition -> InMemoryPlanStore)
 *
 * The audit trail is then PROVEN to show:
 *   - PACK VERSION LINEAGE USED (every published plan's enqueue record
 *     cites the active version 2 with the full [1, 2] lineage; the
 *     registry confirms v1 superseded / v2 active; the proposal's
 *     rationale cites the same),
 *   - NO PLAN EXECUTED BEFORE PUBLICATION (the store is empty until the
 *     first approval; afterwards every stored plan is EXACTLY
 *     `published`; and the frozen domain grammar refuses draft->active,
 *     so publication cannot be skipped),
 *   - EVERY PUBLISHED PLAN TRACES TO A REVIEW RECORD (a 1:1 join onto
 *     an `approved` audit record whose entry was enqueued EARLIER in
 *     the trail, and whose reviewer provenance is a domain PersonId).
 *
 * Deterministic replay is asserted by running the whole scenario twice
 * on identically-constructed worlds (fresh DeterministicClock +
 * DeterministicIdFactory with fixed seeds) and comparing byte-identical
 * canonical serializations of the audit trail, the published plans, and
 * the proposal hashes.
 *
 * INTEGRATION NOTE (recorded handoff): this harness composes the REAL
 * M5-A modules (InMemoryEvidencePackRegistry, IntentCompiler) and the
 * REAL M5-B SafetyRuleEngine — the in-package integration-test pattern
 * the merged M5-B suites themselves use (safety.test.ts /
 * optimizer.test.ts import compiler.js + registry.js). The A42/A43
 * PRODUCTION modules (proposal.ts / review.ts) import NEITHER: they
 * consume the thin local views (`EvidencePackSummary`,
 * `CandidatePlanView`, `SafetyOutcomeView`) and the adapters below are
 * harness-local, demonstrating exactly the reconciliation the M5-A/M5-B
 * -> M5-C integration performs. Zero PHI: every fixture is SYNTH-marked.
 */
import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import {
  DomainInvariantError,
  assertPlanTransition,
  parseQualityScore,
  type EvidenceLabel,
  type IntentId,
  type MeasurementPlan,
  type MeasurementMethod,
  type MetricDefinition,
  type PersonId,
} from "@orbb/domain";
import { canonicalJsonStringify } from "./canonical.js";
import {
  IntentCompiler,
  type IntentCompilationOutput,
  type MeasurementMethodIndexPort,
  type MetricCatalogPort,
  type PlanCandidate,
} from "./compiler.js";
import { InMemoryEvidencePackRegistry } from "./registry.js";
import type { EvidencePackEntryContent } from "./evidencePack.js";
import type { EvidencePackId } from "./ids.js";
import {
  SafetyRuleEngine,
  safetyCandidateFromPlanCandidate,
  type SafetyOutcome,
} from "./safety.js";
import {
  SYNTH_FALLBACK_CONFIDENCE,
  SYNTH_MODEL_ID,
  SYNTH_MODEL_VERSION,
  SyntheticProposalService,
  hashProposal,
  serializeProposal,
  type CandidateContext,
  type CandidatePlanView,
  type EvidencePackSummary,
  type IntentForProposal,
  type Proposal,
  type SafetyOutcomeView,
} from "./proposal.js";
import {
  InMemoryPlanStore,
  InMemoryReviewWorkflow,
  hashReviewAuditTrail,
  serializeReviewAuditTrail,
  type ApprovedAuditRecord,
  type EnqueuedAuditRecord,
  type PublishedMeasurementPlan,
  type RejectedAuditRecord,
  type ReviewActCommand,
  type ReviewAuditRecord,
  type ReviewEntryId,
  type ReviewQueueEntry,
} from "./review.js";
import type { IntentResult } from "./result.js";

// ---------------------------------------------------------------------------
// The SYNTH world (all ids SYNTH-marked; no real person data).
// ---------------------------------------------------------------------------

const PERSON = "prsn_SYNTH-person-00000001" as PersonId;
const REVIEWER = "prsn_SYNTH-reviewer-0000001" as PersonId;
const OTHER_PERSON = "prsn_SYNTH-person-00000002" as PersonId;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Fixed scenario epoch: 2026-09-12T00:00:00.000Z (deterministic world). */
const CLOCK_EPOCH_MS = Date.UTC(2026, 8, 12);

const BP_SPEC = 0;
const STEPS_SPEC = 1;
const SLEEP_SPEC = 2;

const BP_METRIC = "SYNTH-metric-blood-pressure";
const STEPS_METRIC = "SYNTH-metric-step-count";
const SLEEP_METRIC = "SYNTH-metric-sleep-hours";

const BP_CONCEPT = "SYNTH-concept-blood-pressure";
const HR_CONCEPT = "SYNTH-concept-heart-rate";

const METRICS: readonly MetricDefinition[] = [
  {
    id: BP_METRIC,
    displayName: "SYNTH display blood pressure",
    unitDomain: ["SYNTH-unit-mmhg"],
    valueType: "quantity",
    conceptCode: BP_CONCEPT,
    category: "vital-signs",
  },
  {
    id: STEPS_METRIC,
    displayName: "SYNTH display step count",
    unitDomain: ["SYNTH-unit-steps"],
    valueType: "quantity",
    conceptCode: "SYNTH-concept-step-count",
    category: "activity",
  },
  {
    id: SLEEP_METRIC,
    displayName: "SYNTH display sleep hours",
    unitDomain: ["SYNTH-unit-hours"],
    valueType: "quantity",
    conceptCode: "SYNTH-concept-sleep-hours",
    category: "sleep",
  },
];

function methodDef(
  id: string,
  metricId: string,
  relativeBurden: number,
  evidenceLabel: EvidenceLabel = "MEASURED",
): MeasurementMethod {
  return {
    id,
    metricId,
    evidenceLabel,
    typicalQuality: { min: parseQualityScore(0.7), max: parseQualityScore(0.95) },
    relativeBurden,
  };
}

const METHODS: readonly MeasurementMethod[] = [
  methodDef("SYNTH-method-bp-cuff", BP_METRIC, 2),
  methodDef("SYNTH-method-bp-app", BP_METRIC, 3),
  methodDef("SYNTH-method-steps-wearable", STEPS_METRIC, 1),
  methodDef("SYNTH-method-steps-phone", STEPS_METRIC, 2),
  methodDef("SYNTH-method-sleep-wearable", SLEEP_METRIC, 1),
  methodDef("SYNTH-method-sleep-diary", SLEEP_METRIC, 2, "ESTIMATED"),
];

function packEntry(metricId: string, methodId: string, count: number): EvidencePackEntryContent {
  return {
    metricId,
    methodId,
    window: { startsAt: new Date(CLOCK_EPOCH_MS), endsAt: new Date(CLOCK_EPOCH_MS + DAY_MS) },
    count,
    qualityMix: {
      byEvidenceLabel: { MEASURED: count, ESTIMATED: 0, IMPORTED: 0, DERIVED: 0 },
    },
    provenanceActorClass: "device",
  };
}

/** One intent's full staging spec (identity, pack lineage, safety metadata). */
interface IntentSpec {
  readonly key: "manage-blood-pressure" | "increase-activity" | "improve-sleep";
  readonly intentId: IntentId;
  readonly objective: string;
  readonly metricId: string;
  readonly packId: EvidencePackId;
  readonly packV1: readonly EvidencePackEntryContent[];
  readonly packV2: readonly EvidencePackEntryContent[];
  readonly domain: string;
  readonly cadencePerDay: number;
}

const INTENT_SPECS: readonly IntentSpec[] = [
  {
    key: "manage-blood-pressure",
    intentId: "intent_SYNTH-manage-bp-000001" as IntentId,
    objective: "Manage blood pressure at home with regular measurement",
    metricId: BP_METRIC,
    packId: "evpack_SYNTH-pack-bp-0000001" as EvidencePackId,
    packV1: [packEntry(BP_METRIC, "SYNTH-method-bp-cuff", 4)],
    packV2: [
      packEntry(BP_METRIC, "SYNTH-method-bp-cuff", 12),
      packEntry(BP_METRIC, "SYNTH-method-bp-app", 6),
    ],
    domain: "vital-signs",
    cadencePerDay: 2,
  },
  {
    key: "increase-activity",
    intentId: "intent_SYNTH-more-steps-00001" as IntentId,
    objective: "Increase daily activity tracked as step count",
    metricId: STEPS_METRIC,
    packId: "evpack_SYNTH-pack-steps-0001" as EvidencePackId,
    packV1: [packEntry(STEPS_METRIC, "SYNTH-method-steps-wearable", 30)],
    packV2: [
      packEntry(STEPS_METRIC, "SYNTH-method-steps-wearable", 90),
      packEntry(STEPS_METRIC, "SYNTH-method-steps-phone", 20),
    ],
    domain: "activity",
    cadencePerDay: 2,
  },
  {
    key: "improve-sleep",
    intentId: "intent_SYNTH-better-sleep-0001" as IntentId,
    objective: "Improve sleep duration and regularity",
    metricId: SLEEP_METRIC,
    packId: "evpack_SYNTH-pack-sleep-0001" as EvidencePackId,
    packV1: [packEntry(SLEEP_METRIC, "SYNTH-method-sleep-wearable", 10)],
    packV2: [
      packEntry(SLEEP_METRIC, "SYNTH-method-sleep-wearable", 60),
      packEntry(SLEEP_METRIC, "SYNTH-method-sleep-diary", 7),
    ],
    domain: "sleep",
    // Below the sleep cadence floor (1/day): the safety gate ESCALATES —
    // the improve-sleep journey proves escalation clears ONLY via review.
    cadencePerDay: 0.5,
  },
];

// ---------------------------------------------------------------------------
// Structural fakes for the measurement read-model ports (exactly the
// @orbb/measurement registry shapes the compiler ports describe).
// ---------------------------------------------------------------------------

class FakeMetricCatalog implements MetricCatalogPort {
  readonly #metrics = new Map<string, MetricDefinition>();

  constructor(metrics: readonly MetricDefinition[]) {
    for (const metric of metrics) {
      this.#metrics.set(metric.id, metric);
    }
  }

  resolveActive(metricId: string): MetricDefinition | undefined {
    return this.#metrics.get(metricId);
  }
}

class FakeMethodIndex implements MeasurementMethodIndexPort {
  readonly #byId = new Map<string, MeasurementMethod>();
  readonly #byMetric = new Map<string, MeasurementMethod[]>();

  constructor(methods: readonly MeasurementMethod[]) {
    for (const method of methods) {
      this.#byId.set(method.id, method);
      const existing = this.#byMetric.get(method.metricId) ?? [];
      existing.push(method);
      this.#byMetric.set(method.metricId, existing);
    }
  }

  find(methodId: string): MeasurementMethod | undefined {
    return this.#byId.get(methodId);
  }

  listForMetric(metricId: string): readonly MeasurementMethod[] {
    return this.#byMetric.get(metricId) ?? [];
  }
}

// ---------------------------------------------------------------------------
// The world + the M5-A/M5-B -> M5-C view adapters (harness-local; these
// ARE the recorded reconciliation handoff, demonstrated executable).
// ---------------------------------------------------------------------------

interface World {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  readonly registry: InMemoryEvidencePackRegistry;
  readonly compiler: IntentCompiler;
  readonly safety: SafetyRuleEngine;
  readonly proposals: SyntheticProposalService;
  readonly store: InMemoryPlanStore;
  readonly workflow: InMemoryReviewWorkflow;
}

function buildWorld(idSeed: string): World {
  const clock = new DeterministicClock({ epochMs: CLOCK_EPOCH_MS });
  const ids = new DeterministicIdFactory({ seed: idSeed });
  const registry = new InMemoryEvidencePackRegistry(clock);
  const compiler = new IntentCompiler({
    registry,
    catalog: new FakeMetricCatalog(METRICS),
    methods: new FakeMethodIndex(METHODS),
    clock,
    ids,
  });
  const safety = new SafetyRuleEngine();
  const proposals = new SyntheticProposalService({ clock, ids });
  const store = new InMemoryPlanStore();
  const workflow = new InMemoryReviewWorkflow({ clock, ids, store });
  return { clock, ids, registry, compiler, safety, proposals, store, workflow };
}

function unwrap<T, E>(result: IntentResult<T, E>, label: string): T {
  if (!result.ok) {
    throw new Error(`harness invariant failed (${label}): unexpected typed rejection`);
  }
  return result.value;
}

function expectRejected<E>(result: IntentResult<unknown, E>, expected: E, label: string): void {
  if (result.ok) {
    throw new Error(`harness invariant failed (${label}): expected a typed rejection`);
  }
  expect(result.error).toEqual(expected);
}

function specAt(index: number): IntentSpec {
  const spec = INTENT_SPECS[index];
  if (spec === undefined) {
    throw new Error("harness invariant failed: spec index out of range");
  }
  return spec;
}

function findEnqueueRecord(
  audit: readonly ReviewAuditRecord[],
  entryId: ReviewEntryId,
): EnqueuedAuditRecord {
  const record = audit.find(
    (candidate): candidate is EnqueuedAuditRecord =>
      candidate.kind === "enqueued" && candidate.entryId === entryId,
  );
  if (record === undefined) {
    throw new Error("harness invariant failed: missing enqueue audit record");
  }
  return record;
}

/** M5-A record -> the A42 thin view (with the full lineage). */
function packSummaryOf(world: World, packId: EvidencePackId): EvidencePackSummary {
  const active = world.registry.resolveActive(packId);
  if (active === undefined) {
    throw new Error("harness invariant failed: expected an active pack version");
  }
  const lineage = world.registry.listVersions(packId).map((record) => record.version);
  return {
    packId,
    version: active.version,
    ...(active.supersedesVersion !== undefined
      ? { supersedesVersion: active.supersedesVersion }
      : {}),
    lineage,
    contentHash: active.contentHash,
    coveredMetricIds: [...new Set(active.entries.map((entry) => entry.metricId))],
    entryCount: active.entries.length,
  };
}

/** M5-A PlanCandidate -> the A42 thin view (draft plan WITHOUT state). */
function candidateViewOf(candidate: PlanCandidate): CandidatePlanView {
  return {
    plan: {
      id: candidate.plan.id,
      personId: candidate.plan.personId,
      intentId: candidate.plan.intentId,
      metrics: [...candidate.plan.metrics],
      createdAt: candidate.plan.createdAt,
    },
    metricId: candidate.metricId,
    conceptCode: candidate.conceptCode,
    methodId: candidate.methodId,
    methodOrder: [...candidate.methodOrder],
    packVersion: candidate.explainability.packVersion,
    totalObservationCount: candidate.explainability.totalObservationCount,
    methodRelativeBurden: candidate.explainability.methodRelativeBurden,
  };
}

/** M5-B SafetyOutcome -> the A42 thin view. */
function safetyViewOf(outcome: SafetyOutcome): SafetyOutcomeView {
  return {
    candidateId: outcome.candidateId,
    kind: outcome.kind,
    requiresHumanReview: outcome.requiresHumanReview,
    publishable: outcome.publishable,
    reasonCodes:
      outcome.kind === "ESCALATE"
        ? [...outcome.reasonCodes]
        : outcome.kind === "REJECT"
          ? [outcome.reason]
          : [],
  };
}

/** One intent's staged pipeline (pack versions -> candidates -> safety verdicts). */
interface StagedIntent {
  readonly spec: IntentSpec;
  readonly compilation: IntentCompilationOutput;
  readonly candidateViews: readonly CandidatePlanView[];
  readonly safetyOutcomes: readonly SafetyOutcome[];
  readonly safetyViews: readonly SafetyOutcomeView[];
  readonly summary: EvidencePackSummary;
  readonly intentView: IntentForProposal;
}

async function stageIntent(world: World, spec: IntentSpec): Promise<StagedIntent> {
  // Pack v1 (bootstrap), then supersession -> v2 ACTIVE (the lineage proof).
  world.clock.advance(HOUR_MS);
  const v1 = unwrap(
    world.registry.register({
      packId: spec.packId,
      personId: PERSON,
      entries: spec.packV1,
      assembledBy: PERSON,
      sourceEntryReferences: [`SYNTH-source-${spec.key}-v1`],
    }),
    "register pack v1",
  );
  expect(v1.record.version).toBe(1);
  world.clock.advance(HOUR_MS);
  const v2 = unwrap(
    world.registry.register({
      packId: spec.packId,
      personId: PERSON,
      entries: spec.packV2,
      assembledBy: PERSON,
      sourceEntryReferences: [`SYNTH-source-${spec.key}-v2`],
      supersedes: 1,
    }),
    "register pack v2",
  );
  expect(v2.record.version).toBe(2);
  expect(v2.pair?.superseded.version).toBe(1);

  // Compile the intent goal against the ACTIVE version (M5-A).
  world.clock.advance(HOUR_MS);
  const compilation = unwrap(
    world.compiler.compile({
      personId: PERSON,
      intentId: spec.intentId,
      packId: spec.packId,
      goal: { metrics: [{ metricId: spec.metricId }] },
    }),
    "compile intent",
  );
  expect(compilation.candidates.length).toBeGreaterThan(0);

  // Deterministic safety verdicts (M5-B) for every candidate.
  const outcomes: SafetyOutcome[] = [];
  for (const candidate of compilation.candidates) {
    const safetyCandidate = unwrap(
      safetyCandidateFromPlanCandidate(candidate, (metricId) =>
        metricId === spec.metricId
          ? { domain: spec.domain, cadencePerDay: spec.cadencePerDay }
          : undefined,
      ),
      "safety candidate adaptation",
    );
    outcomes.push(unwrap(world.safety.evaluate(safetyCandidate), "safety evaluation"));
  }

  return {
    spec,
    compilation,
    candidateViews: compilation.candidates.map(candidateViewOf),
    safetyOutcomes: outcomes,
    safetyViews: outcomes.map(safetyViewOf),
    summary: packSummaryOf(world, spec.packId),
    intentView: { intentId: spec.intentId, personId: PERSON, objective: spec.objective },
  };
}

/** Propose + enqueue one staged intent (the A42 seam -> A43 queue). */
async function proposeAndEnqueue(
  world: World,
  staged: StagedIntent,
): Promise<{ proposal: Proposal; entry: ReviewQueueEntry }> {
  world.clock.advance(HOUR_MS);
  const context: CandidateContext = {
    candidates: staged.candidateViews,
    safetyOutcomes: staged.safetyViews,
  };
  const proposal = unwrap(
    await world.proposals.proposePlan(staged.intentView, staged.summary, context),
    "propose plan",
  );
  world.clock.advance(HOUR_MS);
  const entry = unwrap(
    world.workflow.enqueueProposal({ proposal, actor: PERSON }),
    "enqueue proposal",
  );
  return { proposal, entry };
}

/** The per-intent reviewer edit (approve-with-edits command payload). */
function editsForIntent(
  spec: IntentSpec,
): { metrics?: readonly string[]; note?: string } | undefined {
  switch (spec.key) {
    case "manage-blood-pressure":
      // A real metric-set edit: the clinician co-monitors heart rate.
      return { metrics: [BP_CONCEPT, HR_CONCEPT], note: "SYNTH approval: co-monitor pulse" };
    case "increase-activity":
      // Approved as-is (no edits).
      return undefined;
    case "improve-sleep":
      // Note-only edit.
      return { note: "SYNTH approval: wearable nightly cadence accepted" };
  }
}

interface JourneyTrace {
  readonly spec: IntentSpec;
  readonly compilation: IntentCompilationOutput;
  readonly proposal: Proposal;
  readonly entry: ReviewQueueEntry;
  readonly approvedRecord: ApprovedAuditRecord;
  readonly enqueueRecord: EnqueuedAuditRecord;
  readonly published: PublishedMeasurementPlan;
}

interface ScenarioTrace {
  readonly journeys: readonly JourneyTrace[];
  readonly rejectedEntry: ReviewQueueEntry;
  readonly rejectionRecord: RejectedAuditRecord;
  readonly storeEmptyBeforeAnyApproval: boolean;
  readonly audit: readonly ReviewAuditRecord[];
  readonly publishedPlans: readonly PublishedMeasurementPlan[];
  readonly auditSerialized: string;
  readonly auditHash: string;
  readonly plansSerialized: string;
  readonly proposalHashes: readonly string[];
}

/**
 * THE exit scenario: three intents staged + enqueued (nothing published),
 * then each approved through the domain transition; the improve-sleep
 * diary escalation (a safety-ESCALATE candidate with no proposal) is
 * enqueued on the escalation path and REJECTED (terminal).
 */
async function runExitScenario(idSeed = "m5-exit"): Promise<ScenarioTrace> {
  const world = buildWorld(idSeed);

  // PHASE 1 — stage + propose + enqueue every intent (NO publication).
  const stagedList: StagedIntent[] = [];
  for (const spec of INTENT_SPECS) {
    stagedList.push(await stageIntent(world, spec));
  }
  const enqueuedList: { proposal: Proposal; entry: ReviewQueueEntry }[] = [];
  for (const staged of stagedList) {
    enqueuedList.push(await proposeAndEnqueue(world, staged));
  }

  // NO PLAN EXECUTED BEFORE PUBLICATION, part 1: the store is still empty.
  const storeEmptyBeforeAnyApproval = world.store.listAll().length === 0;
  expect(storeEmptyBeforeAnyApproval).toBe(true);

  // PHASE 2 — reviewer acts: approve (with edits) each enqueued proposal.
  const journeys: JourneyTrace[] = [];
  for (const [index, staged] of stagedList.entries()) {
    const enqueued = enqueuedList[index];
    if (enqueued === undefined) {
      throw new Error("harness invariant failed: staged/enqueued mismatch");
    }
    world.clock.advance(HOUR_MS);
    const edits = editsForIntent(staged.spec);
    const command: ReviewActCommand = {
      action: "approve-with-edits",
      entryId: enqueued.entry.entryId,
      reviewer: REVIEWER,
      ...(edits !== undefined ? { edits } : {}),
    };
    const acted = unwrap(world.workflow.act(command), "approve with edits");
    if (acted.kind !== "approved") {
      throw new Error("harness invariant failed: expected an approved outcome");
    }
    journeys.push({
      spec: staged.spec,
      compilation: staged.compilation,
      proposal: enqueued.proposal,
      entry: acted.entry,
      approvedRecord: acted.record,
      enqueueRecord: findEnqueueRecord(world.workflow.auditTrail(), acted.record.entryId),
      published: acted.plan,
    });
  }

  // PHASE 3 — the improve-sleep diary candidate: a safety-ESCALATE
  // candidate enqueued WITHOUT a proposal, then REJECTED (terminal).
  const sleepStaged = stagedList[SLEEP_SPEC];
  if (sleepStaged === undefined) {
    throw new Error("harness invariant failed: sleep staging missing");
  }
  const diaryCandidate = sleepStaged.compilation.candidates.find(
    (candidate) => candidate.methodId === "SYNTH-method-sleep-diary",
  );
  const diaryOutcome = sleepStaged.safetyOutcomes.find(
    (outcome) => outcome.candidateId === diaryCandidate?.plan.id,
  );
  if (diaryCandidate === undefined || diaryOutcome === undefined) {
    throw new Error("harness invariant failed: sleep diary candidate missing");
  }
  expect(diaryOutcome.kind).toBe("ESCALATE");
  const diaryView = candidateViewOf(diaryCandidate);
  world.clock.advance(HOUR_MS);
  const escalationEntry = unwrap(
    world.workflow.enqueueEscalation({
      escalation: {
        candidateId: diaryView.plan.id,
        reasonCodes: diaryOutcome.kind === "ESCALATE" ? [...diaryOutcome.reasonCodes] : [],
        plan: diaryView.plan,
        pack: {
          packId: sleepStaged.summary.packId,
          version: sleepStaged.summary.version,
          ...(sleepStaged.summary.supersedesVersion !== undefined
            ? { supersedesVersion: sleepStaged.summary.supersedesVersion }
            : {}),
          lineage: [...sleepStaged.summary.lineage],
        },
      },
      actor: PERSON,
    }),
    "enqueue escalation",
  );
  world.clock.advance(HOUR_MS);
  const rejection = unwrap(
    world.workflow.act({
      action: "reject",
      entryId: escalationEntry.entryId,
      reviewer: REVIEWER,
      reason: "SYNTH rejection: redundant with the approved wearable plan",
    }),
    "reject escalation",
  );
  if (rejection.kind !== "rejected") {
    throw new Error("harness invariant failed: expected a rejected outcome");
  }

  const audit = world.workflow.auditTrail();
  return {
    journeys,
    rejectedEntry: rejection.entry,
    rejectionRecord: rejection.record,
    storeEmptyBeforeAnyApproval,
    audit,
    publishedPlans: world.store.listAll(),
    auditSerialized: serializeReviewAuditTrail(audit),
    auditHash: hashReviewAuditTrail(audit),
    plansSerialized: canonicalJsonStringify(world.store.listAll()),
    proposalHashes: journeys.map((journey) => hashProposal(journey.proposal)),
  };
}

// ---------------------------------------------------------------------------
// THE EXIT CRITERION PROOF.
// ---------------------------------------------------------------------------

describe("M5 exit harness — three intents, explainable plans, review-gated publication", () => {
  it("publishes an explainable plan for each of the three distinct intents through the proposal -> review -> domain-transition seam", async () => {
    const trace = await runExitScenario();

    // THREE distinct intents, each with exactly one published plan.
    expect(trace.journeys).toHaveLength(3);
    expect(new Set(trace.journeys.map((journey) => journey.spec.intentId)).size).toBe(3);
    expect(trace.journeys.map((journey) => journey.spec.key)).toEqual([
      "manage-blood-pressure",
      "increase-activity",
      "improve-sleep",
    ]);
    expect(trace.publishedPlans).toHaveLength(3);
    for (const journey of trace.journeys) {
      const plans = trace.publishedPlans.filter((plan) => plan.intentId === journey.spec.intentId);
      expect(plans).toHaveLength(1);
      expect(plans[0]?.id).toBe(journey.published.id);
    }

    // Each published plan is a well-formed domain plan in the published
    // state (published-only states: nothing executed, nothing draft).
    for (const plan of trace.publishedPlans) {
      expect(plan.state).toBe("published");
      expect(plan.personId).toBe(PERSON);
      expect(plan.intentId).toBeDefined();
      expect(plan.metrics.length).toBeGreaterThan(0);
    }

    // EXPLAINABLE: each journey's proposal has the full rationale trail
    // (evidence -> candidates -> selection -> safety -> human decision),
    // its selected candidate IS the published plan, and the M5-A
    // explainability of that candidate (pack version + contributing
    // entries + coverage) backs the published plan.
    for (const journey of trace.journeys) {
      expect(journey.proposal.rationaleTrail.map((step) => step.kind)).toEqual([
        "evidence-considered",
        "candidates-reviewed",
        "candidate-selected",
        "safety-context-noted",
        "human-decision-required",
      ]);
      expect(journey.proposal.decisionAuthority).toBe("none");
      expect(journey.proposal.selectedCandidateId).toBe(journey.published.id);
      expect(journey.proposal.candidatePlan.id).toBe(journey.published.id);
      // Full §8 provenance on every AI artifact.
      expect(journey.proposal.provenance.modelId).toBe(SYNTH_MODEL_ID);
      expect(journey.proposal.provenance.modelVersion).toBe(SYNTH_MODEL_VERSION);
      expect(journey.proposal.provenance.promptHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(journey.proposal.provenance.confidence).toBeGreaterThanOrEqual(0);
      expect(journey.proposal.provenance.confidence).toBeLessThanOrEqual(1);
      // The M5-A explainability of the selected candidate.
      const selectedCandidate = journey.compilation.candidates.find(
        (candidate) => candidate.plan.id === journey.published.id,
      );
      expect(selectedCandidate).toBeDefined();
      expect(selectedCandidate?.explainability.packVersion).toBe(2);
      expect(selectedCandidate?.explainability.contributingEntries.length).toBeGreaterThan(0);
      expect(selectedCandidate?.explainability.totalObservationCount).toBeGreaterThan(0);
      expect(selectedCandidate?.explainability.metricId).toBe(journey.spec.metricId);
    }

    // The improve-sleep journey cleared an ESCALATE safety verdict through
    // human review (the M5-B type-encoding's only clearing path).
    const sleepJourney = trace.journeys[SLEEP_SPEC];
    expect(sleepJourney?.proposal.selectedSafetyOutcome?.kind).toBe("ESCALATE");
    expect(sleepJourney?.proposal.selectedSafetyOutcome?.reasonCodes).toContain(
      "cadence-below-floor",
    );
    expect(sleepJourney?.approvedRecord.escalatedReasonCodes).toContain("cadence-below-floor");

    // Reviewer edits: the blood-pressure plan's metric list was edited at
    // approval and the audit records original vs published.
    const bpJourney = trace.journeys[BP_SPEC];
    expect(bpJourney?.approvedRecord.originalMetrics).toEqual([BP_CONCEPT]);
    expect(bpJourney?.approvedRecord.publishedMetrics).toEqual([BP_CONCEPT, HR_CONCEPT]);
    expect(bpJourney?.approvedRecord.edits?.note).toBeDefined();
    expect(bpJourney?.published.metrics).toEqual([BP_CONCEPT, HR_CONCEPT]);
    // The steps plan was approved as-is (no edits).
    const stepsJourney = trace.journeys[STEPS_SPEC];
    expect(stepsJourney?.approvedRecord.edits).toBeUndefined();
    expect(stepsJourney?.approvedRecord.originalMetrics).toEqual(
      stepsJourney?.approvedRecord.publishedMetrics,
    );
  });

  it("proves PACK VERSION LINEAGE USED: every published plan cites the active version 2 with the full [1, 2] lineage", async () => {
    const trace = await runExitScenario();

    for (const journey of trace.journeys) {
      // The enqueue audit record carries the pack lineage the proposal
      // was derived from (the join key for the lineage proof).
      expect(journey.enqueueRecord.subject.kind).toBe("proposal");
      if (journey.enqueueRecord.subject.kind === "proposal") {
        expect(journey.enqueueRecord.subject.pack.version).toBe(2);
        expect(journey.enqueueRecord.subject.pack.supersedesVersion).toBe(1);
        expect(journey.enqueueRecord.subject.pack.lineage).toEqual([1, 2]);
        expect(journey.enqueueRecord.subject.pack.packId).toBe(journey.spec.packId);
        // The model provenance rides the audit record (§8 provenance).
        expect(journey.enqueueRecord.subject.modelProvenance.modelId).toBe(SYNTH_MODEL_ID);
      }
      // The proposal itself cites the same versioned pack.
      expect(journey.proposal.evidencePack.version).toBe(2);
      expect(journey.proposal.evidencePack.lineage).toEqual([1, 2]);
      expect(journey.proposal.evidencePack.supersedesVersion).toBe(1);
      // The rationale's evidence step cites pack v2 with the lineage.
      const evidenceStep = journey.proposal.rationaleTrail[0];
      expect(evidenceStep?.kind).toBe("evidence-considered");
      const packRef = evidenceStep?.refs[0];
      expect(packRef).toMatchObject({ kind: "pack", version: 2, lineage: [1, 2] });
    }

    // The registry itself confirms the lineage is real: v1 superseded,
    // v2 active — and the compile used v2's explainability.
    const world = buildWorld("m5-exit-lineage");
    for (const spec of INTENT_SPECS) {
      const staged = await stageIntent(world, spec);
      const versions = world.registry.listVersions(spec.packId);
      expect(versions.map((record) => record.version)).toEqual([1, 2]);
      expect(versions[0]?.state).toBe("superseded");
      expect(versions[1]?.state).toBe("active");
      expect(staged.compilation.packVersion).toBe(2);
      for (const candidate of staged.compilation.candidates) {
        expect(candidate.explainability.packVersion).toBe(2);
        expect(candidate.explainability.contributingEntries.length).toBeGreaterThan(0);
        expect(candidate.explainability.totalObservationCount).toBeGreaterThan(0);
      }
    }
  });

  it("proves NO PLAN EXECUTED BEFORE PUBLICATION: the store is empty until approval, then published-only, and the domain grammar forbids skipping publication", async () => {
    const trace = await runExitScenario();

    // Part 1: nothing was stored before the first reviewer approval.
    expect(trace.storeEmptyBeforeAnyApproval).toBe(true);

    // Part 2: every stored plan is EXACTLY published (no draft, no
    // active/execution, no completed/cancelled).
    for (const plan of trace.publishedPlans) {
      expect(plan.state).toBe("published");
    }
    expect(trace.publishedPlans.length).toBe(3);

    // Part 3: the frozen domain grammar makes draft->active ILLEGAL —
    // a plan cannot start executing without passing through published.
    expect(() => assertPlanTransition("draft", "active")).toThrow(DomainInvariantError);
    // (And publication -> activation remains the legal execution path.)
    expect(() => assertPlanTransition("published", "active")).not.toThrow();

    // Part 4: the rejected escalation produced NO plan at all.
    expect(trace.audit.filter((record) => record.kind === "approved")).toHaveLength(3);
    expect(trace.rejectionRecord.kind).toBe("rejected");
  });

  it("proves EVERY PUBLISHED PLAN TRACES TO A REVIEW RECORD (and the review record traces back to an enqueue)", async () => {
    const trace = await runExitScenario();

    for (const journey of trace.journeys) {
      const plan = journey.published;
      // The join: published plan -> exactly ONE approved review record.
      const approvedRecords = trace.audit.filter(
        (record): record is ApprovedAuditRecord =>
          record.kind === "approved" && record.planId === plan.id,
      );
      expect(approvedRecords).toHaveLength(1);
      const approved = approvedRecords[0];
      if (approved === undefined) {
        throw new Error("harness invariant failed: missing approved record");
      }
      // The review record carries reviewer provenance (a domain person).
      expect(approved.reviewer).toBe(REVIEWER);
      // The domain transition is recorded on the review record.
      expect(approved.fromState).toBe("draft");
      expect(approved.toState).toBe("published");
      // The record's entry exists and is approved.
      const entry = trace.journeys.find((j) => j.entry.entryId === approved.entryId)?.entry;
      expect(entry?.state).toBe("approved");
      // The entry was ENQUEUED earlier in the trail (chronology).
      const enqueuedRecord = findEnqueueRecord(trace.audit, approved.entryId);
      expect(enqueuedRecord.at.getTime()).toBeLessThanOrEqual(approved.at.getTime());
    }

    // Global invariant: every approved record's plan is IN the store and
    // every store plan HAS an approved record (1:1, nothing unreviewed).
    const approvedPlanIds = new Set(
      trace.audit
        .filter((record): record is ApprovedAuditRecord => record.kind === "approved")
        .map((record) => record.planId),
    );
    expect(approvedPlanIds.size).toBe(trace.publishedPlans.length);
    for (const plan of trace.publishedPlans) {
      expect(approvedPlanIds.has(plan.id)).toBe(true);
    }

    // The rejected entry's trail: enqueue record exists BEFORE the
    // rejection record; rejection is terminal for the entry.
    expect(trace.rejectedEntry.state).toBe("rejected");
    const escalationEnqueue = findEnqueueRecord(trace.audit, trace.rejectedEntry.entryId);
    expect(escalationEnqueue.subject.kind).toBe("escalation");
    if (escalationEnqueue.subject.kind === "escalation") {
      expect(escalationEnqueue.subject.reasonCodes).toContain("cadence-below-floor");
      expect(escalationEnqueue.subject.personId).toBe(PERSON);
      expect(escalationEnqueue.subject.pack?.lineage).toEqual([1, 2]);
    }
    expect(escalationEnqueue.at.getTime()).toBeLessThanOrEqual(
      trace.rejectionRecord.at.getTime(),
    );
  });

  it("replays DETERMINISTICALLY: byte-identical audit trail, published plans, and proposal hashes across two full runs", async () => {
    const first = await runExitScenario("m5-exit-replay");
    const second = await runExitScenario("m5-exit-replay");

    expect(second.auditSerialized).toBe(first.auditSerialized);
    expect(second.auditHash).toBe(first.auditHash);
    expect(second.plansSerialized).toBe(first.plansSerialized);
    expect([...second.proposalHashes]).toEqual([...first.proposalHashes]);
    expect(second.journeys.map((journey) => journey.published.id)).toEqual(
      first.journeys.map((journey) => journey.published.id),
    );
    // The prompt hashes (the §8 provenance) replay identically too.
    expect(
      second.journeys.map((journey) => journey.proposal.provenance.promptHash),
    ).toEqual(first.journeys.map((journey) => journey.proposal.provenance.promptHash));
  });
});

// ---------------------------------------------------------------------------
// A42 seam invariants (unit-level; the packet's "encode + test it" for
// the AI boundary).
// ---------------------------------------------------------------------------

describe("A42 — AI proposal seam invariants", () => {
  /** Stages the blood-pressure world + context (shared fixture). */
  async function stagedBp(
    idSeed = "m5c-a42",
  ): Promise<{ world: World; staged: StagedIntent; context: CandidateContext }> {
    const world = buildWorld(idSeed);
    const staged = await stageIntent(world, specAt(BP_SPEC));
    const context: CandidateContext = {
      candidates: staged.candidateViews,
      safetyOutcomes: staged.safetyViews,
    };
    return { world, staged, context };
  }

  it("is deterministic: identically constructed services propose byte-identical artifacts", async () => {
    const first = await stagedBp("m5c-a42-det");
    const second = await stagedBp("m5c-a42-det");
    const proposalA = unwrap(
      await first.world.proposals.proposePlan(
        first.staged.intentView,
        first.staged.summary,
        first.context,
      ),
      "propose A",
    );
    const proposalB = unwrap(
      await second.world.proposals.proposePlan(
        second.staged.intentView,
        second.staged.summary,
        second.context,
      ),
      "propose B",
    );
    expect(serializeProposal(proposalB)).toBe(serializeProposal(proposalA));
    expect(hashProposal(proposalB)).toBe(hashProposal(proposalA));
  });

  it("selects from the fixed table and never invents a candidate: the proposal echoes an input candidate's plan view", async () => {
    const { world, staged, context } = await stagedBp();
    const proposal = unwrap(
      await world.proposals.proposePlan(staged.intentView, staged.summary, context),
      "propose",
    );
    // The fixed table prefers the cuff method for the BP metric.
    const expected = context.candidates.find(
      (candidate) =>
        candidate.metricId === BP_METRIC && candidate.methodId === "SYNTH-method-bp-cuff",
    );
    expect(expected).toBeDefined();
    expect(proposal.candidatePlan.id).toBe(expected?.plan.id);
    expect(proposal.selectedCandidateId).toBe(expected?.plan.id);
    expect(proposal.provenance.confidence).toBe(0.86);
    // The candidate plan is a VIEW: no lifecycle state, not a plan.
    expect("state" in proposal.candidatePlan).toBe(false);
    expect(proposal.decisionAuthority).toBe("none");
  });

  it("falls back to the least-burden candidate with the fallback confidence when no table rule matches", async () => {
    const { staged, context } = await stagedBp();
    const service = new SyntheticProposalService({
      clock: new DeterministicClock({ epochMs: CLOCK_EPOCH_MS }),
      ids: new DeterministicIdFactory({ seed: "m5c-a42-fallback" }),
      table: [
        {
          metricId: "SYNTH-metric-body-weight",
          methodId: "SYNTH-method-wt-scale",
          confidence: 0.9,
        },
      ],
    });
    const proposal = unwrap(
      await service.proposePlan(staged.intentView, staged.summary, context),
      "propose fallback",
    );
    expect(proposal.candidatePlan.id).toBe(context.candidates[0]?.plan.id);
    expect(proposal.provenance.confidence).toBe(SYNTH_FALLBACK_CONFIDENCE);
  });

  it("rejects typed: invalid intent, invalid pack summary lineage, no candidates, malformed candidate", async () => {
    const { world, staged, context } = await stagedBp();

    const badIntent = await world.proposals.proposePlan(
      { ...staged.intentView, intentId: "intent_SHORT" as IntentId },
      staged.summary,
      context,
    );
    expectRejected(badIntent, { kind: "invalid-intent" }, "invalid intent");

    const badLineage = await world.proposals.proposePlan(
      staged.intentView,
      { ...staged.summary, lineage: [3] },
      context,
    );
    expectRejected(badLineage, { kind: "invalid-pack-summary" }, "invalid lineage");

    const noCandidates = await world.proposals.proposePlan(staged.intentView, staged.summary, {
      candidates: [],
      safetyOutcomes: [],
    });
    expectRejected(noCandidates, { kind: "no-candidates" }, "no candidates");

    const firstCandidate = context.candidates[0];
    if (firstCandidate === undefined) {
      throw new Error("harness invariant failed: no staged candidates");
    }
    const badCandidate = await world.proposals.proposePlan(staged.intentView, staged.summary, {
      candidates: [{ ...firstCandidate, plan: { ...firstCandidate.plan, id: "plan_x" as never } }],
      safetyOutcomes: context.safetyOutcomes,
    });
    expectRejected(
      badCandidate,
      { kind: "invalid-candidate", candidateIndex: 0 },
      "invalid candidate",
    );

    // A draft view smuggling a lifecycle `state` is malformed (the §8
    // encoding: a proposal is never a plan).
    const statefulView = await world.proposals.proposePlan(staged.intentView, staged.summary, {
      candidates: [
        { ...firstCandidate, plan: { ...firstCandidate.plan, state: "draft" } as never },
      ],
      safetyOutcomes: context.safetyOutcomes,
    });
    expectRejected(
      statefulView,
      { kind: "invalid-candidate", candidateIndex: 0 },
      "stateful view",
    );

    // A candidate belonging to ANOTHER person is never proposed for this
    // intent (the double cannot leak cross-person plans).
    const foreignCandidate = await world.proposals.proposePlan(staged.intentView, staged.summary, {
      candidates: [
        { ...firstCandidate, plan: { ...firstCandidate.plan, personId: OTHER_PERSON } },
      ],
      safetyOutcomes: context.safetyOutcomes,
    });
    expectRejected(
      foreignCandidate,
      { kind: "invalid-candidate-context" },
      "foreign person candidate",
    );
  });

  it("carries the safety context of the selected candidate on the proposal (reported, never evaluated)", async () => {
    const world = buildWorld("m5c-a42-sleep");
    const staged = await stageIntent(world, specAt(SLEEP_SPEC));
    const context: CandidateContext = {
      candidates: staged.candidateViews,
      safetyOutcomes: staged.safetyViews,
    };
    const proposal = unwrap(
      await world.proposals.proposePlan(staged.intentView, staged.summary, context),
      "propose sleep",
    );
    expect(proposal.selectedSafetyOutcome?.kind).toBe("ESCALATE");
    expect(proposal.selectedSafetyOutcome?.reasonCodes).toContain("cadence-below-floor");
    expect(proposal.selectedSafetyOutcome?.requiresHumanReview).toBe(true);
    expect(proposal.selectedSafetyOutcome?.publishable).toBe(false);
    const safetyStep = proposal.rationaleTrail.find((step) => step.kind === "safety-context-noted");
    expect(safetyStep?.statement).toContain("ESCALATE");
  });
});

// ---------------------------------------------------------------------------
// A43 workflow invariants (unit-level; the packet's "encode + test it").
// ---------------------------------------------------------------------------

describe("A43 — human review/publish workflow invariants", () => {
  /** Stages the BP world, proposes, and enqueues (a pending queue entry). */
  async function stagedQueue(
    idSeed = "m5c-a43",
  ): Promise<{
    world: World;
    staged: StagedIntent;
    context: CandidateContext;
    proposal: Proposal;
    entry: ReviewQueueEntry;
  }> {
    const world = buildWorld(idSeed);
    const staged = await stageIntent(world, specAt(BP_SPEC));
    const context: CandidateContext = {
      candidates: staged.candidateViews,
      safetyOutcomes: staged.safetyViews,
    };
    const proposal = unwrap(
      await world.proposals.proposePlan(staged.intentView, staged.summary, context),
      "propose",
    );
    const entry = unwrap(world.workflow.enqueueProposal({ proposal, actor: PERSON }), "enqueue");
    return { world, staged, context, proposal, entry };
  }

  it("rejects an approve command WITHOUT a matching enqueue as a typed error (the packet invariant)", async () => {
    const { world } = await stagedQueue();
    const unknownEntryId = "revq_SYNTH-never-enqueued-1" as ReviewEntryId;
    const approved = world.workflow.act({
      action: "approve-with-edits",
      entryId: unknownEntryId,
      reviewer: REVIEWER,
    });
    expectRejected(approved, { kind: "unknown-entry" }, "approve unknown entry");
    const rejected = world.workflow.act({
      action: "reject",
      entryId: unknownEntryId,
      reviewer: REVIEWER,
      reason: "SYNTH reason",
    });
    expectRejected(rejected, { kind: "unknown-entry" }, "reject unknown entry");
    // Nothing was published by the failed acts.
    expect(world.store.listAll()).toHaveLength(0);
  });

  it("makes rejection TERMINAL for the queue entry (no later approve, no double reject)", async () => {
    const { world, entry } = await stagedQueue();
    const rejected = unwrap(
      world.workflow.act({
        action: "reject",
        entryId: entry.entryId,
        reviewer: REVIEWER,
        reason: "SYNTH rejection: cadence too aggressive",
      }),
      "reject",
    );
    expect(rejected.entry.state).toBe("rejected");
    expect(world.store.listAll()).toHaveLength(0);

    const rejectedAgain = world.workflow.act({
      action: "reject",
      entryId: entry.entryId,
      reviewer: REVIEWER,
      reason: "SYNTH second reject",
    });
    expectRejected(rejectedAgain, { kind: "entry-not-pending" }, "double reject");

    const approvedAfterReject = world.workflow.act({
      action: "approve-with-edits",
      entryId: entry.entryId,
      reviewer: REVIEWER,
    });
    expectRejected(
      approvedAfterReject,
      { kind: "entry-not-pending" },
      "approve after reject",
    );
    expect(world.store.listAll()).toHaveLength(0);
  });

  it("makes approval once-only (a second approve on the same entry is a typed error)", async () => {
    const { world, entry } = await stagedQueue();
    const first = unwrap(
      world.workflow.act({
        action: "approve-with-edits",
        entryId: entry.entryId,
        reviewer: REVIEWER,
      }),
      "approve",
    );
    expect(first.kind).toBe("approved");
    expect(world.store.listAll()).toHaveLength(1);
    const second = world.workflow.act({
      action: "approve-with-edits",
      entryId: entry.entryId,
      reviewer: REVIEWER,
    });
    expectRejected(second, { kind: "entry-not-pending" }, "double approve");
    expect(world.store.listAll()).toHaveLength(1);
  });

  it("encodes that a proposal NEVER enters the plan store directly (type-level AND runtime)", async () => {
    const { world, proposal, entry } = await stagedQueue();

    // TYPE-PROOF 1: a ProposedDraftPlan is not assignable to a domain
    // MeasurementPlan (it has no lifecycle `state`). If this assignment
    // ever compiled, the @ts-expect-error below would itself fail
    // typecheck — the invariant is machine-checked.
    // @ts-expect-error TYPE-PROOF: a proposal's candidatePlan view lacks `state` and must NOT be a MeasurementPlan
    const notAPlan: MeasurementPlan = proposal.candidatePlan;
    expect(notAPlan).toBeDefined();
    expect("state" in proposal.candidatePlan).toBe(false);

    // TYPE-PROOF 2: the store accepts only published plans — a proposal
    // view is not savable. (If this call compiled, typecheck fails.)
    // @ts-expect-error TYPE-PROOF: the plan store accepts only PublishedMeasurementPlan, never a proposal view
    world.store.save(proposal.candidatePlan);

    // RUNTIME defense-in-depth: even a smuggled (cast) view is refused.
    const smuggled = proposal.candidatePlan as unknown as PublishedMeasurementPlan;
    const refused = world.store.save(smuggled);
    expectRejected(refused, { kind: "invalid-plan" }, "smuggled view");

    // A second, distinct intent also publishes through review — the
    // store holds multiple REVIEWED plans while refusing unreviewed ones.
    const stepsStaged = await stageIntent(world, specAt(STEPS_SPEC));
    const stepsProposal = unwrap(
      await world.proposals.proposePlan(
        stepsStaged.intentView,
        stepsStaged.summary,
        { candidates: stepsStaged.candidateViews, safetyOutcomes: stepsStaged.safetyViews },
      ),
      "propose steps",
    );
    const stepsEntry = unwrap(
      world.workflow.enqueueProposal({ proposal: stepsProposal, actor: PERSON }),
      "enqueue steps",
    );
    const approvedSteps = unwrap(
      world.workflow.act({
        action: "approve-with-edits",
        entryId: stepsEntry.entryId,
        reviewer: REVIEWER,
      }),
      "approve steps",
    );
    expect(approvedSteps.kind).toBe("approved");
    const approvedBp = unwrap(
      world.workflow.act({
        action: "approve-with-edits",
        entryId: entry.entryId,
        reviewer: REVIEWER,
      }),
      "approve bp",
    );
    if (approvedSteps.kind !== "approved") {
      throw new Error("harness invariant failed: expected steps approval");
    }
    if (approvedBp.kind !== "approved") {
      throw new Error("harness invariant failed: expected bp approval");
    }
    expect(world.store.get(approvedSteps.plan.id)).toBeDefined();
    expect(world.store.get(approvedBp.plan.id)).toBeDefined();
  });

  it("refuses a duplicate enqueue of the same draft plan (one review per plan draft)", async () => {
    const { world, staged, context } = await stagedQueue();
    const secondProposal = unwrap(
      await world.proposals.proposePlan(staged.intentView, staged.summary, context),
      "propose again",
    );
    const duplicate = world.workflow.enqueueProposal({ proposal: secondProposal, actor: PERSON });
    expectRejected(duplicate, { kind: "duplicate-plan" }, "duplicate enqueue");
  });

  it("refuses malformed proposals at the enqueue boundary (deny-by-default, typed)", async () => {
    const { world, proposal } = await stagedQueue();

    const selfAuthority = world.workflow.enqueueProposal({
      proposal: { ...proposal, decisionAuthority: "auto" } as unknown as Proposal,
      actor: PERSON,
    });
    expectRejected(selfAuthority, { kind: "invalid-proposal" }, "self authority");

    const statefulPlan = world.workflow.enqueueProposal({
      proposal: {
        ...proposal,
        candidatePlan: { ...proposal.candidatePlan, state: "draft" } as never,
      },
      actor: PERSON,
    });
    expectRejected(statefulPlan, { kind: "invalid-proposal" }, "stateful plan view");

    const personMismatch = world.workflow.enqueueProposal({
      proposal: { ...proposal, personId: OTHER_PERSON },
      actor: PERSON,
    });
    expectRejected(
      personMismatch,
      { kind: "proposal-person-mismatch" },
      "person mismatch",
    );

    const rationaleWithoutDisclaimer = world.workflow.enqueueProposal({
      proposal: { ...proposal, rationaleTrail: proposal.rationaleTrail.slice(0, 4) },
      actor: PERSON,
    });
    expectRejected(
      rationaleWithoutDisclaimer,
      { kind: "invalid-proposal" },
      "rationale without disclaimer",
    );
  });

  it("validates reviewer commands: reviewer id, entry id, reject reason, and edits", async () => {
    const { world, entry } = await stagedQueue();

    const badReviewer = world.workflow.act({
      action: "approve-with-edits",
      entryId: entry.entryId,
      reviewer: "not-a-person-id" as PersonId,
    });
    expectRejected(badReviewer, { kind: "invalid-reviewer" }, "bad reviewer");

    const badEntryId = world.workflow.act({
      action: "reject",
      entryId: "revq_too-short" as ReviewEntryId,
      reviewer: REVIEWER,
      reason: "SYNTH reason",
    });
    expectRejected(badEntryId, { kind: "invalid-entry-id" }, "bad entry id");

    const badAction = world.workflow.act({
      action: "postpone",
      entryId: entry.entryId,
      reviewer: REVIEWER,
    } as unknown as ReviewActCommand);
    expectRejected(badAction, { kind: "invalid-action" }, "bad action");

    const missingReason = world.workflow.act({
      action: "reject",
      entryId: entry.entryId,
      reviewer: REVIEWER,
      reason: "",
    });
    expectRejected(missingReason, { kind: "missing-reject-reason" }, "missing reason");

    const emptyMetrics = world.workflow.act({
      action: "approve-with-edits",
      entryId: entry.entryId,
      reviewer: REVIEWER,
      edits: { metrics: [] },
    });
    // Malformed edit payloads (empty metrics) are refused at the command
    // boundary (invalid-edits); the apply-time guard (invalid-edit) is
    // defense-in-depth behind it.
    expectRejected(emptyMetrics, { kind: "invalid-edits" }, "empty metrics edit");

    const duplicateMetrics = world.workflow.act({
      action: "approve-with-edits",
      entryId: entry.entryId,
      reviewer: REVIEWER,
      edits: { metrics: [BP_CONCEPT, BP_CONCEPT] },
    });
    expectRejected(duplicateMetrics, { kind: "invalid-edits" }, "duplicate metrics edit");

    // Nothing published by any refused command; the entry stays pending.
    expect(world.store.listAll()).toHaveLength(0);
    expect(world.workflow.getEntry(entry.entryId)?.state).toBe("pending");
  });

  it("publishes a safety-ESCALATED candidate ONLY through review approval (the M5-B clearing path)", async () => {
    const world = buildWorld("m5c-a43-escalation");
    const staged = await stageIntent(world, specAt(SLEEP_SPEC));
    const diaryCandidate = staged.compilation.candidates.find(
      (candidate) => candidate.methodId === "SYNTH-method-sleep-diary",
    );
    const diaryOutcome = staged.safetyOutcomes.find(
      (outcome) => outcome.candidateId === diaryCandidate?.plan.id,
    );
    if (diaryCandidate === undefined || diaryOutcome === undefined) {
      throw new Error("harness invariant failed: diary candidate missing");
    }
    expect(diaryOutcome.kind).toBe("ESCALATE");

    const view = candidateViewOf(diaryCandidate);
    const entry = unwrap(
      world.workflow.enqueueEscalation({
        escalation: {
          candidateId: view.plan.id,
          reasonCodes: diaryOutcome.kind === "ESCALATE" ? [...diaryOutcome.reasonCodes] : [],
          plan: view.plan,
          pack: {
            packId: staged.summary.packId,
            version: staged.summary.version,
            ...(staged.summary.supersedesVersion !== undefined
              ? { supersedesVersion: staged.summary.supersedesVersion }
              : {}),
            lineage: [...staged.summary.lineage],
          },
        },
        actor: PERSON,
      }),
      "enqueue escalation",
    );

    // Before approval: nothing published (an escalation never clears itself).
    expect(world.store.listAll()).toHaveLength(0);

    const approved = unwrap(
      world.workflow.act({
        action: "approve-with-edits",
        entryId: entry.entryId,
        reviewer: REVIEWER,
        edits: { note: "SYNTH clinician accepts the diary cadence" },
      }),
      "approve escalation",
    );
    if (approved.kind !== "approved") {
      throw new Error("harness invariant failed: expected approval");
    }
    expect(approved.plan.state).toBe("published");
    expect(world.store.listAll()).toHaveLength(1);
    // The audit trail proves the escalation was cleared by a HUMAN.
    expect(approved.record.escalatedReasonCodes).toContain("cadence-below-floor");
    expect(approved.record.modelProvenance).toBeUndefined();
    expect(approved.record.reviewer).toBe(REVIEWER);
    const enqueueRecord = findEnqueueRecord(world.workflow.auditTrail(), entry.entryId);
    expect(enqueueRecord.subject.kind).toBe("escalation");
    if (enqueueRecord.subject.kind === "escalation") {
      expect(enqueueRecord.subject.pack?.lineage).toEqual([1, 2]);
    }
  });

  it("refuses malformed escalations at the enqueue boundary (typed)", async () => {
    const world = buildWorld("m5c-a43-bad-escalation");
    const staged = await stageIntent(world, specAt(BP_SPEC));
    const candidate = staged.compilation.candidates[0];
    if (candidate === undefined) {
      throw new Error("harness invariant failed: no candidates");
    }
    const view = candidateViewOf(candidate);
    const emptyReasonCodes = world.workflow.enqueueEscalation({
      escalation: { candidateId: view.plan.id, reasonCodes: [], plan: view.plan },
      actor: PERSON,
    });
    expectRejected(emptyReasonCodes, { kind: "invalid-escalation" }, "empty reason codes");

    const badPlanId = world.workflow.enqueueEscalation({
      escalation: {
        candidateId: "not-a-plan-id",
        reasonCodes: ["cadence-below-floor"],
        plan: { ...view.plan, id: "plan_bad" as never },
      },
      actor: PERSON,
    });
    expectRejected(badPlanId, { kind: "invalid-escalation" }, "bad plan id");

    const badLineage = world.workflow.enqueueEscalation({
      escalation: {
        candidateId: view.plan.id,
        reasonCodes: ["cadence-below-floor"],
        plan: view.plan,
        pack: { packId: staged.summary.packId, version: 2, lineage: [9, 2] },
      },
      actor: PERSON,
    });
    expectRejected(badLineage, { kind: "invalid-escalation" }, "bad lineage");
  });
});
