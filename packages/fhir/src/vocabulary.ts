/**
 * Local mirrors of the frozen @orbb/domain vocabularies + the ORBB SYNTH
 * identifier namespace.
 *
 * WHY LOCAL MIRRORS INSTEAD OF RUNTIME IMPORTS: the packet brief pins
 * "@orbb/domain — types only" for this package, so src/ performs
 * TYPE-ONLY imports of the domain shapes (see `compat.ts`) and mirrors
 * the frozen VALUE vocabularies here for runtime validation. Drift is
 * guarded mechanically: `test/invariant.test.ts` imports the REAL
 * frozen constants from @orbb/domain (and TASK_STATES /
 * COMPLETION_QUALITY_STATES from @orbb/measurement) at runtime and
 * asserts deep equality with these mirrors — the mirrors can never
 * silently diverge from the kernel.
 *
 * SYNTH NAMESPACE (RECORDED DECISION): ORBB has no production domain
 * yet; the only URL the repo already uses is the reserved-TLD test
 * origin `https://orbb.test` (@orbb/auth synthetic origins). The
 * boundary identifier namespace therefore defaults to
 * `https://orbb.test/synth` — a SYNTH-only namespace that can never
 * collide with a real host — and is deliberately configurable through
 * the mapping context so a future tech-lead decision can retarget it
 * without mapper changes.
 */

/** Default ORBB SYNTH namespace for boundary identifiers and vocabularies. */
export const ORBB_SYNTH_NAMESPACE = "https://orbb.test/synth";

/** Canonical id kinds mirrored from @orbb/domain `ID_PREFIXES` (frozen M0 list). */
export type IdKind =
  | "person"
  | "intent"
  | "observation"
  | "evidence"
  | "plan"
  | "task"
  | "grant"
  | "device"
  | "source"
  | "provenance";

/** Fixed kind prefixes mirrored from @orbb/domain (frozen M0 grammar). */
export const ID_PREFIXES: Readonly<Record<IdKind, string>> = {
  person: "prsn",
  intent: "intent",
  observation: "obs",
  evidence: "evid",
  plan: "plan",
  task: "task",
  grant: "grant",
  device: "dev",
  source: "src",
  provenance: "prov",
};

/** Valid body segment of a canonical id (16-128 URL-safe chars), mirrored from @orbb/domain. */
export const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a canonical id of the given kind? */
export function isIdOfKind(kind: IdKind, value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const prefix = ID_PREFIXES[kind];
  if (!value.startsWith(`${prefix}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(prefix.length + 1));
}

/** Measurement-lane local id prefixes (mirrored: attempt `mta_`, upload session `usess_`). */
export const ATTEMPT_ID_PREFIX = "mta";
export const UPLOAD_SESSION_ID_PREFIX = "usess";

/** Type guard: is `value` a measurement-attempt id (`mta_<body>`)? */
export function isAttemptId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${ATTEMPT_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(ATTEMPT_ID_PREFIX.length + 1));
}

/** Type guard: is `value` an upload-session id (`usess_<body>`)? */
export function isUploadSessionId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${UPLOAD_SESSION_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(UPLOAD_SESSION_ID_PREFIX.length + 1));
}

// ---------------------------------------------------------------------------
// Frozen domain vocabularies (mirrored exactly — drift-guarded by tests).
// ---------------------------------------------------------------------------

/** Evidence labels (frozen 4-label M0 vocabulary). */
export const EVIDENCE_LABELS = ["MEASURED", "ESTIMATED", "IMPORTED", "DERIVED"] as const;
export type EvidenceLabelValue = (typeof EVIDENCE_LABELS)[number];

/** Observation validation states (frozen M1 grammar). */
export const OBSERVATION_VALIDATION_STATES = [
  "pending",
  "validated",
  "rejected",
  "superseded",
] as const;
export type ObservationValidationStateValue = (typeof OBSERVATION_VALIDATION_STATES)[number];

/** Grant states (frozen M1 grammar: active -> revoked, terminal). */
export const GRANT_STATES = ["active", "revoked"] as const;
export type GrantStateValue = (typeof GRANT_STATES)[number];

/** Intent states (frozen M0 grammar). */
export const INTENT_STATES = ["draft", "active", "paused", "achieved", "retired"] as const;
export type IntentStateValue = (typeof INTENT_STATES)[number];

/** Measurement task states (mirrored from @orbb/measurement). */
export const TASK_STATES = ["open", "completed"] as const;
export type TaskStateValue = (typeof TASK_STATES)[number];

/** Attempt completion quality states (mirrored from @orbb/measurement). */
export const COMPLETION_QUALITY_STATES = ["complete", "partial", "low-quality"] as const;
export type CompletionQualityValue = (typeof COMPLETION_QUALITY_STATES)[number];

/** EvidenceObject lifecycle states (mirrored from @orbb/db contracts: only "active"). */
export const EVIDENCE_OBJECT_STATES = ["active"] as const;
export type EvidenceObjectStateValue = (typeof EVIDENCE_OBJECT_STATES)[number];

/** Provenance actor kinds derivable from the canonical actor id grammar. */
export const ACTOR_KINDS = ["person", "device", "source"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

// ---------------------------------------------------------------------------
// Namespace-derived system URIs.
// ---------------------------------------------------------------------------

/**
 * System URI for a canonical domain id kind under a namespace:
 * `<namespace>/id/<kind>` (e.g. `https://orbb.test/synth/id/person`).
 */
export function identifierSystem(namespace: string, kind: IdKind | ActorKind): string {
  return `${namespace}/id/${kind}`;
}

/**
 * System URI for an ORBB vocabulary under a namespace:
 * `<namespace>/vocab/<name>` (e.g. `https://orbb.test/synth/vocab/evidence-label`).
 */
export function vocabularySystem(namespace: string, name: string): string {
  return `${namespace}/vocab/${name}`;
}

/** Standard FHIR R4 system URIs used verbatim by the mapper (frozen constants). */
export const FHIR_STANDARD_SYSTEMS = {
  consentScope: "http://terminology.hl7.org/CodeSystem/consentscope",
  conditionClinicalStatus: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  conditionVerificationStatus: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
} as const;

/**
 * Derives the actor kind from a provenance actor id (the frozen domain
 * actor vocabulary is entity-kind-based: PersonId | DeviceId | SourceId).
 * Returns undefined when the id matches no canonical actor grammar.
 */
export function actorKindOf(actor: string): ActorKind | undefined {
  if (isIdOfKind("person", actor)) {
    return "person";
  }
  if (isIdOfKind("device", actor)) {
    return "device";
  }
  if (isIdOfKind("source", actor)) {
    return "source";
  }
  return undefined;
}
