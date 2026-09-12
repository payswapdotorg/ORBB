// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  GOAL_METRIC_OPTIONS,
  INTENT_CADENCE_OPTIONS,
  INTENT_DOMAIN_CADENCE_BOUNDS,
  INTENT_METHOD_OPTIONS,
  INTENT_REGISTERED_SOURCES,
  assertIntentCatalogInvariants,
  domainCadenceBounds,
  findGoalMetricOption,
  findIntentMethodOption,
  hasRegisteredSource,
  methodsForMetric,
} from "./catalog";

/**
 * Intent catalog contract tests (M6-A): the vocabulary invariants —
 * SYNTH-marked ids, metric/method/source coherence, burden ordering, and
 * the domain-cadence-bounds mirror of the frozen M5-B default table.
 */

describe("intent catalog", () => {
  it("passes its invariant assertion (fixture loud-failure contract)", () => {
    expect(() => assertIntentCatalogInvariants()).not.toThrow();
  });

  it("offers one goal metric option per M4-B catalog metric (SYNTH-marked)", () => {
    expect(GOAL_METRIC_OPTIONS.length).toBeGreaterThanOrEqual(6);
    for (const option of GOAL_METRIC_OPTIONS) {
      expect(option.metricId.startsWith("SYNTH-metric-")).toBe(true);
      expect(option.conceptCode.startsWith("SYNTH-")).toBe(true);
      expect(option.unit.length).toBeGreaterThan(0);
      expect(option.targetMin).toBeLessThan(option.targetMax);
    }
    const systolic = findGoalMetricOption("SYNTH-metric-bp-systolic");
    expect(systolic?.conceptCode).toBe("SYNTH-8480-5");
    expect(systolic?.category).toBe("vital-signs");
  });

  it("registers manual methods with sources and seam methods without", () => {
    const manual = findIntentMethodOption("SYNTH-method-bpsys-manual");
    expect(manual?.kind).toBe("manual");
    expect(hasRegisteredSource("SYNTH-method-bpsys-manual")).toBe(true);

    const seam = findIntentMethodOption("SYNTH-method-cuff-bp-panel");
    expect(seam?.kind).toBe("device");
    expect(hasRegisteredSource("SYNTH-method-cuff-bp-panel")).toBe(false);

    // The manual source is the ONLY registered source (M4-C seam is display-only).
    expect(INTENT_REGISTERED_SOURCES).toHaveLength(1);
    expect(INTENT_REGISTERED_SOURCES[0]?.sourceId).toBe("src_SYNTH-source-manual");
  });

  it("orders a metric's methods least-burden first", () => {
    const methods = methodsForMetric("SYNTH-metric-bp-systolic");
    const burdens = methods.map((method) => method.relativeBurden);
    expect(burdens).toEqual([...burdens].sort((a, b) => a - b));
  });

  it("carries the four cadence options with per-day rates", () => {
    const rates = INTENT_CADENCE_OPTIONS.map((option) => option.cadencePerDay);
    expect(rates).toContain(2);
    expect(rates).toContain(1);
    expect(rates).toContain(0.5);
    expect(Math.abs((rates.find((r) => r !== 2 && r !== 1 && r !== 0.5) ?? 0) - 1 / 7)).toBeLessThan(1e-9);
  });

  it("mirrors the frozen M5-B default domain cadence bounds", () => {
    expect(domainCadenceBounds("vital-signs")).toEqual({
      domain: "vital-signs",
      floorPerDay: 1,
      ceilingPerDay: 4,
    });
    expect(domainCadenceBounds("body-composition")).toEqual({
      domain: "body-composition",
      floorPerDay: 1 / 7,
      ceilingPerDay: 2,
    });
    expect(domainCadenceBounds("unknown-domain")).toBeUndefined();
    expect(INTENT_DOMAIN_CADENCE_BOUNDS).toHaveLength(4);
  });

  it("keeps every method attached to a goal metric", () => {
    const metricIds = new Set(GOAL_METRIC_OPTIONS.map((option) => option.metricId));
    for (const method of INTENT_METHOD_OPTIONS) {
      expect(metricIds.has(method.metricId)).toBe(true);
    }
  });
});
