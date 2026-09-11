import { guardNumericValue, type NumericGuardLimits } from "@orbb/ui";
import { SYNTHETIC_METRIC, SYNTHETIC_METHOD_OPTIONS } from "./synthetic-data";

/**
 * Validation for the "Record a measurement" flow (M3-B).
 *
 * Two layers share this module:
 * 1. the client form — string input, parsed with the library's guard
 *    semantics (clamp + snap, never invent a value);
 * 2. the `/api/measurements` route stub — strict validation of untrusted
 *    JSON (route-side data is never guarded/clamped, only accepted or
 *    rejected with a machine-readable reason).
 *
 * Pure functions only: no hooks, no DOM, no fetch — directly unit-testable
 * from both the form tests and the route contract.
 */

/** Rules shared by the client form and the API route stub. */
export interface MeasurementSubmissionRules {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly knownMethodIds: readonly string[];
}

export const MEASUREMENT_SUBMISSION_RULES: MeasurementSubmissionRules = {
  min: SYNTHETIC_METRIC.min,
  max: SYNTHETIC_METRIC.max,
  step: SYNTHETIC_METRIC.step,
  unit: SYNTHETIC_METRIC.unit,
  knownMethodIds: SYNTHETIC_METHOD_OPTIONS.map((option) => option.id),
};

/** A validated measurement submission (value already guarded). */
export interface MeasurementSubmission {
  readonly value: number;
  readonly methodId: string;
}

export type MeasurementParseFailure = "value-missing" | "value-not-numeric";

export type MeasurementParseResult =
  | { readonly ok: true; readonly value: number; readonly guardedText: string }
  | { readonly ok: false; readonly reason: MeasurementParseFailure };

/**
 * Parses free-text measurement input with the library's guard semantics:
 * empty input and non-numeric input are reported as failures (the guard
 * never invents a value); finite values are clamped to `[min, max]` and
 * snapped to the nearest `step` multiple.
 */
export function parseMeasurementValue(
  raw: string,
  rules: MeasurementSubmissionRules,
): MeasurementParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, reason: "value-missing" };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, reason: "value-not-numeric" };
  }
  const limits: NumericGuardLimits = {
    min: rules.min,
    max: rules.max,
    step: rules.step,
  };
  const guardedText = guardNumericValue(trimmed, limits);
  return { ok: true, value: Number(guardedText), guardedText };
}

/** Machine-readable rejection reasons returned by the route stub. */
export type MeasurementRouteFailureReason =
  | "body-not-object"
  | "value-missing"
  | "value-not-numeric"
  | "value-out-of-range"
  | "value-not-step-multiple"
  | "method-missing"
  | "method-unknown";

export interface MeasurementRouteFailure {
  readonly reason: MeasurementRouteFailureReason;
  readonly message: string;
}

export type MeasurementRouteValidation =
  | { readonly ok: true; readonly submission: MeasurementSubmission }
  | { readonly ok: false; readonly failure: MeasurementRouteFailure };

/**
 * Strictly validates an untrusted JSON body for the measurement route
 * stub. Unlike the client-side parser, out-of-range values are rejected
 * (never silently clamped) — server-side validation must not mutate data.
 */
export function validateMeasurementSubmission(
  body: unknown,
  rules: MeasurementSubmissionRules,
): MeasurementRouteValidation {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      failure: {
        reason: "body-not-object",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;

  if (record.value === undefined) {
    return {
      ok: false,
      failure: { reason: "value-missing", message: "A numeric 'value' field is required." },
    };
  }
  if (typeof record.value !== "number" || !Number.isFinite(record.value)) {
    return {
      ok: false,
      failure: { reason: "value-not-numeric", message: "'value' must be a finite number." },
    };
  }
  const value = record.value;
  if (value < rules.min || value > rules.max) {
    return {
      ok: false,
      failure: {
        reason: "value-out-of-range",
        message: `'value' must be between ${rules.min} and ${rules.max}.`,
      },
    };
  }
  if (rules.step > 0 && !Number.isInteger(value / rules.step)) {
    return {
      ok: false,
      failure: {
        reason: "value-not-step-multiple",
        message: `'value' must be a multiple of ${rules.step}.`,
      },
    };
  }

  if (record.methodId === undefined) {
    return {
      ok: false,
      failure: { reason: "method-missing", message: "A 'methodId' field is required." },
    };
  }
  if (typeof record.methodId !== "string" || !rules.knownMethodIds.includes(record.methodId)) {
    return {
      ok: false,
      failure: {
        reason: "method-unknown",
        message: "'methodId' must be one of the known capture methods.",
      },
    };
  }

  return { ok: true, submission: { value, methodId: record.methodId } };
}
