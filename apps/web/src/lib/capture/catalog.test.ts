import { describe, expect, it } from "vitest";
import {
  CAPTURE_SHAPES,
  assertCaptureCatalogInvariants,
  findCaptureShape,
} from "./catalog";
import { CAPTURE_PARTIAL_FLOOR_FRACTION, classifyQualityScore, qualityScoreFromState } from "./quality";
import { CAPTURE_QUALITY_STATES } from "./types";

/**
 * Catalog contract tests (M4-B): the synthetic capture vocabulary is
 * well-formed, SYNTH-marked, method/metric-consistent, and its quality
 * mappings round-trip for every manual method.
 */

describe("capture catalog", () => {
  it("passes its structural invariants", () => {
    expect(() => assertCaptureCatalogInvariants()).not.toThrow();
  });

  it("offers at least four shapes including the compound blood pressure panel", () => {
    expect(CAPTURE_SHAPES.length).toBeGreaterThanOrEqual(4);
    const bp = findCaptureShape("SYNTH-shape-bp-panel");
    expect(bp).toBeDefined();
    expect(bp?.fields.map((field) => field.id)).toEqual(["systolic", "diastolic"]);
    expect(bp?.fields.every((field) => field.metric.unitDomain[0] === "mmHg")).toBe(true);
  });

  it("marks every identity-like string SYNTH (protocol test-data rule)", () => {
    for (const shape of CAPTURE_SHAPES) {
      expect(shape.id.startsWith("SYNTH-")).toBe(true);
      expect(shape.manualMethodOption.id.startsWith("SYNTH-")).toBe(true);
      for (const option of shape.futureMethodOptions) {
        expect(option.id.startsWith("SYNTH-")).toBe(true);
      }
      for (const field of shape.fields) {
        expect(field.metric.id.startsWith("SYNTH-")).toBe(true);
        expect(field.metric.conceptCode.startsWith("SYNTH-")).toBe(true);
        expect(field.method.id.startsWith("SYNTH-")).toBe(true);
      }
    }
  });

  it("keeps every field's method bound to its own metric (engine invariant mirror)", () => {
    for (const shape of CAPTURE_SHAPES) {
      for (const field of shape.fields) {
        expect(field.method.metricId).toBe(field.metric.id);
      }
    }
  });

  it("aligns metric/method ids with the M4-A engine seed vocabulary", () => {
    // Drop-in seam: the engine's seeded ids appear verbatim here so the
    // integration swap renames nothing.
    const metricIds = new Set(
      CAPTURE_SHAPES.flatMap((shape) => shape.fields.map((field) => field.metric.id)),
    );
    expect(metricIds.has("SYNTH-metric-bp-systolic")).toBe(true);
    expect(metricIds.has("SYNTH-metric-bp-diastolic")).toBe(true);
    expect(metricIds.has("SYNTH-metric-heart-rate")).toBe(true);
    expect(metricIds.has("SYNTH-metric-body-weight")).toBe(true);
    const methodIds = new Set(
      CAPTURE_SHAPES.flatMap((shape) => shape.fields.map((field) => field.method.id)),
    );
    expect(methodIds.has("SYNTH-method-bpsys-manual")).toBe(true);
    expect(methodIds.has("SYNTH-method-hr-manual")).toBe(true);
  });

  it("records MEASURED for device-read manual entries and ESTIMATED for recalled ones", () => {
    const byShape = new Map(
      CAPTURE_SHAPES.flatMap((shape) =>
        shape.fields.map((field) => [shape.id, field.method.evidenceLabel] as const),
      ),
    );
    expect(byShape.get("SYNTH-shape-bp-panel")).toBe("MEASURED");
    expect(byShape.get("SYNTH-shape-heart-rate")).toBe("MEASURED");
    expect(byShape.get("SYNTH-shape-step-count")).toBe("ESTIMATED");
    expect(byShape.get("SYNTH-shape-sleep-minutes")).toBe("ESTIMATED");
    // Honest-method notes exist exactly on the ESTIMATED shapes.
    for (const shape of CAPTURE_SHAPES) {
      const estimated = shape.fields.some((field) => field.method.evidenceLabel === "ESTIMATED");
      expect((shape.evidenceNote !== undefined) === estimated).toBe(true);
    }
  });

  it("derives quality scores that classify back to the self-assessed state (no silent upgrades)", () => {
    for (const shape of CAPTURE_SHAPES) {
      for (const field of shape.fields) {
        for (const state of CAPTURE_QUALITY_STATES) {
          const score = qualityScoreFromState(state, field.method.typicalQuality);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
          expect(classifyQualityScore(score, field.method.typicalQuality)).toBe(state);
        }
      }
    }
  });

  it("mirrors the A31 partial-floor fraction", () => {
    expect(CAPTURE_PARTIAL_FLOOR_FRACTION).toBe(0.5);
  });
});
