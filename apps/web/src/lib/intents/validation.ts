/**
 * Intent journey request validation (M6-A, Lane B): typed, deny-by-default
 * validation of the wire bodies the `/api/intents` and `/api/plans` stubs
 * receive — the M4-B capture validation discipline, mirrored:
 *   - well-formed JSON violating the contract -> 422 `validation-failed`
 *     with field-level issues (field PATH + problem; values NEVER echoed);
 *   - unknown shapes, wrong types, degenerate values -> typed issues;
 *   - expected rejections are TYPED RESULTS, never throws.
 */

import {
  GOAL_METRIC_OPTIONS,
  INTENT_MAX_MEASUREMENTS_PER_DAY,
  findGoalMetricOption,
} from "./catalog";
import {
  INTENT_METHOD_PREFERENCES,
  isIntentDirection,
  type IntentIssue,
} from "./types";

/** Draft id grammar: `SYNTH-DRAFT-` + 6..64 URL-safe chars. */
const DRAFT_ID_PATTERN = /^SYNTH-DRAFT-[A-Za-z0-9_-]{6,64}$/;

/** Review entry id grammar: `revq_SYNTH-` + 3..64 URL-safe chars. */
const ENTRY_ID_PATTERN = /^revq_SYNTH-[A-Za-z0-9_-]{3,64}$/;

/** Maximum reviewer note / reject reason length. */
export const INTENT_NOTE_MAX_LENGTH = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates an intent-create request body. Returns the validated view
 * (rebuilt defensively) or the typed issue list.
 */
export function validateIntentCreateRequest(
  candidate: unknown,
): { ok: true; request: IntentCreateValidated } | { ok: false; issues: IntentIssue[] } {
  const issues: IntentIssue[] = [];

  if (!isPlainObject(candidate)) {
    return {
      ok: false,
      issues: [{ field: "body", problem: "Request body must be an object." }],
    };
  }

  if (!isNonEmptyString(candidate.draftId) || !DRAFT_ID_PATTERN.test(candidate.draftId)) {
    issues.push({
      field: "draftId",
      problem: "Draft id must match the SYNTH-DRAFT-… grammar (idempotency key).",
    });
  }

  const goal = candidate.goal;
  const goalRecord = isPlainObject(goal) ? goal : undefined;
  if (goalRecord === undefined) {
    issues.push({ field: "goal", problem: "Goal must be an object." });
  } else {
    if (!isNonEmptyString(goalRecord.metricId)) {
      issues.push({ field: "goal.metricId", problem: "Goal metric id is required." });
    } else if (findGoalMetricOption(goalRecord.metricId) === undefined) {
      issues.push({
        field: "goal.metricId",
        problem: "Goal metric id is not in the synthetic catalog.",
      });
    }
    if (!isIntentDirection(goalRecord.direction)) {
      issues.push({
        field: "goal.direction",
        problem: "Goal direction must be one of the intent directions.",
      });
    }
    if (!isFiniteNumber(goalRecord.target)) {
      issues.push({ field: "goal.target", problem: "Goal target must be a number." });
    } else {
      const option = isNonEmptyString(goalRecord.metricId)
        ? findGoalMetricOption(goalRecord.metricId)
        : undefined;
      if (option !== undefined) {
        if (goalRecord.target < option.targetMin || goalRecord.target > option.targetMax) {
          issues.push({
            field: "goal.target",
            problem: `Goal target must stay within the metric guards (in ${option.unit}).`,
          });
        }
      }
    }
  }

  const constraints = candidate.constraints;
  const constraintsRecord = isPlainObject(constraints) ? constraints : undefined;
  let cadencePerDay = 0;
  let methodPreference: "any" | "measured-only" = "any";
  if (constraintsRecord === undefined) {
    issues.push({ field: "constraints", problem: "Constraints must be an object." });
  } else {
    if (
      !isFiniteNumber(constraintsRecord.cadencePerDay) ||
      constraintsRecord.cadencePerDay <= 0 ||
      constraintsRecord.cadencePerDay > INTENT_MAX_MEASUREMENTS_PER_DAY
    ) {
      issues.push({
        field: "constraints.cadencePerDay",
        problem: `Cadence must be a positive number of measurements per day (max ${INTENT_MAX_MEASUREMENTS_PER_DAY}).`,
      });
    } else {
      cadencePerDay = constraintsRecord.cadencePerDay;
    }
    const preference = constraintsRecord.methodPreference;
    if (
      typeof preference !== "string" ||
      !(INTENT_METHOD_PREFERENCES as readonly string[]).includes(preference)
    ) {
      issues.push({
        field: "constraints.methodPreference",
        problem: "Method preference must be any or measured-only.",
      });
    } else {
      methodPreference = preference as "any" | "measured-only";
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const goalView = goal as Record<string, unknown>;
  return {
    ok: true,
    request: {
      draftId: candidate.draftId as string,
      goal: {
        metricId: goalView.metricId as string,
        direction: goalView.direction as "decrease" | "increase" | "maintain",
        target: goalView.target as number,
      },
      constraints: {
        cadencePerDay,
        methodPreference,
      },
    },
  };
}

export interface IntentCreateValidated {
  readonly draftId: string;
  readonly goal: {
    readonly metricId: string;
    readonly direction: "decrease" | "increase" | "maintain";
    readonly target: number;
  };
  readonly constraints: {
    readonly cadencePerDay: number;
    readonly methodPreference: "any" | "measured-only";
  };
}

/** Reject-reason guard: non-empty, bounded length. */
function isAcceptableText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= INTENT_NOTE_MAX_LENGTH
  );
}

/**
 * Validates a plan review act body (approve-with-edits | reject). Returns
 * the validated command or the typed issue list.
 */
export function validatePlanActRequest(
  candidate: unknown,
):
  | { ok: true; request: IntentPlanActValidated }
  | { ok: false; issues: IntentIssue[] } {
  if (!isPlainObject(candidate)) {
    return {
      ok: false,
      issues: [{ field: "body", problem: "Request body must be an object." }],
    };
  }

  if (candidate.action !== "approve-with-edits" && candidate.action !== "reject") {
    return {
      ok: false,
      issues: [
        { field: "action", problem: "Review action must be approve-with-edits or reject." },
      ],
    };
  }

  if (!isNonEmptyString(candidate.entryId) || !ENTRY_ID_PATTERN.test(candidate.entryId)) {
    return {
      ok: false,
      issues: [
        { field: "entryId", problem: "Review entry id must match the revq_SYNTH-… grammar." },
      ],
    };
  }

  if (candidate.action === "reject") {
    if (!isAcceptableText(candidate.reason)) {
      return {
        ok: false,
        issues: [
          {
            field: "reason",
            problem: `A rejection reason is required (max ${INTENT_NOTE_MAX_LENGTH} characters).`,
          },
        ],
      };
    }
    return {
      ok: true,
      request: {
        action: "reject",
        entryId: candidate.entryId,
        reason: (candidate.reason as string).trim(),
      },
    };
  }

  // approve-with-edits: optional edits { metrics?, note? }.
  const edits = candidate.edits;
  if (edits === undefined) {
    return {
      ok: true,
      request: {
        action: "approve-with-edits",
        entryId: candidate.entryId,
        edits: undefined,
      },
    };
  }
  if (!isPlainObject(edits)) {
    return {
      ok: false,
      issues: [{ field: "edits", problem: "Edits must be an object." }],
    };
  }
  const issues: IntentIssue[] = [];
  let metrics: readonly string[] | undefined;
  if (edits.metrics !== undefined) {
    if (!Array.isArray(edits.metrics) || edits.metrics.length === 0) {
      issues.push({
        field: "edits.metrics",
        problem: "Edited metrics must be a non-empty list of concept codes.",
      });
    } else {
      const seen = new Set<string>();
      const codes: string[] = [];
      for (const code of edits.metrics) {
        if (
          typeof code !== "string" ||
          !/^[A-Za-z0-9-]+$/.test(code) ||
          findGoalMetricOptionByConceptCode(code) === undefined
        ) {
          issues.push({
            field: "edits.metrics",
            problem: "Edited metrics must be concept codes from the synthetic catalog.",
          });
          break;
        }
        if (seen.has(code)) {
          issues.push({
            field: "edits.metrics",
            problem: "Edited metrics must not repeat a concept code.",
          });
          break;
        }
        seen.add(code);
        codes.push(code);
      }
      if (issues.length === 0) {
        metrics = codes;
      }
    }
  }
  let note: string | undefined;
  if (edits.note !== undefined) {
    if (!isAcceptableText(edits.note)) {
      issues.push({
        field: "edits.note",
        problem: `Reviewer note must be non-empty and at most ${INTENT_NOTE_MAX_LENGTH} characters.`,
      });
    } else {
      note = (edits.note as string).trim();
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    request: {
      action: "approve-with-edits",
      entryId: candidate.entryId,
      ...(metrics !== undefined || note !== undefined
        ? {
            edits: {
              ...(metrics !== undefined ? { metrics } : {}),
              ...(note !== undefined ? { note } : {}),
            },
          }
        : {}),
    },
  };
}

export type IntentPlanActValidated =
  | {
      readonly action: "reject";
      readonly entryId: string;
      readonly reason: string;
    }
  | {
      readonly action: "approve-with-edits";
      readonly entryId: string;
      /** Present exactly when the reviewer supplied edits. */
      readonly edits?:
        | { readonly metrics?: readonly string[]; readonly note?: string }
        | undefined;
    };

/** The catalog's concept codes are the only editable committed codes. */
function findGoalMetricOptionByConceptCode(code: string) {
  return GOAL_METRIC_OPTIONS.find((option) => option.conceptCode === code);
}
