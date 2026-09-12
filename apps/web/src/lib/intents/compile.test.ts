// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  burdenSummaryOf,
  compileIntentPlan,
  composeObjectiveStatement,
  evaluateCandidateSafety,
  evaluateSafetyOutcome,
} from "./compile";
import { buildSyntheticEvidencePack } from "./pack";
import type { IntentEvidencePackView, IntentGoalView } from "./types";

/**
 * Compile mirror contract tests (M6-A): the deterministic M5 pipeline
 * mirror — burden-ordered executable candidates (manual only: seam methods
 * drop with `no-source`), explainability shape, safety outcomes across
 * PASS / ESCALATE / REJECT, and the burden projection.
 */

const NOW = new Date("2026-09-12T10:00:00.000Z");
const PACK = buildSyntheticEvidencePack(NOW);

const BP_GOAL: IntentGoalView = {
  metricId: "SYNTH-metric-bp-systolic",
  direction: "decrease",
  target: 120,
};

function compile(
  goal: IntentGoalView = BP_GOAL,
  cadencePerDay = 1,
  methodPreference: "any" | "measured-only" = "any",
  pack: IntentEvidencePackView = PACK,
  now: Date = NOW,
) {
  return compileIntentPlan({
    intentId: "intent_SYNTH-intent-000001",
    goal,
    constraints: { cadencePerDay, methodPreference },
    pack,
    now,
  });
}

describe("compile mirror", () => {
  it("is deterministic given identical inputs", () => {
    expect(compile()).toEqual(compile());
  });

  it("emits burden-ordered candidates and drops seam methods with no-source", () => {
    const result = compile();
    // Both the cuff seam (burden 1) and manual (burden 3) are claimed by
    // the pack; only the manual method has a registered source.
    expect(result.executable).toHaveLength(1);
    const candidate = result.executable[0]!;
    expect(candidate.methodId).toBe("SYNTH-method-bpsys-manual");
    expect(candidate.state).toBe("draft");
    expect(candidate.metrics).toEqual(["SYNTH-8480-5"]);

    expect(result.dropped).toHaveLength(1);
    const drop = result.dropped[0]!;
    expect(drop.methodId).toBe("SYNTH-method-cuff-bp-panel");
    expect(drop.reason).toBe("no-source");
  });

  it("carries the A38 explainability shape on each candidate", () => {
    const candidate = compile().executable[0]!;
    expect(candidate.pack.packId).toBe(PACK.packId);
    expect(candidate.pack.version).toBe(1);
    expect(candidate.pack.contentHash).toBe(PACK.contentHash);
    expect(candidate.contributingEntries).toHaveLength(1);
    const entry = candidate.contributingEntries[0]!;
    expect(entry.count).toBe(12);
    expect(entry.provenanceActorClass).toBe("person");
    expect(entry.windowStart).toBe(PACK.entries[0]!.windowStart);
    expect(candidate.totalObservationCount).toBe(12);
    expect(candidate.compiledAt).toBe(NOW.toISOString());
    expect(candidate.planId).toBe(
      "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
    );
  });

  it("excludes ESTIMATED methods under the measured-only preference", () => {
    const sleepGoal: IntentGoalView = {
      metricId: "SYNTH-metric-sleep-minutes",
      direction: "increase",
      target: 480,
    };
    const anyResult = compile(sleepGoal, 1, "any");
    // Sleep manual is ESTIMATED; the wearable seam is MEASURED but has no
    // registered source — so ANY leaves the manual candidate executable.
    expect(anyResult.executable.map((c) => c.methodId)).toEqual([
      "SYNTH-method-sleep-manual",
    ]);

    // MEASURED-ONLY excludes the manual method; the remaining wearable seam
    // compiles but the matcher drops it (no registered source) — the
    // honest empty state with a typed drop audit, never a fabricated plan.
    const measuredOnly = compile(sleepGoal, 1, "measured-only");
    expect(measuredOnly.executable).toHaveLength(0);
    expect(measuredOnly.dropped).toEqual([
      expect.objectContaining({
        methodId: "SYNTH-method-wearable-sleep-minutes",
        reason: "no-source",
      }),
    ]);
  });

  it("gates goal metrics without pack coverage with the typed reason", () => {
    const emptyPack: IntentEvidencePackView = {
      packId: PACK.packId,
      personId: PACK.personId,
      version: 1,
      contentHash: PACK.contentHash,
      entries: [],
    };
    const result = compile(BP_GOAL, 1, "any", emptyPack);
    expect(result.executable).toHaveLength(0);
    expect(result.gated).toEqual([
      {
        metricId: "SYNTH-metric-bp-systolic",
        reason: "no-pack-coverage",
        packEntryCount: 0,
      },
    ]);
  });

  it("composes the objective statement from the structured goal", () => {
    expect(composeObjectiveStatement(BP_GOAL)).toBe(
      "Lower Blood Pressure Systolic toward 120 mmHg.",
    );
  });
});

describe("safety mirror", () => {
  it("PASSes a daily vital-signs cadence", () => {
    const outcome = evaluateSafetyOutcome({
      metricId: "SYNTH-metric-bp-systolic",
      domain: "vital-signs",
      cadencePerDay: 1,
    });
    expect(outcome.kind).toBe("PASS");
    expect(outcome.publishable).toBe(true);
    expect(outcome.requiresHumanReview).toBe(false);
  });

  it("ESCALATEs a weekly vital-signs cadence (below the domain floor)", () => {
    const outcome = evaluateSafetyOutcome({
      metricId: "SYNTH-metric-bp-systolic",
      domain: "vital-signs",
      cadencePerDay: 1 / 7,
    });
    expect(outcome.kind).toBe("ESCALATE");
    expect(outcome.requiresHumanReview).toBe(true);
    expect(outcome.publishable).toBe(false);
    expect(outcome.reasonCodes).toEqual(["cadence-below-floor"]);
    expect(outcome.firedRules[0]?.ruleId).toBe(
      "safety/cadence-floor/vital-signs/v1",
    );
  });

  it("REJECTs a cadence above the domain ceiling (hard stop)", () => {
    const outcome = evaluateSafetyOutcome({
      metricId: "SYNTH-metric-sleep-minutes",
      domain: "sleep",
      cadencePerDay: 6,
    });
    expect(outcome.kind).toBe("REJECT");
    expect(outcome.publishable).toBe(false);
    expect(outcome.reasonCodes).toContain("cadence-above-ceiling");
  });

  it("REJECTs a total above the day guard", () => {
    const outcome = evaluateSafetyOutcome({
      metricId: "SYNTH-metric-bp-systolic",
      domain: "vital-signs",
      cadencePerDay: 13,
    });
    expect(outcome.kind).toBe("REJECT");
    expect(outcome.reasonCodes).toContain("exceeds-max-measurements-per-day");
  });

  it("leaves domains without table entries unchecked (rules are data)", () => {
    const outcome = evaluateSafetyOutcome({
      metricId: "SYNTH-metric-unknown",
      domain: "not-in-table",
      cadencePerDay: 1,
    });
    expect(outcome.kind).toBe("PASS");
  });

  it("evaluates a candidate through its catalog domain", () => {
    const candidate = compile(BP_GOAL, 1 / 7).executable[0]!;
    expect(evaluateCandidateSafety(candidate).kind).toBe("ESCALATE");
  });
});

describe("burden mirror", () => {
  it("projects the kind-weight × cadence burden units", () => {
    const candidate = compile(BP_GOAL, 1).executable[0]!;
    const burden = burdenSummaryOf(candidate);
    expect(burden.methodCount).toBe(1);
    expect(burden.measurementsPerDay).toBe(1);
    expect(burden.burdenUnitsPerDay).toBe(3); // manual weight 3 × 1/day
    expect(burden.methodKindWeights).toEqual({ manual: 3, app: 2, device: 1 });
  });

  it("scales burden with cadence", () => {
    const candidate = compile(BP_GOAL, 0.5).executable[0]!;
    expect(burdenSummaryOf(candidate).burdenUnitsPerDay).toBe(1.5);
  });
});
