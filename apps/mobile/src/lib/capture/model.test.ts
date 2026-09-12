import { describe, expect, it } from "vitest";
import {
  CAPTURE_SHAPES,
  CAPTURE_QUALITY_LABELS,
  CAPTURE_QUALITY_STATES,
  SYNTHETIC_PERSON_ID,
  buildRecordSummary,
  classifyQualityScore,
  createMobileCaptureRecord,
  findCaptureShape,
  formatCapturedLabel,
  formatDayLabel,
  formatValueLabel,
  initialCaptureIdCounters,
  parseCaptureFieldText,
  parseTimestampText,
  qualityScoreFromState,
  toTimestampInputValue,
} from "./model";

/**
 * Mobile capture model contract tests (M4-B): the web capture session
 * model mirrored for RN — same SYNTH catalog, same quality vocabulary,
 * same domain-shaped records, byte-stable labels.
 */

const NOW = new Date(2026, 8, 10, 12, 0);

describe("mobile capture catalog", () => {
  it("mirrors the web/engine catalog shapes with SYNTH ids", () => {
    expect(CAPTURE_SHAPES.length).toBe(5);
    const ids = CAPTURE_SHAPES.map((shape) => shape.id);
    expect(ids).toContain("SYNTH-shape-bp-panel");
    expect(ids).toContain("SYNTH-shape-heart-rate");
    for (const shape of CAPTURE_SHAPES) {
      for (const field of shape.fields) {
        expect(field.method.metricId).toBe(field.metric.id);
        expect(field.metric.id.startsWith("SYNTH-")).toBe(true);
        expect(field.method.id.startsWith("SYNTH-")).toBe(true);
        const { min, max } = field.method.typicalQuality;
        expect(min).toBeGreaterThan(0);
        expect(min).toBeLessThanOrEqual(max);
      }
    }
  });

  it("quality round-trips for every manual method (no silent upgrades)", () => {
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
});

describe("parseCaptureFieldText", () => {
  const systolic = findCaptureShape("SYNTH-shape-bp-panel")?.fields[0];

  it("rejects empty and non-numeric input", () => {
    expect(systolic).toBeDefined();
    expect(parseCaptureFieldText("", systolic!)).toEqual({ ok: false, reason: "value-missing" });
    expect(parseCaptureFieldText("high", systolic!)).toEqual({
      ok: false,
      reason: "value-not-numeric",
    });
  });

  it("clamps and snaps (guard semantics without the web ValueInput)", () => {
    expect(parseCaptureFieldText("118", systolic!)).toEqual({
      ok: true,
      value: 118,
      guardedText: "118",
    });
    expect(parseCaptureFieldText("350", systolic!)).toEqual({
      ok: true,
      value: 300,
      guardedText: "300",
    });
    expect(parseCaptureFieldText("10", systolic!)).toEqual({
      ok: true,
      value: 60,
      guardedText: "60",
    });
  });

  it("accepts the decimal comma (mobile decimal pad locales)", () => {
    const weight = findCaptureShape("SYNTH-shape-body-weight")?.fields[0];
    expect(weight).toBeDefined();
    expect(parseCaptureFieldText("70,6", weight!)).toEqual({
      ok: true,
      value: 70.6,
      guardedText: "70.6",
    });
  });
});

describe("timestamp round trip", () => {
  it("formats and parses the mobile input form", () => {
    const text = toTimestampInputValue(new Date(2026, 8, 10, 8, 5));
    expect(text).toBe("2026-09-10 08:05");
    const parsed = parseTimestampText(text);
    expect(parsed?.getHours()).toBe(8);
    expect(parsed?.getMinutes()).toBe(5);
  });

  it("rejects malformed timestamps", () => {
    expect(parseTimestampText("today")).toBeNull();
    expect(parseTimestampText("")).toBeNull();
  });
});

describe("createMobileCaptureRecord", () => {
  it("records one observation per field with the method actually used and the person as actor", () => {
    const result = createMobileCaptureRecord(
      {
        shapeId: "SYNTH-shape-bp-panel",
        methodOptionId: "SYNTH-method-manual-bp-panel",
        fieldValues: { systolic: 118, diastolic: 76 },
        qualityState: "partial",
        capturedAtIso: "2026-09-10T08:30:00.000Z",
        notes: "morning reading",
      },
      new Date("2026-09-10T09:00:00.000Z"),
      initialCaptureIdCounters(),
    );
    const { record, counters } = result;
    expect(record.recordId).toBe("SYNTH-MCAP-000001");
    expect(record.qualityState).toBe("partial");
    expect(record.observations).toHaveLength(2);
    const [systolic, diastolic] = record.observations;
    expect(systolic?.id).toBe("obs_SYNTH-obs-000001");
    expect(systolic?.methodId).toBe("SYNTH-method-bpsys-manual");
    expect(systolic?.provenance.actor).toBe(SYNTHETIC_PERSON_ID);
    expect(systolic?.provenance.correlationId).toBe(record.recordId);
    expect(systolic?.effectiveAt).toBe("2026-09-10T08:30:00.000Z");
    expect(systolic?.observedAt).toBe("2026-09-10T09:00:00.000Z");
    expect(diastolic?.methodId).toBe("SYNTH-method-bpdia-manual");
    expect(counters.record).toBe(1);
    expect(counters.observation).toBe(2);
    expect(counters.provenance).toBe(2);
  });

  it("derives per-observation quality scores from the self-assessed state", () => {
    const { record } = createMobileCaptureRecord(
      {
        shapeId: "SYNTH-shape-heart-rate",
        methodOptionId: "SYNTH-method-manual-heart-rate",
        fieldValues: { heartRate: 64 },
        qualityState: "low-quality",
        capturedAtIso: "2026-09-10T08:30:00.000Z",
      },
      new Date("2026-09-10T09:00:00.000Z"),
      initialCaptureIdCounters(),
    );
    expect(record.qualityState).toBe("low-quality");
    expect(record.observations[0]?.quality).toBe(0.15); // 0.25 * 0.6 (hr-manual min)
    expect("notes" in record).toBe(false);
  });

  it("advances counters deterministically across records", () => {
    const first = createMobileCaptureRecord(
      {
        shapeId: "SYNTH-shape-heart-rate",
        methodOptionId: "SYNTH-method-manual-heart-rate",
        fieldValues: { heartRate: 64 },
        qualityState: "complete",
        capturedAtIso: "2026-09-10T08:30:00.000Z",
      },
      NOW,
      initialCaptureIdCounters(),
    );
    const second = createMobileCaptureRecord(
      {
        shapeId: "SYNTH-shape-heart-rate",
        methodOptionId: "SYNTH-method-manual-heart-rate",
        fieldValues: { heartRate: 66 },
        qualityState: "complete",
        capturedAtIso: "2026-09-10T09:30:00.000Z",
      },
      NOW,
      first.counters,
    );
    expect(second.record.recordId).toBe("SYNTH-MCAP-000002");
    expect(second.record.observations[0]?.id).toBe("obs_SYNTH-obs-000002");
  });
});

describe("display summaries", () => {
  it("labels days, times and compound values byte-stably", () => {
    expect(formatDayLabel(new Date(2026, 8, 10, 8, 5), NOW)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 8, 9, 20, 30), NOW)).toBe("Yesterday");
    expect(formatDayLabel(new Date(2026, 8, 8, 18, 40), NOW)).toBe("Sep 8");
    expect(formatCapturedLabel(new Date(2026, 8, 10, 8, 5), NOW)).toBe("Today, 08:05");
    const bp = findCaptureShape("SYNTH-shape-bp-panel");
    expect(bp).toBeDefined();
    expect(formatValueLabel(bp!, { systolic: 118, diastolic: 76 })).toBe("118/76 mmHg");
  });

  it("builds the history row summary with quality, provenance and method", () => {
    const { record } = createMobileCaptureRecord(
      {
        shapeId: "SYNTH-shape-bp-panel",
        methodOptionId: "SYNTH-method-manual-bp-panel",
        fieldValues: { systolic: 118, diastolic: 76 },
        qualityState: "partial",
        capturedAtIso: new Date(2026, 8, 10, 8, 30).toISOString(),
      },
      NOW,
      initialCaptureIdCounters(),
    );
    const summary = buildRecordSummary(record, NOW);
    expect(summary.title).toBe("Blood pressure 118/76 mmHg");
    expect(summary.subtitle).toContain("Manual");
    expect(summary.subtitle).toContain(`Quality: ${CAPTURE_QUALITY_LABELS.partial}`);
    expect(summary.accessibilityLabel).toContain("recorded by you (self-tracking)");
    expect(summary.accessibilityLabel).toContain(
      "methods actually used: SYNTH-method-bpsys-manual, SYNTH-method-bpdia-manual",
    );
  });
});
