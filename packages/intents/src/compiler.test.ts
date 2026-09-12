import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import {
  DomainInvariantError,
  assertMeasurementPlan,
  isIdOf,
  parseQualityScore,
  type DeviceId,
  type EvidenceLabel,
  type IntentId,
  type MeasurementMethod,
  type MetricDefinition,
  type PersonId,
} from "@orbb/domain";
import {
  IntentCompiler,
  applyPlanTransition,
  hashIntentCompilation,
  serializeIntentCompilation,
  type CompileIntentInput,
  type IntentCompilationOutput,
  type MeasurementMethodIndexPort,
  type MetricCatalogPort,
} from "./compiler.js";
import { InMemoryEvidencePackRegistry } from "./registry.js";
import type { EvidencePackEntryContent } from "./evidencePack.js";
import type { EvidencePackId } from "./ids.js";

// ---------------------------------------------------------------------------
// Fixtures (SYNTH grammar throughout; fakes satisfy the measurement ports
// structurally exactly like @orbb/measurement's in-memory registries will).
// ---------------------------------------------------------------------------

const PERSON = "prsn_SYNTH-person-00000001" as PersonId;
const OTHER_PERSON = "prsn_SYNTH-person-00000002" as PersonId;
const INTENT_ID = "intent_SYNTH-intent-00000001" as IntentId;
const DEVICE_ACTOR = "dev_SYNTH-device-00000001" as DeviceId;
const PACK_ID = "evpack_SYNTH-pack-00000001" as EvidencePackId;

const DAY_MS = 86_400_000;

const HR = "SYNTH-metric-heart-rate";
const STEPS = "SYNTH-metric-step-count";
const SLEEP = "SYNTH-metric-sleep-hours";
const BP = "SYNTH-metric-blood-pressure";

/** Pack claims: ring(8) + wearable(30) + app(10) for HR; steps 90 + 20. */
const PACK_ENTRIES: readonly EvidencePackEntryContent[] = [
  packEntry(HR, "SYNTH-method-hr-ring", 8),
  packEntry(HR, "SYNTH-method-hr-wearable", 30),
  packEntry(HR, "SYNTH-method-hr-app", 10),
  packEntry(STEPS, "SYNTH-method-steps-wearable", 90),
  packEntry(STEPS, "SYNTH-method-steps-phone", 20),
  // Claims an UNREGISTERED method -> capability gating (no-usable-method).
  packEntry(BP, "SYNTH-method-bp-manual", 4),
];

const METRICS: readonly MetricDefinition[] = [
  metricDef(HR, "SYNTH-concept-heart-rate"),
  metricDef(STEPS, "SYNTH-concept-step-count"),
  metricDef(SLEEP, "SYNTH-concept-sleep-hours"),
  metricDef(BP, "SYNTH-concept-blood-pressure"),
];

const METHODS: readonly MeasurementMethod[] = [
  methodDef("SYNTH-method-hr-ring", HR, 1),
  methodDef("SYNTH-method-hr-wearable", HR, 1),
  methodDef("SYNTH-method-hr-app", HR, 3),
  // Registered for HR but NEVER claimed by the pack: must not expand.
  methodDef("SYNTH-method-hr-chest-strap", HR, 5),
  methodDef("SYNTH-method-steps-wearable", STEPS, 1),
  methodDef("SYNTH-method-steps-phone", STEPS, 2),
  // Registered for SLEEP but the pack has no sleep entry: no coverage.
  methodDef("SYNTH-method-sleep-diary", SLEEP, 2, "ESTIMATED"),
  // Registered for BP but the pack claims only the unregistered manual one.
  methodDef("SYNTH-method-bp-cuff", BP, 3),
];

function packEntry(metricId: string, methodId: string, count: number): EvidencePackEntryContent {
  return {
    metricId,
    methodId,
    window: { startsAt: new Date(0), endsAt: new Date(DAY_MS) },
    count,
    qualityMix: {
      byEvidenceLabel: { MEASURED: count, ESTIMATED: 0, IMPORTED: 0, DERIVED: 0 },
    },
    provenanceActorClass: "device",
  };
}

function metricDef(id: string, conceptCode: string): MetricDefinition {
  return {
    id,
    displayName: `SYNTH display ${id}`,
    unitDomain: ["SYNTH-unit"],
    valueType: "quantity",
    conceptCode,
    category: "SYNTH-category",
  };
}

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

/** Structural stand-in for @orbb/measurement's metric catalog (read-only port). */
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

/** Structural stand-in for the measurement-method index (read-only port). */
class FakeMethodIndex implements MeasurementMethodIndexPort {
  readonly #methods = new Map<string, MeasurementMethod>();
  readonly #byMetric = new Map<string, MeasurementMethod[]>();

  constructor(methods: readonly MeasurementMethod[]) {
    for (const method of methods) {
      this.#methods.set(method.id, method);
      const list = this.#byMetric.get(method.metricId) ?? [];
      list.push(method);
      this.#byMetric.set(method.metricId, list);
    }
  }

  find(methodId: string): MeasurementMethod | undefined {
    return this.#methods.get(methodId);
  }

  listForMetric(metricId: string): readonly MeasurementMethod[] {
    return [...(this.#byMetric.get(metricId) ?? [])];
  }
}

function compileInput(overrides?: Partial<CompileIntentInput>): CompileIntentInput {
  return {
    personId: PERSON,
    intentId: INTENT_ID,
    packId: PACK_ID,
    goal: { metrics: [{ metricId: HR }] },
    ...overrides,
  };
}

function compileGoal(...metricIds: readonly string[]): CompileIntentInput {
  return compileInput({ goal: { metrics: metricIds.map((metricId) => ({ metricId })) } });
}

interface Harness {
  readonly clock: DeterministicClock;
  readonly registry: InMemoryEvidencePackRegistry;
  readonly compiler: IntentCompiler;
}

function harness(options?: {
  clockMs?: number;
  packEntries?: readonly EvidencePackEntryContent[];
}): Harness {
  const clock = new DeterministicClock({ epochMs: options?.clockMs ?? 1_000 });
  const registry = new InMemoryEvidencePackRegistry(clock);
  const registered = registry.register({
    packId: PACK_ID,
    personId: PERSON,
    entries: options?.packEntries ?? PACK_ENTRIES,
    assembledBy: DEVICE_ACTOR,
    sourceEntryReferences: ["SYNTH-source-ref-0001"],
  });
  if (!registered.ok) {
    throw new Error("expected fixture pack registration to succeed");
  }
  const compiler = new IntentCompiler({
    registry,
    catalog: new FakeMetricCatalog(METRICS),
    methods: new FakeMethodIndex(METHODS),
    clock,
    ids: new DeterministicIdFactory({ seed: "SYNTH-seed" }),
  });
  return { clock, registry, compiler };
}

function expectOk(
  result: ReturnType<IntentCompiler["compile"]>,
): IntentCompilationOutput {
  if (!result.ok) {
    throw new Error(`expected compilation to succeed, got: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// A38 — expansion + burden ordering.
// ---------------------------------------------------------------------------

describe("A38 IntentCompiler — candidate expansion", () => {
  it("emits one candidate per usable method, excluding methods the pack does not claim", () => {
    const output = expectOk(harness().compiler.compile(compileGoal(HR, STEPS)));
    // HR: ring + wearable + app (chest-strap registered but unclaimed).
    // STEPS: wearable + phone.
    expect(output.candidates.map((candidate) => [candidate.metricId, candidate.methodId]))
      .toEqual([
        [HR, "SYNTH-method-hr-ring"],
        [HR, "SYNTH-method-hr-wearable"],
        [STEPS, "SYNTH-method-steps-wearable"],
        [STEPS, "SYNTH-method-steps-phone"],
        [HR, "SYNTH-method-hr-app"],
      ]);
    // Both goal metrics expanded: nothing gated.
    expect(output.gated).toEqual([]);
  });

  it("orders candidates by burden asc, then metricId, then methodId (deterministic total order)", () => {
    const output = expectOk(harness().compiler.compile(compileGoal(HR, STEPS)));
    const order = output.candidates.map(
      (candidate) =>
        `${candidate.explainability.methodRelativeBurden}|${candidate.metricId}|${candidate.methodId}`,
    );
    expect(order).toEqual([
      `1|${HR}|SYNTH-method-hr-ring`,
      `1|${HR}|SYNTH-method-hr-wearable`,
      `1|${STEPS}|SYNTH-method-steps-wearable`,
      `2|${STEPS}|SYNTH-method-steps-phone`,
      `3|${HR}|SYNTH-method-hr-app`,
    ]);
  });

  it("emits DRAFT domain plans that pass the frozen domain plan guard", () => {
    const output = expectOk(harness().compiler.compile(compileGoal(HR, STEPS)));
    for (const candidate of output.candidates) {
      expect(candidate.plan.state).toBe("draft");
      expect(() => assertMeasurementPlan(candidate.plan)).not.toThrow();
      expect(isIdOf("plan", candidate.plan.id)).toBe(true);
      expect(candidate.plan.personId).toBe(PERSON);
      expect(candidate.plan.intentId).toBe(INTENT_ID);
      expect(candidate.plan.metrics).toEqual([candidate.conceptCode]);
      expect(candidate.plan.createdAt).toEqual(output.compiledAt);
      expect(candidate.methodOrder).toEqual([candidate.methodId]);
    }
  });

  it("carries the explainability audit trail (pack identity + contributing entries + totals)", () => {
    const { registry, compiler } = harness();
    const active = registry.resolveActive(PACK_ID);
    if (active === undefined) {
      throw new Error("expected fixture pack to resolve");
    }
    const output = expectOk(compiler.compile(compileGoal(HR, STEPS)));
    const wearable = output.candidates.find(
      (candidate) => candidate.methodId === "SYNTH-method-hr-wearable",
    );
    if (wearable === undefined) {
      throw new Error("expected a wearable candidate");
    }
    expect(wearable.conceptCode).toBe("SYNTH-concept-heart-rate");
    expect(wearable.explainability).toMatchObject({
      packId: PACK_ID,
      packVersion: 1,
      packContentHash: active.contentHash,
      metricId: HR,
      conceptCode: "SYNTH-concept-heart-rate",
      methodId: "SYNTH-method-hr-wearable",
      methodRelativeBurden: 1,
      methodEvidenceLabel: "MEASURED",
      totalObservationCount: 30,
    });
    expect(wearable.explainability.contributingEntries).toHaveLength(1);
    const contributing = wearable.explainability.contributingEntries[0]!;
    expect(contributing).toMatchObject({
      metricId: HR,
      methodId: "SYNTH-method-hr-wearable",
      count: 30,
      provenanceActorClass: "device",
    });
    expect(contributing.window).toEqual({ startsAt: new Date(0), endsAt: new Date(DAY_MS) });
    // PHID-safe by construction: the audit entry carries ONLY structural
    // summary fields — never values, observation ids, or actor ids.
    expect(Object.keys(contributing).sort()).toEqual([
      "count",
      "entryId",
      "methodId",
      "metricId",
      "provenanceActorClass",
      "window",
    ]);
    // Output pins the compiled pack identity.
    expect(output.packVersion).toBe(1);
    expect(output.packContentHash).toBe(active.contentHash);
    expect(output.compiledAt).toEqual(new Date(1_000));
    expect(output.intentId).toBe(INTENT_ID);
    expect(output.personId).toBe(PERSON);
    expect(output.packId).toBe(PACK_ID);
  });

  it("aggregates every contributing entry of the method into the observation total", () => {
    const entries: readonly EvidencePackEntryContent[] = [
      packEntry(HR, "SYNTH-method-hr-wearable", 12),
      packEntry(HR, "SYNTH-method-hr-wearable", 20),
    ];
    const output = expectOk(harness({ packEntries: entries }).compiler.compile(compileGoal(HR)));
    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0]!.explainability.totalObservationCount).toBe(32);
    expect(output.candidates[0]!.explainability.contributingEntries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// A38 — constraints (validated, deterministic effects only).
// ---------------------------------------------------------------------------

describe("A38 IntentCompiler — constraints", () => {
  it("excludes methods by id (and reports a metric fully excluded as gated)", () => {
    const { compiler } = harness();
    const output = expectOk(
      compiler.compile(
        compileInput({
          goal: { metrics: [{ metricId: HR }, { metricId: STEPS }] },
          constraints: { excludedMethodIds: ["SYNTH-method-hr-app"] },
        }),
      ),
    );
    expect(output.candidates.map((candidate) => candidate.methodId)).toEqual([
      "SYNTH-method-hr-ring",
      "SYNTH-method-hr-wearable",
      "SYNTH-method-steps-wearable",
      "SYNTH-method-steps-phone",
    ]);

    const allExcluded = expectOk(
      compiler.compile(
        compileInput({
          goal: { metrics: [{ metricId: HR }] },
          constraints: {
            excludedMethodIds: [
              "SYNTH-method-hr-ring",
              "SYNTH-method-hr-wearable",
              "SYNTH-method-hr-app",
            ],
          },
        }),
      ),
    );
    expect(allExcluded.candidates).toEqual([]);
    expect(allExcluded.gated).toEqual([
      { metricId: HR, reason: "all-methods-excluded", packEntryCount: 3 },
    ]);
  });

  it("caps candidates per metric, keeping the least burdensome", () => {
    const output = expectOk(
      harness().compiler.compile(
        compileInput({
          goal: { metrics: [{ metricId: HR }, { metricId: STEPS }] },
          constraints: { maxCandidatesPerMetric: 1 },
        }),
      ),
    );
    expect(output.candidates.map((candidate) => candidate.methodId)).toEqual([
      "SYNTH-method-hr-ring",
      "SYNTH-method-steps-wearable",
    ]);
  });

  it("gates pack entries below minCoverageCount before capability gating", () => {
    const { compiler } = harness();
    const output = expectOk(
      compiler.compile(
        compileInput({
          goal: { metrics: [{ metricId: HR }, { metricId: STEPS }] },
          constraints: { minCoverageCount: 25 },
        }),
      ),
    );
    // ring(8) and app(10) fall below 25; only wearable(30) survives for HR.
    expect(output.candidates.map((candidate) => candidate.methodId)).toEqual([
      "SYNTH-method-hr-wearable",
      "SYNTH-method-steps-wearable",
    ]);

    const none = expectOk(
      compiler.compile(
        compileInput({
          goal: { metrics: [{ metricId: HR }, { metricId: STEPS }] },
          constraints: { minCoverageCount: 200 },
        }),
      ),
    );
    expect(none.candidates).toEqual([]);
    expect(none.gated).toEqual([
      { metricId: HR, reason: "insufficient-coverage", packEntryCount: 3 },
      { metricId: STEPS, reason: "insufficient-coverage", packEntryCount: 2 },
    ]);
  });

  it("rejects malformed constraints (deny-by-default, typed)", () => {
    const { compiler } = harness();
    const rejections: readonly [unknown, string][] = [
      ["nope", "non-object constraints"],
      [{ excludedMethodIds: "nope" }, "non-array excludedMethodIds"],
      [{ excludedMethodIds: [""] }, "empty method id"],
      [{ maxCandidatesPerMetric: 0 }, "zero cap"],
      [{ maxCandidatesPerMetric: 1.5 }, "fractional cap"],
      [{ maxCandidatesPerMetric: "2" }, "string cap"],
      [{ minCoverageCount: 0 }, "zero coverage"],
    ];
    for (const [constraints] of rejections) {
      const result = compiler.compile(compileInput({ constraints: constraints as never }));
      expect(result).toEqual({ ok: false, error: { kind: "invalid-constraints" } });
    }
  });
});

// ---------------------------------------------------------------------------
// A38 — gated audit reasons.
// ---------------------------------------------------------------------------

describe("A38 IntentCompiler — gated goal metrics (typed audit)", () => {
  it("reports no-pack-coverage for goal metrics the pack has no entries for", () => {
    const output = expectOk(harness().compiler.compile(compileGoal(HR, SLEEP)));
    expect(output.candidates.map((candidate) => candidate.metricId)).toEqual([HR, HR, HR]);
    // Goal order preserved in the gated audit list.
    expect(output.gated).toEqual([
      { metricId: SLEEP, reason: "no-pack-coverage", packEntryCount: 0 },
    ]);
  });

  it("reports no-usable-method when the pack claims only unregistered methods", () => {
    const output = expectOk(harness().compiler.compile(compileGoal(BP)));
    expect(output.candidates).toEqual([]);
    expect(output.gated).toEqual([
      { metricId: BP, reason: "no-usable-method", packEntryCount: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// A38 — determinism (the packet's determinism-hash assertion tests).
// ---------------------------------------------------------------------------

describe("A38 IntentCompiler — determinism", () => {
  it("produces byte-identical output for identical inputs (determinism hash assertion)", () => {
    const first = harness();
    const second = harness();
    const outA = expectOk(first.compiler.compile(compileGoal(HR, STEPS)));
    // Same instance, compiled again (candidate ids are content-derived).
    const outARepeat = expectOk(first.compiler.compile(compileGoal(HR, STEPS)));
    // A separately constructed, identically seeded harness.
    const outB = expectOk(second.compiler.compile(compileGoal(HR, STEPS)));

    expect(serializeIntentCompilation(outA)).toBe(serializeIntentCompilation(outARepeat));
    expect(serializeIntentCompilation(outA)).toBe(serializeIntentCompilation(outB));
    expect(hashIntentCompilation(outA)).toBe(hashIntentCompilation(outARepeat));
    expect(hashIntentCompilation(outA)).toBe(hashIntentCompilation(outB));
    expect(hashIntentCompilation(outA)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compiles byte-identically for equivalent inputs built in different key order", () => {
    const { compiler } = harness();
    const canonical = expectOk(compiler.compile(compileGoal(HR)));
    const reordered = expectOk(
      compiler.compile({
        goal: { metrics: [{ metricId: HR }] },
        packId: PACK_ID,
        intentId: INTENT_ID,
        personId: PERSON,
      }),
    );
    expect(serializeIntentCompilation(reordered)).toBe(serializeIntentCompilation(canonical));
  });

  it("keeps candidate plan ids replay-stable while compiledAt follows the clock", () => {
    const { clock, compiler } = harness();
    const first = expectOk(compiler.compile(compileGoal(HR, STEPS)));
    clock.advance(DAY_MS);
    const second = expectOk(compiler.compile(compileGoal(HR, STEPS)));

    expect(second.compiledAt).toEqual(new Date(1_000 + DAY_MS));
    // Time moved: the serialized output differs (compiledAt is content).
    expect(serializeIntentCompilation(second)).not.toBe(serializeIntentCompilation(first));
    // But the candidate plan ids are time-INDEPENDENT (content-derived).
    expect(second.candidates.map((candidate) => candidate.plan.id)).toEqual(
      first.candidates.map((candidate) => candidate.plan.id),
    );
  });

  it("derives distinct candidate plan ids per semantic identity", () => {
    const { compiler } = harness();
    const output = expectOk(compiler.compile(compileGoal(HR, STEPS)));
    const planIds = output.candidates.map((candidate) => candidate.plan.id);
    // All distinct (5 candidates, 5 distinct content-derived ids).
    expect(new Set(planIds).size).toBe(planIds.length);
    // A different intent compiles the same pack content to DIFFERENT ids.
    const otherIntent = expectOk(
      compiler.compile(compileInput({ intentId: "intent_SYNTH-intent-00000002" as IntentId })),
    );
    expect(
      otherIntent.candidates.map((candidate) => candidate.plan.id),
    ).not.toEqual(output.candidates.map((candidate) => candidate.plan.id));
  });

  it("pins compilation to the ACTIVE pack version: supersession changes ids + content hash", () => {
    const { clock, registry, compiler } = harness();
    const v1 = expectOk(compiler.compile(compileGoal(HR)));

    clock.advance(DAY_MS);
    const superseded = registry.register({
      packId: PACK_ID,
      personId: PERSON,
      entries: [packEntry(HR, "SYNTH-method-hr-wearable", 31)],
      assembledBy: DEVICE_ACTOR,
      sourceEntryReferences: ["SYNTH-source-ref-0002"],
      supersedes: 1,
    });
    if (!superseded.ok) {
      throw new Error("expected v2 registration to succeed");
    }

    const v2 = expectOk(compiler.compile(compileGoal(HR)));
    const active = registry.resolveActive(PACK_ID);
    expect(active?.version).toBe(2);
    expect(v2.packVersion).toBe(2);
    expect(v2.packContentHash).toBe(active?.contentHash);
    expect(v2.compiledAt).toEqual(new Date(1_000 + DAY_MS));
    expect(v2.candidates).toHaveLength(1);
    expect(v2.candidates[0]!.methodId).toBe("SYNTH-method-hr-wearable");
    expect(v2.candidates[0]!.explainability.totalObservationCount).toBe(31);
    // New pack version => new semantic identity => new plan id.
    expect(v2.candidates[0]!.plan.id).not.toBe(
      v1.candidates.find((candidate) => candidate.methodId === "SYNTH-method-hr-wearable")!.plan
        .id,
    );
  });
});

// ---------------------------------------------------------------------------
// A38 — typed rejections (deny-by-default, never throws).
// ---------------------------------------------------------------------------

describe("A38 IntentCompiler — typed rejections", () => {
  it("rejects malformed identities and unknown packs without throwing", () => {
    const { compiler } = harness();
    expect(compiler.compile(null as unknown as CompileIntentInput)).toEqual({
      ok: false,
      error: { kind: "invalid-person-id" },
    });
    expect(
      compiler.compile(compileInput({ personId: "nope" as unknown as PersonId })),
    ).toEqual({ ok: false, error: { kind: "invalid-person-id" } });
    expect(
      compiler.compile(compileInput({ intentId: "nope" as unknown as IntentId })),
    ).toEqual({ ok: false, error: { kind: "invalid-intent-id" } });
    expect(
      compiler.compile(compileInput({ packId: "not-a-pack" as unknown as EvidencePackId })),
    ).toEqual({ ok: false, error: { kind: "invalid-pack-id" } });
    expect(
      compiler.compile(
        compileInput({ packId: "evpack_SYNTH-unknown-00001" as EvidencePackId }),
      ),
    ).toEqual({ ok: false, error: { kind: "unknown-pack" } });
  });

  it("rejects an intent compiled against another person's pack (scope invariant)", () => {
    const { compiler } = harness();
    expect(
      compiler.compile(compileInput({ personId: OTHER_PERSON })),
    ).toEqual({ ok: false, error: { kind: "pack-person-mismatch" } });
  });

  it("rejects malformed and empty goals with typed indexes", () => {
    const { compiler } = harness();
    expect(compiler.compile(compileInput({ goal: "nope" as unknown as never }))).toEqual({
      ok: false,
      error: { kind: "invalid-goal" },
    });
    expect(
      compiler.compile(compileInput({ goal: { metrics: "nope" as unknown as never } })),
    ).toEqual({ ok: false, error: { kind: "invalid-goal" } });
    expect(compiler.compile(compileInput({ goal: { metrics: [] } }))).toEqual({
      ok: false,
      error: { kind: "no-goal-metrics" },
    });
    expect(
      compiler.compile(compileInput({ goal: { metrics: [{ metricId: "" }] } })),
    ).toEqual({ ok: false, error: { kind: "invalid-goal-metric", metricIndex: 0 } });
    expect(
      compiler.compile(compileInput({ goal: { metrics: ["nope" as unknown as never] } })),
    ).toEqual({ ok: false, error: { kind: "invalid-goal-metric", metricIndex: 0 } });
    expect(
      compiler.compile(compileGoal(HR, HR)),
    ).toEqual({ ok: false, error: { kind: "duplicate-goal-metric", metricIndex: 1 } });
    expect(
      compiler.compile(compileGoal("SYNTH-metric-unknown")),
    ).toEqual({ ok: false, error: { kind: "unknown-goal-metric", metricIndex: 0 } });
  });
});

// ---------------------------------------------------------------------------
// A38 — draft-only publication boundary (frozen domain state machine).
// ---------------------------------------------------------------------------

describe("A38 — draft-only output; publication stays a domain transition", () => {
  it("never publishes or activates: applyPlanTransition routes through the frozen guard", () => {
    const output = expectOk(harness().compiler.compile(compileGoal(HR)));
    const draft = output.candidates[0]!.plan;

    const published = applyPlanTransition(draft, "published");
    expect(published.state).toBe("published");
    // Immutability: the original draft stays a draft.
    expect(draft.state).toBe("draft");

    const active = applyPlanTransition(published, "active");
    expect(active.state).toBe("active");
    expect(applyPlanTransition(active, "completed").state).toBe("completed");
  });

  it("still lets the frozen domain guard reject illegal transitions", () => {
    const output = expectOk(harness().compiler.compile(compileGoal(HR)));
    const draft = output.candidates[0]!.plan;
    // draft -> active is illegal (draft may only be published).
    expect(() => applyPlanTransition(draft, "active")).toThrow(DomainInvariantError);
    expect(() => applyPlanTransition(draft, "cancelled")).toThrow(DomainInvariantError);
    expect(() => applyPlanTransition(draft, "completed")).toThrow(DomainInvariantError);
  });
});
