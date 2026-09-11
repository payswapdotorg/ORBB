import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_SUBMISSION_RULES,
  parseMeasurementValue,
  validateMeasurementSubmission,
} from "./measurement-submission";

describe("parseMeasurementValue (client-side guard semantics)", () => {
  it("rejects empty input without inventing a value", () => {
    expect(parseMeasurementValue("", MEASUREMENT_SUBMISSION_RULES)).toEqual({
      ok: false,
      reason: "value-missing",
    });
    expect(parseMeasurementValue("   ", MEASUREMENT_SUBMISSION_RULES)).toEqual({
      ok: false,
      reason: "value-missing",
    });
  });

  it("rejects non-numeric input", () => {
    expect(parseMeasurementValue("seventy", MEASUREMENT_SUBMISSION_RULES)).toEqual({
      ok: false,
      reason: "value-not-numeric",
    });
  });

  it("accepts an in-range value unchanged", () => {
    expect(parseMeasurementValue("72", MEASUREMENT_SUBMISSION_RULES)).toEqual({
      ok: true,
      value: 72,
      guardedText: "72",
    });
  });

  it("clamps out-of-range values to the metric bounds (library guard)", () => {
    expect(parseMeasurementValue("250", MEASUREMENT_SUBMISSION_RULES)).toEqual({
      ok: true,
      value: 220,
      guardedText: "220",
    });
    expect(parseMeasurementValue("10", MEASUREMENT_SUBMISSION_RULES)).toEqual({
      ok: true,
      value: 30,
      guardedText: "30",
    });
  });

  it("snaps fractional values to the step multiple", () => {
    expect(parseMeasurementValue("72.5", MEASUREMENT_SUBMISSION_RULES)).toEqual({
      ok: true,
      value: 73,
      guardedText: "73",
    });
  });
});

describe("validateMeasurementSubmission (route stub contract)", () => {
  it("accepts a valid submission", () => {
    expect(
      validateMeasurementSubmission(
        { value: 72, methodId: "SYNTH-method-pulse" },
        MEASUREMENT_SUBMISSION_RULES,
      ),
    ).toEqual({ ok: true, submission: { value: 72, methodId: "SYNTH-method-pulse" } });
  });

  it("rejects non-object bodies", () => {
    const result = validateMeasurementSubmission("nope", MEASUREMENT_SUBMISSION_RULES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("body-not-object");
    }
  });

  it("rejects missing and non-numeric values", () => {
    const missing = validateMeasurementSubmission({}, MEASUREMENT_SUBMISSION_RULES);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.failure.reason).toBe("value-missing");
    }
    const notNumber = validateMeasurementSubmission(
      { value: "72" },
      MEASUREMENT_SUBMISSION_RULES,
    );
    expect(notNumber.ok).toBe(false);
    if (!notNumber.ok) {
      expect(notNumber.failure.reason).toBe("value-not-numeric");
    }
  });

  it("rejects out-of-range values instead of clamping (server never mutates)", () => {
    const high = validateMeasurementSubmission(
      { value: 250, methodId: "SYNTH-method-pulse" },
      MEASUREMENT_SUBMISSION_RULES,
    );
    expect(high.ok).toBe(false);
    if (!high.ok) {
      expect(high.failure.reason).toBe("value-out-of-range");
      expect(high.failure.message).toContain("between 30 and 220");
    }
  });

  it("rejects values that are not step multiples", () => {
    const result = validateMeasurementSubmission(
      { value: 72.5, methodId: "SYNTH-method-pulse" },
      MEASUREMENT_SUBMISSION_RULES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("value-not-step-multiple");
    }
  });

  it("rejects missing and unknown methods", () => {
    const missing = validateMeasurementSubmission(
      { value: 72 },
      MEASUREMENT_SUBMISSION_RULES,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.failure.reason).toBe("method-missing");
    }
    const unknown = validateMeasurementSubmission(
      { value: 72, methodId: "not-a-method" },
      MEASUREMENT_SUBMISSION_RULES,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.failure.reason).toBe("method-unknown");
    }
  });
});
