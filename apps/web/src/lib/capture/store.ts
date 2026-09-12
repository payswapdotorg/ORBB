import {
  SYNTHETIC_PERSON_ID,
  SYNTHETIC_PERSON_LABEL,
  SYNTHETIC_SOURCE_ID,
  findCaptureShape,
} from "./catalog";
import { formatValueLabel } from "./format";
import { qualityScoreFromState } from "./quality";
import type {
  CaptureObservationDto,
  CaptureProvenanceDto,
  CaptureRecordDto,
  CaptureSubmission,
} from "./types";

/**
 * In-memory capture store (M4-B route-stub backing): process-local module
 * state, single-person by construction — the synthetic session's
 * person-scoping happens here, at the only write path (the same
 * stub-store pattern as the M3-B echo counter, now with real records).
 *
 * Records mirror domain Observation semantics:
 *   - one observation PER captured field, each with its own canonical id
 *     (`obs_SYNTH-obs-000001`), its own provenance record
 *     (`prov_SYNTH-prov-000001`, actor = the person — self-tracking), and
 *     the METHOD ACTUALLY USED (the field's manual method code);
 *   - `effectiveAt` = the user-stated capture time; `observedAt` = the
 *     record time (server "now");
 *   - fresh manual captures enter the `pending` validation state — the
 *     validation layer is a later milestone's concern, never silently
 *     pre-validated here;
 *   - quality score is derived from the self-assessed state per
 *     observation (its own method's typical range); the recorded STATE is
 *     the self-assessment, never upgraded.
 */

/** Maximum captures returned by the history endpoint. */
export const CAPTURE_HISTORY_LIMIT = 50;

let captureCounter = 0;
let observationCounter = 0;
let provenanceCounter = 0;

/** Insertion-ordered store (oldest first). */
const storedCaptures: CaptureRecordDto[] = [];

function nextCaptureId(): string {
  captureCounter += 1;
  return `SYNTH-CAP-${String(captureCounter).padStart(6, "0")}`;
}

function nextObservationId(): string {
  observationCounter += 1;
  return `obs_SYNTH-obs-${String(observationCounter).padStart(6, "0")}`;
}

function nextProvenanceId(): string {
  provenanceCounter += 1;
  return `prov_SYNTH-prov-${String(provenanceCounter).padStart(6, "0")}`;
}

function manualMethodLabel(
  shapeMethodLabel: string,
  fieldLabel: string,
): string {
  return `${shapeMethodLabel} · ${fieldLabel}`;
}

/**
 * Builds and stores one capture act from a validated submission.
 * Returns the stored record; ids are deterministic (process counters).
 */
export function storeCapture(submission: CaptureSubmission, now: Date): CaptureRecordDto {
  const shape = findCaptureShape(submission.shapeId);
  if (shape === undefined) {
    // validateCaptureSubmission guarantees a known shape; the store is a
    // programming-error boundary, not a user-facing validation layer.
    throw new Error("Capture store received a submission with an unknown shape.");
  }

  const captureId = nextCaptureId();
  const recordedAt = now.toISOString();

  const observations: CaptureObservationDto[] = shape.fields.map((field) => {
    const value = submission.fieldValues[field.id];
    if (value === undefined) {
      throw new Error("Capture store received a submission missing a field value.");
    }
    const provenance: CaptureProvenanceDto = {
      provenanceId: nextProvenanceId(),
      actor: SYNTHETIC_PERSON_ID,
      subject: SYNTHETIC_PERSON_ID,
      occurredAt: recordedAt,
      correlationId: captureId,
    };
    return {
      id: nextObservationId(),
      personId: SYNTHETIC_PERSON_ID,
      conceptCode: field.metric.conceptCode,
      metricId: field.metric.id,
      metricLabel: field.metric.displayName,
      value,
      unit: field.metric.unitDomain[0] ?? "",
      effectiveAt: submission.capturedAtIso,
      observedAt: recordedAt,
      sourceId: SYNTHETIC_SOURCE_ID,
      methodId: field.method.id,
      methodLabel: manualMethodLabel(shape.manualMethodOption.label, field.label),
      evidenceLabel: field.method.evidenceLabel,
      quality: qualityScoreFromState(submission.qualityState, field.method.typicalQuality),
      validationState: "pending",
      provenance,
    };
  });

  const record: CaptureRecordDto = {
    captureId,
    personId: SYNTHETIC_PERSON_ID,
    shapeId: shape.id,
    shapeLabel: shape.displayName,
    methodOptionId: submission.methodOptionId,
    qualityState: submission.qualityState,
    capturedAt: submission.capturedAtIso,
    recordedAt,
    ...(submission.notes !== undefined ? { notes: submission.notes } : {}),
    observations,
  };

  storedCaptures.push(record);
  return record;
}

/** Recent captures, most recent first, capped at {@link CAPTURE_HISTORY_LIMIT}. */
export function listRecentCaptures(): readonly CaptureRecordDto[] {
  return [...storedCaptures].reverse().slice(0, CAPTURE_HISTORY_LIMIT);
}

/** Resets the store (test-only; deterministic re-seeding of suites). */
export function resetCaptureStore(): void {
  captureCounter = 0;
  observationCounter = 0;
  provenanceCounter = 0;
  storedCaptures.length = 0;
}

/** Convenience: the value label for a stored record (display + a11y). */
export function captureValueLabel(record: CaptureRecordDto): string {
  const shape = findCaptureShape(record.shapeId);
  if (shape === undefined) {
    return record.observations
      .map((observation) => `${observation.value} ${observation.unit}`)
      .join(" · ");
  }
  const values: Record<string, number> = {};
  for (const observation of record.observations) {
    const field = shape.fields.find((candidate) => candidate.metric.id === observation.metricId);
    if (field !== undefined) {
      values[field.id] = observation.value;
    }
  }
  return formatValueLabel(shape, values);
}

/** Convenience: the provenance actor display label (self-tracking person). */
export function captureActorLabel(): string {
  return SYNTHETIC_PERSON_LABEL;
}
