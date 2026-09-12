import { describe, expect, it } from "vitest";
import {
  formatCapturedLabel,
  formatDayLabel,
  formatNumberValue,
  formatTimeLabel,
  formatValueLabel,
  parseDatetimeLocal,
  toDatetimeLocalValue,
} from "./format";
import { findCaptureShape } from "./catalog";

/**
 * Formatting contract tests (M4-B): byte-stable labels from pinned dates
 * (no wall-clock, no Intl).
 */

describe("formatDayLabel", () => {
  const now = new Date(2026, 8, 10, 12, 0); // Sep 10, 2026 local

  it("labels the same calendar day Today", () => {
    expect(formatDayLabel(new Date(2026, 8, 10, 0, 1), now)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 8, 10, 23, 59), now)).toBe("Today");
  });

  it("labels the previous calendar day Yesterday (incl. month boundary)", () => {
    expect(formatDayLabel(new Date(2026, 8, 9, 20, 30), now)).toBe("Yesterday");
    const august = new Date(2026, 7, 31, 9, 0);
    expect(formatDayLabel(august, new Date(2026, 8, 1, 10, 0))).toBe("Yesterday");
  });

  it("labels older dates with the month-day form", () => {
    expect(formatDayLabel(new Date(2026, 8, 8, 18, 40), now)).toBe("Sep 8");
    expect(formatDayLabel(new Date(2026, 0, 2, 8, 0), now)).toBe("Jan 2");
  });

  it("labels future dates with the month-day form", () => {
    expect(formatDayLabel(new Date(2026, 8, 11, 8, 0), now)).toBe("Sep 11");
  });
});

describe("formatTimeLabel / formatCapturedLabel", () => {
  it("zero-pads hours and minutes (24h local)", () => {
    expect(formatTimeLabel(new Date(2026, 8, 10, 8, 5))).toBe("08:05");
    expect(formatTimeLabel(new Date(2026, 8, 10, 20, 30))).toBe("20:30");
  });

  it("combines day and time", () => {
    const now = new Date(2026, 8, 10, 12, 0);
    expect(formatCapturedLabel(new Date(2026, 8, 10, 8, 5), now)).toBe("Today, 08:05");
    expect(formatCapturedLabel(new Date(2026, 8, 9, 20, 30), now)).toBe("Yesterday, 20:30");
  });
});

describe("datetime-local round trip", () => {
  it("formats local datetimes at minute precision", () => {
    expect(toDatetimeLocalValue(new Date(2026, 8, 10, 8, 5))).toBe("2026-09-10T08:05");
  });

  it("parses its own output (local-time semantics)", () => {
    const text = toDatetimeLocalValue(new Date(2026, 8, 10, 8, 5));
    const parsed = parseDatetimeLocal(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(10);
    expect(parsed?.getHours()).toBe(8);
    expect(parsed?.getMinutes()).toBe(5);
  });

  it("accepts the space separator (mobile input form)", () => {
    const parsed = parseDatetimeLocal("2026-09-10 08:05");
    expect(parsed?.getHours()).toBe(8);
    expect(parsed?.getMinutes()).toBe(5);
  });

  it("rejects malformed text", () => {
    expect(parseDatetimeLocal("")).toBeNull();
    expect(parseDatetimeLocal("not a date")).toBeNull();
    expect(parseDatetimeLocal("2026-9-10T8:05")).toBeNull();
    expect(parseDatetimeLocal("2026-09-10T08")).toBeNull();
  });
});

describe("formatValueLabel", () => {
  it("joins two same-unit fields with a slash (blood pressure)", () => {
    const bp = findCaptureShape("SYNTH-shape-bp-panel");
    expect(bp).toBeDefined();
    expect(formatValueLabel(bp!, { systolic: 118, diastolic: 76 })).toBe("118/76 mmHg");
  });

  it("labels single-field shapes with value + unit", () => {
    const weight = findCaptureShape("SYNTH-shape-body-weight");
    expect(formatValueLabel(weight!, { bodyWeight: 70.5 })).toBe("70.5 kg");
    const hr = findCaptureShape("SYNTH-shape-heart-rate");
    expect(formatValueLabel(hr!, { heartRate: 64 })).toBe("64 beats/min");
  });

  it("trims float dust from step-snapped values", () => {
    expect(formatNumberValue(70.500000000001)).toBe("70.5");
    expect(formatNumberValue(118)).toBe("118");
  });
});
