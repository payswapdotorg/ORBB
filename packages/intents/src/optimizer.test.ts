import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import type {
  DeviceId,
  EvidenceLabel,
  IntentId,
  MeasurementMethod,
  MetricDefinition,
  PersonId,
} from "@orbb/domain";
import { parseQualityScore } from "@orbb/domain";
import {
  BURDEN_METHOD_KINDS,
  BurdenOptimizer,
  DEFAULT_BURDEN_MODEL,
  hashBurdenOptimization,
  isBurdenMethodKind,
  optimizableFromPlanCandidate,
  runBurdenOptimization,
  serializeBurdenOptimization,
  type BurdenModel,
  type BurdenOptimizerOutput,
  type OptimizableCandidate,
} from "./optimizer.js";
import { IntentCompiler } from "./compiler.js";
import { InMemoryEvidencePackRegistry } from "./registry.js";
import type { EvidencePackEntryContent } from "./evidencePack.js";
import type { EvidencePackId } from "./ids.js";
import type {
  IntentCompilationOutput,
  MeasurementMethodIndexPort,
  MetricCatalogPort,
} from "./compiler.js";

// ---------------------------------------------------------------------------
// Local fixtures (SYNTH grammar throughout — zero PHI, mirroring the M5-A
// suites; fakes satisfy the measurement ports structurally).
// ---------------------------------------------------------------------------

function candidate(
  overrides: Partial<OptimizableCandidate> & { candidateId: string },
): OptimizableCandidate {
  return {
    metrics: ["SYNTH-metric-a"],
    methods: [{ methodId: "SYNTH-method-a-device", kind: "device" }],
    windowCount: 0,
    ...overrides,
  };
}

function expectOk(
  result: ReturnType<typeof runBurdenOptimization>,
): BurdenOptimizerOutput {
  if (!result.ok) {
    throw new Error(`expected optimization to succeed, got: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// A39 — burden model.
// ---------------------------------------------------------------------------

describe("A39 BurdenOptimizer — burden model", () => {
  it("exposes the frozen default model with manual > app > device weights (measurement-lane seed ranks)", () => {
    expect(DEFAULT_BURDEN_MODEL.methodKindWeights).toEqual({ manual: 3, app: 2, device: 1 });
    expect(DEFAULT_BURDEN_MODEL.metricCadenceCosts).toEqual({});
    expect(DEFAULT_BURDEN_MODEL.defaultMetricCadenceCost).toBe(1);
    expect(DEFAULT_BURDEN_MODEL.windowCountWeight).toBe(1);
  });

  it("computes total burden: method weights + per-metric cadence cost + window weight x count", () => {
    const output = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [
          candidate({
            candidateId: "plan_SYNTH-candidate-000001",
            metrics: ["SYNTH-metric-a", "SYNTH-metric-b"],
            methods: [
              { methodId: "SYNTH-method-a-manual", kind: "manual" },
              { methodId: "SYNTH-method-a-app", kind: "app" },
            ],
            windowCount: 2,
          }),
        ],
      }),
    );
    // manual 3 + app 2 + 2 metrics x default cadence cost 1 + 2 windows x 1 = 9.
    const evaluated = output.paretoMinimal[0];
    expect(evaluated?.totalBurden).toBe(9);
    expect(evaluated?.methodCount).toBe(2);
    expect(evaluated?.coverageCardinality).toBe(2);
    expect(evaluated?.metricsCovered).toEqual(["SYNTH-metric-a", "SYNTH-metric-b"]);
  });

  it("honors per-metric cadence costs and custom injectable weights", () => {
    const model: BurdenModel = {
      methodKindWeights: { manual: 9, app: 5, device: 2 },
      metricCadenceCosts: { "SYNTH-metric-a": 7 },
      defaultMetricCadenceCost: 0.5,
      windowCountWeight: 0.25,
    };
    const output = expectOk(
      runBurdenOptimization(
        {
          candidates: [
            candidate({
              candidateId: "plan_SYNTH-candidate-000002",
              metrics: ["SYNTH-metric-a", "SYNTH-metric-z"],
              windowCount: 4,
            }),
          ],
        },
        model,
      ),
    );
    // device 2 + metric-a 7 + metric-z 0.5 + 4 windows x 0.25 = 10.5.
    expect(output.paretoMinimal[0]?.totalBurden).toBe(10.5);
  });

  it("rejects models that violate the manual > app > device ordering (typed)", () => {
    const broken: BurdenModel = {
      ...DEFAULT_BURDEN_MODEL,
      methodKindWeights: { manual: 1, app: 2, device: 3 },
    };
    const result = runBurdenOptimization({ candidates: [] }, broken);
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid-burden-model", reason: "burden-order-violated" },
    });
  });

  it("rejects malformed models with typed reasons (weights, costs, window weight)", () => {
    const cases: readonly (readonly [BurdenModel, string])[] = [
      [
        { ...DEFAULT_BURDEN_MODEL, methodKindWeights: { manual: 0, app: 2, device: 1 } },
        "invalid-method-kind-weights",
      ],
      [
        { ...DEFAULT_BURDEN_MODEL, metricCadenceCosts: { "SYNTH-metric-a": -1 } },
        "invalid-metric-cadence-costs",
      ],
      [
        { ...DEFAULT_BURDEN_MODEL, defaultMetricCadenceCost: Number.NaN },
        "invalid-default-metric-cadence-cost",
      ],
      [{ ...DEFAULT_BURDEN_MODEL, windowCountWeight: -0.5 }, "invalid-window-count-weight"],
    ];
    for (const [model, reason] of cases) {
      const result = runBurdenOptimization({ candidates: [] }, model);
      expect(result).toEqual({
        ok: false,
        error: { kind: "invalid-burden-model", reason },
      });
    }
  });

  it("exposes the burden kind vocabulary and guard", () => {
    expect(BURDEN_METHOD_KINDS).toEqual(["manual", "app", "device"]);
    expect(isBurdenMethodKind("manual")).toBe(true);
    expect(isBurdenMethodKind("app")).toBe(true);
    expect(isBurdenMethodKind("device")).toBe(true);
    expect(isBurdenMethodKind("widget")).toBe(false);
    expect(isBurdenMethodKind(7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A39 — Pareto semantics under (total burden, coverage completeness).
// ---------------------------------------------------------------------------

describe("A39 BurdenOptimizer — Pareto minimality", () => {
  it("prunes a same-coverage candidate with strictly higher burden (dominated audit)", () => {
    const output = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [
          candidate({ candidateId: "plan_SYNTH-candidate-cheap-01" }),
          candidate({
            candidateId: "plan_SYNTH-candidate-pricey1",
            methods: [{ methodId: "SYNTH-method-a-manual", kind: "manual" }],
          }),
        ],
      }),
    );
    // device (1 + 1 metric) vs manual (3 + 1 metric): the manual variant is dominated.
    expect(output.paretoMinimal.map((c) => c.candidateId)).toEqual(["plan_SYNTH-candidate-cheap-01"]);
    expect(output.dominated).toEqual([
      { candidateId: "plan_SYNTH-candidate-pricey1", dominatedBy: ["plan_SYNTH-candidate-cheap-01"] },
    ]);
    expect(output.evaluatedCount).toBe(2);
  });

  it("prunes an equal-burden candidate whose coverage is a strict subset (zero-metric-cost model)", () => {
    const model: BurdenModel = {
      ...DEFAULT_BURDEN_MODEL,
      defaultMetricCadenceCost: 0,
    };
    const output = expectOk(
      runBurdenOptimization(
        {
          candidates: [
            candidate({ candidateId: "plan_SYNTH-candidate-subset001" }),
            candidate({
              candidateId: "plan_SYNTH-candidate-superset1",
              metrics: ["SYNTH-metric-a", "SYNTH-metric-b"],
            }),
          ],
        },
        model,
      ),
    );
    // Both cost device(1); the superset covers strictly more at the same
    // price, so the subset is dominated.
    expect(output.paretoMinimal.map((c) => c.candidateId)).toEqual(["plan_SYNTH-candidate-superset1"]);
    expect(output.dominated[0]?.dominatedBy).toEqual(["plan_SYNTH-candidate-superset1"]);
  });

  it("keeps per-metric alternatives incomparable (different metric sets never dominate each other)", () => {
    const output = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [
          candidate({ candidateId: "plan_SYNTH-candidate-metric-a1" }),
          candidate({
            candidateId: "plan_SYNTH-candidate-metric-b1",
            metrics: ["SYNTH-metric-b"],
          }),
        ],
      }),
    );
    // Same burden, same cardinality, disjoint metric sets: mutually
    // non-dominated — the person keeps an option for BOTH metrics.
    expect(output.paretoMinimal).toHaveLength(2);
    expect(output.dominated).toEqual([]);
  });

  it("keeps burden/coverage trade-offs on the front (more coverage at more burden)", () => {
    const output = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [
          candidate({ candidateId: "plan_SYNTH-candidate-narrow-01" }),
          candidate({
            candidateId: "plan_SYNTH-candidate-broad-01",
            metrics: ["SYNTH-metric-a", "SYNTH-metric-b"],
            methods: [
              { methodId: "SYNTH-method-a-manual", kind: "manual" },
              { methodId: "SYNTH-method-b-manual", kind: "manual" },
            ],
          }),
        ],
      }),
    );
    // narrow: 2; broad: 3 + 3 + 2 = 8 — neither dominates the other.
    expect(output.paretoMinimal).toHaveLength(2);
  });

  it("keeps exact (burden, metric-set) ties and orders them by least-methods, then lexicographic ids", () => {
    const output = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [
          // manual (3) + metric (1) = 4 ...
          candidate({
            candidateId: "plan_SYNTH-candidate-one-a00001",
            methods: [{ methodId: "SYNTH-method-a-manual", kind: "manual" }],
          }),
          candidate({
            candidateId: "plan_SYNTH-candidate-one-b00001",
            methods: [{ methodId: "SYNTH-method-b-manual", kind: "manual" }],
          }),
          // ... and device (1) + app (2) + metric (1) = 4: an EXACT tie
          // with MORE methods.
          candidate({
            candidateId: "plan_SYNTH-candidate-two-method1",
            methods: [
              { methodId: "SYNTH-method-a-device", kind: "device" },
              { methodId: "SYNTH-method-a-app", kind: "app" },
            ],
          }),
        ],
      }),
    );
    // All three tie at burden 4 over the same metric set: exact ties
    // survive; the least-methods candidates order first; ids break the
    // one-method tie lexicographically.
    expect(output.paretoMinimal.map((c) => c.candidateId)).toEqual([
      "plan_SYNTH-candidate-one-a00001",
      "plan_SYNTH-candidate-one-b00001",
      "plan_SYNTH-candidate-two-method1",
    ]);
    expect(output.dominated).toEqual([]);
  });

  it("orders the front canonically: burden ASC, then coverage cardinality DESC", () => {
    const output = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [
          candidate({
            candidateId: "plan_SYNTH-candidate-manual-broad1",
            metrics: ["SYNTH-metric-a", "SYNTH-metric-b"],
            methods: [
              { methodId: "SYNTH-method-a-manual", kind: "manual" },
              { methodId: "SYNTH-method-b-manual", kind: "manual" },
            ],
          }),
          candidate({ candidateId: "plan_SYNTH-candidate-cheap-01" }),
          candidate({ candidateId: "plan_SYNTH-candidate-cheap-02" }),
        ],
      }),
    );
    expect(output.paretoMinimal.map((c) => [c.candidateId, c.totalBurden, c.coverageCardinality])).toEqual([
      ["plan_SYNTH-candidate-cheap-01", 2, 1],
      ["plan_SYNTH-candidate-cheap-02", 2, 1],
      ["plan_SYNTH-candidate-manual-broad1", 8, 2],
    ]);
  });

  it("accepts an empty candidate set (empty front, nothing dominated)", () => {
    const output = expectOk(new BurdenOptimizer().optimize({ candidates: [] }));
    expect(output.paretoMinimal).toEqual([]);
    expect(output.dominated).toEqual([]);
    expect(output.evaluatedCount).toBe(0);
  });

  it("reports coverage fractions when goalMetrics is supplied (reporting only)", () => {
    const output = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [
          candidate({ candidateId: "plan_SYNTH-candidate-goal-001" }),
          candidate({
            candidateId: "plan_SYNTH-candidate-goal-002",
            metrics: ["SYNTH-metric-c"],
          }),
        ],
        goalMetrics: ["SYNTH-metric-a", "SYNTH-metric-b"],
      }),
    );
    const byId = new Map(output.paretoMinimal.map((c) => [c.candidateId, c]));
    expect(byId.get("plan_SYNTH-candidate-goal-001")?.coverageFraction).toBe(0.5);
    // metric-c is outside the goal: fraction 0, but the candidate still
    // survives the prune (dominance uses set inclusion, not the fraction).
    expect(byId.get("plan_SYNTH-candidate-goal-002")?.coverageFraction).toBe(0);
    expect(output.paretoMinimal).toHaveLength(2);
  });

  it("rejects malformed goal metric sets (typed)", () => {
    for (const goalMetrics of [[], ["", "SYNTH-metric-a"], ["SYNTH-metric-a", "SYNTH-metric-a"]]) {
      const result = new BurdenOptimizer().optimize({
        candidates: [candidate({ candidateId: "plan_SYNTH-candidate-goal-003" })],
        goalMetrics,
      });
      expect(result).toEqual({ ok: false, error: { kind: "invalid-goal-metrics" } });
    }
  });
});

// ---------------------------------------------------------------------------
// A39 — typed rejections for malformed candidates (deny-by-default).
// ---------------------------------------------------------------------------

describe("A39 BurdenOptimizer — malformed candidate rejections", () => {
  const cases: readonly (readonly [OptimizableCandidate, Record<string, unknown>])[] = [
    [
      { candidateId: "", metrics: ["m"], methods: [{ methodId: "x", kind: "device" }], windowCount: 0 },
      { kind: "invalid-candidate", index: 0, reason: "invalid-candidate-id" },
    ],
    [
      { candidateId: "plan_SYNTH-candidate-000003", metrics: [], methods: [{ methodId: "x", kind: "device" }], windowCount: 0 },
      { kind: "invalid-candidate", index: 0, reason: "invalid-metrics" },
    ],
    [
      { candidateId: "plan_SYNTH-candidate-000004", metrics: ["m", "m"], methods: [{ methodId: "x", kind: "device" }], windowCount: 0 },
      { kind: "invalid-candidate", index: 0, reason: "duplicate-metric" },
    ],
    [
      { candidateId: "plan_SYNTH-candidate-000005", metrics: ["m"], methods: [], windowCount: 0 },
      { kind: "invalid-candidate", index: 0, reason: "invalid-methods" },
    ],
    [
      { candidateId: "plan_SYNTH-candidate-000006", metrics: ["m"], methods: [{ methodId: "x", kind: "widget" as "device" }], windowCount: 0 },
      { kind: "invalid-candidate", index: 0, reason: "invalid-method" },
    ],
    [
      { candidateId: "plan_SYNTH-candidate-000007", metrics: ["m"], methods: [{ methodId: "x", kind: "device" }, { methodId: "x", kind: "device" }], windowCount: 0 },
      { kind: "invalid-candidate", index: 0, reason: "duplicate-method" },
    ],
    [
      { candidateId: "plan_SYNTH-candidate-000008", metrics: ["m"], methods: [{ methodId: "x", kind: "device" }], windowCount: -1 },
      { kind: "invalid-candidate", index: 0, reason: "invalid-window-count" },
    ],
  ];
  for (const [malformed, expected] of cases) {
    it(`rejects ${JSON.stringify(expected)} (typed, deny-by-default)`, () => {
      const result = new BurdenOptimizer().optimize({ candidates: [malformed] });
      expect(result).toEqual({ ok: false, error: expected });
    });
  }

  it("rejects a non-array candidates input (typed)", () => {
    const result = runBurdenOptimization({ candidates: undefined as unknown as readonly OptimizableCandidate[] });
    expect(result).toEqual({ ok: false, error: { kind: "invalid-candidates" } });
  });

  it("rejects duplicate candidate ids across the set (identity ambiguity, typed)", () => {
    const result = new BurdenOptimizer().optimize({
      candidates: [
        candidate({ candidateId: "plan_SYNTH-candidate-dup-0001" }),
        candidate({ candidateId: "plan_SYNTH-candidate-dup-0001" }),
      ],
    });
    expect(result).toEqual({ ok: false, error: { kind: "duplicate-candidate-id", index: 1 } });
  });
});

// ---------------------------------------------------------------------------
// A39 — determinism (byte-identical serialization; input-order independence).
// ---------------------------------------------------------------------------

describe("A39 BurdenOptimizer — determinism", () => {
  const candidateSet: readonly OptimizableCandidate[] = [
    candidate({ candidateId: "plan_SYNTH-candidate-det-0001" }),
    candidate({
      candidateId: "plan_SYNTH-candidate-det-0002",
      methods: [{ methodId: "SYNTH-method-a-manual", kind: "manual" }],
    }),
    candidate({
      candidateId: "plan_SYNTH-candidate-det-0003",
      metrics: ["SYNTH-metric-b"],
    }),
    candidate({
      candidateId: "plan_SYNTH-candidate-det-0004",
      metrics: ["SYNTH-metric-a", "SYNTH-metric-b"],
      methods: [
        { methodId: "SYNTH-method-a-app", kind: "app" },
        { methodId: "SYNTH-method-b-app", kind: "app" },
      ],
      windowCount: 3,
    }),
  ];

  it("produces byte-identical output for identical inputs (fresh engines, serialization hash)", () => {
    const first = expectOk(new BurdenOptimizer().optimize({ candidates: candidateSet }));
    const second = expectOk(new BurdenOptimizer().optimize({ candidates: candidateSet }));
    expect(serializeBurdenOptimization(second)).toBe(serializeBurdenOptimization(first));
    expect(hashBurdenOptimization(second)).toBe(hashBurdenOptimization(first));
    expect(hashBurdenOptimization(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces byte-identical output when re-run on the SAME engine instance", () => {
    const optimizer = new BurdenOptimizer();
    const first = expectOk(optimizer.optimize({ candidates: candidateSet }));
    const second = expectOk(optimizer.optimize({ candidates: candidateSet }));
    expect(hashBurdenOptimization(second)).toBe(hashBurdenOptimization(first));
  });

  it("is independent of the input candidate order (canonical total order on the output)", () => {
    const chain: readonly OptimizableCandidate[] = [
      // X: {a} device (2) — front.
      candidate({ candidateId: "plan_SYNTH-candidate-det-0001" }),
      // Y: {a} manual (4) — dominated by X.
      candidate({
        candidateId: "plan_SYNTH-candidate-det-0002",
        methods: [{ methodId: "SYNTH-method-a-manual", kind: "manual" }],
      }),
      // Z: {a} two manual methods (7) — dominated by BOTH X and Y
      // (multi-dominator canonical ordering).
      candidate({
        candidateId: "plan_SYNTH-candidate-det-0003",
        metrics: ["SYNTH-metric-a"],
        methods: [
          { methodId: "SYNTH-method-a-manual", kind: "manual" },
          { methodId: "SYNTH-method-a-manual2", kind: "manual" },
        ],
      }),
      // W: {b} device (2) — front (incomparable with X).
      candidate({
        candidateId: "plan_SYNTH-candidate-det-0004",
        metrics: ["SYNTH-metric-b"],
      }),
      // V: {a,b} app+app, 3 windows (9) — front (trade-off).
      candidate({
        candidateId: "plan_SYNTH-candidate-det-0005",
        metrics: ["SYNTH-metric-a", "SYNTH-metric-b"],
        methods: [
          { methodId: "SYNTH-method-a-app", kind: "app" },
          { methodId: "SYNTH-method-b-app", kind: "app" },
        ],
        windowCount: 3,
      }),
    ];
    const forward = expectOk(new BurdenOptimizer().optimize({ candidates: chain }));
    expect(forward.dominated).toEqual([
      { candidateId: "plan_SYNTH-candidate-det-0002", dominatedBy: ["plan_SYNTH-candidate-det-0001"] },
      {
        candidateId: "plan_SYNTH-candidate-det-0003",
        dominatedBy: ["plan_SYNTH-candidate-det-0001", "plan_SYNTH-candidate-det-0002"],
      },
    ]);
    const shuffled = expectOk(
      new BurdenOptimizer().optimize({
        candidates: [chain[4]!, chain[2]!, chain[0]!, chain[3]!, chain[1]!],
      }),
    );
    expect(serializeBurdenOptimization(shuffled)).toBe(serializeBurdenOptimization(forward));
  });
});

// ---------------------------------------------------------------------------
// A39 — M5-A PlanCandidate adapter (the thin structural seam).
// ---------------------------------------------------------------------------

describe("A39 optimizableFromPlanCandidate — M5-A structural adapter", () => {
  const planCandidate = {
    plan: { id: "plan_SYNTH-adapted-candidate1" },
    metricId: "SYNTH-metric-heart-rate",
    methodOrder: ["SYNTH-method-hr-ring", "SYNTH-method-hr-app"],
    explainability: {
      contributingEntries: [
        { entryId: "evpe_SYNTH-entry-0000000001" },
        { entryId: "evpe_SYNTH-entry-0000000002" },
        { entryId: "evpe_SYNTH-entry-0000000003" },
      ],
    },
  };

  it("projects plan id, metric, methods (with kinds), and window count from contributing entries", () => {
    const kinds: Record<string, "device" | "app" | "manual"> = {
      "SYNTH-method-hr-ring": "device",
      "SYNTH-method-hr-app": "app",
    };
    const result = optimizableFromPlanCandidate(planCandidate, (methodId) => kinds[methodId]);
    expect(result).toEqual({
      ok: true,
      value: {
        candidateId: "plan_SYNTH-adapted-candidate1",
        metrics: ["SYNTH-metric-heart-rate"],
        methods: [
          { methodId: "SYNTH-method-hr-ring", kind: "device" },
          { methodId: "SYNTH-method-hr-app", kind: "app" },
        ],
        windowCount: 3,
      },
    });
  });

  it("rejects an unknown method kind (deny-by-default, typed with method index)", () => {
    const result = optimizableFromPlanCandidate(planCandidate, () => undefined);
    expect(result).toEqual({ ok: false, error: { kind: "unknown-method-kind", methodIndex: 0 } });
  });

  it("rejects a malformed plan candidate (typed)", () => {
    const malformed = { ...planCandidate, plan: { id: "" } };
    const result = optimizableFromPlanCandidate(malformed, () => "device");
    expect(result).toEqual({ ok: false, error: { kind: "invalid-plan-candidate" } });
  });
});

// ---------------------------------------------------------------------------
// A39 — M5-A interop: real compiler output flows through the optimizer.
// ---------------------------------------------------------------------------

describe("A39 — IntentCompiler (M5-A) output through the BurdenOptimizer", () => {
  const PERSON = "prsn_SYNTH-person-00000001" as PersonId;
  const INTENT_ID = "intent_SYNTH-intent-00000001" as IntentId;
  const DEVICE_ACTOR = "dev_SYNTH-device-00000001" as DeviceId;
  const PACK_ID = "evpack_SYNTH-pack-00000001" as EvidencePackId;
  const DAY_MS = 86_400_000;

  const HR = "SYNTH-metric-heart-rate";
  const STEPS = "SYNTH-metric-step-count";

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

  const METRICS: readonly MetricDefinition[] = [
    {
      id: HR,
      displayName: "SYNTH Heart Rate",
      unitDomain: ["beats/min"],
      valueType: "quantity",
      conceptCode: "SYNTH-8867-4",
      category: "vital-signs",
    },
    {
      id: STEPS,
      displayName: "SYNTH Step Count",
      unitDomain: ["count"],
      valueType: "quantity",
      conceptCode: "SYNTH-41950-7",
      category: "activity",
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
    methodDef("SYNTH-method-hr-ring", HR, 1),
    methodDef("SYNTH-method-hr-wearable", HR, 1),
    methodDef("SYNTH-method-hr-app", HR, 3),
    methodDef("SYNTH-method-steps-wearable", STEPS, 1),
    methodDef("SYNTH-method-steps-phone", STEPS, 2),
  ];

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
    readonly #byMetric = new Map<string, MeasurementMethod[]>();
    constructor(methods: readonly MeasurementMethod[]) {
      for (const method of methods) {
        const list = this.#byMetric.get(method.metricId) ?? [];
        list.push(method);
        this.#byMetric.set(method.metricId, list);
      }
    }
    find(methodId: string): MeasurementMethod | undefined {
      return METHODS.find((method) => method.id === methodId);
    }
    listForMetric(metricId: string): readonly MeasurementMethod[] {
      return [...(this.#byMetric.get(metricId) ?? [])];
    }
  }

  function compiledCandidates(): readonly IntentCompilationOutput["candidates"][number][] {
    const clock = new DeterministicClock({ epochMs: 1_000 });
    const registry = new InMemoryEvidencePackRegistry(clock);
    const registered = registry.register({
      packId: PACK_ID,
      personId: PERSON,
      entries: [
        packEntry(HR, "SYNTH-method-hr-ring", 8),
        packEntry(HR, "SYNTH-method-hr-wearable", 30),
        packEntry(HR, "SYNTH-method-hr-app", 10),
        packEntry(STEPS, "SYNTH-method-steps-wearable", 90),
        packEntry(STEPS, "SYNTH-method-steps-phone", 20),
      ],
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
    const result = compiler.compile({
      personId: PERSON,
      intentId: INTENT_ID,
      packId: PACK_ID,
      goal: { metrics: [{ metricId: HR }, { metricId: STEPS }] },
    });
    if (!result.ok) {
      throw new Error(`expected fixture compilation to succeed: ${JSON.stringify(result.error)}`);
    }
    return result.value.candidates;
  }

  it("adapts real compiler candidates and prunes to the least-burden front per metric", () => {
    const candidates = compiledCandidates();
    expect(candidates).toHaveLength(5);

    // Kind resolution mirrors what integration derives from registered
    // sources: ring/wearable are device methods, app/phone are app methods.
    const kinds: Record<string, "device" | "app" | "manual"> = {
      "SYNTH-method-hr-ring": "device",
      "SYNTH-method-hr-wearable": "device",
      "SYNTH-method-hr-app": "app",
      "SYNTH-method-steps-wearable": "device",
      "SYNTH-method-steps-phone": "app",
    };
    const optimizable: OptimizableCandidate[] = [];
    for (const pc of candidates) {
      const adapted = optimizableFromPlanCandidate(pc, (methodId) => kinds[methodId]);
      if (!adapted.ok) {
        throw new Error(`expected adaptation to succeed: ${JSON.stringify(adapted.error)}`);
      }
      optimizable.push(adapted.value);
    }

    const output = expectOk(new BurdenOptimizer().optimize({ candidates: optimizable }));
    // Per metric the least-burden ties survive (device methods cost
    // 1+1+1 window = 3); the app variants cost 2+1+1 = 4 and are dominated.
    expect(output.paretoMinimal).toHaveLength(3);
    expect(output.dominated.map((d) => d.candidateId).sort()).toEqual(
      candidates
        .filter((pc) => pc.methodId.endsWith("-app") || pc.methodId.endsWith("-phone"))
        .map((pc) => pc.plan.id)
        .sort(),
    );
    // Every front entry is a device-method candidate at burden 3.
    for (const front of output.paretoMinimal) {
      expect(front.totalBurden).toBe(3);
      expect(front.methods[0]?.kind).toBe("device");
    }
    // Deterministic canonical order: all ties -> sorted by candidate id.
    const ids = output.paretoMinimal.map((c) => c.candidateId);
    expect(ids).toEqual([...ids].sort());
  });
});
