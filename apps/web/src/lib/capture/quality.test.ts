import { describe, expect, it } from "vitest";
import {
  CAPTURE_PARTIAL_FLOOR_FRACTION,
  CAPTURE_QUALITY_LABELS,
  CAPTURE_QUALITY_TONES,
  classifyQualityScore,
  qualityScoreFromState,
} from "./quality";
import { CAPTURE_QUALITY_STATES, isCaptureQualityState } from "./types";

/**
 * Quality mapping contract tests (M4-B): the self-assessment -> score ->
 * classification round-trip, label/tone coverage, and degenerate-range
 * rejection.
 */

const TYPICAL = { min: 0.7, max: 0.9 } as const;

describe("quality state vocabulary", () => {
  it("mirrors the domain completion-quality states exactly", () => {
    expect(CAPTURE_QUALITY_STATES).toEqual(["complete", "partial", "low-quality"]);
    expect(isCaptureQualityState("partial")).toBe(true);
    expect(isCaptureQualityState("low-quality")).toBe(true);
    expect(isCaptureQualityState("complete")).toBe(true);
    expect(isCaptureQualityState("completed")).toBe(false);
    expect(isCaptureQualityState(1)).toBe(false);
  });

  it("labels and tones cover every state (text is the status carrier)", () => {
    for (const state of CAPTURE_QUALITY_STATES) {
      expect(CAPTURE_QUALITY_LABELS[state].length).toBeGreaterThan(0);
      expect(["neutral", "accent", "success", "warning", "danger"]).toContain(
        CAPTURE_QUALITY_TONES[state],
      );
    }
  });
});

describe("qualityScoreFromState", () => {
  it("maps complete to the typical maximum", () => {
    expect(qualityScoreFromState("complete", TYPICAL)).toBe(0.9);
  });

  it("maps partial into the below-typical band (0.75 * min)", () => {
    const score = qualityScoreFromState("partial", TYPICAL);
    expect(score).toBe(0.525);
    expect(score).toBeLessThan(TYPICAL.min);
    expect(score).toBeGreaterThanOrEqual(CAPTURE_PARTIAL_FLOOR_FRACTION * TYPICAL.min);
  });

  it("maps low-quality below the partial floor (0.25 * min)", () => {
    const score = qualityScoreFromState("low-quality", TYPICAL);
    expect(score).toBe(0.175);
    expect(score).toBeLessThan(CAPTURE_PARTIAL_FLOOR_FRACTION * TYPICAL.min);
  });

  it("rejects degenerate typical ranges (catalog invariant guard)", () => {
    expect(() => qualityScoreFromState("partial", { min: 0, max: 0.9 })).toThrow(RangeError);
    expect(() => qualityScoreFromState("partial", { min: 0.7, max: 1.5 })).toThrow(RangeError);
    expect(() => qualityScoreFromState("partial", { min: 0.9, max: 0.7 })).toThrow(RangeError);
  });
});

describe("classifyQualityScore", () => {
  it("classifies by the A31-default policy bands", () => {
    expect(classifyQualityScore(0.9, TYPICAL)).toBe("complete");
    expect(classifyQualityScore(0.7, TYPICAL)).toBe("complete");
    expect(classifyQualityScore(0.525, TYPICAL)).toBe("partial");
    expect(classifyQualityScore(0.35, TYPICAL)).toBe("partial");
    expect(classifyQualityScore(0.349, TYPICAL)).toBe("low-quality");
    expect(classifyQualityScore(0, TYPICAL)).toBe("low-quality");
  });
});
