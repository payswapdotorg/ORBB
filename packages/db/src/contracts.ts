/**
 * @orbb/db persistence contracts — A15.
 *
 * Domain-shaped, Drizzle-free TypeScript interfaces:
 *   - persistence RECORD types for the schema families (the domain
 *     aggregates are used DIRECTLY where they exist — HealthIntent,
 *     Observation, MeasurementPlan, AccessGrant, Provenance — so the
 *     repository surface can never drift from @orbb/domain);
 *   - typed `*Repository` interfaces (one per domain family, reads +
 *     mutations together — the domain-shaped surface of the packet);
 *   - the `Db` facade + `UnitOfWork` interfaces (see `db.ts`);
 *   - local id grammars for persistence-owned opaque ids (`acct_`,
 *     `audit_`) — the same local-branding precedent @orbb/databox set
 *     with `usess_`: the frozen M0 canonical id list is not extended
 *     unilaterally.
 *
 * Architecture §4 discipline (every domain mutation inside a transaction
 * that also writes an outbox event) is enforced by the DrizzleDb facade:
 * writer methods called on the ROOT handle throw (mutations are only
 * reachable through `transaction()`), and a mutating transaction that
 * appends no outbox event rolls back with `outbox-required`.
 *
 * This module imports NOTHING from Drizzle — it is the stable contract
 * surface other packages can code against (and fake in tests).
 */
import type {
  AccessGrant,
  EvidenceId,
  GrantId,
  GrantState,
  HealthIntent,
  IntentId,
  IntentState,
  MeasurementPlan,
  Observation,
  ObservationId,
  ObservationValidationState,
  PersonId,
  PlanId,
  PlanState,
  Provenance,
  ProvenanceId,
} from "@orbb/domain";
import {
  isPersonId,
  isProvenanceId,
  isEvidenceId,
  isIdOf,
  type AccessDecisionKind,
  type SupersededPair,
} from "@orbb/domain";
import type { DomainEventType, EventId, OutboxRecord } from "@orbb/contracts";
import { isEventId, isDomainEventType } from "@orbb/contracts";
import { assertEnvelopeShape, isUploadSessionId } from "@orbb/databox";
import type { EncryptedEnvelope, UploadSessionId, UploadSessionRecord, UploadSessionState } from "@orbb/databox";
import { PersistenceError } from "./errors.js";
import type { CursorPage, CursorPageResult } from "./cursor.js";

// ---------------------------------------------------------------------------
// Upload-plane session types (M2-D). The RECORD is the frozen
// @orbb/databox `UploadSessionRecord` (used DIRECTLY, exactly like the
// domain aggregates below — the upstream interface owns the shape, so
// the persistence surface can never drift from it). Re-exported here so
// the repository surface is self-documenting.
// ---------------------------------------------------------------------------

export type { UploadSessionId, UploadSessionRecord, UploadSessionState } from "@orbb/databox";

// ---------------------------------------------------------------------------
// Local opaque id grammars (persistence-owned).
// ---------------------------------------------------------------------------

declare const accountIdBrand: unique symbol;

/** Branded canonical account identifier: `acct_<body>`. */
export type AccountId = string & { readonly [accountIdBrand]: "AccountId" };

export const ACCOUNT_ID_PREFIX = "acct";

declare const auditIdBrand: unique symbol;

/** Branded canonical access-audit identifier: `audit_<body>`. */
export type AuditId = string & { readonly [auditIdBrand]: "AuditId" };

export const AUDIT_ID_PREFIX = "audit";

const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Lowercase hexadecimal SHA-256 digest (64 chars). */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Type guard: is `value` a lowercase-hex SHA-256 digest? */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

function parseLocalId(kind: string, prefix: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(`${prefix}_`) ||
    !ID_BODY_PATTERN.test(value.slice(prefix.length + 1))
  ) {
    throw new PersistenceError(
      "invalid-request",
      `Invalid ${kind} id: expected "${prefix}_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

/** Type guard: is `value` a canonical `acct_<body>` id? */
export function isAccountId(value: unknown): value is AccountId {
  return (
    typeof value === "string" &&
    value.startsWith(`${ACCOUNT_ID_PREFIX}_`) &&
    ID_BODY_PATTERN.test(value.slice(ACCOUNT_ID_PREFIX.length + 1))
  );
}

/** Parses and validates a raw value as an {@link AccountId}. */
export function parseAccountId(value: unknown): AccountId {
  return parseLocalId("account", ACCOUNT_ID_PREFIX, value) as AccountId;
}

/** Type guard: is `value` a canonical `audit_<body>` id? */
export function isAuditId(value: unknown): value is AuditId {
  return (
    typeof value === "string" &&
    value.startsWith(`${AUDIT_ID_PREFIX}_`) &&
    ID_BODY_PATTERN.test(value.slice(AUDIT_ID_PREFIX.length + 1))
  );
}

/** Parses and validates a raw value as an {@link AuditId}. */
export function parseAuditId(value: unknown): AuditId {
  return parseLocalId("access audit", AUDIT_ID_PREFIX, value) as AuditId;
}

// ---------------------------------------------------------------------------
// Mutation option shapes (idempotency keys — architecture §3).
// ---------------------------------------------------------------------------

/** Every mutating repository method is keyed for retry safety. */
export interface MutationOptions {
  /**
   * Caller-supplied idempotency key (1-256 chars). Retrying the same
   * mutation with the same key replays the stored result (upsert-style:
   * first write wins) instead of duplicating the effect.
   */
  readonly idempotencyKey: string;
}

/** A guarded state transition: idempotency + optimistic concurrency. */
export interface TransitionOptions<S> extends MutationOptions {
  /** State the caller believes the record is in (compare-and-set). */
  readonly expectedFrom: S;
}

// ---------------------------------------------------------------------------
// Persistence records (db-owned shapes; domain aggregates are reused
// verbatim wherever they exist).
// ---------------------------------------------------------------------------

/** Person row (M0: the domain defines no Person aggregate — minimal shape). */
export interface PersonRecord {
  readonly id: PersonId;
  readonly displayName: string;
}

/** Account row (architecture §5 Identity family — minimal shape). */
export interface AccountRecord {
  readonly id: AccountId;
  readonly personId: PersonId;
}

/**
 * EvidenceObject row — architecture §5 field list
 * (`id, personId, objectKey, mediaType, sha256, capturedAt, sourceType,
 * provenanceId, retentionClass`) plus the operational columns needed for
 * §6 integrity (`sizeBytes`, `state`).
 *
 * M2-D (Lane A) upload-plane extensions (the additive landing of the
 * recorded M2-A handoff; all optional — legacy rows and non-upload
 * ingestion paths carry none of them):
 *   - `createdAt` — surfaced for read paths; when present on insert it is
 *     stored verbatim (the intent/plan convention — the upstream record
 *     owns its creation time), otherwise the persistence layer stamps it
 *     from its clock (M2-A behavior).
 *   - `sessionId` — the upload session that produced this object
 *     (unique when present: one finalized EvidenceObject per session).
 *   - `encryptedMetadata` — the envelope-encrypted sensitive metadata
 *     (capturedAt/purpose/scope live ONLY inside this envelope).
 */
export interface EvidenceObjectRecord {
  readonly id: EvidenceId;
  readonly personId: PersonId;
  /** Opaque content-addressed object key (`evidence/v1/<id>/<sha256>`). */
  readonly objectKey: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly capturedAt: Date;
  readonly sourceType: string;
  readonly provenanceId: ProvenanceId;
  readonly retentionClass: string;
  readonly state: EvidenceObjectState;
  /** EvidenceObject creation time (see interface docs; optional). */
  readonly createdAt?: Date;
  /** The upload session that produced this object (optional). */
  readonly sessionId?: UploadSessionId;
  /** Envelope-encrypted sensitive metadata (optional). */
  readonly encryptedMetadata?: EncryptedEnvelope;
}

/** EvidenceObject lifecycle state (M2-A: only "active"; expand-safe). */
export const EVIDENCE_OBJECT_STATES = ["active"] as const;

export type EvidenceObjectState = (typeof EVIDENCE_OBJECT_STATES)[number];

/**
 * AccessAudit row — the domain `AccessAudit` shape extended with the
 * persistence columns the packet's "query API for a subject's audit
 * trail" requires (`subjectId`) and the audited outcome (`decision`,
 * the frozen ALLOW | DENY vocabulary).
 */
export interface AccessAuditRecord {
  /** Opaque `audit_<body>` id. */
  readonly id: AuditId;
  readonly decisionId: string;
  readonly subjectId: PersonId;
  readonly decision: AccessDecisionKind;
  readonly at: Date;
  readonly actor: string;
  readonly requestDigest: string;
}

// ---------------------------------------------------------------------------
// Record guards (PHI-safe: describe the shape, never echo values).
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalid(what: string): PersistenceError {
  return new PersistenceError("invalid-request", `Invalid ${what}.`);
}

/** Pure guard: asserts a well-formed {@link PersonRecord}. */
export function assertPersonRecord(candidate: unknown): asserts candidate is PersonRecord {
  if (!isPlainObject(candidate)) {
    throw invalid("person record");
  }
  if (!isIdOf("person", candidate.id)) {
    throw invalid("person record: expected a canonical prsn_ id");
  }
  if (!isNonEmptyString(candidate.displayName) || candidate.displayName.length > 200) {
    throw invalid("person record: expected a display name of 1-200 characters");
  }
}

/** Pure guard: asserts a well-formed {@link AccountRecord}. */
export function assertAccountRecord(candidate: unknown): asserts candidate is AccountRecord {
  if (!isPlainObject(candidate)) {
    throw invalid("account record");
  }
  if (!isAccountId(candidate.id)) {
    throw invalid("account record: expected a canonical acct_ id");
  }
  if (!isPersonId(candidate.personId)) {
    throw invalid("account record: expected a canonical prsn_ person id");
  }
}

/** Pure guard: asserts a well-formed {@link EvidenceObjectRecord}. */
export function assertEvidenceObjectRecord(
  candidate: unknown,
): asserts candidate is EvidenceObjectRecord {
  if (!isPlainObject(candidate)) {
    throw invalid("evidence object record");
  }
  if (!isEvidenceId(candidate.id)) {
    throw invalid("evidence object record: expected a canonical evid_ id");
  }
  if (!isPersonId(candidate.personId)) {
    throw invalid("evidence object record: expected a canonical prsn_ person id");
  }
  if (!isProvenanceId(candidate.provenanceId)) {
    throw invalid("evidence object record: expected a canonical prov_ provenance id");
  }
  if (!isNonEmptyString(candidate.objectKey) || candidate.objectKey.length > 512) {
    throw invalid("evidence object record: expected an object key of 1-512 characters");
  }
  if (!isNonEmptyString(candidate.mediaType) || candidate.mediaType.length > 256) {
    throw invalid("evidence object record: expected a media type of 1-256 characters");
  }
  if (!isSha256Hex(candidate.sha256)) {
    throw invalid("evidence object record: expected a 64-character lowercase hexadecimal sha256");
  }
  if (
    typeof candidate.sizeBytes !== "number" ||
    !Number.isInteger(candidate.sizeBytes) ||
    candidate.sizeBytes < 0 ||
    candidate.sizeBytes > Number.MAX_SAFE_INTEGER
  ) {
    throw invalid("evidence object record: expected a non-negative integer size in bytes");
  }
  if (!isTimestamp(candidate.capturedAt)) {
    throw invalid("evidence object record: expected a valid capturedAt timestamp");
  }
  if (!isNonEmptyString(candidate.sourceType)) {
    throw invalid("evidence object record: expected a non-empty source type");
  }
  if (!isNonEmptyString(candidate.retentionClass)) {
    throw invalid("evidence object record: expected a non-empty retention class");
  }
  if (candidate.state !== "active") {
    throw invalid("evidence object record: expected the state 'active'");
  }
  if (candidate.createdAt !== undefined && !isTimestamp(candidate.createdAt)) {
    throw invalid("evidence object record: expected a valid createdAt timestamp when present");
  }
  if (candidate.sessionId !== undefined && !isUploadSessionId(candidate.sessionId)) {
    throw invalid("evidence object record: expected a canonical usess_ session id when present");
  }
  if (candidate.encryptedMetadata !== undefined) {
    try {
      assertEnvelopeShape(candidate.encryptedMetadata as EncryptedEnvelope);
    } catch {
      throw invalid("evidence object record: expected a well-formed envelope when present");
    }
  }
}

/** Pure guard: asserts a well-formed {@link AccessAuditRecord}. */
export function assertAccessAuditRecord(candidate: unknown): asserts candidate is AccessAuditRecord {
  if (!isPlainObject(candidate)) {
    throw invalid("access audit record");
  }
  if (!isAuditId(candidate.id)) {
    throw invalid("access audit record: expected a canonical audit_ id");
  }
  if (!isNonEmptyString(candidate.decisionId)) {
    throw invalid("access audit record: expected a non-empty decision id");
  }
  if (!isPersonId(candidate.subjectId)) {
    throw invalid("access audit record: expected a canonical prsn_ subject id");
  }
  if (candidate.decision !== "ALLOW" && candidate.decision !== "DENY") {
    throw invalid("access audit record: expected the decision ALLOW or DENY");
  }
  if (!isTimestamp(candidate.at)) {
    throw invalid("access audit record: expected a valid at timestamp");
  }
  if (!isNonEmptyString(candidate.actor)) {
    throw invalid("access audit record: expected a non-empty actor");
  }
  if (!isNonEmptyString(candidate.requestDigest)) {
    throw invalid("access audit record: expected a non-empty request digest");
  }
}

// ---------------------------------------------------------------------------
// Transactional outbox input (architecture §4).
// ---------------------------------------------------------------------------

/** Input for appending one event to the transactional outbox. */
export interface NewOutboxEvent {
  readonly eventId: EventId;
  readonly eventType: DomainEventType;
  /** Serialized JSON event payload. */
  readonly payload: string;
}

/** Pure guard: asserts a well-formed {@link NewOutboxEvent}. */
export function assertNewOutboxEvent(candidate: unknown): asserts candidate is NewOutboxEvent {
  if (!isPlainObject(candidate)) {
    throw invalid("outbox event");
  }
  if (!isEventId(candidate.eventId)) {
    throw invalid("outbox event: expected a canonical evt_ event id");
  }
  if (!isDomainEventType(candidate.eventType)) {
    throw invalid("outbox event: expected a canonical domain event type");
  }
  if (typeof candidate.payload !== "string" || candidate.payload.length === 0) {
    throw invalid("outbox event: expected a non-empty serialized payload");
  }
  try {
    JSON.parse(candidate.payload) as unknown;
  } catch {
    throw invalid("outbox event: expected the payload to be valid JSON");
  }
}

// ---------------------------------------------------------------------------
// Repository interfaces — Readers on the root Db, full repositories
// (Reader + Writer) inside a UnitOfWork transaction.
// ---------------------------------------------------------------------------

export interface PersonRepository {
  insert(person: PersonRecord, options: MutationOptions): Promise<PersonRecord>;
  findById(id: PersonId): Promise<PersonRecord | undefined>;
  list(page?: CursorPage): Promise<CursorPageResult<PersonRecord>>;
}

export interface AccountRepository {
  insert(account: AccountRecord, options: MutationOptions): Promise<AccountRecord>;
  findById(id: AccountId): Promise<AccountRecord | undefined>;
  listByPerson(personId: PersonId, page?: CursorPage): Promise<CursorPageResult<AccountRecord>>;
}

export interface ProvenanceRepository {
  insert(provenance: Provenance, options: MutationOptions): Promise<Provenance>;
  findById(id: ProvenanceId): Promise<Provenance | undefined>;
  listBySubject(subject: PersonId, page?: CursorPage): Promise<CursorPageResult<Provenance>>;
}

export interface HealthIntentRepository {
  insert(intent: HealthIntent, options: MutationOptions): Promise<HealthIntent>;
  findById(id: IntentId): Promise<HealthIntent | undefined>;
  listByPerson(personId: PersonId, page?: CursorPage): Promise<CursorPageResult<HealthIntent>>;
  /** Guarded state transition (frozen intent state machine). */
  transition(
    id: IntentId,
    to: IntentState,
    options: TransitionOptions<IntentState>,
  ): Promise<HealthIntent>;
  /** Links the plan currently fulfilling the intent (soft reference). */
  setPlan(id: IntentId, planId: PlanId, options: MutationOptions): Promise<HealthIntent>;
}

export interface ObservationRepository {
  insert(observation: Observation, options: MutationOptions): Promise<Observation>;
  findById(id: ObservationId): Promise<Observation | undefined>;
  listByPerson(
    personId: PersonId,
    page?: CursorPage,
  ): Promise<CursorPageResult<Observation>>;
  listByPersonAndConcept(
    personId: PersonId,
    conceptCode: string,
    page?: CursorPage,
  ): Promise<CursorPageResult<Observation>>;
  /** Guarded validation-state transition (frozen observation machine). */
  transition(
    id: ObservationId,
    to: ObservationValidationState,
    options: TransitionOptions<ObservationValidationState>,
  ): Promise<Observation>;
  /**
   * Persists an M1 amendment atomically: the old observation moves to
   * `superseded` and the replacement (carrying `supersedesId`) is
   * inserted as `validated` — one transaction, two rows, idempotent by
   * key. Input must come from the pure domain `supersede()` function.
   */
  applySupersession(pair: SupersededPair, options: MutationOptions): Promise<SupersededPair>;
}

export interface EvidenceObjectRepository {
  insert(evidence: EvidenceObjectRecord, options: MutationOptions): Promise<EvidenceObjectRecord>;
  findById(id: EvidenceId): Promise<EvidenceObjectRecord | undefined>;
  findByObjectKey(objectKey: string): Promise<EvidenceObjectRecord | undefined>;
  listByPerson(
    personId: PersonId,
    page?: CursorPage,
  ): Promise<CursorPageResult<EvidenceObjectRecord>>;
}

/** Pure guard: asserts a well-formed {@link UploadSessionRecord}. */
export function assertUploadSessionRecord(
  candidate: unknown,
): asserts candidate is UploadSessionRecord {
  if (!isPlainObject(candidate)) {
    throw invalid("upload session record");
  }
  if (!isUploadSessionId(candidate.sessionId)) {
    throw invalid("upload session record: expected a canonical usess_ session id");
  }
  if (!isEvidenceId(candidate.evidenceId)) {
    throw invalid("upload session record: expected a canonical evid_ evidence id");
  }
  if (!isPersonId(candidate.personId)) {
    throw invalid("upload session record: expected a canonical prsn_ person id");
  }
  if (!isNonEmptyString(candidate.objectKey) || candidate.objectKey.length > 512) {
    throw invalid("upload session record: expected an object key of 1-512 characters");
  }
  if (!isNonEmptyString(candidate.mediaType) || candidate.mediaType.length > 255) {
    throw invalid("upload session record: expected a media type of 1-255 characters");
  }
  if (!isSha256Hex(candidate.declaredSha256)) {
    throw invalid("upload session record: expected a 64-character lowercase hexadecimal sha256");
  }
  if (
    typeof candidate.declaredSizeBytes !== "number" ||
    !Number.isInteger(candidate.declaredSizeBytes) ||
    candidate.declaredSizeBytes < 0 ||
    candidate.declaredSizeBytes > Number.MAX_SAFE_INTEGER
  ) {
    throw invalid("upload session record: expected a non-negative integer size in bytes");
  }
  if (!isNonEmptyString(candidate.purpose) || candidate.purpose.length > 256) {
    throw invalid("upload session record: expected a purpose of 1-256 characters");
  }
  if (
    !Array.isArray(candidate.scope) ||
    candidate.scope.length === 0 ||
    candidate.scope.some(
      (token) => typeof token !== "string" || token.length === 0 || token.length > 256,
    )
  ) {
    throw invalid("upload session record: expected a non-empty list of non-empty scope tokens");
  }
  if (!isTimestamp(candidate.createdAt)) {
    throw invalid("upload session record: expected a valid createdAt timestamp");
  }
  if (!isTimestamp(candidate.expiresAt)) {
    throw invalid("upload session record: expected a valid expiresAt timestamp");
  }
  if (candidate.state !== "open" && candidate.state !== "finalized") {
    throw invalid("upload session record: expected the state 'open' or 'finalized'");
  }
  if (candidate.finalizedAt !== undefined && !isTimestamp(candidate.finalizedAt)) {
    throw invalid("upload session record: expected a valid finalizedAt timestamp when present");
  }
  if (candidate.state === "finalized" && candidate.finalizedAt === undefined) {
    throw invalid("upload session record: expected finalizedAt when the state is 'finalized'");
  }
  if (candidate.state === "open" && candidate.finalizedAt !== undefined) {
    throw invalid("upload session record: did not expect finalizedAt while the state is 'open'");
  }
}

/**
 * Options for {@link UploadSessionRepository.markFinalized}: the guarded
 * open → finalized transition (the only transition the §6 flow defines)
 * plus the finalization instant stamped onto `finalized_at`.
 */
export interface FinalizeSessionOptions extends TransitionOptions<UploadSessionState> {
  /** Finalization instant (= EvidenceObject creation time, §6 step 6). */
  readonly finalizedAt: Date;
}

/**
 * M2-D (Lane A) — upload-session repository over `upload_sessions`.
 * The record type is the frozen @orbb/databox `UploadSessionRecord`
 * (create-before-publication semantics; the session fixes its
 * EvidenceObject id at creation).
 */
export interface UploadSessionRepository {
  /** Persists a newly created session record (state "open"). */
  insert(session: UploadSessionRecord, options: MutationOptions): Promise<UploadSessionRecord>;
  findById(sessionId: UploadSessionId): Promise<UploadSessionRecord | undefined>;
  /** A person's sessions, newest-first, cursor-paginated. */
  listByPerson(
    personId: PersonId,
    page?: CursorPage,
  ): Promise<CursorPageResult<UploadSessionRecord>>;
  /**
   * Guarded open → finalized transition (compare-and-set on "open"),
   * stamping `finalized_at`. Converged retries (already finalized)
   * return the stored record; a missing session is "not-found".
   */
  markFinalized(sessionId: UploadSessionId, options: FinalizeSessionOptions): Promise<UploadSessionRecord>;
}

export interface MeasurementPlanRepository {
  insert(plan: MeasurementPlan, options: MutationOptions): Promise<MeasurementPlan>;
  findById(id: PlanId): Promise<MeasurementPlan | undefined>;
  listByPerson(personId: PersonId, page?: CursorPage): Promise<CursorPageResult<MeasurementPlan>>;
  /** Guarded state transition (frozen plan state machine). */
  transition(
    id: PlanId,
    to: PlanState,
    options: TransitionOptions<PlanState>,
  ): Promise<MeasurementPlan>;
}

export interface AccessGrantRepository {
  insert(grant: AccessGrant, options: MutationOptions): Promise<AccessGrant>;
  findById(id: GrantId): Promise<AccessGrant | undefined>;
  listBySubject(subjectId: PersonId, page?: CursorPage): Promise<CursorPageResult<AccessGrant>>;
  /**
   * Candidate grants for access evaluation (subject + recipient).
   * Deliberately unpaginated: the evaluator must see EVERY candidate —
   * silent truncation would be a security bug. A safety ceiling of
   * 1000 rows fails loudly instead.
   */
  listBySubjectAndRecipient(
    subjectId: PersonId,
    recipientId: string,
  ): Promise<readonly AccessGrant[]>;
  /** Guarded state transition (active -> revoked, terminal). */
  transition(
    id: GrantId,
    to: GrantState,
    options: TransitionOptions<GrantState>,
  ): Promise<AccessGrant>;
}

/**
 * A20 — immutable access audit repository. APPEND-ONLY by design:
 * the ONLY mutating method is {@link appendAccessAudit}; there is no
 * update, no delete, no state transition on this surface, and the
 * database itself rejects UPDATE/DELETE/TRUNCATE (migration 0001).
 */
export interface AccessAuditRepository {
  /** Inserts one audit record. Retried keys replay the stored record. */
  appendAccessAudit(record: AccessAuditRecord, options: MutationOptions): Promise<AccessAuditRecord>;
  findById(id: AuditId): Promise<AccessAuditRecord | undefined>;
  /** A subject's audit trail, newest-first, cursor-paginated. */
  listBySubject(subjectId: PersonId, page?: CursorPage): Promise<CursorPageResult<AccessAuditRecord>>;
}

/**
 * Transactional outbox repository (architecture §4). `append` is used
 * by the unit of work INSIDE the domain transaction; `listPending` /
 * `markPublished` / `markFailed` are the publisher-side surface used
 * asynchronously by workers.
 */
export interface OutboxRepository {
  /**
   * Inserts one pending outbox row. Idempotent on `eventId`: replaying
   * the same event id returns the stored row (payload/type must agree —
   * a reused id with different content is a state conflict).
   */
  append(event: NewOutboxEvent): Promise<OutboxRecord>;
  findById(eventId: EventId): Promise<OutboxRecord | undefined>;
  /** Pending rows oldest-first (fair drain order). */
  listPending(page?: CursorPage): Promise<CursorPageResult<OutboxRecord>>;
  /** Marks an event published (idempotent; stamps publishedAt). */
  markPublished(eventId: EventId): Promise<OutboxRecord>;
  /** Records a publication failure: attempts+1, status "failed". */
  markFailed(eventId: EventId, lastError: string): Promise<OutboxRecord>;
}

// ---------------------------------------------------------------------------
// Db facade + UnitOfWork (implemented in db.ts).
// ---------------------------------------------------------------------------

/**
 * The persistence facade. Reads are available directly; EVERY domain
 * mutation runs inside `transaction()` on the {@link UnitOfWork} and
 * MUST append at least one outbox event (enforced before commit).
 */
export interface Db {
  readonly persons: PersonRepository;
  readonly accounts: AccountRepository;
  readonly provenances: ProvenanceRepository;
  readonly intents: HealthIntentRepository;
  readonly observations: ObservationRepository;
  readonly evidence: EvidenceObjectRepository;
  readonly uploadSessions: UploadSessionRepository;
  readonly plans: MeasurementPlanRepository;
  readonly grants: AccessGrantRepository;
  readonly audits: AccessAuditRepository;
  readonly outbox: OutboxRepository;
  /**
   * Runs `work` inside one Postgres transaction. Commits when `work`
   * resolves (after the outbox guard), rolls back when it rejects or
   * when a mutating transaction appended no outbox event.
   */
  transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  /** Closes the underlying connection(s). */
  close(): Promise<void>;
}

/** Unit of work: the transaction-scoped surface handed to `work`. */
export interface UnitOfWork {
  readonly persons: PersonRepository;
  readonly accounts: AccountRepository;
  readonly provenances: ProvenanceRepository;
  readonly intents: HealthIntentRepository;
  readonly observations: ObservationRepository;
  readonly evidence: EvidenceObjectRepository;
  readonly uploadSessions: UploadSessionRepository;
  readonly plans: MeasurementPlanRepository;
  readonly grants: AccessGrantRepository;
  readonly audits: AccessAuditRepository;
  /**
   * Appends one event to the outbox INSIDE this transaction (the
   * transactional outbox pattern — state + event commit atomically).
   */
  appendEvent(event: NewOutboxEvent): Promise<OutboxRecord>;
}
