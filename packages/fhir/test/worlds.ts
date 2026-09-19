/**
 * Deterministic SYNTH test worlds for @orbb/fhir (agent-protocol
 * test-data rules: every fixture is obviously synthetic, tagged
 * `synthetic: true`, and carries no PHI — no person names, no contact
 * strings, no free text; the intents' objective fields are SYNTH-marked
 * tokens, never prose).
 *
 * World A ("rich"): one person with the full clinical spread — a
 * validated quantity observation, a superseded/replacement amendment
 * pair, a pending code-valued observation, a rejected boolean-valued
 * observation, a completed task with two attempts (report "final"), an
 * open attempt-less task (report "registered"), two single-focus
 * intents (Conditions), one evidence object (DocumentReference), three
 * grants (Consents, incl. revoked and no-issuedAt), and the full
 * provenance set with explicit target assignments so the coverage
 * invariant passes.
 *
 * World B ("minimal"): one person, one provenance, NO grants — the
 * deny-by-default world (the domain evaluator decides DENY; the mapped
 * world contains zero Consent resources).
 */
import {
  createFhirMappingContext,
  type DemographicPort,
  type FhirMappingContext,
  type IntentFocusEntry,
  type MetricVocabularyEntry,
} from "../src/context.js";
import type {
  ConsentGrantInput,
  DiagnosticReportInput,
  EvidenceObjectInput,
  HealthIntentInput,
  ObservationInput,
  ProvenanceRecordInput,
} from "../src/inputs.js";
import type { FhirResource } from "../src/fhir.js";
import type { FhirProvenance } from "../src/fhir.js";
import { ORBB_SYNTH_NAMESPACE } from "../src/vocabulary.js";
import type { FhirResourceType } from "../src/fhirIds.js";
import { mapPatient } from "../src/patient.js";
import { mapObservation } from "../src/observation.js";
import { mapDiagnosticReport } from "../src/diagnosticReport.js";
import { mapCondition } from "../src/condition.js";
import { mapDocumentReference } from "../src/documentReference.js";
import { mapConsent } from "../src/consent.js";
import { mapProvenance } from "../src/provenance.js";
import { fhirResourceReference } from "../src/references.js";

/** Machine-checkable synthetic tag on every world. */
export interface WorldMetadata {
  readonly synthetic: true;
  readonly seed: string;
}

/** One mapped-resource target specification (world-side provenance linkage). */
export interface ProvenanceTargetSpec {
  readonly resourceType: FhirResourceType;
  readonly domainId: string;
}

/** A provenance record plus its target assignments. */
export interface WorldProvenance {
  readonly record: ProvenanceRecordInput;
  readonly targets: readonly ProvenanceTargetSpec[];
}

/** A SYNTH world: pure fixture data, no behavior. */
export interface SynthWorld {
  readonly metadata: WorldMetadata;
  readonly personIds: readonly string[];
  readonly metrics: readonly MetricVocabularyEntry[];
  readonly intentFocuses: readonly IntentFocusEntry[];
  readonly provenance: readonly WorldProvenance[];
  readonly observations: readonly ObservationInput[];
  readonly intents: readonly HealthIntentInput[];
  readonly reports: readonly DiagnosticReportInput[];
  readonly evidence: readonly EvidenceObjectInput[];
  readonly grants: readonly ConsentGrantInput[];
}

// ---------------------------------------------------------------------------
// Shared SYNTH vocabulary (engine-seed aligned: the M4 metric ids,
// concept codes, units, categories, and method codes carry the SYNTH-
// marker convention; displays mirror the seed vocabulary).
// ---------------------------------------------------------------------------

const METRIC_SYSTEM = `${ORBB_SYNTH_NAMESPACE}/vocab/metric-code`;
const CATEGORY_SYSTEM = `${ORBB_SYNTH_NAMESPACE}/vocab/metric-category`;

export const WORLD_METRIC_VOCABULARY: readonly MetricVocabularyEntry[] = [
  {
    metricId: "SYNTH-metric-heart-rate",
    conceptCode: "SYNTH-8867-4",
    conceptSystem: METRIC_SYSTEM,
    display: "Heart Rate",
    category: "vital-signs",
    categorySystem: CATEGORY_SYSTEM,
  },
  {
    metricId: "SYNTH-metric-bp-systolic",
    conceptCode: "SYNTH-8480-5",
    conceptSystem: METRIC_SYSTEM,
    display: "Systolic Blood Pressure",
    category: "vital-signs",
    categorySystem: CATEGORY_SYSTEM,
  },
  {
    metricId: "SYNTH-metric-body-weight",
    conceptCode: "SYNTH-29463-7",
    conceptSystem: METRIC_SYSTEM,
    display: "Body Weight",
    category: "body-composition",
    categorySystem: CATEGORY_SYSTEM,
  },
  {
    metricId: "SYNTH-metric-activity-intensity",
    conceptCode: "SYNTH-83299-0",
    conceptSystem: METRIC_SYSTEM,
    display: "Activity Intensity",
    category: "activity",
    categorySystem: CATEGORY_SYSTEM,
  },
  {
    metricId: "SYNTH-metric-exercise-completed",
    conceptCode: "SYNTH-83471-4",
    conceptSystem: METRIC_SYSTEM,
    display: "Exercise Completed",
    category: "activity",
    categorySystem: CATEGORY_SYSTEM,
  },
];

// Fixed SYNTH identifiers (grammar-compliant, obviously synthetic).
const PERSON_1 = "prsn_SYNTH000000000001";
const PERSON_2 = "prsn_SYNTH000000000002";
const SOURCE_1 = "src_SYNTH000000000001";
const SOURCE_2 = "src_SYNTH000000000002";
const DEVICE_1 = "dev_SYNTH000000000001";
const PLAN_1 = "plan_SYNTH000000000001";
const INTENT_1 = "intent_SYNTH000000000001";
const INTENT_2 = "intent_SYNTH000000000002";
const OBS_A = "obs_SYNTH00000000000A";
const OBS_B = "obs_SYNTH00000000000B";
const OBS_C = "obs_SYNTH00000000000C";
const OBS_D = "obs_SYNTH00000000000D";
const OBS_E = "obs_SYNTH00000000000E";
const OBS_F = "obs_SYNTH00000000000F";
const TASK_1 = "task_SYNTH000000000001";
const TASK_2 = "task_SYNTH000000000002";
const ATTEMPT_1 = "mta_SYNTH000000000001";
const ATTEMPT_2 = "mta_SYNTH000000000002";
const EVIDENCE_1 = "evid_SYNTH000000000001";
const GRANT_1 = "grant_SYNTH000000000001";
const GRANT_2 = "grant_SYNTH000000000002";
const GRANT_3 = "grant_SYNTH000000000003";
const SESSION_1 = "usess_SYNTH000000000001";

/** The fixed SYNTH sha256 digest of World A's evidence bytes (all-zero except the last byte). */
export const WORLD_EVIDENCE_SHA256 =
  "00000000000000000000000000000000000000000000000000000000000000ff";

const OBJECT_KEY_1 = `evidence/v1/${EVIDENCE_1}/${WORLD_EVIDENCE_SHA256}`;

function iso(value: string): Date {
  return new Date(value);
}

// ---------------------------------------------------------------------------
// World A (rich).
// ---------------------------------------------------------------------------

const worldAObservations: readonly ObservationInput[] = [
  {
    id: OBS_A,
    personId: PERSON_1,
    conceptCode: "SYNTH-8867-4",
    value: 72,
    unit: "beats/min",
    effectiveAt: iso("2026-01-06T08:15:00.000Z"),
    observedAt: iso("2026-01-06T08:20:00.000Z"),
    sourceId: SOURCE_1,
    methodId: "SYNTH-method-hr-wearable",
    evidenceId: EVIDENCE_1,
    quality: 0.92,
    validationState: "validated",
    provenanceId: "prov_SYNTH000000000003",
    evidenceLabel: "MEASURED",
  },
  {
    id: OBS_B,
    personId: PERSON_1,
    conceptCode: "SYNTH-8480-5",
    value: 118,
    unit: "mmHg",
    effectiveAt: iso("2026-01-05T07:30:00.000Z"),
    observedAt: iso("2026-01-05T07:31:00.000Z"),
    sourceId: SOURCE_1,
    methodId: "SYNTH-method-bpsys-manual",
    quality: 0.88,
    validationState: "superseded",
    provenanceId: "prov_SYNTH000000000004",
    evidenceLabel: "MEASURED",
  },
  {
    id: OBS_C,
    personId: PERSON_1,
    conceptCode: "SYNTH-8480-5",
    value: 116,
    unit: "mmHg",
    effectiveAt: iso("2026-01-05T07:30:00.000Z"),
    observedAt: iso("2026-01-05T07:45:00.000Z"),
    sourceId: SOURCE_1,
    methodId: "SYNTH-method-bpsys-manual",
    quality: 0.95,
    validationState: "validated",
    provenanceId: "prov_SYNTH000000000005",
    evidenceLabel: "MEASURED",
    supersedesId: OBS_B,
  },
  {
    id: OBS_D,
    personId: PERSON_1,
    conceptCode: "SYNTH-83299-0",
    value: "moderate",
    unit: "",
    effectiveAt: iso("2026-01-07T18:00:00.000Z"),
    observedAt: iso("2026-01-07T19:05:00.000Z"),
    sourceId: SOURCE_1,
    methodId: "SYNTH-method-activity-app",
    quality: 0.75,
    validationState: "pending",
    provenanceId: "prov_SYNTH000000000006",
    evidenceLabel: "ESTIMATED",
  },
  {
    id: OBS_E,
    personId: PERSON_1,
    conceptCode: "SYNTH-83471-4",
    value: true,
    unit: "",
    effectiveAt: iso("2026-01-08T06:45:00.000Z"),
    observedAt: iso("2026-01-08T06:50:00.000Z"),
    sourceId: SOURCE_1,
    methodId: "SYNTH-method-exercise-watch",
    quality: 0.6,
    validationState: "rejected",
    provenanceId: "prov_SYNTH000000000007",
    evidenceLabel: "DERIVED",
  },
  {
    id: OBS_F,
    personId: PERSON_1,
    conceptCode: "SYNTH-8867-4",
    value: 71,
    unit: "beats/min",
    effectiveAt: iso("2026-01-06T08:10:00.000Z"),
    observedAt: iso("2026-01-06T08:16:00.000Z"),
    sourceId: SOURCE_1,
    methodId: "SYNTH-method-hr-wearable",
    quality: 0.4,
    validationState: "validated",
    provenanceId: "prov_SYNTH000000000002",
    evidenceLabel: "MEASURED",
  },
];

const worldAReports: readonly DiagnosticReportInput[] = [
  {
    task: {
      id: TASK_1,
      planId: PLAN_1,
      personId: PERSON_1,
      metricId: "SYNTH-metric-heart-rate",
      conceptCode: "SYNTH-8867-4",
      methodOrder: ["SYNTH-method-hr-wearable", "SYNTH-method-hr-manual"],
      window: {
        sequence: 3,
        startsAt: iso("2026-01-06T00:00:00.000Z"),
        endsAt: iso("2026-01-06T12:00:00.000Z"),
      },
      state: "completed",
      createdAt: iso("2026-01-06T00:00:05.000Z"),
      rollCount: 0,
    },
    attempts: [
      {
        id: ATTEMPT_1,
        taskId: TASK_1,
        personId: PERSON_1,
        metricId: "SYNTH-metric-heart-rate",
        observationId: OBS_F,
        methodId: "SYNTH-method-hr-wearable",
        quality: 0.4,
        completionState: "partial",
        recordedAt: iso("2026-01-06T08:16:30.000Z"),
        provenanceId: "prov_SYNTH000000000015",
      },
      {
        id: ATTEMPT_2,
        taskId: TASK_1,
        personId: PERSON_1,
        metricId: "SYNTH-metric-heart-rate",
        observationId: OBS_A,
        methodId: "SYNTH-method-hr-wearable",
        quality: 0.92,
        completionState: "complete",
        recordedAt: iso("2026-01-06T08:21:00.000Z"),
        provenanceId: "prov_SYNTH000000000016",
      },
    ],
  },
  {
    task: {
      id: TASK_2,
      planId: PLAN_1,
      personId: PERSON_1,
      metricId: "SYNTH-metric-bp-systolic",
      conceptCode: "SYNTH-8480-5",
      methodOrder: ["SYNTH-method-bpsys-cuff"],
      window: {
        sequence: 4,
        startsAt: iso("2026-01-09T00:00:00.000Z"),
        endsAt: iso("2026-01-09T12:00:00.000Z"),
      },
      state: "open",
      createdAt: iso("2026-01-09T00:00:05.000Z"),
      rollCount: 1,
    },
    attempts: [],
  },
];

const worldAIntents: readonly HealthIntentInput[] = [
  {
    id: INTENT_1,
    personId: PERSON_1,
    objective: "SYNTH-objective-resting-heart-rate-goal",
    state: "active",
    createdAt: iso("2026-01-02T09:05:00.000Z"),
    evidencePackVersion: 1,
    planId: PLAN_1,
  },
  {
    id: INTENT_2,
    personId: PERSON_1,
    objective: "SYNTH-objective-body-weight-goal",
    state: "achieved",
    createdAt: iso("2026-01-03T10:00:00.000Z"),
    evidencePackVersion: 2,
  },
];

const worldAEvidence: readonly EvidenceObjectInput[] = [
  {
    id: EVIDENCE_1,
    personId: PERSON_1,
    objectKey: OBJECT_KEY_1,
    mediaType: "image/png",
    sha256: WORLD_EVIDENCE_SHA256,
    sizeBytes: 2048,
    capturedAt: iso("2026-01-04T11:10:00.000Z"),
    sourceType: "manual-capture",
    provenanceId: "prov_SYNTH000000000012",
    retentionClass: "original",
    state: "active",
    createdAt: iso("2026-01-04T11:12:00.000Z"),
    sessionId: SESSION_1,
  },
];

const worldAGrants: readonly ConsentGrantInput[] = [
  {
    id: GRANT_1,
    subjectId: PERSON_1,
    recipientId: "SYNTH-Recipient-CareTeam-0001",
    purpose: "SYNTH-CARE_MANAGEMENT",
    scope: ["observations:read", "intent:read"],
    state: "active",
    issuedAt: iso("2026-01-02T10:00:00.000Z"),
    expiresAt: iso("2026-06-30T23:59:59.000Z"),
  },
  {
    id: GRANT_2,
    subjectId: PERSON_1,
    recipientId: "SYNTH-Recipient-Research-0002",
    purpose: "SYNTH-RESEARCH",
    scope: ["evidence:read"],
    state: "revoked",
    issuedAt: iso("2026-01-02T10:30:00.000Z"),
    expiresAt: iso("2026-03-31T23:59:59.000Z"),
  },
  {
    id: GRANT_3,
    subjectId: PERSON_1,
    recipientId: "SYNTH-Recipient-Clinic-0003",
    purpose: "SYNTH-TREATMENT",
    scope: ["observations:read"],
    state: "active",
    expiresAt: iso("2026-12-31T23:59:59.000Z"),
  },
];

const worldAProvenance: readonly WorldProvenance[] = [
  {
    record: {
      provenanceId: "prov_SYNTH000000000001",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-02T09:00:00.000Z"),
      correlationId: "SYNTH-correlation-0001",
    },
    targets: [{ resourceType: "Patient", domainId: PERSON_1 }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000002",
      actor: SOURCE_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-06T08:16:00.000Z"),
    },
    targets: [{ resourceType: "Observation", domainId: OBS_F }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000003",
      actor: DEVICE_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-06T08:20:00.000Z"),
    },
    targets: [{ resourceType: "Observation", domainId: OBS_A }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000004",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-05T07:31:00.000Z"),
    },
    targets: [{ resourceType: "Observation", domainId: OBS_B }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000005",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-05T07:45:00.000Z"),
    },
    targets: [{ resourceType: "Observation", domainId: OBS_C }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000006",
      actor: SOURCE_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-07T19:05:00.000Z"),
    },
    targets: [{ resourceType: "Observation", domainId: OBS_D }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000007",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-08T06:50:00.000Z"),
    },
    targets: [{ resourceType: "Observation", domainId: OBS_E }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000012",
      actor: SOURCE_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-04T11:12:00.000Z"),
    },
    targets: [{ resourceType: "DocumentReference", domainId: EVIDENCE_1 }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000013",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-02T10:00:00.000Z"),
    },
    targets: [{ resourceType: "Consent", domainId: GRANT_1 }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000014",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-02T10:30:00.000Z"),
      causationId: "SYNTH-causation-0001",
    },
    targets: [{ resourceType: "Consent", domainId: GRANT_2 }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000015",
      actor: SOURCE_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-06T08:16:30.000Z"),
    },
    targets: [{ resourceType: "Observation", domainId: OBS_F }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000016",
      actor: SOURCE_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-06T08:21:00.000Z"),
    },
    targets: [
      { resourceType: "Observation", domainId: OBS_A },
      { resourceType: "DiagnosticReport", domainId: TASK_1 },
    ],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000017",
      actor: SOURCE_2,
      subject: PERSON_1,
      occurredAt: iso("2026-01-09T00:00:05.000Z"),
    },
    targets: [{ resourceType: "DiagnosticReport", domainId: TASK_2 }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000018",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-02T09:05:00.000Z"),
    },
    targets: [{ resourceType: "Condition", domainId: INTENT_1 }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000019",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-03T10:00:00.000Z"),
    },
    targets: [{ resourceType: "Condition", domainId: INTENT_2 }],
  },
  {
    record: {
      provenanceId: "prov_SYNTH000000000020",
      actor: PERSON_1,
      subject: PERSON_1,
      occurredAt: iso("2026-01-02T11:00:00.000Z"),
    },
    targets: [{ resourceType: "Consent", domainId: GRANT_3 }],
  },
];

/** World A (rich): the full clinical spread. */
export const WORLD_A: SynthWorld = {
  metadata: { synthetic: true, seed: "fhir-world-a" },
  personIds: [PERSON_1],
  metrics: WORLD_METRIC_VOCABULARY,
  intentFocuses: [
    { intentId: INTENT_1, metricIds: ["SYNTH-metric-heart-rate"] },
    { intentId: INTENT_2, metricIds: ["SYNTH-metric-body-weight"] },
  ],
  provenance: worldAProvenance,
  observations: worldAObservations,
  intents: worldAIntents,
  reports: worldAReports,
  evidence: worldAEvidence,
  grants: worldAGrants,
};

// ---------------------------------------------------------------------------
// World B (minimal, grantless — the deny-by-default world).
// ---------------------------------------------------------------------------

/** World B (minimal): one person, one provenance, NO grants. */
export const WORLD_B: SynthWorld = {
  metadata: { synthetic: true, seed: "fhir-world-b" },
  personIds: [PERSON_2],
  metrics: WORLD_METRIC_VOCABULARY,
  intentFocuses: [],
  provenance: [
    {
      record: {
        provenanceId: "prov_SYNTH000000000101",
        actor: PERSON_2,
        subject: PERSON_2,
        occurredAt: iso("2026-02-01T09:00:00.000Z"),
      },
      targets: [{ resourceType: "Patient", domainId: PERSON_2 }],
    },
  ],
  observations: [],
  intents: [],
  reports: [],
  evidence: [],
  grants: [],
};

// ---------------------------------------------------------------------------
// The deliberate demographic port (the ONLY non-default-port fixture).
// ---------------------------------------------------------------------------

/**
 * A pure lookup disclosing SYNTH-marked demographics for exactly one
 * person (the privacy-first Patient proofs use the default NO_DEMOGRAPHICS
 * port; this port is the deliberate-disclosure counterproof — every
 * disclosed value is SYNTH-marked, never real-looking).
 */
export const SYNTH_DEMOGRAPHIC_PORT: DemographicPort = {
  demographicsFor: (personId: string) => {
    if (personId !== WORLD_A_IDS.PERSON_1) {
      return undefined;
    }
    return {
      name: [{ family: "SYNTH-Family-0001", given: ["SYNTH-Given-0001"] }],
      birthDate: "1990-01-01",
      gender: "unknown" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// World -> context + mapped output helpers.
// ---------------------------------------------------------------------------

/** The mapping context for a world (its vocabulary, focuses, and provenance registry). */
export function worldContext(world: SynthWorld): FhirMappingContext {
  return createFhirMappingContext({
    metrics: world.metrics,
    intentFocuses: world.intentFocuses,
    provenanceRecords: world.provenance.map((entry) => entry.record),
  });
}

/** The full mapped output of a world: clinical resources + provenance resources. */
export interface MappedWorld {
  readonly resources: readonly FhirResource[];
  readonly provenances: readonly FhirProvenance[];
}

/** Maps every fixture of a world through the seven mappers (pure, deterministic). */
export function mapWorld(world: SynthWorld, context: FhirMappingContext): MappedWorld {
  const patients = world.personIds.map((personId) => mapPatient(personId, context));
  const observations = world.observations.map((observation) =>
    mapObservation(observation, context),
  );
  const reports = world.reports.map((input) => mapDiagnosticReport(input, context));
  const conditions = world.intents.map((intent) => mapCondition(intent, context));
  const documents = world.evidence.map((evidence) => mapDocumentReference(evidence, context));
  const consents = world.grants.map((grant) => mapConsent(grant, context));
  const provenances = world.provenance.map(({ record, targets }) =>
    mapProvenance(
      record,
      targets.map((target) => fhirResourceReference(target.resourceType, target.domainId, context)),
      context,
    ),
  );
  return {
    resources: [...patients, ...observations, ...reports, ...conditions, ...documents, ...consents],
    provenances,
  };
}

// ---------------------------------------------------------------------------
// World (de)serialization — the "serialized re-instantiation" determinism
// proof: a world survives a JSON round-trip (dates as ISO strings) and
// maps to byte-identical output.
// ---------------------------------------------------------------------------

const DATE_KEYS = new Set([
  "effectiveAt",
  "observedAt",
  "createdAt",
  "expiresAt",
  "issuedAt",
  "capturedAt",
  "occurredAt",
  "startsAt",
  "endsAt",
  "recordedAt",
  "finalizedAt",
]);

function reviveDates(key: string, value: unknown): unknown {
  if (DATE_KEYS.has(key) && typeof value === "string") {
    return new Date(value);
  }
  return value;
}

/** Serializes a world to JSON (Dates become ISO strings — toJSON). */
export function serializeWorld(world: SynthWorld): string {
  return JSON.stringify(world);
}

/** Re-instantiates a world from its serialized form (Date revival by key). */
export function reviveWorld(json: string): SynthWorld {
  return JSON.parse(json, reviveDates) as SynthWorld;
}

// Exposed SYNTH identifiers for cross-test assertions.
export const WORLD_A_IDS = {
  PERSON_1,
  PERSON_2,
  SOURCE_1,
  DEVICE_1,
  PLAN_1,
  INTENT_1,
  INTENT_2,
  OBS_A,
  OBS_B,
  OBS_C,
  OBS_D,
  OBS_E,
  OBS_F,
  TASK_1,
  TASK_2,
  ATTEMPT_1,
  ATTEMPT_2,
  EVIDENCE_1,
  GRANT_1,
  GRANT_2,
  GRANT_3,
  SESSION_1,
} as const;
