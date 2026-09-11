import { describe, expect, it } from "vitest";
import * as measurementBoundary from "./index.js";

describe("@orbb/measurement boundary package", () => {
  it("loads the engine module with real runtime behavior", () => {
    expect(measurementBoundary).toBeDefined();
  });

  it("exports the A27–A31 engine surface plus reconciliation", () => {
    const surface = measurementBoundary as Record<string, unknown>;
    for (const name of [
      "InMemoryMetricCatalog",
      "InMemoryMeasurementMethodRegistry",
      "InMemoryCapabilityIndex",
      "PlanCompiler",
      "TaskScheduler",
      "AttemptRecorder",
      "ReconciliationService",
      "seedMeasurementVocabulary",
      "applyPlanTransition",
      "TypicalRangeQualityPolicy",
      "deriveDeterministicId",
    ]) {
      expect(typeof surface[name]).toBe("function");
    }
    for (const name of ["MISSED_WINDOW_POLICIES", "COMPLETION_QUALITY_STATES"]) {
      expect(Array.isArray(surface[name])).toBe(true);
    }
  });
});
