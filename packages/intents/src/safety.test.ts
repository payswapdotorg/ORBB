import { describe, expect, expectTypeOf, it } from "vitest";
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
  DEFAULT_SAFETY_RULE_TABLE,
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
  type FiredRuleRecord,
  type SafetyCandidate,
  type SafetyOutcome,
  type SafetyRuleTable,
} from "./safety.js";
import { BurdenOptimizer, optimizableFromPlanCandidate } from "./optimizer.js";
import { matchableFromPlanCandidate, ResourceMatcher, type MatchableCandidate } from "./matcher.js";
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
const INTENT_ID = "intent_SYNTH-intent-00000001" as IntentId;
const DEVICE_ACTOR = "dev_SYNTH-device-00000001" as DeviceId;

const HR = "SYNTH-metric-heart-rate";
const STEPS = "SYNTH-metric-step-count";
const WEIGHT = "SYNTH-metric-body-weight";

function safetyCandidate(
  assignments: readonly { metricId: string; domain: string; cadencePerDay: number }[],
  candidateId = "plan_SYNTH-safety-candidate-1",
): SafetyCandidate {
  return { candidateId, assignments };
}

function expectOutcomeOk(
  result: ReturnType<typeof evaluateSafetyCandidate>,
): SafetyOutcome {
  if (!result.ok) {
    throw new Error(`expected safety evaluation to succeed, got: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// A41 — vocabulary + default table.
// ---------------------------------------------------------------------------

describe("A41 — rule vocabulary and the frozen default table", () => {
  it("exposes the five rule kinds with guards", () => {
    expect(SAFETY_RULE_KINDS).toEqual([
      "max-measurements-per-day",
      "min-gap-between-metrics",
      "forbidden-metric-combination",
      "cadence-floor",
      "cadence-ceiling",
    ]);
    expect(isRuleViolationOutcome("reject")).toBe(true);
    expect(isRuleViolationOutcome("escalate")).toBe(true);
    expect(isRuleViolationOutcome("maybe")).toBe(false);
  });

  it("ships the frozen default table: guard first, then per-domain cadence bounds, no declared pairs", () => {
    expect(DEFAULT_SAFETY_RULE_TABLE.rules[0]?.kind).toBe("max-measurements-per-day");
    expect(DEFAULT_SAFETY_RULE_TABLE.rules[0]?.ruleId).toBe("safety/max-measurements-per-day/v1");
    // No metric-specific pairs ship by default (metric ids are
    // deployment-specific opaque strings — deny-by-default).
    const kinds = DEFAULT_SAFETY_RULE_TABLE.rules.map((rule) => rule.kind);
    expect(kinds).not.toContain("min-gap-between-metrics");
    expect(kinds).not.toContain("forbidden-metric-combination");
    // Cadence bounds exist for the four seeded metric categories.
    const domains = DEFAULT_SAFETY_RULE_TABLE.rules
      .filter((rule) => rule.kind === "cadence-floor" || rule.kind === "cadence-ceiling")
      .map((rule) => (rule as { domain: string }).domain);
    expect(new Set(domains)).toEqual(new Set(["vital-signs", "body-composition", "activity", "sleep"]));
    // Rule ids are unique (table order is the evaluation order).
    const ruleIds = DEFAULT_SAFETY_RULE_TABLE.rules.map((rule) => rule.ruleId);
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });
});

// ---------------------------------------------------------------------------
// A41 — PASS outcomes (default table).
// ---------------------------------------------------------------------------

describe("A41 SafetyRuleEngine — PASS", () => {
  it("passes a modest candidate and audits every evaluated rule id in table order", () => {
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }]),
      ),
    );
    expect(outcome.kind).toBe("PASS");
    expect(outcome.candidateId).toBe("plan_SYNTH-safety-candidate-1");
    expect(outcome.evaluatedRuleIds).toEqual(
      DEFAULT_SAFETY_RULE_TABLE.rules.map((rule) => rule.ruleId),
    );
    expect(isPublishableOutcome(outcome)).toBe(true);
  });

  it("passes at the exact max-per-day boundary (the guard fires only above the limit)", () => {
    // 3 x vital-signs 4/day = 12 (the boundary, not above it).
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([
          { metricId: HR, domain: "vital-signs", cadencePerDay: 4 },
          { metricId: "SYNTH-metric-bp-systolic", domain: "vital-signs", cadencePerDay: 4 },
          { metricId: "SYNTH-metric-bp-diastolic", domain: "vital-signs", cadencePerDay: 4 },
        ]),
      ),
    );
    expect(outcome.kind).toBe("PASS");
  });

  it("passes metrics whose domain has no table entry (rules are data; only declared domains are checked)", () => {
    // 2/day total stays under the metric-agnostic guard; the "wellbeing"
    // domain has no cadence rules in the default table.
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: "SYNTH-metric-mood", domain: "wellbeing", cadencePerDay: 2 }]),
      ),
    );
    expect(outcome.kind).toBe("PASS");
  });

  it("passes a min-gap pair when a schedule can honor the gap", () => {
    const table: SafetyRuleTable = {
      rules: [
        {
          kind: "min-gap-between-metrics",
          ruleId: "safety/min-gap-hr-steps/v1",
          metricA: HR,
          metricB: STEPS,
          minGapHours: 6,
          onViolation: "escalate",
        },
      ],
    };
    // 1/day + 1/day: best achievable A-B gap = 12h >= 6h.
    const outcome = expectOutcomeOk(
      evaluateSafetyCandidate(
        safetyCandidate([
          { metricId: HR, domain: "vital-signs", cadencePerDay: 1 },
          { metricId: STEPS, domain: "activity", cadencePerDay: 1 },
        ]),
        table,
      ),
    );
    expect(outcome.kind).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// A41 — REJECT outcomes (default table).
// ---------------------------------------------------------------------------

describe("A41 SafetyRuleEngine — REJECT (typed reason, fired-rule audit)", () => {
  it("rejects when total measurements per day exceed the guard (and nothing else fires)", () => {
    // 3 vital-signs metrics at the 4/day ceiling boundary + body weight at
    // 1.5/day (within its [1/7, 2] bounds): total 13.5 > 12.
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([
          { metricId: HR, domain: "vital-signs", cadencePerDay: 4 },
          { metricId: "SYNTH-metric-bp-systolic", domain: "vital-signs", cadencePerDay: 4 },
          { metricId: "SYNTH-metric-bp-diastolic", domain: "vital-signs", cadencePerDay: 4 },
          { metricId: WEIGHT, domain: "body-composition", cadencePerDay: 1.5 },
        ]),
      ),
    );
    expect(outcome.kind).toBe("REJECT");
    if (outcome.kind !== "REJECT") {
      throw new Error("unreachable");
    }
    expect(outcome.reason).toBe("exceeds-max-measurements-per-day");
    expect(outcome.publishable).toBe(false);
    expect(outcome.requiresHumanReview).toBe(false);
    expect(isPublishableOutcome(outcome)).toBe(false);
    expect(outcome.firedRules).toHaveLength(1);
    const fired = outcome.firedRules[0] as FiredRuleRecord;
    expect(fired.ruleId).toBe("safety/max-measurements-per-day/v1");
    expect(fired.inputs).toEqual({ kind: "max-measurements-per-day", totalPerDay: 13.5, maxPerDay: 12 });
  });

  it("rejects a cadence above a domain ceiling (over-measurement guard)", () => {
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 4.5 }]),
      ),
    );
    expect(outcome.kind).toBe("REJECT");
    if (outcome.kind !== "REJECT") {
      throw new Error("unreachable");
    }
    expect(outcome.reason).toBe("cadence-above-ceiling");
    expect(outcome.firedRules[0]?.ruleId).toBe("safety/cadence-ceiling/vital-signs/v1");
  });

  it("takes the FIRST reject rule in table order when several reject rules fire", () => {
    // 7 + 7 = 14/day total (max-per-day guard, first in the table) AND a
    // vital-signs ceiling breach (7 > 4): the guard wins the typed reason.
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([
          { metricId: HR, domain: "vital-signs", cadencePerDay: 7 },
          { metricId: STEPS, domain: "activity", cadencePerDay: 7 },
        ]),
      ),
    );
    expect(outcome.kind).toBe("REJECT");
    if (outcome.kind !== "REJECT") {
      throw new Error("unreachable");
    }
    expect(outcome.reason).toBe("exceeds-max-measurements-per-day");
    // ALL fired rules ride along for audit (the ceiling breach included;
    // activity 7/day is under its 24/day ceiling and does not fire).
    expect(outcome.firedRules.map((fired) => fired.ruleId)).toEqual([
      "safety/max-measurements-per-day/v1",
      "safety/cadence-ceiling/vital-signs/v1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// A41 — ESCALATE outcomes (human review REQUIRED, never publishable).
// ---------------------------------------------------------------------------

describe("A41 SafetyRuleEngine — ESCALATE (typed outcome, not an exception)", () => {
  it("escalates a cadence below a domain floor (clinical-judgment call)", () => {
    // Weekly floor is 1/7 per day; monthly weighing is below it.
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: WEIGHT, domain: "body-composition", cadencePerDay: 1 / 28 }]),
      ),
    );
    expect(outcome.kind).toBe("ESCALATE");
    if (outcome.kind !== "ESCALATE") {
      throw new Error("unreachable");
    }
    expect(outcome.reasonCodes).toEqual(["cadence-below-floor"]);
    expect(outcome.firedRules[0]?.inputs).toEqual({
      kind: "cadence-floor",
      metricId: WEIGHT,
      domain: "body-composition",
      cadencePerDay: 1 / 28,
      floorPerDay: 1 / 7,
    });
  });

  it("escalates a min-gap violation when NO schedule can honor the gap", () => {
    const table: SafetyRuleTable = {
      rules: [
        {
          kind: "min-gap-between-metrics",
          ruleId: "safety/min-gap-bp-activity/v1",
          metricA: "SYNTH-metric-bp-systolic",
          metricB: STEPS,
          minGapHours: 6,
          onViolation: "escalate",
        },
      ],
    };
    // 3/day and 1/day: best achievable gap = 12 / 3 = 4h < 6h.
    const outcome = expectOutcomeOk(
      evaluateSafetyCandidate(
        safetyCandidate([
          { metricId: "SYNTH-metric-bp-systolic", domain: "vital-signs", cadencePerDay: 3 },
          { metricId: STEPS, domain: "activity", cadencePerDay: 1 },
        ]),
        table,
      ),
    );
    expect(outcome.kind).toBe("ESCALATE");
    if (outcome.kind !== "ESCALATE") {
      throw new Error("unreachable");
    }
    expect(outcome.reasonCodes).toEqual(["min-gap-between-metrics"]);
    expect(outcome.firedRules[0]?.inputs).toEqual({
      kind: "min-gap-between-metrics",
      metricA: "SYNTH-metric-bp-systolic",
      metricB: STEPS,
      cadenceAPerDay: 3,
      cadenceBPerDay: 1,
      bestAchievableMinGapHours: 4,
      minGapHours: 6,
    });
  });

  it("passes a min-gap pair at the exact feasibility boundary (12 / max == minGapHours)", () => {
    const table: SafetyRuleTable = {
      rules: [
        {
          kind: "min-gap-between-metrics",
          ruleId: "safety/min-gap-bp-activity/v1",
          metricA: "SYNTH-metric-bp-systolic",
          metricB: STEPS,
          minGapHours: 6,
          onViolation: "escalate",
        },
      ],
    };
    // 2/day and 1/day: best achievable gap = 12 / 2 = 6h, NOT below 6h.
    const outcome = expectOutcomeOk(
      evaluateSafetyCandidate(
        safetyCandidate([
          { metricId: "SYNTH-metric-bp-systolic", domain: "vital-signs", cadencePerDay: 2 },
          { metricId: STEPS, domain: "activity", cadencePerDay: 1 },
        ]),
        table,
      ),
    );
    expect(outcome.kind).toBe("PASS");
  });

  it("ignores a min-gap rule when only one metric of the pair is present", () => {
    const table: SafetyRuleTable = {
      rules: [
        {
          kind: "min-gap-between-metrics",
          ruleId: "safety/min-gap-bp-activity/v1",
          metricA: "SYNTH-metric-bp-systolic",
          metricB: STEPS,
          minGapHours: 24,
          onViolation: "escalate",
        },
      ],
    };
    // Only STEPS of the pair is present: the rule does not fire (even
    // though a 24h gap would be infeasible were the pair complete).
    const outcome = expectOutcomeOk(
      evaluateSafetyCandidate(
        safetyCandidate([{ metricId: STEPS, domain: "activity", cadencePerDay: 30 }]),
        table,
      ),
    );
    expect(outcome.kind).toBe("PASS");
    if (outcome.kind !== "PASS") {
      throw new Error("unreachable");
    }
    expect(outcome.firedRules).toEqual([]);
  });

  it("collects unique reason codes in table order when several escalate rules fire", () => {
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([
          { metricId: WEIGHT, domain: "body-composition", cadencePerDay: 1 / 28 },
          { metricId: "SYNTH-metric-sleep-hours", domain: "sleep", cadencePerDay: 1 / 14 },
        ]),
      ),
    );
    expect(outcome.kind).toBe("ESCALATE");
    if (outcome.kind !== "ESCALATE") {
      throw new Error("unreachable");
    }
    expect(outcome.reasonCodes).toEqual(["cadence-below-floor"]);
    expect(outcome.firedRules).toHaveLength(2);
  });

  it("REJECT wins over ESCALATE when both kinds fire (first reject rule in table order)", () => {
    // vital-signs cadence 5/day: above the ceiling (reject) AND... craft a
    // candidate that also trips an escalate rule: body-composition below
    // floor. Reject takes precedence; both fired rules are audited.
    const outcome = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([
          { metricId: HR, domain: "vital-signs", cadencePerDay: 5 },
          { metricId: WEIGHT, domain: "body-composition", cadencePerDay: 1 / 28 },
        ]),
      ),
    );
    expect(outcome.kind).toBe("REJECT");
    if (outcome.kind !== "REJECT") {
      throw new Error("unreachable");
    }
    expect(outcome.reason).toBe("cadence-above-ceiling");
    expect(outcome.firedRules.map((fired) => fired.code)).toEqual([
      "cadence-above-ceiling",
      "cadence-below-floor",
    ]);
  });

  it("treats a reject-configured rule as REJECT and an escalate-configured one as ESCALATE (outcome is table data)", () => {
    const rejectFirst: SafetyRuleTable = {
      rules: [
        {
          kind: "forbidden-metric-combination",
          ruleId: "safety/forbidden-hr-steps/v1",
          metricA: HR,
          metricB: STEPS,
          onViolation: "reject",
        },
      ],
    };
    const escalateOnly: SafetyRuleTable = {
      rules: [
        {
          kind: "forbidden-metric-combination",
          ruleId: "safety/forbidden-hr-steps/v1",
          metricA: HR,
          metricB: STEPS,
          onViolation: "escalate",
        },
      ],
    };
    const pair = safetyCandidate([
      { metricId: HR, domain: "vital-signs", cadencePerDay: 1 },
      { metricId: STEPS, domain: "activity", cadencePerDay: 1 },
    ]);
    expect(expectOutcomeOk(evaluateSafetyCandidate(pair, rejectFirst)).kind).toBe("REJECT");
    const escalated = expectOutcomeOk(evaluateSafetyCandidate(pair, escalateOnly));
    expect(escalated.kind).toBe("ESCALATE");
    if (escalated.kind !== "ESCALATE") {
      throw new Error("unreachable");
    }
    expect(escalated.reasonCodes).toEqual(["forbidden-metric-combination"]);
  });

  it("does not fire a forbidden-combination rule when only one member is present", () => {
    const table: SafetyRuleTable = {
      rules: [
        {
          kind: "forbidden-metric-combination",
          ruleId: "safety/forbidden-hr-steps/v1",
          metricA: HR,
          metricB: STEPS,
          onViolation: "reject",
        },
      ],
    };
    const outcome = expectOutcomeOk(
      evaluateSafetyCandidate(safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }]), table),
    );
    expect(outcome.kind).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// A41 — the type-encoded publish invariant.
// ---------------------------------------------------------------------------

describe("A41 — ESCALATE never publishes without the review workflow (type-encoded invariant)", () => {
  it("narrowing: isPublishableOutcome only accepts PASS", () => {
    const pass = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }]),
      ),
    );
    const escalate = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: WEIGHT, domain: "body-composition", cadencePerDay: 1 / 28 }]),
      ),
    );
    const reject = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 5 }]),
      ),
    );
    expect(isPublishableOutcome(pass)).toBe(true);
    expect(isPublishableOutcome(escalate)).toBe(false);
    expect(isPublishableOutcome(reject)).toBe(false);
  });

  it("the escalate outcome's literal types encode requiresHumanReview: true and publishable: false", () => {
    const escalate = expectOutcomeOk(
      new SafetyRuleEngine().evaluate(
        safetyCandidate([{ metricId: WEIGHT, domain: "body-composition", cadencePerDay: 1 / 28 }]),
      ),
    );
    if (escalate.kind !== "ESCALATE") {
      throw new Error("unreachable");
    }
    expectTypeOf(escalate).toMatchTypeOf<EscalateOutcome>();
    expectTypeOf(escalate.requiresHumanReview).toEqualTypeOf<true>();
    expectTypeOf(escalate.publishable).toEqualTypeOf<false>();
    // Compile-time guarantee: an ESCALATE verdict never satisfies a
    // publishable-typed slot.
    expectTypeOf(escalate).not.toMatchTypeOf<{ publishable: true }>();
  });
});

// ---------------------------------------------------------------------------
// A41 — typed rejections (tables + candidates).
// ---------------------------------------------------------------------------

describe("A41 SafetyRuleEngine — typed input rejections", () => {
  it("rejects an invalid rule table (typed)", () => {
    const result = evaluateSafetyCandidate(
      safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }]),
      {} as SafetyRuleTable,
    );
    expect(result).toEqual({ ok: false, error: { kind: "invalid-rule-table" } });
  });

  it("rejects malformed rules with typed reasons and indices", () => {
    const cases: readonly (readonly [SafetyRuleTable["rules"][number], Record<string, unknown>])[] = [
      [
        { kind: "max-measurements-per-day", ruleId: "", maxPerDay: 5, onViolation: "reject" } as SafetyRuleTable["rules"][number],
        { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-rule-id" },
      ],
      [
        { kind: "no-such-rule", ruleId: "safety/x/v1", onViolation: "reject" } as unknown as SafetyRuleTable["rules"][number],
        { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-rule-kind" },
      ],
      [
        { kind: "max-measurements-per-day", ruleId: "safety/x/v1", maxPerDay: 0, onViolation: "reject" },
        { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-rule-params" },
      ],
      [
        {
          kind: "min-gap-between-metrics",
          ruleId: "safety/x/v1",
          metricA: HR,
          metricB: HR,
          minGapHours: 1,
          onViolation: "escalate",
        },
        { kind: "invalid-rule", ruleIndex: 0, reason: "same-metric-pair" },
      ],
      [
        {
          kind: "min-gap-between-metrics",
          ruleId: "safety/x/v1",
          metricA: HR,
          metricB: STEPS,
          minGapHours: 0,
          onViolation: "escalate",
        },
        { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-rule-params" },
      ],
      [
        {
          kind: "cadence-floor",
          ruleId: "safety/x/v1",
          domain: "",
          floorPerDay: 1,
          onViolation: "escalate",
        },
        { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-rule-params" },
      ],
      [
        { kind: "cadence-ceiling", ruleId: "safety/x/v1", domain: "vital-signs", ceilingPerDay: -1, onViolation: "reject" },
        { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-rule-params" },
      ],
      [
        { kind: "max-measurements-per-day", ruleId: "safety/x/v1", maxPerDay: 5, onViolation: "maybe" as "reject" },
        { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-violation-outcome" },
      ],
    ];
    for (const [badRule, expected] of cases) {
      const result = evaluateSafetyCandidate(
        safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }]),
        { rules: [badRule] },
      );
      expect(result).toEqual({ ok: false, error: expected });
    }
  });

  it("rejects duplicate rule ids (typed, with index)", () => {
    const rule = {
      kind: "max-measurements-per-day",
      ruleId: "safety/dup/v1",
      maxPerDay: 5,
      onViolation: "reject",
    } as const;
    const result = evaluateSafetyCandidate(
      safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }]),
      { rules: [rule, rule] },
    );
    expect(result).toEqual({ ok: false, error: { kind: "duplicate-rule-id", ruleIndex: 1 } });
  });

  it("accepts an empty rule table (data-driven permissiveness — everything passes)", () => {
    const outcome = expectOutcomeOk(
      evaluateSafetyCandidate(
        safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 100 }]),
        { rules: [] },
      ),
    );
    expect(outcome.kind).toBe("PASS");
    expect(outcome.evaluatedRuleIds).toEqual([]);
  });

  it("rejects malformed candidates with typed reasons (single evaluate)", () => {
    const cases: readonly (readonly [SafetyCandidate, Record<string, unknown>])[] = [
      [
        { candidateId: "", assignments: [{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }] },
        { kind: "invalid-candidate", candidateIndex: 0, reason: "invalid-candidate-id" },
      ],
      [
        { candidateId: "plan_SYNTH-safety-candidate-2", assignments: [] },
        { kind: "invalid-candidate", candidateIndex: 0, reason: "no-assignments" },
      ],
      [
        {
          candidateId: "plan_SYNTH-safety-candidate-3",
          assignments: [
            { metricId: HR, domain: "vital-signs", cadencePerDay: 1 },
            { metricId: HR, domain: "vital-signs", cadencePerDay: 1 },
          ],
        },
        { kind: "invalid-candidate", candidateIndex: 0, reason: "duplicate-metric-assignment" },
      ],
      [
        {
          candidateId: "plan_SYNTH-safety-candidate-4",
          assignments: [{ metricId: HR, domain: "", cadencePerDay: 1 }],
        },
        { kind: "invalid-candidate", candidateIndex: 0, reason: "invalid-domain" },
      ],
      [
        {
          candidateId: "plan_SYNTH-safety-candidate-5",
          assignments: [{ metricId: HR, domain: "vital-signs", cadencePerDay: 0 }],
        },
        { kind: "invalid-candidate", candidateIndex: 0, reason: "invalid-cadence" },
      ],
      [
        {
          candidateId: "plan_SYNTH-safety-candidate-6",
          assignments: [{ metricId: HR, domain: "vital-signs", cadencePerDay: Number.NaN }],
        },
        { kind: "invalid-candidate", candidateIndex: 0, reason: "invalid-cadence" },
      ],
    ];
    for (const [badCandidate, expected] of cases) {
      const result = evaluateSafetyCandidate(badCandidate);
      expect(result).toEqual({ ok: false, error: expected });
    }
  });

  it("evaluateAll fails fast on the first malformed candidate (typed, with index)", () => {
    const engine = new SafetyRuleEngine();
    const result = engine.evaluateAll([
      safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }], "plan_SYNTH-ok-000000000000001"),
      {
        candidateId: "plan_SYNTH-safety-candidate-7",
        assignments: [{ metricId: HR, domain: "vital-signs", cadencePerDay: -1 }],
      },
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid-candidate", candidateIndex: 1, reason: "invalid-cadence" },
    });
  });

  it("evaluateAll rejects a non-array (typed)", () => {
    const result = new SafetyRuleEngine().evaluateAll(
      undefined as unknown as readonly SafetyCandidate[],
    );
    expect(result).toEqual({ ok: false, error: { kind: "invalid-candidates" } });
  });

  it("evaluateAll validates the injected table up front (fail-fast symmetry)", () => {
    const engine = new SafetyRuleEngine({
      rules: [
        { kind: "max-measurements-per-day", ruleId: "", maxPerDay: 5, onViolation: "reject" },
      ],
    });
    const result = engine.evaluateAll([
      safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }]),
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid-rule", ruleIndex: 0, reason: "invalid-rule-id" },
    });
  });
});

// ---------------------------------------------------------------------------
// A41 — evaluateAll + determinism.
// ---------------------------------------------------------------------------

describe("A41 SafetyRuleEngine — evaluateAll + determinism", () => {
  const candidates: readonly SafetyCandidate[] = [
    safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 1 }], "plan_SYNTH-batch-0000000000001"),
    safetyCandidate([{ metricId: WEIGHT, domain: "body-composition", cadencePerDay: 1 / 28 }], "plan_SYNTH-batch-0000000000002"),
    safetyCandidate([{ metricId: HR, domain: "vital-signs", cadencePerDay: 5 }], "plan_SYNTH-batch-0000000000003"),
  ];

  it("evaluates a batch preserving candidate input order", () => {
    const result = new SafetyRuleEngine().evaluateAll(candidates);
    if (!result.ok) {
      throw new Error(`expected batch evaluation to succeed: ${JSON.stringify(result.error)}`);
    }
    expect(result.value.map((outcome) => [outcome.candidateId, outcome.kind])).toEqual([
      ["plan_SYNTH-batch-0000000000001", "PASS"],
      ["plan_SYNTH-batch-0000000000002", "ESCALATE"],
      ["plan_SYNTH-batch-0000000000003", "REJECT"],
    ]);
  });

  it("produces byte-identical outcomes for identical inputs (fresh engines, serialization hash)", () => {
    const first = new SafetyRuleEngine().evaluateAll(candidates);
    const second = new SafetyRuleEngine().evaluateAll(candidates);
    if (!first.ok || !second.ok) {
      throw new Error("expected batch evaluations to succeed");
    }
    expect(serializeSafetyOutcomes(second.value)).toBe(serializeSafetyOutcomes(first.value));
    expect(hashSafetyOutcomes(second.value)).toBe(hashSafetyOutcomes(first.value));
    expect(hashSafetyOutcomes(first.value)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces byte-identical outcomes when re-run on the SAME engine instance", () => {
    const engine = new SafetyRuleEngine();
    const first = engine.evaluateAll(candidates);
    const second = engine.evaluateAll(candidates);
    if (!first.ok || !second.ok) {
      throw new Error("expected batch evaluations to succeed");
    }
    expect(hashSafetyOutcomes(second.value)).toBe(hashSafetyOutcomes(first.value));
  });
});

// ---------------------------------------------------------------------------
// A41 — adapters.
// ---------------------------------------------------------------------------

describe("A41 — safety candidate adapters", () => {
  it("adapts a matchable candidate with per-metric metadata (deny-by-default on missing metadata)", () => {
    const matchable: MatchableCandidate = {
      candidateId: "plan_SYNTH-adapted-safety-01",
      metricMethods: [
        { metricId: HR, methodIds: ["SYNTH-method-hr-ring"] },
        { metricId: STEPS, methodIds: ["SYNTH-method-steps-phone"] },
      ],
    };
    const metadata: Record<string, { domain: string; cadencePerDay: number }> = {
      [HR]: { domain: "vital-signs", cadencePerDay: 1 },
      [STEPS]: { domain: "activity", cadencePerDay: 1 },
    };
    const adapted = safetyCandidateFromMatchable(matchable, (metricId) => metadata[metricId]);
    expect(adapted).toEqual({
      ok: true,
      value: {
        candidateId: "plan_SYNTH-adapted-safety-01",
        assignments: [
          { metricId: HR, domain: "vital-signs", cadencePerDay: 1 },
          { metricId: STEPS, domain: "activity", cadencePerDay: 1 },
        ],
      },
    });

    const missing = safetyCandidateFromMatchable(matchable, (metricId) =>
      metricId === HR ? metadata[metricId] : undefined,
    );
    expect(missing).toEqual({ ok: false, error: { kind: "missing-metric-metadata", metricIndex: 1 } });

    const invalid = safetyCandidateFromMatchable(matchable, () => ({
      domain: "vital-signs",
      cadencePerDay: 0,
    }));
    expect(invalid).toEqual({ ok: false, error: { kind: "invalid-metric-metadata", metricIndex: 0 } });
  });

  it("adapts an M5-A plan-candidate shape directly", () => {
    const planCandidate = {
      plan: { id: "plan_SYNTH-adapted-safety-02" },
      metricId: HR,
      methodOrder: ["SYNTH-method-hr-ring"],
      explainability: { contributingEntries: [{ entryId: "evpe_x" }] },
    };
    const adapted = safetyCandidateFromPlanCandidate(planCandidate, (metricId) =>
      metricId === HR ? { domain: "vital-signs", cadencePerDay: 2 } : undefined,
    );
    expect(adapted).toEqual({
      ok: true,
      value: {
        candidateId: "plan_SYNTH-adapted-safety-02",
        assignments: [{ metricId: HR, domain: "vital-signs", cadencePerDay: 2 }],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// A41 — full Lane A pipeline (M5-A compiler -> A39 -> A40 -> A41).
// ---------------------------------------------------------------------------

describe("M5 Lane A pipeline — compile -> optimize -> match -> safety-gate", () => {
  const DAY_MS = 86_400_000;
  const PACK_ID = "evpack_SYNTH-pack-00000001" as EvidencePackId;

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

  it("runs the full deterministic chain end-to-end (M5-A handoff reconciled through the adapters)", () => {
    // --- M5-A: compile the intent against the active EvidencePack. ---
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
    const compiled = compiler.compile({
      personId: PERSON,
      intentId: INTENT_ID,
      packId: PACK_ID,
      goal: { metrics: [{ metricId: HR }, { metricId: STEPS }] },
    });
    if (!compiled.ok) {
      throw new Error(`expected compilation to succeed: ${JSON.stringify(compiled.error)}`);
    }
    expect(compiled.value.candidates).toHaveLength(5);

    // --- A39: burden-optimize (kinds derived from the person's sources). ---
    const kinds: Record<string, "device" | "app" | "manual"> = {
      "SYNTH-method-hr-ring": "device",
      "SYNTH-method-hr-wearable": "device",
      "SYNTH-method-hr-app": "app",
      "SYNTH-method-steps-wearable": "device",
      "SYNTH-method-steps-phone": "app",
    };
    const optimizable = compiled.value.candidates.map((pc) => {
      const adapted = optimizableFromPlanCandidate(pc, (methodId) => kinds[methodId]);
      if (!adapted.ok) {
        throw new Error(`expected adaptation to succeed: ${JSON.stringify(adapted.error)}`);
      }
      return adapted.value;
    });
    const optimized = new BurdenOptimizer().optimize({
      candidates: optimizable,
      goalMetrics: [HR, STEPS],
    });
    if (!optimized.ok) {
      throw new Error(`expected optimization to succeed: ${JSON.stringify(optimized.error)}`);
    }
    // Least-burden device ties survive per metric; app variants are dominated.
    expect(optimized.value.paretoMinimal).toHaveLength(3);

    // --- A40: resource-match against the person's registered sources. ---
    const frontMatchable: MatchableCandidate[] = optimized.value.paretoMinimal.map((evaluated) => {
      const original = compiled.value.candidates.find((pc) => pc.plan.id === evaluated.candidateId);
      if (original === undefined) {
        throw new Error("expected front candidate to join to its compiled source");
      }
      return matchableFromPlanCandidate(original);
    });
    const active = registry.resolveActive(PACK_ID);
    if (active === undefined) {
      throw new Error("expected fixture pack to resolve");
    }
    const matched = new ResourceMatcher().match({
      personId: PERSON,
      candidates: frontMatchable,
      sources: [
        {
          sourceId: "src_SYNTH-source-00000006" as SourceId,
          personId: PERSON,
          kind: "device",
          supportedMethodIds: [
            "SYNTH-method-hr-ring",
            "SYNTH-method-hr-wearable",
            "SYNTH-method-steps-wearable",
          ],
          active: true,
        },
      ],
      coverage: active.entries,
    });
    if (!matched.ok) {
      throw new Error(`expected match to succeed: ${JSON.stringify(matched.error)}`);
    }
    expect(matched.value.matched).toHaveLength(3);
    expect(matched.value.dropped).toEqual([]);

    // --- A41: safety-gate the executable candidates. ---
    const metadata: Record<string, { domain: string; cadencePerDay: number }> = {
      [HR]: { domain: METRICS[0]!.category, cadencePerDay: 1 },
      [STEPS]: { domain: METRICS[1]!.category, cadencePerDay: 1 },
    };
    const safetyCandidates = matched.value.matched.map((executable) => {
      const candidate = {
        candidateId: executable.candidateId,
        metricMethods: executable.bindings.map((binding) => ({
          metricId: binding.metricId,
          methodIds: [binding.methodId],
        })),
      };
      const adapted = safetyCandidateFromMatchable(candidate, (metricId) => metadata[metricId]);
      if (!adapted.ok) {
        throw new Error(`expected safety adaptation to succeed: ${JSON.stringify(adapted.error)}`);
      }
      return adapted.value;
    });
    const outcomes = new SafetyRuleEngine().evaluateAll(safetyCandidates);
    if (!outcomes.ok) {
      throw new Error(`expected safety evaluation to succeed: ${JSON.stringify(outcomes.error)}`);
    }
    expect(outcomes.value).toHaveLength(3);
    for (const outcome of outcomes.value) {
      expect(outcome.kind).toBe("PASS");
      expect(isPublishableOutcome(outcome)).toBe(true);
    }

    // Determinism: the whole chain is replayable byte-identically.
    expect(hashSafetyOutcomes(outcomes.value)).toMatch(/^[0-9a-f]{64}$/);
  });
});
