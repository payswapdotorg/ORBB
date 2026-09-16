import { describe, expect, it } from "vitest";
import {
  EMPTY_DATABOX_FILTERS,
  conceptOptions,
  deriveCollections,
  filterObservations,
  isEmptyDataboxFilters,
  matchesSearch,
  matchesTimeFilter,
  sourceOptions,
  type DataboxFilters,
} from "./search";
import type { ObservationDetailView } from "../observations/types";

/**
 * DataBox search/filter tests (M6-B B6): search + the four §DataBox UX
 * filters (time, concept, source, confidence/quality) over the pinned
 * synthetic reference date; collections derive from concept groupings.
 */

const REFERENCE_NOW = "2026-09-10T08:20:00.000Z";

function observation(overrides: Partial<ObservationDetailView> = {}): ObservationDetailView {
  return {
    id: "obs_SYNTH-obs-x-0001",
    metricId: "SYNTH-metric-bp-systolic",
    metricLabel: "Blood Pressure Systolic",
    conceptCode: "SYNTH-8480-5",
    value: 118,
    unit: "mmHg",
    valueLabel: "118 mmHg",
    evidenceLabel: "MEASURED",
    validationState: "pending",
    capturedBy: "You (SYNTH-Person-1, self-tracking)",
    sourceKind: "manual",
    method: { id: "SYNTH-method-bpsys-manual", label: "Manual entry — home BP cuff reading" },
    deviceOrPerson: "Person: You (SYNTH-Person-1)",
    time: { capturedAtLabel: "Today, 07:42", recordedAtLabel: "Today, 07:43" },
    quality: { state: "complete", score: 0.9 },
    transformations: [],
    capturedAtIso: "2026-09-10T07:42:00.000Z",
    ...overrides,
  };
}

describe("matchesTimeFilter (reference-date-relative, never wall-clock)", () => {
  const today = observation();
  const yesterday = observation({
    id: "obs_SYNTH-obs-x-0002",
    capturedAtIso: "2026-09-09T20:31:00.000Z",
  });
  const older = observation({
    id: "obs_SYNTH-obs-x-0003",
    capturedAtIso: "2026-08-30T20:31:00.000Z",
  });

  it("all passes everything", () => {
    for (const candidate of [today, yesterday, older]) {
      expect(matchesTimeFilter(candidate, "all", REFERENCE_NOW)).toBe(true);
    }
  });

  it("today passes only the reference day", () => {
    expect(matchesTimeFilter(today, "today", REFERENCE_NOW)).toBe(true);
    expect(matchesTimeFilter(yesterday, "today", REFERENCE_NOW)).toBe(false);
    expect(matchesTimeFilter(older, "today", REFERENCE_NOW)).toBe(false);
  });

  it("last-7-days covers [reference - 7d, reference] inclusive", () => {
    expect(matchesTimeFilter(today, "last-7-days", REFERENCE_NOW)).toBe(true);
    expect(matchesTimeFilter(yesterday, "last-7-days", REFERENCE_NOW)).toBe(true);
    expect(matchesTimeFilter(older, "last-7-days", REFERENCE_NOW)).toBe(false);
    const edge = observation({
      id: "obs_SYNTH-obs-x-0004",
      capturedAtIso: "2026-09-03T08:20:00.000Z", // exactly 7 days before
    });
    expect(matchesTimeFilter(edge, "last-7-days", REFERENCE_NOW)).toBe(true);
  });
});

describe("matchesSearch", () => {
  it("matches case-insensitively across metric, method, value, and evidence ids", () => {
    const withEvidence = observation({
      evidence: { id: "SYNTH-EV-0002", summary: "Manual blood pressure log page", mediaTypeLabel: "document" },
    });
    expect(matchesSearch(withEvidence, "blood pressure")).toBe(true);
    expect(matchesSearch(withEvidence, "SYNTH-EV-0002")).toBe(true);
    expect(matchesSearch(withEvidence, "118 mmhg")).toBe(true);
    expect(matchesSearch(withEvidence, "wearable")).toBe(false);
  });

  it("matches the model version of estimated observations", () => {
    const estimated = observation({
      modelVersion: "SYNTH-thermo-estimator v0.3",
    });
    expect(matchesSearch(estimated, "v0.3")).toBe(true);
  });

  it("empty search passes everything", () => {
    expect(matchesSearch(observation(), "")).toBe(true);
    expect(matchesSearch(observation(), "   ")).toBe(true);
  });
});

describe("filterObservations (search + the four filters)", () => {
  const manualBp = observation();
  const deviceHr = observation({
    id: "obs_SYNTH-obs-x-0002",
    metricId: "SYNTH-metric-heart-rate",
    metricLabel: "Heart Rate",
    valueLabel: "62 beats/min",
    sourceKind: "device-adapter",
    method: { id: "SYNTH-method-hr-wearable", label: "Wearable sync" },
    evidenceLabel: "IMPORTED",
    quality: { state: "complete", score: 0.92 },
    capturedAtIso: "2026-09-10T08:06:00.000Z",
  });
  const estimatedTemp = observation({
    id: "obs_SYNTH-obs-x-0003",
    metricId: "SYNTH-metric-body-temp",
    metricLabel: "Body Temperature",
    valueLabel: "36.8 °C",
    evidenceLabel: "ESTIMATED",
    quality: { state: "partial", score: 0.6 },
    capturedAtIso: "2026-09-09T20:31:00.000Z",
  });
  const all = [manualBp, deviceHr, estimatedTemp];

  it("passes everything with the empty filter state", () => {
    expect(filterObservations(all, EMPTY_DATABOX_FILTERS, REFERENCE_NOW)).toHaveLength(3);
    expect(isEmptyDataboxFilters(EMPTY_DATABOX_FILTERS)).toBe(true);
  });

  it("filters by concept (metric)", () => {
    const filters: DataboxFilters = { ...EMPTY_DATABOX_FILTERS, concept: "SYNTH-metric-heart-rate" };
    const result = filterObservations(all, filters, REFERENCE_NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.metricLabel).toBe("Heart Rate");
  });

  it("filters by source kind", () => {
    const filters: DataboxFilters = { ...EMPTY_DATABOX_FILTERS, source: "device-adapter" };
    const result = filterObservations(all, filters, REFERENCE_NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.sourceKind).toBe("device-adapter");
  });

  it("filters by confidence/quality state", () => {
    const partial: DataboxFilters = { ...EMPTY_DATABOX_FILTERS, quality: "partial" };
    expect(filterObservations(all, partial, REFERENCE_NOW)).toHaveLength(1);
    const complete: DataboxFilters = { ...EMPTY_DATABOX_FILTERS, quality: "complete" };
    expect(filterObservations(all, complete, REFERENCE_NOW)).toHaveLength(2);
  });

  it("combines filters AND search (intersection semantics)", () => {
    const filters: DataboxFilters = {
      ...EMPTY_DATABOX_FILTERS,
      time: "today",
      quality: "complete",
      search: "wearable",
    };
    const result = filterObservations(all, filters, REFERENCE_NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("obs_SYNTH-obs-x-0002");
  });
});

describe("deriveCollections", () => {
  it("groups by concept with stable first-appearance order and counts", () => {
    const a = observation();
    const b = observation({ id: "obs_SYNTH-obs-x-0002" });
    const c = observation({
      id: "obs_SYNTH-obs-x-0003",
      metricId: "SYNTH-metric-heart-rate",
      metricLabel: "Heart Rate",
    });
    const collections = deriveCollections([a, c, b]);
    expect(collections).toHaveLength(2);
    expect(collections[0]?.metricId).toBe("SYNTH-metric-bp-systolic");
    expect(collections[0]?.count).toBe(2);
    expect(collections[1]?.metricId).toBe("SYNTH-metric-heart-rate");
    expect(collections[1]?.count).toBe(1);
  });

  it("empty input yields no collections", () => {
    expect(deriveCollections([])).toEqual([]);
  });
});

describe("option derivations", () => {
  it("conceptOptions lists the distinct metric options", () => {
    const options = conceptOptions([
      observation(),
      observation({ id: "obs_SYNTH-obs-x-0002", metricId: "SYNTH-metric-heart-rate", metricLabel: "Heart Rate" }),
    ]);
    expect(options).toEqual([
      { id: "SYNTH-metric-bp-systolic", label: "Blood Pressure Systolic" },
      { id: "SYNTH-metric-heart-rate", label: "Heart Rate" },
    ]);
  });

  it("sourceOptions lists the distinct source kinds present", () => {
    const options = sourceOptions([
      observation(),
      observation({
        id: "obs_SYNTH-obs-x-0002",
        sourceKind: "device-adapter",
      }),
      observation({
        id: "obs_SYNTH-obs-x-0003",
        sourceKind: "device-adapter",
      }),
    ]);
    expect(options).toHaveLength(2);
    expect(options[0]?.label).toBe("Manual entry");
    expect(options[1]?.label).toBe("Device adapter import");
  });
});
