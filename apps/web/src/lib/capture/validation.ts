import { guardNumericValue, type NumericGuardLimits } from "@orbb/ui";
import { findCaptureShape } from "./catalog";
import type {
  CaptureFieldSpec,
  CaptureIssue,
  CaptureQualityState,
  CaptureShape,
  CaptureSubmission,
} from "./types";
import { isCaptureQualityState } from "./types";

/**
 * Validation for the manual-capture journey (M4-B) — two layers, same
 * module (the M3-B measurement-submission pattern):
 *
 * 1. the client form — string fields parsed with the library's guard
 *    semantics (clamp + snap on commit, never invent a value), the
 *    timestamp parsed from `datetime-local` text;
 * 2. the `/api/capture` route — STRICT validation of untrusted JSON:
 *    nothing is clamped or coerced server-side, every violation becomes a
 *    typed field-level issue (field PATH + problem; values are never
 *    echoed — PHI discipline of the error-envelope style).
 *
 * Pure functions only: no hooks, no DOM, no fetch.
 */

/** Maximum accepted notes length (after trim). */
export const CAPTURE_NOTES_MAX_LENGTH = 500;

/** Tolerance for a user-stated capture time slightly in the future. */
export const CAPTURE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Sanity floor for back-dated manual entries (logged history). */
export const CAPTURE_EARLIEST_MS = Date.parse("2000-01-01T00:00:00.000Z");

// ---------------------------------------------------------------------------
// Client-side parsing (guard semantics — clamping belongs to the client).
// ---------------------------------------------------------------------------

export type CaptureFieldParseFailure = "value-missing" | "value-not-numeric";

export type CaptureFieldParseResult =
  | { readonly ok: true; readonly value: number; readonly guardedText: string }
  | { readonly ok: false; readonly reason: CaptureFieldParseFailure };

/**
 * Parses one field's free-text input with the library's guard semantics:
 * empty and non-numeric input are failures (the guard never invents a
 * value); finite values are clamped to the field bounds and snapped to the
 * step, mirroring the ValueInput blur commit.
 */
export function parseCaptureFieldText(
  raw: string,
  field: CaptureFieldSpec,
): CaptureFieldParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, reason: "value-missing" };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, reason: "value-not-numeric" };
  }
  const limits: NumericGuardLimits = { min: field.min, max: field.max, step: field.step };
  const guardedText = guardNumericValue(trimmed, limits);
  return { ok: true, value: Number(guardedText), guardedText };
}

// ---------------------------------------------------------------------------
// Server-side strict validation (typed issues; nothing is coerced).
// ---------------------------------------------------------------------------

export type CaptureValidationResult =
  | { readonly ok: true; readonly submission: CaptureSubmission }
  | { readonly ok: false; readonly issues: readonly CaptureIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strictly validates an untrusted JSON body against the capture catalog.
 * Accumulates every field-level violation (early shape/method failures
 * short-circuit field validation because the shape defines the fields).
 */
export function validateCaptureSubmission(
  body: unknown,
  now: Date,
): CaptureValidationResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      issues: [{ field: "body", problem: "Request body must be a JSON object." }],
    };
  }

  const issues: CaptureIssue[] = [];

  // --- shapeId -----------------------------------------------------------
  if (typeof body.shapeId !== "string" || body.shapeId.length === 0) {
    issues.push({ field: "shapeId", problem: "A non-empty 'shapeId' string is required." });
  }
  const shape: CaptureShape | undefined =
    typeof body.shapeId === "string" ? findCaptureShape(body.shapeId) : undefined;
  if (shape === undefined && typeof body.shapeId === "string" && body.shapeId.length > 0) {
    issues.push({ field: "shapeId", problem: "'shapeId' is not a known capture shape." });
  }

  // --- methodOptionId ----------------------------------------------------
  if (typeof body.methodOptionId !== "string" || body.methodOptionId.length === 0) {
    issues.push({
      field: "methodOptionId",
      problem: "A non-empty 'methodOptionId' string is required.",
    });
  } else if (shape !== undefined && body.methodOptionId !== shape.manualMethodOption.id) {
    issues.push({
      field: "methodOptionId",
      problem:
        "'methodOptionId' must be the shape's manual-entry method (other capture routes are not available in this packet).",
    });
  }

  // --- qualityState ------------------------------------------------------
  if (!isCaptureQualityState(body.qualityState)) {
    issues.push({
      field: "qualityState",
      problem: "'qualityState' must be one of complete | partial | low-quality.",
    });
  }

  // --- capturedAt --------------------------------------------------------
  let capturedAt: Date | null = null;
  if (typeof body.capturedAt !== "string" || body.capturedAt.length === 0) {
    issues.push({
      field: "capturedAt",
      problem: "An ISO-8601 'capturedAt' timestamp string is required.",
    });
  } else {
    const parsed = new Date(body.capturedAt);
    if (Number.isNaN(parsed.getTime())) {
      issues.push({
        field: "capturedAt",
        problem: "'capturedAt' must be a valid ISO-8601 timestamp.",
      });
    } else {
      capturedAt = parsed;
      if (parsed.getTime() < CAPTURE_EARLIEST_MS) {
        issues.push({
          field: "capturedAt",
          problem: "'capturedAt' is implausibly far in the past.",
        });
      }
      if (parsed.getTime() > now.getTime() + CAPTURE_FUTURE_TOLERANCE_MS) {
        issues.push({
          field: "capturedAt",
          problem: "'capturedAt' cannot be in the future.",
        });
      }
    }
  }

  // --- fieldValues (needs the shape) --------------------------------------
  const fieldValues: Record<string, number> = {};
  if (shape !== undefined) {
    if (!isRecord(body.fieldValues)) {
      issues.push({
        field: "fieldValues",
        problem: "A 'fieldValues' object keyed by field id is required.",
      });
    } else {
      for (const field of shape.fields) {
        const raw = body.fieldValues[field.id];
        if (raw === undefined) {
          issues.push({
            field: `fieldValues.${field.id}`,
            problem: `A numeric value for '${field.id}' is required.`,
          });
          continue;
        }
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          issues.push({
            field: `fieldValues.${field.id}`,
            problem: `'${field.id}' must be a finite number.`,
          });
          continue;
        }
        if (raw < field.min || raw > field.max) {
          issues.push({
            field: `fieldValues.${field.id}`,
            problem: `'${field.id}' must be between ${field.min} and ${field.max}.`,
          });
          continue;
        }
        if (field.step > 0 && !Number.isInteger(raw / field.step)) {
          issues.push({
            field: `fieldValues.${field.id}`,
            problem: `'${field.id}' must be a multiple of ${field.step}.`,
          });
          continue;
        }
        fieldValues[field.id] = raw;
      }
      const knownFieldIds = new Set(shape.fields.map((field) => field.id));
      for (const key of Object.keys(body.fieldValues)) {
        if (!knownFieldIds.has(key)) {
          issues.push({
            field: "fieldValues",
            problem: "Unknown field keys are not accepted.",
          });
          break;
        }
      }
    }
  }

  // --- notes ---------------------------------------------------------------
  let notes: string | undefined;
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      issues.push({ field: "notes", problem: "'notes' must be a string when present." });
    } else {
      const trimmed = body.notes.trim();
      if (trimmed.length > CAPTURE_NOTES_MAX_LENGTH) {
        issues.push({
          field: "notes",
          problem: `'notes' must be at most ${CAPTURE_NOTES_MAX_LENGTH} characters.`,
        });
      } else if (trimmed.length > 0) {
        notes = trimmed;
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // Shape checks guaranteed by the issue-free path above.
  const validShape = shape as CaptureShape;
  const validQuality = body.qualityState as CaptureQualityState;
  const validCapturedAt = capturedAt as Date;

  return {
    ok: true,
    submission: {
      shapeId: validShape.id,
      methodOptionId: validShape.manualMethodOption.id,
      fieldValues,
      qualityState: validQuality,
      capturedAtIso: validCapturedAt.toISOString(),
      ...(notes !== undefined ? { notes } : {}),
    },
  };
}
