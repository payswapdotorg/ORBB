import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import type {
  DeviceId,
  EvidenceLabel,
  IntentId,
  MeasurementMethod,
  MetricDefinition,
  PersonId,
  SourceId,
} from "@orbb/domain";
import { parseQualityScore } from "@orbb/domain";
import {
  RESOURCE_SOURCE_KINDS,
  ResourceMatcher,
  hashResourceMatch,
  isResourceSourceKind,
  matchableFromPlanCandidate,
  runResourceMatch,
  serializeResourceMatch,
  type CoverageSummaryEntry,
  type MatchableCandidate,
  type RegisteredResourceSource,
  type ResourceMatchInput,
  type ResourceMatchOutput,
} from "./matcher.js";
import { IntentCompiler } from "./compiler.js";
import { InMemoryEvidencePackRegistry } from "./registry.js";
import type { EvidencePackEntryContent } from "./evidencePack.js";
import type { EvidencePackId } from "./ids.js";
import type {
  MeasurementMethodIndexPort,
  MetricCatalogPort,
} from "./compiler.js";

// ---------------------------------------------------------------------------
// Fixtures (SYNTH grammar throughout — zero PHI, mirroring the M5-A suites).
// ---------------------------------------------------------------------------

const PERSON = "prsn_SYNTH-person-00000001" as PersonId;
const OTHER_PERSON = "prsn_SYNTH-person-00000002" as PersonId;

const HR = "SYNTH-metric-heart-rate";
const STEPS = "SYNTH-metric-step-count";
const SLEEP = "SYNTH-metric-sleep-hours";

function source(
  overrides: Partial<RegisteredResourceSource> & { sourceId: SourceId },
): RegisteredResourceSource {
  return {
    personId: PERSON,
    kind: "device",
    supportedMethodIds: ["SYNTH-method-hr-ring"],
    active: true,
    ...overrides,
  };
}

const DEVICE_SOURCE = "src_SYNTH-source-00000001" as SourceId;
const APP_SOURCE = "src_SYNTH-source-00000002" as SourceId;
const MANUAL_SOURCE = "src_SYNTH-source-00000003" as SourceId;
const OTHER_PERSON_SOURCE = "src_SYNTH-source-00000004" as SourceId;

function entry(
  metricId: string,
  methodId: string,
  count: number,
  entryId: string,
): CoverageSummaryEntry {
  return {
    entryId,
    metricId,
    methodId,
    count,
    window: { startsAt: new Date(0), endsAt: new Date(86_400_000) },
  };
}

function matchable(
  candidateId: string,
  metricId: string,
  methodIds: readonly string[],
): MatchableCandidate {
  return { candidateId, metricMethods: [{ metricId, methodIds }] };
}

function matchInput(overrides: Partial<ResourceMatchInput> = {}): ResourceMatchInput {
  return {
    personId: PERSON,
    candidates: [matchable("plan_SYNTH-match-candidate1", HR, ["SYNTH-method-hr-ring"])],
    sources: [source({ sourceId: DEVICE_SOURCE })],
    coverage: [entry(HR, "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000001")],
    ...overrides,
  };
}

function expectMatchOk(
  result: ReturnType<typeof runResourceMatch>,
): ResourceMatchOutput {
  if (!result.ok) {
    throw new Error(`expected match to succeed, got: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// A40 — source kind vocabulary.
// ---------------------------------------------------------------------------

describe("A40 — source kind vocabulary", () => {
  it("exposes the manual/device/app kinds with a guard (A28 vocabulary mirrored locally)", () => {
    expect(RESOURCE_SOURCE_KINDS).toEqual(["manual", "device", "app"]);
    expect(isResourceSourceKind("manual")).toBe(true);
    expect(isResourceSourceKind("device")).toBe(true);
    expect(isResourceSourceKind("app")).toBe(true);
    expect(isResourceSourceKind("cloud")).toBe(false);
    expect(isResourceSourceKind(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A40 — executable candidates + binding trails (the happy paths).
// ---------------------------------------------------------------------------

describe("A40 ResourceMatcher — executable candidates", () => {
  it("binds the metric to the first proposed method with BOTH coverage and an active source", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          candidates: [
            matchable("plan_SYNTH-match-candidate1", HR, [
              "SYNTH-method-hr-uncovered",
              "SYNTH-method-hr-ring",
            ]),
          ],
        }),
      ),
    );
    // The first method has no coverage entry; the second binds.
    expect(output.matched).toEqual([
      {
        candidateId: "plan_SYNTH-match-candidate1",
        bindings: [
          {
            metricId: HR,
            methodId: "SYNTH-method-hr-ring",
            sourceId: DEVICE_SOURCE,
            sourceKind: "device",
            coverageEntryId: "evpe_SYNTH-entry-0000000001",
            coverageCount: 8,
          },
        ],
      },
    ]);
    expect(output.dropped).toEqual([]);
  });

  it("skips a coverage-backed method that has no source and binds a later fallback method", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          candidates: [
            matchable("plan_SYNTH-match-candidate2", STEPS, [
              "SYNTH-method-steps-watch",
              "SYNTH-method-steps-phone",
            ]),
          ],
          sources: [
            source({
              sourceId: APP_SOURCE,
              kind: "app",
              supportedMethodIds: ["SYNTH-method-steps-phone"],
            }),
          ],
          coverage: [
            entry(STEPS, "SYNTH-method-steps-watch", 40, "evpe_SYNTH-entry-0000000002"),
            entry(STEPS, "SYNTH-method-steps-phone", 20, "evpe_SYNTH-entry-0000000003"),
          ],
        }),
      ),
    );
    expect(output.matched[0]?.bindings[0]).toEqual({
      metricId: STEPS,
      methodId: "SYNTH-method-steps-phone",
      sourceId: APP_SOURCE,
      sourceKind: "app",
      coverageEntryId: "evpe_SYNTH-entry-0000000003",
      coverageCount: 20,
    });
  });

  it("attributes the FIRST registered active source (input order) and FIRST coverage entry (input order)", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          sources: [
            source({
              sourceId: MANUAL_SOURCE,
              kind: "manual",
              supportedMethodIds: ["SYNTH-method-hr-ring"],
            }),
            source({ sourceId: DEVICE_SOURCE }),
          ],
          coverage: [
            entry(HR, "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000004"),
            entry(HR, "SYNTH-method-hr-ring", 5, "evpe_SYNTH-entry-0000000005"),
          ],
        }),
      ),
    );
    expect(output.matched[0]?.bindings[0]?.sourceId).toBe(MANUAL_SOURCE);
    expect(output.matched[0]?.bindings[0]?.sourceKind).toBe("manual");
    expect(output.matched[0]?.bindings[0]?.coverageEntryId).toBe("evpe_SYNTH-entry-0000000004");
  });

  it("produces one binding per metric for multi-metric candidates, in candidate metric order", () => {
    const multiMetric: MatchableCandidate = {
      candidateId: "plan_SYNTH-match-candidate3",
      metricMethods: [
        { metricId: HR, methodIds: ["SYNTH-method-hr-ring"] },
        { metricId: STEPS, methodIds: ["SYNTH-method-steps-phone"] },
      ],
    };
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          candidates: [multiMetric],
          sources: [
            source({ sourceId: DEVICE_SOURCE }),
            source({
              sourceId: APP_SOURCE,
              kind: "app",
              supportedMethodIds: ["SYNTH-method-steps-phone"],
            }),
          ],
          coverage: [
            entry(HR, "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000006"),
            entry(STEPS, "SYNTH-method-steps-phone", 20, "evpe_SYNTH-entry-0000000007"),
          ],
        }),
      ),
    );
    expect(output.matched[0]?.bindings.map((binding) => binding.metricId)).toEqual([HR, STEPS]);
  });

  it("preserves candidate input order across matched and dropped outputs", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          candidates: [
            matchable("plan_SYNTH-match-candidate-a1", SLEEP, ["SYNTH-method-sleep-diary"]),
            matchable("plan_SYNTH-match-candidate-b1", HR, ["SYNTH-method-hr-ring"]),
            matchable("plan_SYNTH-match-candidate-c1", SLEEP, ["SYNTH-method-sleep-diary"]),
          ],
        }),
      ),
    );
    expect(output.matched.map((c) => c.candidateId)).toEqual(["plan_SYNTH-match-candidate-b1"]);
    expect(output.dropped.map((c) => c.candidateId)).toEqual([
      "plan_SYNTH-match-candidate-a1",
      "plan_SYNTH-match-candidate-c1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// A40 — deny-by-default typed drop reasons.
// ---------------------------------------------------------------------------

describe("A40 ResourceMatcher — typed drop reasons (deny-by-default)", () => {
  it("drops with metric-uncovered when the pack has no coverage entry for the metric at all", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          candidates: [matchable("plan_SYNTH-match-candidate-d1", SLEEP, ["SYNTH-method-sleep-diary"])],
          coverage: [],
        }),
      ),
    );
    expect(output.matched).toEqual([]);
    expect(output.dropped).toEqual([
      {
        candidateId: "plan_SYNTH-match-candidate-d1",
        failures: [{ metricId: SLEEP, reason: "metric-uncovered" }],
      },
    ]);
  });

  it("drops with no-method when coverage exists for the metric but not for any proposed method", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          candidates: [
            matchable("plan_SYNTH-match-candidate-d2", HR, ["SYNTH-method-hr-chest-strap"]),
          ],
          coverage: [entry(HR, "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000008")],
        }),
      ),
    );
    expect(output.dropped[0]?.failures).toEqual([{ metricId: HR, reason: "no-method" }]);
  });

  it("drops with no-source when coverage-backed methods exist but no active source backs any", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          sources: [
            source({
              sourceId: APP_SOURCE,
              kind: "app",
              supportedMethodIds: ["SYNTH-method-steps-phone"],
            }),
          ],
          coverage: [entry(HR, "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000009")],
        }),
      ),
    );
    expect(output.dropped[0]?.failures).toEqual([{ metricId: HR, reason: "no-source" }]);
  });

  it("treats an inactive source as no source (deny-by-default)", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          sources: [source({ sourceId: DEVICE_SOURCE, active: false })],
        }),
      ),
    );
    expect(output.matched).toEqual([]);
    expect(output.dropped[0]?.failures).toEqual([{ metricId: HR, reason: "no-source" }]);
  });

  it("drops a multi-metric candidate entirely when ONE metric fails, listing per-metric failures", () => {
    const output = expectMatchOk(
      new ResourceMatcher().match(
        matchInput({
          candidates: [
            {
              candidateId: "plan_SYNTH-match-candidate-d3",
              metricMethods: [
                { metricId: HR, methodIds: ["SYNTH-method-hr-ring"] },
                { metricId: SLEEP, methodIds: ["SYNTH-method-sleep-diary"] },
                { metricId: STEPS, methodIds: ["SYNTH-method-steps-watch"] },
              ],
            },
          ],
          coverage: [
            entry(HR, "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000010"),
            entry(STEPS, "SYNTH-method-steps-watch", 40, "evpe_SYNTH-entry-0000000011"),
          ],
        }),
      ),
    );
    // SLEEP has no coverage at all; STEPS is covered but unbacked by the
    // single device source; the whole candidate is dropped.
    expect(output.dropped[0]?.failures).toEqual([
      { metricId: SLEEP, reason: "metric-uncovered" },
      { metricId: STEPS, reason: "no-source" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// A40 — typed rejections for malformed inputs.
// ---------------------------------------------------------------------------

describe("A40 ResourceMatcher — typed input rejections", () => {
  it("rejects an invalid person id (typed)", () => {
    const result = runResourceMatch(matchInput({ personId: "not-a-person-id" as PersonId }));
    expect(result).toEqual({ ok: false, error: { kind: "invalid-person-id" } });
  });

  it("rejects non-array candidates/sources/coverage (typed)", () => {
    expect(
      runResourceMatch(matchInput({ candidates: undefined as unknown as readonly MatchableCandidate[] })),
    ).toEqual({ ok: false, error: { kind: "invalid-candidates" } });
    expect(
      runResourceMatch(matchInput({ sources: "nope" as unknown as readonly RegisteredResourceSource[] })),
    ).toEqual({ ok: false, error: { kind: "invalid-sources" } });
    expect(
      runResourceMatch(matchInput({ coverage: 42 as unknown as readonly CoverageSummaryEntry[] })),
    ).toEqual({ ok: false, error: { kind: "invalid-coverage" } });
  });

  it("rejects malformed sources with typed reasons and indices", () => {
    const cases: readonly (readonly [RegisteredResourceSource, Record<string, unknown>])[] = [
      [
        { personId: PERSON, kind: "device", supportedMethodIds: ["m"], active: true, sourceId: "bad" as SourceId },
        { kind: "invalid-source", index: 0, reason: "invalid-source-id" },
      ],
      [
        source({ sourceId: DEVICE_SOURCE, personId: "x" as PersonId }),
        { kind: "invalid-source", index: 0, reason: "invalid-source-person" },
      ],
      [
        source({ sourceId: DEVICE_SOURCE, kind: "cloud" as "device" }),
        { kind: "invalid-source", index: 0, reason: "invalid-source-kind" },
      ],
      [
        source({ sourceId: DEVICE_SOURCE, supportedMethodIds: [] }),
        { kind: "invalid-source", index: 0, reason: "invalid-supported-methods" },
      ],
      [
        source({ sourceId: DEVICE_SOURCE, active: "yes" as unknown as boolean }),
        { kind: "invalid-source", index: 0, reason: "invalid-active-flag" },
      ],
    ];
    for (const [badSource, expected] of cases) {
      const result = runResourceMatch(matchInput({ sources: [badSource] }));
      expect(result).toEqual({ ok: false, error: expected });
    }
  });

  it("rejects duplicate source ids (typed, with index)", () => {
    const result = runResourceMatch(
      matchInput({
        sources: [source({ sourceId: DEVICE_SOURCE }), source({ sourceId: DEVICE_SOURCE })],
      }),
    );
    expect(result).toEqual({ ok: false, error: { kind: "duplicate-source-id", index: 1 } });
  });

  it("rejects a source registered to a different person (never silently ignored)", () => {
    const result = runResourceMatch(
      matchInput({
        sources: [source({ sourceId: OTHER_PERSON_SOURCE, personId: OTHER_PERSON })],
      }),
    );
    expect(result).toEqual({ ok: false, error: { kind: "source-person-mismatch", index: 0 } });
  });

  it("rejects malformed coverage entries with typed reasons and indices", () => {
    const cases: readonly (readonly [CoverageSummaryEntry, Record<string, unknown>])[] = [
      [
        { ...entry(HR, "SYNTH-method-hr-ring", 8, ""), window: { startsAt: new Date(0), endsAt: new Date(1) } },
        { kind: "invalid-coverage-entry", index: 0, reason: "invalid-entry-id" },
      ],
      [
        entry("", "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000012"),
        { kind: "invalid-coverage-entry", index: 0, reason: "invalid-entry-metric" },
      ],
      [
        entry(HR, "", 8, "evpe_SYNTH-entry-0000000013"),
        { kind: "invalid-coverage-entry", index: 0, reason: "invalid-entry-method" },
      ],
      [
        entry(HR, "SYNTH-method-hr-ring", 0, "evpe_SYNTH-entry-0000000014"),
        { kind: "invalid-coverage-entry", index: 0, reason: "invalid-entry-count" },
      ],
      [
        {
          metricId: HR,
          methodId: "SYNTH-method-hr-ring",
          count: 8,
          entryId: "evpe_SYNTH-entry-0000000015",
          window: { startsAt: new Date(Number.NaN), endsAt: new Date(1) },
        },
        { kind: "invalid-coverage-entry", index: 0, reason: "invalid-entry-window" },
      ],
    ];
    for (const [badEntry, expected] of cases) {
      const result = runResourceMatch(matchInput({ coverage: [badEntry] }));
      expect(result).toEqual({ ok: false, error: expected });
    }
  });

  it("rejects malformed candidates with typed reasons and indices", () => {
    const cases: readonly (readonly [MatchableCandidate, Record<string, unknown>])[] = [
      [
        { candidateId: "", metricMethods: [{ metricId: HR, methodIds: ["m"] }] },
        { kind: "invalid-candidate", index: 0, reason: "invalid-candidate-id" },
      ],
      [
        { candidateId: "plan_SYNTH-match-candidate-e1", metricMethods: [] },
        { kind: "invalid-candidate", index: 0, reason: "invalid-metric-methods" },
      ],
      [
        { candidateId: "plan_SYNTH-match-candidate-e2", metricMethods: [{ metricId: "", methodIds: ["m"] }] },
        { kind: "invalid-candidate", index: 0, reason: "invalid-metric-assignment" },
      ],
      [
        {
          candidateId: "plan_SYNTH-match-candidate-e3",
          metricMethods: [
            { metricId: HR, methodIds: ["m"] },
            { metricId: HR, methodIds: ["m"] },
          ],
        },
        { kind: "invalid-candidate", index: 0, reason: "duplicate-metric-assignment" },
      ],
    ];
    for (const [badCandidate, expected] of cases) {
      const result = runResourceMatch(matchInput({ candidates: [badCandidate] }));
      expect(result).toEqual({ ok: false, error: expected });
    }
  });
});

// ---------------------------------------------------------------------------
// A40 — determinism.
// ---------------------------------------------------------------------------

describe("A40 ResourceMatcher — determinism", () => {
  const input = matchInput({
    candidates: [
      matchable("plan_SYNTH-match-candidate-f1", HR, ["SYNTH-method-hr-ring"]),
      matchable("plan_SYNTH-match-candidate-f2", SLEEP, ["SYNTH-method-sleep-diary"]),
    ],
    sources: [
      source({ sourceId: DEVICE_SOURCE }),
      source({
        sourceId: MANUAL_SOURCE,
        kind: "manual",
        supportedMethodIds: ["SYNTH-method-sleep-diary"],
      }),
    ],
    coverage: [
      entry(HR, "SYNTH-method-hr-ring", 8, "evpe_SYNTH-entry-0000000016"),
      entry(SLEEP, "SYNTH-method-sleep-diary", 3, "evpe_SYNTH-entry-0000000017"),
    ],
  });

  it("produces byte-identical output for identical inputs (fresh engines, serialization hash)", () => {
    const first = expectMatchOk(new ResourceMatcher().match(input));
    const second = expectMatchOk(new ResourceMatcher().match(input));
    expect(serializeResourceMatch(second)).toBe(serializeResourceMatch(first));
    expect(hashResourceMatch(second)).toBe(hashResourceMatch(first));
    expect(hashResourceMatch(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces byte-identical output when re-run on the SAME engine instance", () => {
    const matcher = new ResourceMatcher();
    const first = expectMatchOk(matcher.match(input));
    const second = expectMatchOk(matcher.match(input));
    expect(hashResourceMatch(second)).toBe(hashResourceMatch(first));
  });
});

// ---------------------------------------------------------------------------
// A40 — M5-A interop: real compiler output + real EvidencePack entries.
// ---------------------------------------------------------------------------

describe("A40 — M5-A interop (compiler candidates + EvidencePack entries as coverage)", () => {
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

  it("matches adapted compiler candidates against real registry entries (structural compatibility)", () => {
    const clock = new DeterministicClock({ epochMs: 1_000 });
    const registry = new InMemoryEvidencePackRegistry(clock);
    const registered = registry.register({
      packId: PACK_ID,
      personId: PERSON,
      entries: [
        packEntry(HR, "SYNTH-method-hr-ring", 8),
        packEntry(HR, "SYNTH-method-hr-wearable", 30),
        packEntry(STEPS, "SYNTH-method-steps-wearable", 90),
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
    const compiled = compiler.compile({
      personId: PERSON,
      intentId: INTENT_ID,
      packId: PACK_ID,
      goal: { metrics: [{ metricId: HR }, { metricId: STEPS }] },
    });
    if (!compiled.ok) {
      throw new Error(`expected fixture compilation to succeed: ${JSON.stringify(compiled.error)}`);
    }

    // M5-A PlanCandidate -> MatchableCandidate (pure projection).
    const matchableCandidates = compiled.value.candidates.map(matchableFromPlanCandidate);
    // The ACTIVE pack version's entries ARE the coverage summaries
    // (structural subset — no adapter needed).
    const active = registry.resolveActive(PACK_ID);
    if (active === undefined) {
      throw new Error("expected fixture pack to resolve");
    }

    const output = expectMatchOk(
      new ResourceMatcher().match({
        personId: PERSON,
        candidates: matchableCandidates,
        sources: [
          {
            sourceId: "src_SYNTH-source-00000005" as SourceId,
            personId: PERSON,
            kind: "device",
            supportedMethodIds: ["SYNTH-method-hr-ring", "SYNTH-method-steps-wearable"],
            active: true,
          },
        ],
        coverage: active.entries,
      }),
    );

    // hr-wearable is coverage-backed but has no registered source ->
    // dropped with no-source; ring and steps-wearable bind to real
    // content-addressed entry ids.
    expect(output.matched).toHaveLength(2);
    for (const matched of output.matched) {
      const binding = matched.bindings[0];
      expect(binding).toBeDefined();
      expect(binding?.sourceId).toBe("src_SYNTH-source-00000005");
      expect(binding?.coverageEntryId).toMatch(/^evpe_/);
      expect(active.entries.some((packEntry) => packEntry.entryId === binding?.coverageEntryId)).toBe(
        true,
      );
    }
    expect(output.dropped).toEqual([
      {
        candidateId: compiled.value.candidates
          .find((pc) => pc.methodId === "SYNTH-method-hr-wearable")
          ?.plan.id,
        failures: [{ metricId: HR, reason: "no-source" }],
      },
    ]);
  });
});
