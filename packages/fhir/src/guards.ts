/**
 * Shared runtime guards for the mapper inputs and context — the
 * fail-closed validation layer.
 *
 * Every mapper asserts its input structurally BEFORE building any output
 * ("never a silent partial resource"), and the mapping context is
 * validated once at construction. Guards are PHI-safe in the @orbb/domain
 * discipline: error messages describe the expected shape and never echo
 * received values.
 */
import { FhirMappingError, invalidInput } from "./errors.js";
export { invalidInput } from "./errors.js";
import {
  COMPLETION_QUALITY_STATES,
  EVIDENCE_LABELS,
  EVIDENCE_OBJECT_STATES,
  GRANT_STATES,
  INTENT_STATES,
  OBSERVATION_VALIDATION_STATES,
  TASK_STATES,
  isAttemptId,
  isIdOfKind,
  isUploadSessionId,
} from "./vocabulary.js";
import type {
  ConsentGrantInput,
  DiagnosticReportInput,
  EvidenceObjectInput,
  HealthIntentInput,
  MeasurementAttemptInput,
  MeasurementTaskInput,
  ObservationInput,
  ProvenanceRecordInput,
} from "./inputs.js";

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isQualityScoreValue(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/.test(value);
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(
  vocabulary: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && (vocabulary as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Provenance record guard (shared with the context validator).
// ---------------------------------------------------------------------------

/**
 * Pure guard: asserts a well-formed provenance record (the frozen domain
 * `Provenance` shape). Throws {@link FhirMappingError}`("invalid-input")`
 * or `("unknown-vocabulary")` — values are never echoed.
 */
export function assertProvenanceRecord(candidate: unknown): asserts candidate is ProvenanceRecordInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid provenance record: expected the domain Provenance shape.");
  }
  if (!isIdOfKind("provenance", candidate.provenanceId)) {
    throw invalidInput(
      "Invalid provenance record: expected a canonical provenance id (prov_<body>).",
    );
  }
  if (
    !isIdOfKind("person", candidate.actor) &&
    !isIdOfKind("device", candidate.actor) &&
    !isIdOfKind("source", candidate.actor)
  ) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid provenance record: the actor must be a canonical person, device, or source id (the frozen domain actor vocabulary).",
    );
  }
  if (!isIdOfKind("person", candidate.subject)) {
    throw invalidInput("Invalid provenance record: expected a canonical person subject id.");
  }
  if (!isTimestamp(candidate.occurredAt)) {
    throw invalidInput("Invalid provenance record: expected a valid occurredAt timestamp.");
  }
  if (candidate.causationId !== undefined && !isNonEmptyString(candidate.causationId)) {
    throw invalidInput("Invalid provenance record: causationId, when present, must be a non-empty token.");
  }
  if (candidate.correlationId !== undefined && !isNonEmptyString(candidate.correlationId)) {
    throw invalidInput("Invalid provenance record: correlationId, when present, must be a non-empty token.");
  }
}

// ---------------------------------------------------------------------------
// Observation guard.
// ---------------------------------------------------------------------------

/** Pure guard: asserts a well-formed {@link ObservationInput}. */
export function assertObservationInput(candidate: unknown): asserts candidate is ObservationInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid observation input: expected the domain Observation shape.");
  }
  if (!isIdOfKind("observation", candidate.id)) {
    throw invalidInput("Invalid observation input: expected a canonical observation id (obs_<body>).");
  }
  if (!isIdOfKind("person", candidate.personId)) {
    throw invalidInput("Invalid observation input: expected a canonical person id.");
  }
  if (!isNonEmptyString(candidate.conceptCode)) {
    throw invalidInput("Invalid observation input: expected a non-empty concept code.");
  }
  const value = candidate.value;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw invalidInput(
      "Invalid observation input: expected a typed primitive value (quantity, code/text string, or boolean).",
    );
  }
  if (typeof candidate.unit !== "string") {
    throw invalidInput("Invalid observation input: expected a unit string (empty for non-quantitative values).");
  }
  if (!isTimestamp(candidate.effectiveAt) || !isTimestamp(candidate.observedAt)) {
    throw invalidInput("Invalid observation input: expected valid effectiveAt and observedAt timestamps.");
  }
  if (!isIdOfKind("source", candidate.sourceId)) {
    throw invalidInput("Invalid observation input: expected a canonical source id.");
  }
  if (!isNonEmptyString(candidate.methodId)) {
    throw invalidInput("Invalid observation input: expected a non-empty method code.");
  }
  if (candidate.evidenceId !== undefined && !isIdOfKind("evidence", candidate.evidenceId)) {
    throw invalidInput("Invalid observation input: evidenceId, when present, must be a canonical evidence id.");
  }
  if (candidate.quality !== undefined && !isQualityScoreValue(candidate.quality)) {
    throw invalidInput("Invalid observation input: quality, when present, must be a finite number in [0, 1].");
  }
  if (!isMember(OBSERVATION_VALIDATION_STATES, candidate.validationState)) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid observation input: validationState must be one of pending | validated | rejected | superseded (the frozen domain vocabulary).",
    );
  }
  if (!isIdOfKind("provenance", candidate.provenanceId)) {
    throw invalidInput("Invalid observation input: expected a canonical provenance id.");
  }
  if (!isMember(EVIDENCE_LABELS, candidate.evidenceLabel)) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid observation input: evidenceLabel must be one of MEASURED | ESTIMATED | IMPORTED | DERIVED (the frozen domain vocabulary).",
    );
  }
  if (candidate.supersedesId !== undefined && !isIdOfKind("observation", candidate.supersedesId)) {
    throw invalidInput("Invalid observation input: supersedesId, when present, must be a canonical observation id.");
  }
}

// ---------------------------------------------------------------------------
// HealthIntent guard.
// ---------------------------------------------------------------------------

/** Pure guard: asserts a well-formed {@link HealthIntentInput}. */
export function assertHealthIntentInput(candidate: unknown): asserts candidate is HealthIntentInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid health intent input: expected the domain HealthIntent shape.");
  }
  if (!isIdOfKind("intent", candidate.id)) {
    throw invalidInput("Invalid health intent input: expected a canonical intent id (intent_<body>).");
  }
  if (!isIdOfKind("person", candidate.personId)) {
    throw invalidInput("Invalid health intent input: expected a canonical person id.");
  }
  if (!isNonEmptyString(candidate.objective)) {
    throw invalidInput("Invalid health intent input: expected a non-empty objective (never mapped, only shape-checked).");
  }
  if (!isMember(INTENT_STATES, candidate.state)) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid health intent input: state must be one of draft | active | paused | achieved | retired (the frozen domain vocabulary).",
    );
  }
  if (!isTimestamp(candidate.createdAt)) {
    throw invalidInput("Invalid health intent input: expected a valid createdAt timestamp.");
  }
  if (candidate.evidencePackVersion !== undefined) {
    if (typeof candidate.evidencePackVersion !== "number" || !Number.isInteger(candidate.evidencePackVersion) || candidate.evidencePackVersion < 1) {
      throw invalidInput("Invalid health intent input: evidencePackVersion, when present, must be a positive integer.");
    }
  }
  if (candidate.planId !== undefined && !isIdOfKind("plan", candidate.planId)) {
    throw invalidInput("Invalid health intent input: planId, when present, must be a canonical plan id.");
  }
}

// ---------------------------------------------------------------------------
// AccessGrant input guard.
// ---------------------------------------------------------------------------

/** Scope-entry grammar mirror of the domain `parseScopePermission` rule (exactly one colon, non-empty segments). */
function isScopePermissionEntry(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  const separator = value.indexOf(":");
  return (
    separator >= 1 &&
    separator === value.lastIndexOf(":") &&
    separator !== value.length - 1
  );
}

/** Pure guard: asserts a well-formed {@link ConsentGrantInput}. */
export function assertConsentGrantInput(candidate: unknown): asserts candidate is ConsentGrantInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid access grant input: expected the domain AccessGrant shape (plus optional issuedAt).");
  }
  if (!isIdOfKind("grant", candidate.id)) {
    throw invalidInput("Invalid access grant input: expected a canonical grant id (grant_<body>).");
  }
  if (!isIdOfKind("person", candidate.subjectId)) {
    throw invalidInput("Invalid access grant input: expected a canonical person subject id.");
  }
  if (!isNonEmptyString(candidate.recipientId)) {
    throw invalidInput("Invalid access grant input: expected a non-empty recipient id.");
  }
  if (!isNonEmptyString(candidate.purpose)) {
    throw invalidInput("Invalid access grant input: expected a non-empty purpose-of-use label.");
  }
  if (!Array.isArray(candidate.scope) || candidate.scope.length === 0) {
    throw invalidInput("Invalid access grant input: expected a non-empty scope list.");
  }
  for (const entry of candidate.scope) {
    if (!isScopePermissionEntry(entry)) {
      throw invalidInput(
        'Invalid access grant input: every scope entry must be "<resourceKind>:<operation>" with non-empty segments and exactly one colon (the frozen domain scope grammar).',
      );
    }
  }
  if (!isMember(GRANT_STATES, candidate.state)) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid access grant input: state must be one of active | revoked (the frozen domain vocabulary).",
    );
  }
  if (!isTimestamp(candidate.expiresAt)) {
    throw invalidInput("Invalid access grant input: expected a valid expiresAt timestamp.");
  }
  if (candidate.issuedAt !== undefined && !isTimestamp(candidate.issuedAt)) {
    throw invalidInput("Invalid access grant input: issuedAt, when present, must be a valid timestamp.");
  }
}

// ---------------------------------------------------------------------------
// EvidenceObject input guard.
// ---------------------------------------------------------------------------

/** Pure guard: asserts a well-formed {@link EvidenceObjectInput}. */
export function assertEvidenceObjectInput(candidate: unknown): asserts candidate is EvidenceObjectInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid evidence object input: expected the architecture §5 EvidenceObject field list (the @orbb/db record shape).");
  }
  if (!isIdOfKind("evidence", candidate.id)) {
    throw invalidInput("Invalid evidence object input: expected a canonical evidence id (evid_<body>).");
  }
  if (!isIdOfKind("person", candidate.personId)) {
    throw invalidInput("Invalid evidence object input: expected a canonical person id.");
  }
  if (!isNonEmptyString(candidate.objectKey)) {
    throw invalidInput("Invalid evidence object input: expected a non-empty opaque object key.");
  }
  if (!isNonEmptyString(candidate.mediaType)) {
    throw invalidInput("Invalid evidence object input: expected a non-empty media type.");
  }
  if (!isSha256Hex(candidate.sha256)) {
    throw invalidInput("Invalid evidence object input: expected a 64-character lowercase hexadecimal sha256 digest.");
  }
  if (!isNonNegativeInteger(candidate.sizeBytes)) {
    throw invalidInput("Invalid evidence object input: expected a non-negative integer size in bytes.");
  }
  if (!isTimestamp(candidate.capturedAt)) {
    throw invalidInput("Invalid evidence object input: expected a valid capturedAt timestamp.");
  }
  if (!isNonEmptyString(candidate.sourceType)) {
    throw invalidInput("Invalid evidence object input: expected a non-empty source type.");
  }
  if (!isIdOfKind("provenance", candidate.provenanceId)) {
    throw invalidInput("Invalid evidence object input: expected a canonical provenance id.");
  }
  if (!isNonEmptyString(candidate.retentionClass)) {
    throw invalidInput("Invalid evidence object input: expected a non-empty retention class.");
  }
  if (!isMember(EVIDENCE_OBJECT_STATES, candidate.state)) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      'Invalid evidence object input: state must be "active" (the frozen evidence-object lifecycle vocabulary).',
    );
  }
  if (candidate.createdAt !== undefined && !isTimestamp(candidate.createdAt)) {
    throw invalidInput("Invalid evidence object input: createdAt, when present, must be a valid timestamp.");
  }
  if (candidate.sessionId !== undefined && !isUploadSessionId(candidate.sessionId)) {
    throw invalidInput("Invalid evidence object input: sessionId, when present, must be a canonical upload-session id.");
  }
}

// ---------------------------------------------------------------------------
// Measurement task / attempt / report-input guards.
// ---------------------------------------------------------------------------

/** Pure guard: asserts a well-formed {@link MeasurementTaskInput}. */
export function assertMeasurementTaskInput(candidate: unknown): asserts candidate is MeasurementTaskInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid measurement task input: expected the measurement lane's MeasurementTask shape.");
  }
  if (!isIdOfKind("task", candidate.id)) {
    throw invalidInput("Invalid measurement task input: expected a canonical task id (task_<body>).");
  }
  if (!isIdOfKind("plan", candidate.planId)) {
    throw invalidInput("Invalid measurement task input: expected a canonical plan id.");
  }
  if (!isIdOfKind("person", candidate.personId)) {
    throw invalidInput("Invalid measurement task input: expected a canonical person id.");
  }
  if (!isNonEmptyString(candidate.metricId)) {
    throw invalidInput("Invalid measurement task input: expected a non-empty metric id.");
  }
  if (!isNonEmptyString(candidate.conceptCode)) {
    throw invalidInput("Invalid measurement task input: expected a non-empty concept code.");
  }
  if (!Array.isArray(candidate.methodOrder) || candidate.methodOrder.length === 0) {
    throw invalidInput("Invalid measurement task input: expected a non-empty method order.");
  }
  for (const methodId of candidate.methodOrder) {
    if (!isNonEmptyString(methodId)) {
      throw invalidInput("Invalid measurement task input: every method-order entry must be a non-empty method code.");
    }
  }
  const window = candidate.window;
  if (!isPlainObject(window)) {
    throw invalidInput("Invalid measurement task input: expected a measurement window.");
  }
  if (!isNonNegativeInteger(window.sequence)) {
    throw invalidInput("Invalid measurement task input: expected a non-negative integer window sequence.");
  }
  if (!isTimestamp(window.startsAt) || !isTimestamp(window.endsAt)) {
    throw invalidInput("Invalid measurement task input: expected valid window start/end timestamps.");
  }
  if (!(window.endsAt.getTime() > window.startsAt.getTime())) {
    throw invalidInput("Invalid measurement task input: the window must be non-degenerate ([startsAt, endsAt) with duration > 0).");
  }
  if (!isMember(TASK_STATES, candidate.state)) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid measurement task input: state must be one of open | completed (the measurement lane vocabulary).",
    );
  }
  if (!isTimestamp(candidate.createdAt)) {
    throw invalidInput("Invalid measurement task input: expected a valid createdAt timestamp.");
  }
  if (!isNonNegativeInteger(candidate.rollCount)) {
    throw invalidInput("Invalid measurement task input: expected a non-negative integer roll count.");
  }
}

/** Pure guard: asserts a well-formed {@link MeasurementAttemptInput}. */
export function assertMeasurementAttemptInput(candidate: unknown): asserts candidate is MeasurementAttemptInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid measurement attempt input: expected the measurement lane's MeasurementAttempt shape.");
  }
  if (!isAttemptId(candidate.id)) {
    throw invalidInput("Invalid measurement attempt input: expected a canonical attempt id (mta_<body>).");
  }
  if (!isIdOfKind("task", candidate.taskId)) {
    throw invalidInput("Invalid measurement attempt input: expected a canonical task id.");
  }
  if (!isIdOfKind("person", candidate.personId)) {
    throw invalidInput("Invalid measurement attempt input: expected a canonical person id.");
  }
  if (!isNonEmptyString(candidate.metricId)) {
    throw invalidInput("Invalid measurement attempt input: expected a non-empty metric id.");
  }
  if (!isIdOfKind("observation", candidate.observationId)) {
    throw invalidInput("Invalid measurement attempt input: expected a canonical observation id.");
  }
  if (!isNonEmptyString(candidate.methodId)) {
    throw invalidInput("Invalid measurement attempt input: expected a non-empty method code.");
  }
  if (candidate.preferredMethodId !== undefined && !isNonEmptyString(candidate.preferredMethodId)) {
    throw invalidInput("Invalid measurement attempt input: preferredMethodId, when present, must be a non-empty method code.");
  }
  if (!isQualityScoreValue(candidate.quality)) {
    throw invalidInput("Invalid measurement attempt input: expected a quality score in [0, 1].");
  }
  if (!isMember(COMPLETION_QUALITY_STATES, candidate.completionState)) {
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid measurement attempt input: completionState must be one of complete | partial | low-quality (the measurement lane vocabulary).",
    );
  }
  if (!isTimestamp(candidate.recordedAt)) {
    throw invalidInput("Invalid measurement attempt input: expected a valid recordedAt timestamp.");
  }
  if (candidate.evidenceId !== undefined && !isIdOfKind("evidence", candidate.evidenceId)) {
    throw invalidInput("Invalid measurement attempt input: evidenceId, when present, must be a canonical evidence id.");
  }
  if (!isIdOfKind("provenance", candidate.provenanceId)) {
    throw invalidInput("Invalid measurement attempt input: expected a canonical provenance id.");
  }
}

/**
 * Pure guard: asserts a well-formed {@link DiagnosticReportInput} — both
 * shapes AND the grouping invariants (every attempt belongs to the task
 * and its person/metric; observation ids are unique across the set).
 */
export function assertDiagnosticReportInput(candidate: unknown): asserts candidate is DiagnosticReportInput {
  if (!isPlainObject(candidate)) {
    throw invalidInput("Invalid diagnostic report input: expected { task, attempts } (one report per task attempt set).");
  }
  assertMeasurementTaskInput(candidate.task);
  if (!Array.isArray(candidate.attempts)) {
    throw invalidInput("Invalid diagnostic report input: expected an attempts array (possibly empty).");
  }
  const seenObservationIds = new Set<string>();
  for (const attempt of candidate.attempts) {
    assertMeasurementAttemptInput(attempt);
    if (attempt.taskId !== candidate.task.id) {
      throw invalidInput(
        "Invalid diagnostic report input: every attempt must reference the report's task (grouping invariant).",
      );
    }
    if (attempt.personId !== candidate.task.personId) {
      throw invalidInput(
        "Invalid diagnostic report input: every attempt must belong to the task's person.",
      );
    }
    if (attempt.metricId !== candidate.task.metricId) {
      throw invalidInput(
        "Invalid diagnostic report input: every attempt must target the task's metric.",
      );
    }
    if (seenObservationIds.has(attempt.observationId)) {
      throw invalidInput(
        "Invalid diagnostic report input: observation ids must be unique across the attempt set.",
      );
    }
    seenObservationIds.add(attempt.observationId);
  }
}
