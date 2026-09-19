/**
 * DiagnosticReport mapper — measurement plan/task/attempt groupings to
 * FHIR R4.
 *
 * RECORDED GROUPING ASSUMPTION (binding): ONE report per task attempt
 * set — the input is a `MeasurementTask` plus EVERY `MeasurementAttempt`
 * recorded against it. Data is never discarded: partial and low-quality
 * attempts are included in `result` (their observations map as their own
 * Observation resources, each carrying its own status — a superseded or
 * rejected attempt observation says so on itself, not on the report).
 * A task with ZERO attempts (a scheduler-materialized open task) maps to
 * a `registered` report with no `result` and no `issued`.
 *
 * RECORDED DETERMINISM RULE: `result` observation references are derived
 * deterministically from the attempt SET — attempts are canonically
 * ordered by (recordedAt, attemptId) before referencing, so the same
 * attempt set yields byte-identical output regardless of input array
 * order. `issued` is the latest attempt `recordedAt` (max over the
 * canonically ordered set; omitted when there are no attempts).
 *
 * STATUS TABLE (recorded):
 *   task open + no attempts    -> "registered" (the report's existence is known; no content yet)
 *   task open + >= 1 attempt   -> "partial"   (some results exist; the task is not complete)
 *   task completed             -> "final"     (an acceptable-quality attempt completed the task)
 *
 * OTHER RECORDED DECISIONS:
 *   - `basedOn` references the owning plan IDENTIFIER-ONLY (the plan is
 *     not one of the seven mapped resource types — an honest linkage
 *     without asserting a CarePlan exists; derived from task.planId).
 *   - `effectivePeriod` is the task's measurement window (half-open
 *     [startsAt, endsAt)) — the period during which the measurements
 *     were due.
 *   - `code` comes from the metric vocabulary via the task's
 *     conceptCode (fail-closed when unresolved).
 *   - Performer is omitted: this packet maps no Practitioner/Organization
 *     (that is A44's model); the attempts' provenance carries the actors.
 *   - The report's provenance linkage: every attempt's provenance record
 *     MUST exist in the context (fail-closed). For attempt-less reports
 *     there is no domain provenance field on the task — the linkage is
 *     then a world-level concern enforced by the coverage invariant.
 */
import { assertDiagnosticReportInput } from "./guards.js";
import { requireProvenanceRecord, resolveConceptCode } from "./context.js";
import type { FhirMappingContext } from "./context.js";
import type { FhirDiagnosticReport } from "./fhir.js";
import type { DiagnosticReportInput, MeasurementAttemptInput } from "./inputs.js";
import { deriveResourceId } from "./fhirIds.js";
import { identifierSystem } from "./vocabulary.js";
import { toFhirTimestamp } from "./canonical.js";
import { observationReference, patientReference } from "./references.js";

/** Canonically orders an attempt set by (recordedAt, attemptId) — the determinism rule. */
export function canonicalAttemptOrder(
  attempts: readonly MeasurementAttemptInput[],
): readonly MeasurementAttemptInput[] {
  return [...attempts].sort((a, b) => {
    const byTime = a.recordedAt.getTime() - b.recordedAt.getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function reportStatus(task: DiagnosticReportInput["task"], attemptCount: number): FhirDiagnosticReport["status"] {
  if (task.state === "completed") {
    return "final";
  }
  return attemptCount === 0 ? "registered" : "partial";
}

/**
 * Maps one task attempt set to a FHIR R4 DiagnosticReport resource.
 * Pure and deterministic; fail-closed on malformed input, grouping
 * invariant violations, unresolved concept codes, and missing attempt
 * provenance.
 */
export function mapDiagnosticReport(
  input: DiagnosticReportInput,
  context: FhirMappingContext,
): FhirDiagnosticReport {
  assertDiagnosticReportInput(input);
  const { task } = input;
  const attempts = canonicalAttemptOrder(input.attempts);
  for (const attempt of attempts) {
    requireProvenanceRecord(attempt.provenanceId, context);
  }
  const metric = resolveConceptCode(task.conceptCode, context);

  const lastAttempt = attempts[attempts.length - 1];
  const issued =
    lastAttempt !== undefined
      ? { issued: toFhirTimestamp(lastAttempt.recordedAt) }
      : {};

  return {
    resourceType: "DiagnosticReport",
    id: deriveResourceId("DiagnosticReport", task.id),
    identifier: [{ system: identifierSystem(context.namespace, "task"), value: task.id }],
    basedOn: [
      { identifier: { system: identifierSystem(context.namespace, "plan"), value: task.planId } },
    ],
    status: reportStatus(task, attempts.length),
    code: {
      coding: [
        {
          system: metric.conceptSystem,
          code: metric.conceptCode,
          ...(metric.display !== undefined ? { display: metric.display } : {}),
        },
      ],
    },
    subject: patientReference(task.personId, context),
    effectivePeriod: {
      start: toFhirTimestamp(task.window.startsAt),
      end: toFhirTimestamp(task.window.endsAt),
    },
    ...issued,
    result: attempts.map((attempt) => observationReference(attempt.observationId, context)),
  };
}
