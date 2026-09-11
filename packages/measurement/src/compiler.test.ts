import { describe, expect, it } from "vitest";
import { DomainInvariantError, assertMeasurementPlan, isMeasurementPlan } from "@orbb/domain";
import {
  buildEngineHarness,
  harnessIntentId,
  harnessPersonId,
  hrProtocol,
} from "./testsupport.js";
import { SEEDED_METRIC_IDS, SEEDED_METHOD_IDS } from "./seed.js";
import { applyPlanTransition, PlanCompiler } from "./compiler.js";
import { MS_PER_DAY, MS_PER_HOUR } from "./testsupport.js";
import type { ProtocolDefinition } from "./protocol.js";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";

const PERSON = harnessPersonId();
const INTENT = harnessIntentId();

function compile(harness: ReturnType<typeof buildEngineHarness>, protocol: ProtocolDefinition) {
  return harness.compiler.compile({ personId: PERSON, intentId: INTENT, protocol });
}

describe("A29 plan compiler — compilation", () => {
  it("compiles a protocol into a domain draft plan with expanded PlanMetrics", () => {
    const harness = buildEngineHarness();
    const result = compile(harness, hrProtocol());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected compilation to succeed");
    }
    const { plan, planMetrics } = result.value;
    expect(plan.state).toBe("draft");
    expect(plan.personId).toBe(PERSON);
    expect(plan.intentId).toBe(INTENT);
    expect(plan.metrics).toEqual(["SYNTH-8867-4"]);
    // The domain guard accepts the compiled plan.
    expect(() => assertMeasurementPlan(plan)).not.toThrow();
    expect(isMeasurementPlan(plan)).toBe(true);
    expect(planMetrics).toHaveLength(1);
    const planMetric = planMetrics[0];
    expect(planMetric?.planId).toBe(plan.id);
    expect(planMetric?.metricId).toBe(SEEDED_METRIC_IDS.heartRate);
    expect(planMetric?.conceptCode).toBe("SYNTH-8867-4");
    expect(planMetric?.schedule.intervalMs).toBe(MS_PER_DAY);
    expect(planMetric?.schedule.windowDurationMs).toBe(MS_PER_HOUR);
    expect(planMetric?.schedule.horizonMs).toBe(2 * MS_PER_DAY);
    expect(planMetric?.schedule.missedWindowPolicy).toBe("roll-forward");
    expect(planMetric?.schedule.anchorAt).toEqual(new Date(0));
    expect(planMetric?.methodOrder).toEqual([
      SEEDED_METHOD_IDS.heartRateWearable,
      SEEDED_METHOD_IDS.heartRateApp,
      SEEDED_METHOD_IDS.heartRateManual,
    ]);
    expect(planMetric?.id.startsWith("pm_")).toBe(true);
  });

  it("expands a category (domain) selector to all of the category's active metrics", () => {
    const harness = buildEngineHarness();
    const protocol = hrProtocol();
    const expanded: ProtocolDefinition = {
      protocolId: protocol.protocolId,
      metricSelectors: [{ category: "vital-signs" }],
      defaultSchedule: protocol.defaultSchedule,
    };
    const result = compile(harness, expanded);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected compilation to succeed");
    }
    expect(result.value.plan.metrics).toHaveLength(3);
    expect(result.value.planMetrics.map((planMetric) => planMetric.metricId).sort()).toEqual(
      [
        SEEDED_METRIC_IDS.bloodPressureSystolic,
        SEEDED_METRIC_IDS.bloodPressureDiastolic,
        SEEDED_METRIC_IDS.heartRate,
      ].sort(),
    );
    // Default method order (no preference): all methods, least-burden-first.
    const heartRateMetric = result.value.planMetrics.find(
      (planMetric) => planMetric.metricId === SEEDED_METRIC_IDS.heartRate,
    );
    expect(heartRateMetric?.methodOrder[0]).toBe(SEEDED_METHOD_IDS.heartRateWearable);
  });

  it("defaults the schedule anchor to compile time when not authored", () => {
    const harness = buildEngineHarness({ epochMs: 5_000 });
    const protocol = hrProtocol();
    const { defaultSchedule, ...rest } = protocol;
    void defaultSchedule;
    const unanchored: ProtocolDefinition = {
      ...rest,
      defaultSchedule: {
        intervalMs: MS_PER_DAY,
        windowDurationMs: MS_PER_HOUR,
        horizonMs: 2 * MS_PER_DAY,
        missedWindowPolicy: "roll-forward",
      },
    };
    const result = compile(harness, unanchored);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.planMetrics[0]?.schedule.anchorAt).toEqual(new Date(5_000));
    }
  });
});

describe("A29 plan compiler — determinism (pure, no I/O)", () => {
  it("produces byte-identical output for identical inputs, factories, and clocks", () => {
    const first = compile(buildEngineHarness({ seed: "determinism", epochMs: 42 }), hrProtocol());
    const second = compile(buildEngineHarness({ seed: "determinism", epochMs: 42 }), hrProtocol());
    expect(second).toEqual(first);
  });

  it("anchors plan-metric ids in (planId, metricId) — stable across identical replays", () => {
    const harnessA = buildEngineHarness({ seed: "determinism" });
    const harnessB = buildEngineHarness({ seed: "determinism" });
    const first = compile(harnessA, hrProtocol());
    const second = compile(harnessB, hrProtocol());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.planMetrics[0]?.id).toBe(second.value.planMetrics[0]?.id);
    }
  });

  it("consumes only the injected id sequence and clock (no ambient state)", () => {
    const harness = buildEngineHarness({ seed: "seq", epochMs: 100 });
    // Advance nothing: compile twice with a fresh factory each time.
    const compilerA = new PlanCompiler({
      catalog: harness.catalog,
      methods: harness.methods,
      clock: new DeterministicClock({ epochMs: 100 }),
      ids: new DeterministicIdFactory({ seed: "seq" }),
    });
    const compilerB = new PlanCompiler({
      catalog: harness.catalog,
      methods: harness.methods,
      clock: new DeterministicClock({ epochMs: 100 }),
      ids: new DeterministicIdFactory({ seed: "seq" }),
    });
    const input = { personId: PERSON, intentId: INTENT, protocol: hrProtocol() };
    expect(compilerB.compile(input)).toEqual(compilerA.compile(input));
  });
});

describe("A29 plan compiler — validation (typed rejections)", () => {
  it("rejects unknown metrics in a selector", () => {
    const harness = buildEngineHarness();
    const protocol = hrProtocol();
    const result = compile(harness, {
      ...protocol,
      metricSelectors: [{ metricId: "SYNTH-metric-ghost" }],
    });
    expect(result).toEqual({ ok: false, error: { kind: "unknown-metric", selectorIndex: 0 } });
  });

  it("rejects empty category selectors", () => {
    const harness = buildEngineHarness();
    const result = compile(harness, {
      ...hrProtocol(),
      metricSelectors: [{ category: "nonexistent-domain" }],
    });
    expect(result).toEqual({ ok: false, error: { kind: "empty-category", selectorIndex: 0 } });
  });

  it("rejects selectors without a target and selectors with conflicting targets", () => {
    const harness = buildEngineHarness();
    expect(compile(harness, { ...hrProtocol(), metricSelectors: [{}] })).toEqual({
      ok: false,
      error: { kind: "selector-without-target", selectorIndex: 0 },
    });
    expect(
      compile(harness, {
        ...hrProtocol(),
        metricSelectors: [{ metricId: SEEDED_METRIC_IDS.heartRate, category: "vital-signs" }],
      }),
    ).toEqual({ ok: false, error: { kind: "ambiguous-selector", selectorIndex: 0 } });
  });

  it("rejects duplicate metric expansion across selectors", () => {
    const harness = buildEngineHarness();
    const result = compile(harness, {
      ...hrProtocol(),
      metricSelectors: [
        { metricId: SEEDED_METRIC_IDS.heartRate },
        { metricId: SEEDED_METRIC_IDS.heartRate },
      ],
    });
    expect(result).toEqual({ ok: false, error: { kind: "duplicate-metric", selectorIndex: 1 } });
  });

  it("rejects method preferences referencing unregistered methods", () => {
    const harness = buildEngineHarness();
    const result = compile(harness, {
      ...hrProtocol(),
      methodPreferences: [
        { metricId: SEEDED_METRIC_IDS.heartRate, orderedMethodIds: ["SYNTH-method-ghost"] },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "unknown-method", preferenceIndex: 0, methodPosition: 0 },
    });
  });

  it("rejects methods that are illegal for the metric (domain assertMethodForMetric)", () => {
    const harness = buildEngineHarness();
    // A blood-pressure method paired with the heart-rate metric.
    const result = compile(harness, {
      ...hrProtocol(),
      methodPreferences: [
        { metricId: SEEDED_METRIC_IDS.heartRate, orderedMethodIds: [SEEDED_METHOD_IDS.bpSystolicCuff] },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "method-metric-mismatch", preferenceIndex: 0 },
    });
  });

  it("rejects duplicate methods inside one preference", () => {
    const harness = buildEngineHarness();
    const method = SEEDED_METHOD_IDS.heartRateWearable;
    const result = compile(harness, {
      ...hrProtocol(),
      methodPreferences: [
        { metricId: SEEDED_METRIC_IDS.heartRate, orderedMethodIds: [method, method] },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "duplicate-method-preference", preferenceIndex: 0 },
    });
  });

  it("rejects schedules where the window overlaps the cadence or the horizon is too short", () => {
    const harness = buildEngineHarness();
    expect(
      compile(harness, hrProtocol({ windowDurationMs: 2 * MS_PER_DAY, horizonMs: 3 * MS_PER_DAY })),
    ).toEqual({
      ok: false,
      error: { kind: "invalid-schedule", selectorIndex: 0, rule: "window-exceeds-interval" },
    });
    expect(compile(harness, hrProtocol({ horizonMs: MS_PER_HOUR }))).toEqual({
      ok: false,
      error: { kind: "invalid-schedule", selectorIndex: 0, rule: "horizon-below-interval" },
    });
    expect(compile(harness, hrProtocol({ intervalMs: 0 }))).toEqual({
      ok: false,
      error: { kind: "invalid-schedule", selectorIndex: 0, rule: "non-positive-interval" },
    });
    expect(compile(harness, hrProtocol({ windowDurationMs: 0 }))).toEqual({
      ok: false,
      error: { kind: "invalid-schedule", selectorIndex: 0, rule: "non-positive-window" },
    });
  });

  it("rejects malformed identities via the domain id parsers", () => {
    const harness = buildEngineHarness();
    const badPerson = harness.compiler.compile({
      personId: "not-a-person-id" as Parameters<typeof harnessPersonId>[never],
      intentId: INTENT,
      protocol: hrProtocol(),
    });
    expect(badPerson).toEqual({ ok: false, error: { kind: "invalid-person-id" } });
    const badIntent = harness.compiler.compile({
      personId: PERSON,
      intentId: "not-an-intent-id" as Parameters<typeof harnessIntentId>[never],
      protocol: hrProtocol(),
    });
    expect(badIntent).toEqual({ ok: false, error: { kind: "invalid-intent-id" } });
  });

  it("rejects protocols with no metric selectors", () => {
    const harness = buildEngineHarness();
    expect(compile(harness, { ...hrProtocol(), metricSelectors: [] })).toEqual({
      ok: false,
      error: { kind: "invalid-protocol" },
    });
  });
});

describe("A29 plan compiler — publication stays a domain transition", () => {
  it("walks draft -> published -> active through the frozen domain state machine", () => {
    const harness = buildEngineHarness();
    const result = compile(harness, hrProtocol());
    if (!result.ok) {
      throw new Error("expected compilation to succeed");
    }
    const published = applyPlanTransition(result.value.plan, "published");
    expect(published.state).toBe("published");
    expect(published.metrics).toEqual(result.value.plan.metrics);
    const active = applyPlanTransition(published, "active");
    expect(active.state).toBe("active");
    const completed = applyPlanTransition(active, "completed");
    expect(completed.state).toBe("completed");
  });

  it("lets the domain guard reject illegal transitions (draft -> active throws)", () => {
    const harness = buildEngineHarness();
    const result = compile(harness, hrProtocol());
    if (!result.ok) {
      throw new Error("expected compilation to succeed");
    }
    expect(() => applyPlanTransition(result.value.plan, "active")).toThrow(DomainInvariantError);
    expect(() => applyPlanTransition(result.value.plan, "completed")).toThrow(DomainInvariantError);
  });
});
