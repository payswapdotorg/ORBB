/**
 * @orbb/db Drizzle (PostgreSQL) schema — A14.
 *
 * Architecture mapping (frozen):
 *   - §5 core schemas: Person/Account (Identity family), HealthIntent,
 *     Observation (+ M1 supersession `supersedes_id`), EvidenceObject,
 *     MeasurementPlan, AccessGrant, AccessAudit (append-only).
 *   - §4 transactional outbox: `outbox` rows written in the SAME
 *     transaction as domain state (see `db.ts`).
 *   - §3 API style: opaque domain ids (`prsn_`, `obs_`, …) are the
 *     primary keys — there are NO serial/integer row ids anywhere, so
 *     cursor pagination over (created_at, id) can never leak a raw
 *     database row id (there is none to leak).
 *   - §6 DataBox: every object row carries its opaque object key and
 *     content digest; `object_key` is unique (content addressing).
 *
 * Recorded design decisions:
 *   - IDs are `text` (the domain id grammar), PRIMARY KEY, with a
 *     regex CHECK carrying the frozen `<prefix>_<body>` grammar into
 *     the database itself.
 *   - Enums are `text` + CHECK constraints (NOT pg enums): adding a
 *     vocabulary value later is a constraint swap under expand/contract,
 *     not an ALTER TYPE migration. Vocabulary values are derived from
 *     the frozen constants in @orbb/domain and @orbb/contracts.
 *   - Timestamps are `timestamptz` (`mode: "date"`); `created_at` is
 *     stamped by the repository layer from the injected clock and is
 *     the pagination anchor for every table.
 *   - `health_intents.plan_id` is deliberately WITHOUT a foreign key:
 *     `measurement_plans.intent_id` already carries the intents-side
 *     FK, and a second FK would create a circular dependency between
 *     the two CREATE TABLE statements. The column still carries the
 *     canonical `plan_` grammar CHECK (handoff: a follow-up migration
 *     may add the FK once both tables exist — expand-safe).
 *   - `observations.value` is `jsonb` storing a WRAPPED primitive
 *     `{ "v": string | number | boolean }`. The wrapper is deliberate:
 *     Drizzle's jsonb mapping re-parses any driver value that arrives
 *     as a bare string (both postgres.js and PGlite deliver jsonb
 *     PRE-parsed), which silently converts a stored string "72" into
 *     the number 72 — the wrapper makes the driver value an object and
 *     the round-trip type-exact. The CHECK constraint pins the union
 *     on the inner `v` field (jsonb_typeof).
 *   - `provenances` exists because `observations.provenance_id` and
 *     `evidence_objects.provenance_id` reference it and the
 *     architecture rule "every observation needs provenance" is only
 *     enforceable when the referenced records have a home (the packet
 *     table list does not name it; recorded assumption).
 *   - `idempotency_ledger` backs the idempotency-key semantics of
 *     every mutating repository method (§3 "idempotency keys for every
 *     mutating endpoint"): (table, operation, key) is claimed inside
 *     the SAME transaction as the mutation.
 *   - `access_audits` is append-only at THREE levels: the repository
 *     surface exposes no update/delete, a database trigger (migration
 *     0001) rejects UPDATE/DELETE/TRUNCATE, and no cascade path exists.
 *   - M2-D (Lane A): `upload_sessions` mirrors @orbb/databox's frozen
 *     `UploadSessionRecord` field-for-field (create-before-publication;
 *     `evidence_id` is UNIQUE — a session fixes its EvidenceObject id at
 *     creation, so the session↔evidence mapping is one-to-one by
 *     construction). `evidence_objects` gains the M2-C upload-plane
 *     columns recorded as the M2-A handoff: `session_id` (nullable, and
 *     UNIQUE when present via a partial index — legacy rows and non-
 *     upload ingestion paths carry none) and `encrypted_metadata`
 *     (nullable jsonb holding the base64-serialized envelope; see
 *     `evidence-envelope.ts`). The session's `purpose`/`scope` are
 *     stored as defined by the frozen databox interface (pre-publication
 *     session state); on the FINALIZED EvidenceObject they exist only
 *     inside the envelope (M2-C recorded decision — "record what you
 *     encrypt").
 */
import {
  EVIDENCE_LABELS,
  GRANT_STATES,
  INTENT_STATES,
  OBSERVATION_VALIDATION_STATES,
  PLAN_STATES,
  type EvidenceLabel,
  type EvidenceId,
  type GrantId,
  type GrantState,
  type IntentId,
  type IntentState,
  type ObservationId,
  type ObservationValue,
  type ObservationValidationState,
  type PersonId,
  type PlanId,
  type PlanState,
  type ProvenanceId,
  type SourceId,
} from "@orbb/domain";
import type { UploadSessionId, UploadSessionState } from "@orbb/databox";
import { DOMAIN_EVENT_TYPES, OUTBOX_STATUSES, type DomainEventType, type EventId, type OutboxStatus } from "@orbb/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { StoredEncryptedEnvelope } from "./evidence-envelope.js";
import type { AccountId, AuditId } from "./contracts.js";

// ---------------------------------------------------------------------------
// Upload-session lifecycle vocabulary (M2-D). Pinned against the frozen
// @orbb/databox `UploadSessionState` union so the SQL CHECK and the
// interface can never drift (a unit test re-asserts the generated SQL).
// ---------------------------------------------------------------------------

/** Lifecycle states of an upload session (mirrors @orbb/databox). */
export const UPLOAD_SESSION_STATES = ["open", "finalized"] as const satisfies readonly UploadSessionState[];

// ---------------------------------------------------------------------------
// Check-constraint builders.
//
// Values are compile-time-known safe ASCII identifiers coming from the
// frozen @orbb/domain and @orbb/contracts vocabularies (they contain no
// single quotes or backslashes), so raw interpolation into the CHECK
// expression is safe and keeps a single source of truth for every
// vocabulary (a unit test re-asserts the schema against the constants
// so drift is impossible in either direction).
// ---------------------------------------------------------------------------

const ID_BODY = "[A-Za-z0-9_-]{16,128}";

function idGrammarCheck(table: string, column: string, prefix: string): ReturnType<typeof check> {
  return check(
    `${table}_${column}_grammar`,
    sql.raw(`"${table}"."${column}" ~ '^${prefix}_${ID_BODY}$'`),
  );
}

function vocabularyCheck(table: string, column: string, values: readonly string[]): ReturnType<typeof check> {
  const csv = values.map((value) => `'${value}'`).join(", ");
  return check(
    `${table}_${column}_vocabulary`,
    sql.raw(`"${table}"."${column}" in (${csv})`),
  );
}

function rawCheck(name: string, expression: string): ReturnType<typeof check> {
  return check(name, sql.raw(expression));
}

// ---------------------------------------------------------------------------
// Identity family (architecture §5): Person + Account.
// ---------------------------------------------------------------------------

export const persons = pgTable("persons", {
  id: text("id").$type<PersonId>().primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, () => [
  idGrammarCheck("persons", "id", "prsn"),
  rawCheck("persons_display_name_nonempty", `"persons"."display_name" <> ''`),
]);

export const accounts = pgTable("accounts", {
  id: text("id").$type<AccountId>().primaryKey(),
  personId: text("person_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  idGrammarCheck("accounts", "id", "acct"),
  idGrammarCheck("accounts", "person_id", "prsn"),
  index("idx_accounts_person_created").on(t.personId, t.createdAt, t.id),
]);

// ---------------------------------------------------------------------------
// Provenance (domain Provenance primitive — prov_).
// ---------------------------------------------------------------------------

export const provenances = pgTable("provenances", {
  id: text("id").$type<ProvenanceId>().primaryKey(),
  actor: text("actor").$type<string>().notNull(),
  subject: text("subject").$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  causationId: text("causation_id"),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  idGrammarCheck("provenances", "id", "prov"),
  rawCheck(
    "provenances_actor_grammar",
    `"provenances"."actor" ~ '^(prsn|dev|src)_${ID_BODY}$'`,
  ),
  idGrammarCheck("provenances", "subject", "prsn"),
  rawCheck("provenances_causation_nonempty", `"provenances"."causation_id" is null or "provenances"."causation_id" <> ''`),
  rawCheck("provenances_correlation_nonempty", `"provenances"."correlation_id" is null or "provenances"."correlation_id" <> ''`),
  index("idx_provenances_subject_created").on(t.subject, t.createdAt, t.id),
]);

// ---------------------------------------------------------------------------
// HealthIntent (architecture §5, frozen state grammar).
// ---------------------------------------------------------------------------

export const healthIntents = pgTable("health_intents", {
  id: text("id").$type<IntentId>().primaryKey(),
  personId: text("person_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  objective: text("objective").notNull(),
  state: text("state").$type<IntentState>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  evidencePackVersion: integer("evidence_pack_version"),
  // Soft reference (grammar-checked, no FK — see module docs).
  planId: text("plan_id").$type<PlanId>(),
}, (t) => [
  idGrammarCheck("health_intents", "id", "intent"),
  idGrammarCheck("health_intents", "person_id", "prsn"),
  idGrammarCheck("health_intents", "plan_id", "plan"),
  vocabularyCheck("health_intents", "state", INTENT_STATES),
  rawCheck("health_intents_objective_nonempty", `"health_intents"."objective" <> ''`),
  rawCheck("health_intents_evidence_pack_version_positive", `"health_intents"."evidence_pack_version" is null or "health_intents"."evidence_pack_version" >= 1`),
  index("idx_health_intents_person_created").on(t.personId, t.createdAt, t.id),
]);

// ---------------------------------------------------------------------------
// EvidenceObject (architecture §5/§6: opaque object key + content digest).
// ---------------------------------------------------------------------------

export const evidenceObjects = pgTable("evidence_objects", {
  id: text("id").$type<EvidenceId>().primaryKey(),
  personId: text("person_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  objectKey: text("object_key").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
  sourceType: text("source_type").notNull(),
  provenanceId: text("provenance_id")
    .$type<ProvenanceId>()
    .notNull()
    .references(() => provenances.id),
  retentionClass: text("retention_class").notNull(),
  state: text("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  // M2-D (Lane A) upload-plane columns — nullable: legacy rows and
  // non-upload ingestion paths carry neither.
  sessionId: text("session_id").$type<UploadSessionId>(),
  encryptedMetadata: jsonb("encrypted_metadata").$type<StoredEncryptedEnvelope>(),
}, (t) => [
  idGrammarCheck("evidence_objects", "id", "evid"),
  idGrammarCheck("evidence_objects", "person_id", "prsn"),
  idGrammarCheck("evidence_objects", "provenance_id", "prov"),
  rawCheck("evidence_objects_sha256_hex", `"evidence_objects"."sha256" ~ '^[0-9a-f]{64}$'`),
  rawCheck("evidence_objects_size_nonnegative", `"evidence_objects"."size_bytes" >= 0`),
  rawCheck("evidence_objects_state_vocabulary", `"evidence_objects"."state" in ('active')`),
  rawCheck("evidence_objects_media_type_nonempty", `"evidence_objects"."media_type" <> ''`),
  rawCheck("evidence_objects_object_key_nonempty", `"evidence_objects"."object_key" <> ''`),
  rawCheck("evidence_objects_source_type_nonempty", `"evidence_objects"."source_type" <> ''`),
  rawCheck("evidence_objects_retention_class_nonempty", `"evidence_objects"."retention_class" <> ''`),
  rawCheck(
    "evidence_objects_session_id_grammar",
    `"evidence_objects"."session_id" is null or "evidence_objects"."session_id" ~ '^usess_${ID_BODY}$'`,
  ),
  rawCheck(
    "evidence_objects_encrypted_metadata_shape",
    `"evidence_objects"."encrypted_metadata" is null or (jsonb_typeof("evidence_objects"."encrypted_metadata") = 'object' and ("evidence_objects"."encrypted_metadata" ? 'algorithm') and ("evidence_objects"."encrypted_metadata" ? 'ciphertext') and ("evidence_objects"."encrypted_metadata" ? 'wrappedKey') and ("evidence_objects"."encrypted_metadata" ? 'iv') and ("evidence_objects"."encrypted_metadata" ? 'tag') and ("evidence_objects"."encrypted_metadata" ? 'context'))`,
  ),
  unique("uq_evidence_objects_object_key").on(t.objectKey),
  // One finalized EvidenceObject per upload session (partial: legacy
  // rows with NULL session_id are exempt — NULLs never collide).
  uniqueIndex("uq_evidence_objects_session")
    .on(t.sessionId)
    .where(sql`"evidence_objects"."session_id" is not null`),
  index("idx_evidence_objects_person_created").on(t.personId, t.createdAt, t.id),
  index("idx_evidence_objects_sha256").on(t.sha256),
]);

// ---------------------------------------------------------------------------
// Upload sessions (M2-D Lane A, §6 raw-object upload flow): the
// pre-publication metadata record for one direct-to-store upload.
// ---------------------------------------------------------------------------

export const uploadSessions = pgTable("upload_sessions", {
  sessionId: text("session_id").$type<UploadSessionId>().primaryKey(),
  /** EvidenceObject id fixed at session creation (idempotency anchor). */
  evidenceId: text("evidence_id")
    .$type<EvidenceId>()
    .notNull(),
  personId: text("person_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  /** Opaque content-addressed key (`evidence/v1/<id>/<sha256>`). */
  objectKey: text("object_key").notNull(),
  mediaType: text("media_type").notNull(),
  declaredSha256: text("declared_sha256").notNull(),
  declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
  /** Purpose of collection the upload was authorized under. */
  purpose: text("purpose").notNull(),
  /** Scope tokens the upload was authorized under. */
  scope: text("scope").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  state: text("state").$type<UploadSessionState>().notNull(),
  /** Present iff state is "finalized" (CHECK-enforced). */
  finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  idGrammarCheck("upload_sessions", "session_id", "usess"),
  idGrammarCheck("upload_sessions", "evidence_id", "evid"),
  idGrammarCheck("upload_sessions", "person_id", "prsn"),
  vocabularyCheck("upload_sessions", "state", UPLOAD_SESSION_STATES),
  rawCheck("upload_sessions_declared_sha256_hex", `"upload_sessions"."declared_sha256" ~ '^[0-9a-f]{64}$'`),
  rawCheck("upload_sessions_declared_size_nonnegative", `"upload_sessions"."declared_size_bytes" >= 0`),
  rawCheck("upload_sessions_object_key_nonempty", `"upload_sessions"."object_key" <> ''`),
  rawCheck("upload_sessions_media_type_nonempty", `"upload_sessions"."media_type" <> ''`),
  rawCheck("upload_sessions_purpose_nonempty", `"upload_sessions"."purpose" <> ''`),
  rawCheck("upload_sessions_scope_nonempty", `array_length("upload_sessions"."scope", 1) > 0`),
  rawCheck(
    "upload_sessions_finalized_at_present",
    `"upload_sessions"."state" <> 'finalized' or "upload_sessions"."finalized_at" is not null`,
  ),
  unique("uq_upload_sessions_evidence").on(t.evidenceId),
  index("idx_upload_sessions_person_created").on(t.personId, t.createdAt, t.sessionId),
  index("idx_upload_sessions_state_expires").on(t.state, t.expiresAt),
]);

// ---------------------------------------------------------------------------
// Observation (architecture §5 + M1 supersession).
// ---------------------------------------------------------------------------

export const observations = pgTable("observations", {
  id: text("id").$type<ObservationId>().primaryKey(),
  personId: text("person_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  conceptCode: text("concept_code").notNull(),
  value: jsonb("value").$type<{ readonly v: ObservationValue }>().notNull(),
  unit: text("unit").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
  sourceId: text("source_id").$type<SourceId>().notNull(),
  methodId: text("method_id").notNull(),
  evidenceId: text("evidence_id")
    .$type<EvidenceId>()
    .references(() => evidenceObjects.id),
  quality: doublePrecision("quality"),
  validationState: text("validation_state").$type<ObservationValidationState>().notNull(),
  provenanceId: text("provenance_id")
    .$type<ProvenanceId>()
    .notNull()
    .references(() => provenances.id),
  evidenceLabel: text("evidence_label").$type<EvidenceLabel>().notNull(),
  supersedesId: text("supersedes_id")
    .$type<ObservationId>()
    .references((): AnyPgColumn => observations.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  idGrammarCheck("observations", "id", "obs"),
  idGrammarCheck("observations", "person_id", "prsn"),
  idGrammarCheck("observations", "source_id", "src"),
  idGrammarCheck("observations", "provenance_id", "prov"),
  idGrammarCheck("observations", "supersedes_id", "obs"),
  idGrammarCheck("observations", "evidence_id", "evid"),
  vocabularyCheck("observations", "validation_state", OBSERVATION_VALIDATION_STATES),
  vocabularyCheck("observations", "evidence_label", EVIDENCE_LABELS),
  rawCheck(
    "observations_value_json_type",
    `jsonb_typeof("observations"."value") = 'object' and ("observations"."value" ? 'v') and jsonb_typeof("observations"."value"->'v') in ('string', 'number', 'boolean')`,
  ),
  rawCheck("observations_quality_range", `"observations"."quality" is null or ("observations"."quality" >= 0 and "observations"."quality" <= 1)`),
  rawCheck("observations_concept_code_nonempty", `"observations"."concept_code" <> ''`),
  rawCheck("observations_method_id_nonempty", `"observations"."method_id" <> ''`),
  // One replacement per superseded observation (the domain supersede()
  // guard already ensures this; the database enforces it under concurrency).
  unique("uq_observations_supersedes").on(t.supersedesId),
  index("idx_observations_person_created").on(t.personId, t.createdAt, t.id),
  index("idx_observations_person_concept").on(t.personId, t.conceptCode, t.createdAt, t.id),
]);

// ---------------------------------------------------------------------------
// MeasurementPlan (architecture §5).
// ---------------------------------------------------------------------------

export const measurementPlans = pgTable("measurement_plans", {
  id: text("id").$type<PlanId>().primaryKey(),
  personId: text("person_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  intentId: text("intent_id")
    .$type<IntentId>()
    .notNull()
    .references(() => healthIntents.id),
  state: text("state").$type<PlanState>().notNull(),
  metrics: text("metrics").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  idGrammarCheck("measurement_plans", "id", "plan"),
  idGrammarCheck("measurement_plans", "person_id", "prsn"),
  idGrammarCheck("measurement_plans", "intent_id", "intent"),
  vocabularyCheck("measurement_plans", "state", PLAN_STATES),
  rawCheck("measurement_plans_metrics_nonempty", `array_length("measurement_plans"."metrics", 1) > 0`),
  index("idx_measurement_plans_person_created").on(t.personId, t.createdAt, t.id),
  index("idx_measurement_plans_intent").on(t.intentId),
]);

// ---------------------------------------------------------------------------
// AccessGrant (architecture §5, Access family).
// ---------------------------------------------------------------------------

export const accessGrants = pgTable("access_grants", {
  id: text("id").$type<GrantId>().primaryKey(),
  subjectId: text("subject_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  recipientId: text("recipient_id").notNull(),
  purpose: text("purpose").notNull(),
  scope: text("scope").array().notNull(),
  state: text("state").$type<GrantState>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  idGrammarCheck("access_grants", "id", "grant"),
  idGrammarCheck("access_grants", "subject_id", "prsn"),
  vocabularyCheck("access_grants", "state", GRANT_STATES),
  rawCheck("access_grants_recipient_nonempty", `"access_grants"."recipient_id" <> ''`),
  rawCheck("access_grants_purpose_nonempty", `"access_grants"."purpose" <> ''`),
  rawCheck("access_grants_scope_nonempty", `array_length("access_grants"."scope", 1) > 0`),
  index("idx_access_grants_subject_recipient").on(t.subjectId, t.recipientId),
  index("idx_access_grants_subject_created").on(t.subjectId, t.createdAt, t.id),
]);

// ---------------------------------------------------------------------------
// AccessAudit — APPEND-ONLY (architecture §7: "Every access produces an
// immutable audit event"). No update/delete path exists in the repository
// surface, and migration 0001 adds a database trigger rejecting
// UPDATE/DELETE/TRUNCATE outright.
// ---------------------------------------------------------------------------

export const accessAudits = pgTable("access_audits", {
  id: text("id").$type<AuditId>().primaryKey(),
  decisionId: text("decision_id").notNull(),
  subjectId: text("subject_id")
    .$type<PersonId>()
    .notNull()
    .references(() => persons.id),
  decision: text("decision").notNull(),
  at: timestamp("at", { withTimezone: true, mode: "date" }).notNull(),
  actor: text("actor").notNull(),
  requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  idGrammarCheck("access_audits", "id", "audit"),
  idGrammarCheck("access_audits", "subject_id", "prsn"),
  vocabularyCheck("access_audits", "decision", ["ALLOW", "DENY"]),
  rawCheck("access_audits_decision_id_nonempty", `"access_audits"."decision_id" <> ''`),
  rawCheck("access_audits_actor_nonempty", `"access_audits"."actor" <> ''`),
  rawCheck("access_audits_request_digest_nonempty", `"access_audits"."request_digest" <> ''`),
  unique("uq_access_audits_decision").on(t.decisionId),
  index("idx_access_audits_subject_created").on(t.subjectId, t.createdAt, t.id),
]);

// ---------------------------------------------------------------------------
// Transactional outbox (architecture §4).
// ---------------------------------------------------------------------------

export const outbox = pgTable("outbox", {
  eventId: text("event_id").$type<EventId>().primaryKey(),
  eventType: text("event_type").$type<DomainEventType>().notNull(),
  payload: text("payload").notNull(),
  status: text("status").$type<OutboxStatus>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  lastError: text("last_error"),
}, (t) => [
  idGrammarCheck("outbox", "event_id", "evt"),
  vocabularyCheck("outbox", "event_type", DOMAIN_EVENT_TYPES),
  vocabularyCheck("outbox", "status", OUTBOX_STATUSES),
  rawCheck("outbox_payload_nonempty", `"outbox"."payload" <> ''`),
  rawCheck("outbox_attempts_nonnegative", `"outbox"."attempts" >= 0`),
  rawCheck("outbox_last_error_nonempty", `"outbox"."last_error" is null or "outbox"."last_error" <> ''`),
  index("idx_outbox_status_created").on(t.status, t.createdAt, t.eventId),
]);

// ---------------------------------------------------------------------------
// Idempotency ledger (architecture §3: idempotency keys for retried
// mutations; claimed in the SAME transaction as the mutation itself).
// ---------------------------------------------------------------------------

export const idempotencyLedger = pgTable("idempotency_ledger", {
  tableName: text("table_name").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  recordId: text("record_id").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  rawCheck("idempotency_ledger_table_nonempty", `"idempotency_ledger"."table_name" <> ''`),
  rawCheck("idempotency_ledger_operation_nonempty", `"idempotency_ledger"."operation" <> ''`),
  rawCheck("idempotency_ledger_key_nonempty", `"idempotency_ledger"."idempotency_key" <> ''`),
  rawCheck("idempotency_ledger_record_nonempty", `"idempotency_ledger"."record_id" <> ''`),
  // Composite primary key: (table_name, operation, idempotency_key).
  primaryKey({
    name: "pk_idempotency_ledger",
    columns: [t.tableName, t.operation, t.idempotencyKey],
  }),
]);

// ---------------------------------------------------------------------------
// Aggregate schema export (used by drizzle() and drizzle-kit).
// ---------------------------------------------------------------------------

export const schema = {
  persons,
  accounts,
  provenances,
  healthIntents,
  evidenceObjects,
  uploadSessions,
  observations,
  measurementPlans,
  accessGrants,
  accessAudits,
  outbox,
  idempotencyLedger,
};
