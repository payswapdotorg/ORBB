/**
 * The FHIR mapping context — every deliberately-supplied port the mappers
 * consume. Nothing here is optional magic: the defaults are deliberately
 * USELESS for clinical mapping so that callers must make the vocabulary,
 * provenance, and demographic decisions EXPLICITLY.
 *
 * RECORDED DECISIONS:
 *
 * - NO CLOCK. The brief allows "the clock/injected dependencies where
 *   timestamps derive" — in this mapper NO output timestamp derives from
 *   mapping time; every instant comes from the domain objects
 *   (effectiveAt/observedAt/window/recordedAt/occurredAt/createdAt/
 *   issuedAt/expiresAt/capturedAt). The context therefore carries no
 *   clock at all: there is nothing for one to derive, and adding one
 *   would only invite wall-clock leakage into deterministic output.
 * - Demographics: the DEFAULT port yields nothing (identifier-only
 *   Patient). The mapper NEVER invents demographics — names, birth
 *   dates, telecom, and addresses cross the boundary only through a
 *   caller-supplied {@link DemographicPort} that must be a PURE function
 *   of the person id (an impure port breaks the determinism contract —
 *   recorded as the port's binding precondition).
 * - Metric vocabulary: Observation.code and DiagnosticReport.code are
 *   mandatory FHIR elements, and the domain concept code is an opaque
 *   string — the mapper cannot invent a terminology system or display.
 *   Callers register metric vocabulary entries (metricId <-> conceptCode
 *   with the caller-bound conceptSystem); unresolved concept codes and
 *   unresolved focus metric ids fail closed.
 * - Intent focus: the M0 HealthIntent carries a free-text objective only;
 *   the structured health-focus vocabulary (the M5/M6 goal metrics) is
 *   read-model data. Callers register per-intent focus metric ids.
 * - Provenance records: the context is the provenance registry the
 *   provenance-carrying domain objects (Observation, EvidenceObject,
 *   MeasurementAttempt) link into — a missing record is a typed
 *   fail-closed mapping failure, which is the mapper-internal half of
 *   the stable-provenance invariant.
 */
import { FhirMappingError } from "./errors.js";
import { assertProvenanceRecord, isHttpUrl, isNonEmptyString } from "./guards.js";
import type { ProvenanceRecordInput } from "./inputs.js";
import type { FhirAddress, FhirContactPoint, FhirHumanName } from "./fhir.js";
import { ORBB_SYNTH_NAMESPACE } from "./vocabulary.js";

/** Demographics a caller may deliberately disclose for a person (all optional). */
export interface PatientDemographics {
  readonly name?: readonly FhirHumanName[];
  readonly birthDate?: string;
  readonly gender?: "male" | "female" | "other" | "unknown";
  readonly telecom?: readonly FhirContactPoint[];
  readonly address?: readonly FhirAddress[];
}

/**
 * The deliberate demographic disclosure port. MUST be a pure function of
 * the person id (determinism precondition); returning `undefined` means
 * "nothing to disclose" (the privacy-first default).
 */
export interface DemographicPort {
  demographicsFor(personId: string): PatientDemographics | undefined;
}

/** The default port: discloses nothing. The minimal Patient is identifier-only. */
export const NO_DEMOGRAPHICS: DemographicPort = {
  demographicsFor: () => undefined,
};

/**
 * One metric vocabulary entry: the caller-bound terminology binding for
 * a domain metric (metricId AND conceptCode must be unique across the
 * vocabulary — enforced at context construction).
 */
export interface MetricVocabularyEntry {
  readonly metricId: string;
  readonly conceptCode: string;
  /** Terminology system URI bound by the CALLER (SYNTH namespace or a real terminology). */
  readonly conceptSystem: string;
  readonly display?: string;
  /** Metric category label; emitted only together with `categorySystem`. */
  readonly category?: string;
  /** Category terminology system bound by the caller. */
  readonly categorySystem?: string;
}

/** One registered health-focus entry: the metric ids an intent commits to. */
export interface IntentFocusEntry {
  readonly intentId: string;
  readonly metricIds: readonly string[];
}

/** The mapping context (validated, immutable). */
export interface FhirMappingContext {
  /** Boundary identifier/vocabulary namespace (default: the ORBB SYNTH namespace). */
  readonly namespace: string;
  /** Deliberate demographic disclosure port (default: nothing). */
  readonly demographics: DemographicPort;
  /** Registered metric vocabulary (default: empty — clinical code mapping fails closed). */
  readonly metrics: readonly MetricVocabularyEntry[];
  /** Registered per-intent health-focus metric ids (default: empty). */
  readonly intentFocuses: readonly IntentFocusEntry[];
  /** The provenance registry linked by provenance-carrying domain objects. */
  readonly provenanceRecords: readonly ProvenanceRecordInput[];
}

/** Overrides for {@link createFhirMappingContext} (every field optional). */
export interface FhirMappingContextOptions {
  readonly namespace?: string;
  readonly demographics?: DemographicPort;
  readonly metrics?: readonly MetricVocabularyEntry[];
  readonly intentFocuses?: readonly IntentFocusEntry[];
  readonly provenanceRecords?: readonly ProvenanceRecordInput[];
}

function invalidContext(message: string): FhirMappingError {
  return new FhirMappingError("invalid-context", message);
}

function assertMetricVocabularyEntry(candidate: unknown): asserts candidate is MetricVocabularyEntry {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw invalidContext("Invalid metric vocabulary entry: expected { metricId, conceptCode, conceptSystem, display?, category?, categorySystem? }.");
  }
  const entry = candidate as Record<string, unknown>;
  if (!isNonEmptyString(entry.metricId)) {
    throw invalidContext("Invalid metric vocabulary entry: expected a non-empty metric id.");
  }
  if (!isNonEmptyString(entry.conceptCode)) {
    throw invalidContext("Invalid metric vocabulary entry: expected a non-empty concept code.");
  }
  if (!isHttpUrl(entry.conceptSystem)) {
    throw invalidContext("Invalid metric vocabulary entry: expected an absolute http(s) concept system URI.");
  }
  if (entry.display !== undefined && !isNonEmptyString(entry.display)) {
    throw invalidContext("Invalid metric vocabulary entry: display, when present, must be a non-empty label.");
  }
  if (entry.category !== undefined && !isNonEmptyString(entry.category)) {
    throw invalidContext("Invalid metric vocabulary entry: category, when present, must be a non-empty label.");
  }
  if (entry.category !== undefined && !isHttpUrl(entry.categorySystem)) {
    throw invalidContext("Invalid metric vocabulary entry: a category requires its caller-bound categorySystem URI.");
  }
  if (entry.category === undefined && entry.categorySystem !== undefined) {
    throw invalidContext("Invalid metric vocabulary entry: categorySystem is meaningful only together with a category.");
  }
}

function assertIntentFocusEntry(candidate: unknown): asserts candidate is IntentFocusEntry {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw invalidContext("Invalid intent focus entry: expected { intentId, metricIds }.");
  }
  const entry = candidate as Record<string, unknown>;
  if (typeof entry.intentId !== "string" || !entry.intentId.startsWith("intent_")) {
    throw invalidContext("Invalid intent focus entry: expected a canonical intent id.");
  }
  if (!Array.isArray(entry.metricIds) || entry.metricIds.length === 0) {
    throw invalidContext("Invalid intent focus entry: expected a non-empty metricIds list.");
  }
  const seen = new Set<string>();
  for (const metricId of entry.metricIds) {
    if (!isNonEmptyString(metricId)) {
      throw invalidContext("Invalid intent focus entry: every metric id must be a non-empty string.");
    }
    if (seen.has(metricId)) {
      throw invalidContext("Invalid intent focus entry: metric ids must be unique within an intent's focus.");
    }
    seen.add(metricId);
  }
}

/**
 * Builds a validated mapping context. Throws
 * {@link FhirMappingError}`("invalid-context")` on a malformed namespace,
 * demographic port, duplicate vocabulary keys, or malformed provenance
 * records (values are never echoed).
 */
export function createFhirMappingContext(options?: FhirMappingContextOptions): FhirMappingContext {
  const rawNamespace = options?.namespace ?? ORBB_SYNTH_NAMESPACE;
  if (!isHttpUrl(rawNamespace)) {
    throw invalidContext("Invalid mapping context namespace: expected an absolute http(s) URI.");
  }
  const namespace = rawNamespace.replace(/\/+$/, "");

  const demographics = options?.demographics ?? NO_DEMOGRAPHICS;
  if (typeof demographics !== "object" || demographics === null || typeof demographics.demographicsFor !== "function") {
    throw invalidContext("Invalid mapping context demographics port: expected { demographicsFor(personId) }.");
  }

  const metrics = options?.metrics ?? [];
  if (!Array.isArray(metrics)) {
    throw invalidContext("Invalid mapping context: metrics must be a list of vocabulary entries.");
  }
  const metricIds = new Set<string>();
  const conceptCodes = new Set<string>();
  for (const entry of metrics) {
    assertMetricVocabularyEntry(entry);
    if (metricIds.has(entry.metricId)) {
      throw invalidContext("Invalid mapping context: duplicate metric id in the metric vocabulary.");
    }
    if (conceptCodes.has(entry.conceptCode)) {
      throw invalidContext("Invalid mapping context: duplicate concept code in the metric vocabulary.");
    }
    metricIds.add(entry.metricId);
    conceptCodes.add(entry.conceptCode);
  }

  const intentFocuses = options?.intentFocuses ?? [];
  if (!Array.isArray(intentFocuses)) {
    throw invalidContext("Invalid mapping context: intentFocuses must be a list of focus entries.");
  }
  const intentIds = new Set<string>();
  for (const entry of intentFocuses) {
    assertIntentFocusEntry(entry);
    if (intentIds.has(entry.intentId)) {
      throw invalidContext("Invalid mapping context: duplicate intent id in the intent focus registry.");
    }
    intentIds.add(entry.intentId);
  }

  const provenanceRecords = options?.provenanceRecords ?? [];
  if (!Array.isArray(provenanceRecords)) {
    throw invalidContext("Invalid mapping context: provenanceRecords must be a list of provenance records.");
  }
  const provenanceIds = new Set<string>();
  for (const record of provenanceRecords) {
    assertProvenanceRecord(record);
    if (provenanceIds.has(record.provenanceId)) {
      throw invalidContext("Invalid mapping context: duplicate provenance id in the provenance registry.");
    }
    provenanceIds.add(record.provenanceId);
  }

  return { namespace, demographics, metrics, intentFocuses, provenanceRecords };
}

// ---------------------------------------------------------------------------
// Vocabulary resolution (internal helpers, fail-closed).
// ---------------------------------------------------------------------------

/** Resolves a concept code against the context's metric vocabulary (fail-closed). */
export function resolveConceptCode(conceptCode: string, context: FhirMappingContext): MetricVocabularyEntry {
  const entry = context.metrics.find((metric) => metric.conceptCode === conceptCode);
  if (entry === undefined) {
    throw new FhirMappingError(
      "unresolved-concept-code",
      "Unresolved concept code: the concept code is not registered in the mapping context's metric vocabulary (a mandatory FHIR code element cannot be invented — register the metric vocabulary entry).",
    );
  }
  return entry;
}

/** Resolves a metric id against the context's metric vocabulary (fail-closed). */
export function resolveMetricId(metricId: string, context: FhirMappingContext): MetricVocabularyEntry {
  const entry = context.metrics.find((metric) => metric.metricId === metricId);
  if (entry === undefined) {
    throw new FhirMappingError(
      "unresolved-metric",
      "Unresolved metric id: the metric id is not registered in the mapping context's metric vocabulary.",
    );
  }
  return entry;
}

/** Looks up the provenance record linked by a domain object (fail-closed: missing-provenance). */
export function requireProvenanceRecord(provenanceId: string, context: FhirMappingContext): ProvenanceRecordInput {
  const record = context.provenanceRecords.find((candidate) => candidate.provenanceId === provenanceId);
  if (record === undefined) {
    throw new FhirMappingError(
      "missing-provenance",
      "Missing provenance: the domain object's provenance record is not present in the mapping context's provenance registry (every observation and evidence object needs provenance — the linkage is fail-closed at the boundary).",
    );
  }
  return record;
}
