import { describe, expect, it } from "vitest";
import { findCaptureShape } from "./catalog";
import { parseCaptureFieldText, validateCaptureSubmission } from "./validation";
import type { CaptureIssue } from "./types";

/**
 * Validation contract tests (M4-B): client guard semantics and the strict
 * route-side validation with typed, PHI-safe issues.
 */

const NOW = new Date("2026-09-10T12:00:00.000Z");
const NOW_ISO = "2026-09-10T12:00:00.000Z";

function bpField() {
  const shape = findCaptureShape("SYNTH-shape-bp-panel");
  const field = shape?.fields.find((candidate) => candidate.id === "systolic");
  if (field === undefined) {
    throw new Error("test fixture: systolic field missing");
  }
  return field;
}

describe("parseCaptureFieldText (client guard semantics)", () => {
  const field = bpField();

  it("rejects empty input (the guard never invents a value)", () => {
    expect(parseCaptureFieldText("", field)).toEqual({ ok: false, reason: "value-missing" });
    expect(parseCaptureFieldText("   ", field)).toEqual({ ok: false, reason: "value-missing" });
  });

  it("rejects non-numeric input", () => {
    expect(parseCaptureFieldText("high", field)).toEqual({
      ok: false,
      reason: "value-not-numeric",
    });
  });

  it("clamps and snaps finite values to the field bounds", () => {
    expect(parseCaptureFieldText("250", field)).toEqual({
      ok: true,
      value: 250,
      guardedText: "250",
    });
    expect(parseCaptureFieldText("350", field)).toEqual({
      ok: true,
      value: 300,
      guardedText: "300",
    });
    expect(parseCaptureFieldText("10", field)).toEqual({
      ok: true,
      value: 60,
      guardedText: "60",
    });
  });

  it("snaps to the step for fractional fields", () => {
    const shape = findCaptureShape("SYNTH-shape-body-weight");
    const weight = shape?.fields[0];
    expect(weight).toBeDefined();
    expect(parseCaptureFieldText("70.56", weight!)).toEqual({
      ok: true,
      value: 70.6,
      guardedText: "70.6",
    });
  });
});

function issuesOf(result: ReturnType<typeof validateCaptureSubmission>): readonly CaptureIssue[] {
  return result.ok ? [] : result.issues;
}

describe("validateCaptureSubmission (strict route-side)", () => {
  const bpBody = {
    shapeId: "SYNTH-shape-bp-panel",
    methodOptionId: "SYNTH-method-manual-bp-panel",
    fieldValues: { systolic: 118, diastolic: 76 },
    qualityState: "complete",
    capturedAt: NOW_ISO,
  };

  it("accepts a well-formed submission and normalizes notes", () => {
    const result = validateCaptureSubmission(
      { ...bpBody, notes: "  morning reading  " },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submission.shapeId).toBe("SYNTH-shape-bp-panel");
      expect(result.submission.fieldValues).toEqual({ systolic: 118, diastolic: 76 });
      expect(result.submission.qualityState).toBe("complete");
      expect(result.submission.notes).toBe("morning reading");
    }
  });

  it("drops empty notes entirely (exactOptionalPropertyTypes discipline)", () => {
    const result = validateCaptureSubmission({ ...bpBody, notes: "   " }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("notes" in result.submission).toBe(false);
    }
  });

  it("rejects a non-object body with a single body issue", () => {
    const result = validateCaptureSubmission("nope", NOW);
    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toEqual([
      { field: "body", problem: "Request body must be a JSON object." },
    ]);
  });

  it("rejects an unknown shape id", () => {
    const result = validateCaptureSubmission({ ...bpBody, shapeId: "SYNTH-shape-x" }, NOW);
    expect(result.ok).toBe(false);
    expect(issuesOf(result).some((issue) => issue.field === "shapeId")).toBe(true);
  });

  it("rejects a method option that is not the shape's manual method", () => {
    const result = validateCaptureSubmission(
      { ...bpBody, methodOptionId: "SYNTH-method-cuff-bp-panel" },
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(
      issuesOf(result).some((issue) => issue.field === "methodOptionId"),
    ).toBe(true);
  });

  it("rejects out-of-range and non-step-multiple values without echoing them", () => {
    const outOfRange = validateCaptureSubmission(
      { ...bpBody, fieldValues: { systolic: 500, diastolic: 76 } },
      NOW,
    );
    expect(outOfRange.ok).toBe(false);
    const rangeIssue = issuesOf(outOfRange).find((issue) => issue.field === "fieldValues.systolic");
    expect(rangeIssue?.problem).toContain("between 60 and 300");
    expect(rangeIssue?.problem).not.toContain("500");

    const notStep = validateCaptureSubmission(
      { ...bpBody, fieldValues: { systolic: 118.5, diastolic: 76 } },
      NOW,
    );
    expect(notStep.ok).toBe(false);
    expect(
      issuesOf(notStep).some((issue) => issue.field === "fieldValues.systolic"),
    ).toBe(true);
  });

  it("rejects missing field values and unknown field keys", () => {
    const missing = validateCaptureSubmission(
      { ...bpBody, fieldValues: { systolic: 118 } },
      NOW,
    );
    expect(missing.ok).toBe(false);
    expect(
      issuesOf(missing).some((issue) => issue.field === "fieldValues.diastolic"),
    ).toBe(true);

    const unknown = validateCaptureSubmission(
      { ...bpBody, fieldValues: { systolic: 118, diastolic: 76, pulse: 60 } },
      NOW,
    );
    expect(unknown.ok).toBe(false);
    expect(issuesOf(unknown).some((issue) => issue.field === "fieldValues")).toBe(true);
  });

  it("rejects a quality state outside the vocabulary", () => {
    const result = validateCaptureSubmission({ ...bpBody, qualityState: "perfect" }, NOW);
    expect(result.ok).toBe(false);
    expect(
      issuesOf(result).some((issue) => issue.field === "qualityState"),
    ).toBe(true);
  });

  it("rejects malformed, future, and implausibly old captured timestamps", () => {
    const malformed = validateCaptureSubmission(
      { ...bpBody, capturedAt: "yesterday-ish" },
      NOW,
    );
    expect(malformed.ok).toBe(false);
    expect(issuesOf(malformed).some((issue) => issue.field === "capturedAt")).toBe(true);

    const future = validateCaptureSubmission(
      { ...bpBody, capturedAt: "2026-09-11T12:00:00.000Z" },
      NOW,
    );
    expect(future.ok).toBe(false);

    const ancient = validateCaptureSubmission(
      { ...bpBody, capturedAt: "1999-01-01T00:00:00.000Z" },
      NOW,
    );
    expect(ancient.ok).toBe(false);
  });

  it("accepts captured times within the future tolerance", () => {
    const result = validateCaptureSubmission(
      { ...bpBody, capturedAt: "2026-09-10T12:04:00.000Z" },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects over-long or non-string notes", () => {
    const long = validateCaptureSubmission(
      { ...bpBody, notes: "n".repeat(501) },
      NOW,
    );
    expect(long.ok).toBe(false);
    expect(issuesOf(long).some((issue) => issue.field === "notes")).toBe(true);

    const wrongType = validateCaptureSubmission({ ...bpBody, notes: 42 }, NOW);
    expect(wrongType.ok).toBe(false);
    expect(issuesOf(wrongType).some((issue) => issue.field === "notes")).toBe(true);
  });

  it("accumulates multiple independent issues", () => {
    const result = validateCaptureSubmission(
      { ...bpBody, qualityState: "nope", notes: 7 },
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(issuesOf(result).length).toBeGreaterThanOrEqual(2);
  });
});
