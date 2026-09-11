/**
 * Drizzle-backed repository implementations — A15.
 *
 * Every repository:
 *   - validates its input through the frozen @orbb/domain guards (or
 *     the local contracts guards for db-owned records);
 *   - claims an idempotency key on EVERY mutating method (upsert-style
 *     replay semantics — see `idempotency.ts`);
 *   - refuses mutations outside a transaction (`requireMutationScope`)
 *     — architecture §4: domain mutations exist only inside
 *     `db.transaction()`, alongside their outbox event;
 *   - notes real mutations so the facade can enforce "a mutating
 *     transaction must append at least one outbox event";
 *   - paginates with the pure cursor helpers over the `(created_at,
 *     id)` anchor (LIMIT limit+1 pattern) — never exposing anything
 *     beyond opaque domain ids.
 *
 * Mapping conventions: DB `null` becomes an absent optional field
 * (conditional spreads keep `exactOptionalPropertyTypes` honest), and
 * branded values are re-derived on read where the domain guards them
 * (e.g. quality scores).
 */
import type { Clock } from "@orbb/testkit";
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
  ProvenanceActor,
  ProvenanceId,
} from "@orbb/domain";
import {
  assertAccessGrant,
  assertGrantTransition,
  assertHealthIntent,
  assertIntentTransition,
  assertMeasurementPlan,
  assertObservation,
  assertObservationValidationTransition,
  assertPlanTransition,
  assertProvenance,
  parseQualityScore,
  type SupersededPair,
} from "@orbb/domain";
import type { OutboxRecord } from "@orbb/contracts";
import type { UploadSessionId, UploadSessionRecord } from "@orbb/databox";
import { and, asc, desc, eq, gt, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { OrbbExecutor } from "./driver.js";
import {
  deserializeEncryptedEnvelope,
  serializeEncryptedEnvelope,
} from "./evidence-envelope.js";
import type {
  AccountId,
  AccessAuditRecord,
  AccountRecord,
  AccountRepository,
  AccessAuditRepository,
  AccessGrantRepository,
  EvidenceObjectRecord,
  EvidenceObjectRepository,
  EvidenceObjectState,
  FinalizeSessionOptions,
  HealthIntentRepository,
  MeasurementPlanRepository,
  MutationOptions,
  NewOutboxEvent,
  ObservationRepository,
  OutboxRepository,
  PersonRecord,
  PersonRepository,
  ProvenanceRepository,
  TransitionOptions,
  UploadSessionRepository,
} from "./contracts.js";
import type {
  CursorPage,
  CursorPageResult,
  CursorSortDirection,
} from "./cursor.js";
import {
  assertAccessAuditRecord,
  assertAccountRecord,
  assertEvidenceObjectRecord,
  assertNewOutboxEvent,
  assertPersonRecord,
  assertUploadSessionRecord,
} from "./contracts.js";
import { clampPageLimit, pageOf, parseCursor } from "./cursor.js";
import { claimIdempotency } from "./idempotency.js";
import { PersistenceError } from "./errors.js";
import {
  accessAudits,
  accessGrants,
  accounts,
  evidenceObjects,
  healthIntents,
  idempotencyLedger,
  measurementPlans,
  observations,
  outbox as outboxTable,
  persons as personsTable,
  provenances as provenancesTable,
  uploadSessions as uploadSessionsTable,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Mutation scope plumbing.
// ---------------------------------------------------------------------------

/**
 * Tracks where a repository is bound. Root bindings REJECT mutations
 * (§4); transaction bindings count real mutations for the facade's
 * outbox guard — but ONLY for methods whose canonical §11 event type
 * EXISTS in the frozen vocabulary (the catalog covers domain
 * creation/ingestion/grant/supersession/evaluation flows; identity
 * families and state transitions without event types do not arm the
 * guard — recorded handoff to the contracts lane).
 */
export interface MutationContext {
  readonly inTransaction: boolean;
  noteMutation(armsOutboxGuard: boolean): void;
}

/** Root binding: reads only — any mutation attempt fails loudly. */
export const ROOT_MUTATION_CONTEXT: MutationContext = {
  inTransaction: false,
  noteMutation(armsOutboxGuard: boolean): void {
    void armsOutboxGuard;
    throw outsideTransaction();
  },
};

function outsideTransaction(): PersistenceError {
  return new PersistenceError(
    "invalid-request",
    "Domain mutations must run inside db.transaction() (architecture §4: state + outbox event commit atomically).",
  );
}

function requireMutationScope(context: MutationContext): void {
  if (!context.inTransaction) {
    throw outsideTransaction();
  }
}

// ---------------------------------------------------------------------------
// Cursor condition (the Drizzle twin of the pure `applyCursor`).
// ---------------------------------------------------------------------------

function cursorCondition(
  cursor: string,
  createdAtColumn: PgColumn,
  idColumn: PgColumn,
  direction: CursorSortDirection,
): SQL {
  const anchor = parseCursor(cursor);
  if (direction === "desc") {
    return or(
      lt(createdAtColumn, anchor.createdAt),
      and(eq(createdAtColumn, anchor.createdAt), lt(idColumn, anchor.id)),
    ) as SQL;
  }
  return or(
    gt(createdAtColumn, anchor.createdAt),
    and(eq(createdAtColumn, anchor.createdAt), gt(idColumn, anchor.id)),
  ) as SQL;
}

// ---------------------------------------------------------------------------
// Row mappers (DB null → absent optional; brands re-derived on read).
// ---------------------------------------------------------------------------

type PersonRow = typeof personsTable.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;
type ProvenanceRow = typeof provenancesTable.$inferSelect;
type IntentRow = typeof healthIntents.$inferSelect;
type ObservationRow = typeof observations.$inferSelect;
type EvidenceRow = typeof evidenceObjects.$inferSelect;
type UploadSessionRow = typeof uploadSessionsTable.$inferSelect;
type PlanRow = typeof measurementPlans.$inferSelect;
type GrantRow = typeof accessGrants.$inferSelect;
type AuditRow = typeof accessAudits.$inferSelect;
type OutboxRow = typeof outboxTable.$inferSelect;

function toPerson(row: PersonRow): PersonRecord {
  return { id: row.id, displayName: row.displayName };
}

function toAccount(row: AccountRow): AccountRecord {
  return { id: row.id, personId: row.personId };
}

function toProvenance(row: ProvenanceRow): Provenance {
  return {
    provenanceId: row.id,
    // Actor grammar (prsn_|dev_|src_) is enforced by the DB check
    // constraint; the brand is re-derived here.
    actor: row.actor as ProvenanceActor,
    subject: row.subject,
    occurredAt: row.occurredAt,
    ...(row.causationId !== null ? { causationId: row.causationId } : {}),
    ...(row.correlationId !== null ? { correlationId: row.correlationId } : {}),
  };
}

function toIntent(row: IntentRow): HealthIntent {
  return {
    id: row.id,
    personId: row.personId,
    objective: row.objective,
    state: row.state,
    createdAt: row.createdAt,
    ...(row.evidencePackVersion !== null ? { evidencePackVersion: row.evidencePackVersion } : {}),
    ...(row.planId !== null ? { planId: row.planId } : {}),
  };
}

function toObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    personId: row.personId,
    conceptCode: row.conceptCode,
    value: row.value.v,
    unit: row.unit,
    effectiveAt: row.effectiveAt,
    observedAt: row.observedAt,
    sourceId: row.sourceId,
    methodId: row.methodId,
    validationState: row.validationState,
    provenanceId: row.provenanceId,
    evidenceLabel: row.evidenceLabel,
    ...(row.evidenceId !== null ? { evidenceId: row.evidenceId } : {}),
    ...(row.quality !== null ? { quality: parseQualityScore(row.quality) } : {}),
    ...(row.supersedesId !== null ? { supersedesId: row.supersedesId } : {}),
  };
}

function toEvidence(row: EvidenceRow): EvidenceObjectRecord {
  return {
    id: row.id,
    personId: row.personId,
    objectKey: row.objectKey,
    mediaType: row.mediaType,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    capturedAt: row.capturedAt,
    sourceType: row.sourceType,
    provenanceId: row.provenanceId,
    retentionClass: row.retentionClass,
    state: row.state as EvidenceObjectState,
    createdAt: row.createdAt,
    // M2-D upload-plane columns (absent on legacy / non-upload rows).
    ...(row.sessionId !== null ? { sessionId: row.sessionId } : {}),
    ...(row.encryptedMetadata !== null
      ? { encryptedMetadata: deserializeEncryptedEnvelope(row.encryptedMetadata) }
      : {}),
  };
}

function toUploadSession(row: UploadSessionRow): UploadSessionRecord {
  return {
    sessionId: row.sessionId,
    evidenceId: row.evidenceId,
    personId: row.personId,
    objectKey: row.objectKey,
    mediaType: row.mediaType,
    declaredSha256: row.declaredSha256,
    declaredSizeBytes: row.declaredSizeBytes,
    purpose: row.purpose,
    scope: row.scope,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    state: row.state,
    ...(row.finalizedAt !== null ? { finalizedAt: row.finalizedAt } : {}),
  };
}

function toPlan(row: PlanRow): MeasurementPlan {
  return {
    id: row.id,
    personId: row.personId,
    intentId: row.intentId,
    state: row.state,
    metrics: row.metrics,
    createdAt: row.createdAt,
  };
}

function toGrant(row: GrantRow): AccessGrant {
  return {
    id: row.id,
    subjectId: row.subjectId,
    recipientId: row.recipientId,
    purpose: row.purpose,
    scope: row.scope,
    state: row.state,
    expiresAt: row.expiresAt,
  };
}

function toAudit(row: AuditRow): AccessAuditRecord {
  return {
    id: row.id,
    decisionId: row.decisionId,
    subjectId: row.subjectId,
    decision: row.decision === "ALLOW" ? "ALLOW" : "DENY",
    at: row.at,
    actor: row.actor,
    requestDigest: row.requestDigest,
  };
}

function toOutbox(row: OutboxRow): OutboxRecord {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    ...(row.publishedAt !== null ? { publishedAt: row.publishedAt } : {}),
    ...(row.lastError !== null ? { lastError: row.lastError } : {}),
  };
}

// ---------------------------------------------------------------------------
// Error helpers (PHI-safe: never echo values).
// ---------------------------------------------------------------------------

function replayMissing(what: string): PersistenceError {
  return new PersistenceError(
    "state-conflict",
    `Idempotent replay for a ${what} mutation found no stored record; the ledger and the table disagree.`,
  );
}

function uniqueConflict(what: string): PersistenceError {
  return new PersistenceError(
    "state-conflict",
    `Unique key conflict while storing ${what} under a fresh idempotency key.`,
  );
}

function diverged(what: string): PersistenceError {
  return new PersistenceError(
    "state-conflict",
    `${what} state diverged from the expected state (concurrent mutation); retry with a fresh idempotency key.`,
  );
}

function notFound(what: string): PersistenceError {
  return new PersistenceError("not-found", `${what} not found.`);
}

// ---------------------------------------------------------------------------
// Person.
// ---------------------------------------------------------------------------

export class DrizzlePersonRepository implements PersonRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(person: PersonRecord, options: MutationOptions): Promise<PersonRecord> {
    requireMutationScope(this.#ctx);
    assertPersonRecord(person);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "persons",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: person.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as PersonId);
      if (stored === undefined) {
        throw replayMissing("person");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(personsTable)
      .values({
        id: person.id,
        displayName: person.displayName,
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("person");
    }
    // No canonical PERSON_* event type exists (§11) — does not arm the
    // outbox guard (recorded contract handoff).
    this.#ctx.noteMutation(false);
    return toPerson(row);
  }

  async findById(id: PersonId): Promise<PersonRecord | undefined> {
    const rows = await this.#ex
      .select()
      .from(personsTable)
      .where(eq(personsTable.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toPerson(rows[0]);
  }

  async list(page?: CursorPage): Promise<CursorPageResult<PersonRecord>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, personsTable.createdAt, personsTable.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(personsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(personsTable.createdAt), desc(personsTable.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toPerson), nextCursor };
  }
}

// ---------------------------------------------------------------------------
// Account.
// ---------------------------------------------------------------------------

export class DrizzleAccountRepository implements AccountRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(account: AccountRecord, options: MutationOptions): Promise<AccountRecord> {
    requireMutationScope(this.#ctx);
    assertAccountRecord(account);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "accounts",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: account.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as AccountId);
      if (stored === undefined) {
        throw replayMissing("account");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(accounts)
      .values({
        id: account.id,
        personId: account.personId,
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("account");
    }
    // No canonical ACCOUNT_* event type exists (§11).
    this.#ctx.noteMutation(false);
    return toAccount(row);
  }

  async findById(id: AccountId): Promise<AccountRecord | undefined> {
    const rows = await this.#ex
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toAccount(rows[0]);
  }

  async listByPerson(personId: PersonId, page?: CursorPage): Promise<CursorPageResult<AccountRecord>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(accounts.personId, personId)];
    if (page?.cursor !== undefined) {
      conditions.push(cursorCondition(page.cursor, accounts.createdAt, accounts.id, "desc"));
    }
    const rows = await this.#ex
      .select()
      .from(accounts)
      .where(and(...conditions))
      .orderBy(desc(accounts.createdAt), desc(accounts.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toAccount), nextCursor };
  }
}

// ---------------------------------------------------------------------------
// Provenance.
// ---------------------------------------------------------------------------

export class DrizzleProvenanceRepository implements ProvenanceRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(provenance: Provenance, options: MutationOptions): Promise<Provenance> {
    requireMutationScope(this.#ctx);
    assertProvenance(provenance);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "provenances",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: provenance.provenanceId,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as ProvenanceId);
      if (stored === undefined) {
        throw replayMissing("provenance");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(provenancesTable)
      .values({
        id: provenance.provenanceId,
        actor: provenance.actor,
        subject: provenance.subject,
        occurredAt: provenance.occurredAt,
        ...(provenance.causationId !== undefined ? { causationId: provenance.causationId } : {}),
        ...(provenance.correlationId !== undefined
          ? { correlationId: provenance.correlationId }
          : {}),
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("provenance");
    }
    // No canonical PROVENANCE_* event type exists (§11).
    this.#ctx.noteMutation(false);
    return toProvenance(row);
  }

  async findById(id: ProvenanceId): Promise<Provenance | undefined> {
    const rows = await this.#ex
      .select()
      .from(provenancesTable)
      .where(eq(provenancesTable.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toProvenance(rows[0]);
  }

  async listBySubject(subject: PersonId, page?: CursorPage): Promise<CursorPageResult<Provenance>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(provenancesTable.subject, subject)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, provenancesTable.createdAt, provenancesTable.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(provenancesTable)
      .where(and(...conditions))
      .orderBy(desc(provenancesTable.createdAt), desc(provenancesTable.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toProvenance), nextCursor };
  }
}

// ---------------------------------------------------------------------------
// HealthIntent.
// ---------------------------------------------------------------------------

export class DrizzleHealthIntentRepository implements HealthIntentRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(intent: HealthIntent, options: MutationOptions): Promise<HealthIntent> {
    requireMutationScope(this.#ctx);
    assertHealthIntent(intent);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "health_intents",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: intent.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as IntentId);
      if (stored === undefined) {
        throw replayMissing("health intent");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(healthIntents)
      .values({
        id: intent.id,
        personId: intent.personId,
        objective: intent.objective,
        state: intent.state,
        createdAt: intent.createdAt,
        ...(intent.evidencePackVersion !== undefined
          ? { evidencePackVersion: intent.evidencePackVersion }
          : {}),
        ...(intent.planId !== undefined ? { planId: intent.planId } : {}),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("health intent");
    }
    // INTENT_CREATED (§11).
    this.#ctx.noteMutation(true);
    return toIntent(row);
  }

  async findById(id: IntentId): Promise<HealthIntent | undefined> {
    const rows = await this.#ex
      .select()
      .from(healthIntents)
      .where(eq(healthIntents.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toIntent(rows[0]);
  }

  async listByPerson(personId: PersonId, page?: CursorPage): Promise<CursorPageResult<HealthIntent>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(healthIntents.personId, personId)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, healthIntents.createdAt, healthIntents.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(healthIntents)
      .where(and(...conditions))
      .orderBy(desc(healthIntents.createdAt), desc(healthIntents.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toIntent), nextCursor };
  }

  async transition(
    id: IntentId,
    to: IntentState,
    options: TransitionOptions<IntentState>,
  ): Promise<HealthIntent> {
    requireMutationScope(this.#ctx);
    assertIntentTransition(options.expectedFrom, to);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "health_intents",
      operation: "transition",
      idempotencyKey: options.idempotencyKey,
      recordId: id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as IntentId);
      if (stored === undefined) {
        throw replayMissing("health intent");
      }
      return stored;
    }
    const rows = await this.#ex
      .update(healthIntents)
      .set({ state: to })
      .where(and(eq(healthIntents.id, id), eq(healthIntents.state, options.expectedFrom)))
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      // No canonical INTENT_* state-change event type exists (§11).
      this.#ctx.noteMutation(false);
      return toIntent(row);
    }
    const current = await this.requireCurrent(id, "health intent");
    if (current.state === to) {
      return current;
    }
    throw diverged("health intent");
  }

  async setPlan(id: IntentId, planId: PlanId, options: MutationOptions): Promise<HealthIntent> {
    requireMutationScope(this.#ctx);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "health_intents",
      operation: "set_plan",
      idempotencyKey: options.idempotencyKey,
      recordId: id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as IntentId);
      if (stored === undefined) {
        throw replayMissing("health intent");
      }
      return stored;
    }
    const rows = await this.#ex
      .update(healthIntents)
      .set({ planId })
      .where(eq(healthIntents.id, id))
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw notFound("health intent");
    }
    // PLAN_PUBLISHED belongs to the plan transition, not to the link.
    this.#ctx.noteMutation(false);
    return toIntent(row);
  }

  async requireCurrent(id: IntentId, what: string): Promise<HealthIntent> {
    const current = await this.findById(id);
    if (current === undefined) {
      throw notFound(what);
    }
    return current;
  }
}

// ---------------------------------------------------------------------------
// Observation.
// ---------------------------------------------------------------------------

export class DrizzleObservationRepository implements ObservationRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(observation: Observation, options: MutationOptions): Promise<Observation> {
    requireMutationScope(this.#ctx);
    assertObservation(observation);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "observations",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: observation.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as ObservationId);
      if (stored === undefined) {
        throw replayMissing("observation");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(observations)
      .values({
        id: observation.id,
        personId: observation.personId,
        conceptCode: observation.conceptCode,
        value: { v: observation.value },
        unit: observation.unit,
        effectiveAt: observation.effectiveAt,
        observedAt: observation.observedAt,
        sourceId: observation.sourceId,
        methodId: observation.methodId,
        validationState: observation.validationState,
        provenanceId: observation.provenanceId,
        evidenceLabel: observation.evidenceLabel,
        ...(observation.evidenceId !== undefined ? { evidenceId: observation.evidenceId } : {}),
        ...(observation.quality !== undefined ? { quality: observation.quality } : {}),
        ...(observation.supersedesId !== undefined
          ? { supersedesId: observation.supersedesId }
          : {}),
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("observation (id or supersedes linkage already stored)");
    }
    // OBSERVATION_RECORDED (§11).
    this.#ctx.noteMutation(true);
    return toObservation(row);
  }

  async findById(id: ObservationId): Promise<Observation | undefined> {
    const rows = await this.#ex
      .select()
      .from(observations)
      .where(eq(observations.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toObservation(rows[0]);
  }

  async listByPerson(personId: PersonId, page?: CursorPage): Promise<CursorPageResult<Observation>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(observations.personId, personId)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, observations.createdAt, observations.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(observations)
      .where(and(...conditions))
      .orderBy(desc(observations.createdAt), desc(observations.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toObservation), nextCursor };
  }

  async listByPersonAndConcept(
    personId: PersonId,
    conceptCode: string,
    page?: CursorPage,
  ): Promise<CursorPageResult<Observation>> {
    if (typeof conceptCode !== "string" || conceptCode.length === 0) {
      throw new PersistenceError("invalid-request", "conceptCode must be a non-empty string.");
    }
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [
      eq(observations.personId, personId),
      eq(observations.conceptCode, conceptCode),
    ];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, observations.createdAt, observations.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(observations)
      .where(and(...conditions))
      .orderBy(desc(observations.createdAt), desc(observations.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toObservation), nextCursor };
  }

  async transition(
    id: ObservationId,
    to: ObservationValidationState,
    options: TransitionOptions<ObservationValidationState>,
  ): Promise<Observation> {
    requireMutationScope(this.#ctx);
    assertObservationValidationTransition(options.expectedFrom, to);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "observations",
      operation: "transition",
      idempotencyKey: options.idempotencyKey,
      recordId: id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as ObservationId);
      if (stored === undefined) {
        throw replayMissing("observation");
      }
      return stored;
    }
    const rows = await this.#ex
      .update(observations)
      .set({ validationState: to })
      .where(and(eq(observations.id, id), eq(observations.validationState, options.expectedFrom)))
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      // No canonical OBSERVATION_VALIDATED/REJECTED event type (§11).
      this.#ctx.noteMutation(false);
      return toObservation(row);
    }
    const current = await this.requireCurrent(id);
    if (current.validationState === to) {
      return current;
    }
    throw diverged("observation");
  }

  async applySupersession(pair: SupersededPair, options: MutationOptions): Promise<SupersededPair> {
    requireMutationScope(this.#ctx);
    assertObservation(pair.superseded);
    assertObservation(pair.replacement);
    if (pair.replacement.supersedesId !== pair.superseded.id) {
      throw new PersistenceError(
        "invalid-request",
        "Invalid supersession pair: replacement.supersedesId must reference the superseded observation (produce pairs via the domain supersede() function).",
      );
    }
    if (
      pair.superseded.validationState !== "superseded" ||
      pair.replacement.validationState !== "validated"
    ) {
      throw new PersistenceError(
        "invalid-request",
        "Invalid supersession pair: expected the old observation as 'superseded' and the replacement as 'validated' (produce pairs via the domain supersede() function).",
      );
    }
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "observations",
      operation: "supersede",
      idempotencyKey: options.idempotencyKey,
      recordId: pair.replacement.id,
    });
    if (claim.replayed) {
      const oldRow = await this.findById(pair.superseded.id);
      const newRow = await this.findById(pair.replacement.id);
      if (oldRow === undefined || newRow === undefined) {
        throw replayMissing("supersession pair");
      }
      return { superseded: oldRow, replacement: newRow };
    }
    // Only a VALIDATED observation may be superseded (frozen domain
    // machine); the guarded update keeps the check atomic.
    const updated = await this.#ex
      .update(observations)
      .set({ validationState: "superseded" })
      .where(
        and(eq(observations.id, pair.superseded.id), eq(observations.validationState, "validated")),
      )
      .returning();
    const oldRow = updated[0];
    if (oldRow === undefined) {
      const current = await this.findById(pair.superseded.id);
      if (current === undefined) {
        throw notFound("superseded observation");
      }
      throw diverged("superseded observation");
    }
    const inserted = await this.#ex
      .insert(observations)
      .values({
        id: pair.replacement.id,
        personId: pair.replacement.personId,
        conceptCode: pair.replacement.conceptCode,
        value: { v: pair.replacement.value },
        unit: pair.replacement.unit,
        effectiveAt: pair.replacement.effectiveAt,
        observedAt: pair.replacement.observedAt,
        sourceId: pair.replacement.sourceId,
        methodId: pair.replacement.methodId,
        validationState: pair.replacement.validationState,
        provenanceId: pair.replacement.provenanceId,
        evidenceLabel: pair.replacement.evidenceLabel,
        ...(pair.replacement.evidenceId !== undefined
          ? { evidenceId: pair.replacement.evidenceId }
          : {}),
        ...(pair.replacement.quality !== undefined ? { quality: pair.replacement.quality } : {}),
        ...(pair.replacement.supersedesId !== undefined
          ? { supersedesId: pair.replacement.supersedesId }
          : {}),
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    const newRow = inserted[0];
    if (newRow === undefined) {
      throw uniqueConflict("replacement observation (id or supersedes linkage already stored)");
    }
    // OBSERVATION_SUPERSEDED (§11).
    this.#ctx.noteMutation(true);
    return { superseded: toObservation(oldRow), replacement: toObservation(newRow) };
  }

  async requireCurrent(id: ObservationId): Promise<Observation> {
    const current = await this.findById(id);
    if (current === undefined) {
      throw notFound("observation");
    }
    return current;
  }
}

// ---------------------------------------------------------------------------
// EvidenceObject.
// ---------------------------------------------------------------------------

export class DrizzleEvidenceObjectRepository implements EvidenceObjectRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(
    evidence: EvidenceObjectRecord,
    options: MutationOptions,
  ): Promise<EvidenceObjectRecord> {
    requireMutationScope(this.#ctx);
    assertEvidenceObjectRecord(evidence);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "evidence_objects",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: evidence.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as EvidenceId);
      if (stored === undefined) {
        throw replayMissing("evidence object");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(evidenceObjects)
      .values({
        id: evidence.id,
        personId: evidence.personId,
        objectKey: evidence.objectKey,
        mediaType: evidence.mediaType,
        sha256: evidence.sha256,
        sizeBytes: evidence.sizeBytes,
        capturedAt: evidence.capturedAt,
        sourceType: evidence.sourceType,
        provenanceId: evidence.provenanceId,
        retentionClass: evidence.retentionClass,
        state: evidence.state,
        // The upstream record owns its creation time when it carries one
        // (intent/plan convention); otherwise the persistence layer
        // stamps it (M2-A behavior).
        createdAt: evidence.createdAt ?? this.#clock.now(),
        // M2-D upload-plane columns (absent on legacy / non-upload rows).
        ...(evidence.sessionId !== undefined ? { sessionId: evidence.sessionId } : {}),
        ...(evidence.encryptedMetadata !== undefined
          ? { encryptedMetadata: serializeEncryptedEnvelope(evidence.encryptedMetadata) }
          : {}),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("evidence object (id, object key, or session already stored)");
    }
    // EVIDENCE_INGESTED (§11).
    this.#ctx.noteMutation(true);
    return toEvidence(row);
  }

  async findById(id: EvidenceId): Promise<EvidenceObjectRecord | undefined> {
    const rows = await this.#ex
      .select()
      .from(evidenceObjects)
      .where(eq(evidenceObjects.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toEvidence(rows[0]);
  }

  async findByObjectKey(objectKey: string): Promise<EvidenceObjectRecord | undefined> {
    if (typeof objectKey !== "string" || objectKey.length === 0) {
      throw new PersistenceError("invalid-request", "objectKey must be a non-empty string.");
    }
    const rows = await this.#ex
      .select()
      .from(evidenceObjects)
      .where(eq(evidenceObjects.objectKey, objectKey))
      .limit(1);
    return rows[0] === undefined ? undefined : toEvidence(rows[0]);
  }

  async listByPerson(
    personId: PersonId,
    page?: CursorPage,
  ): Promise<CursorPageResult<EvidenceObjectRecord>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(evidenceObjects.personId, personId)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, evidenceObjects.createdAt, evidenceObjects.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(evidenceObjects)
      .where(and(...conditions))
      .orderBy(desc(evidenceObjects.createdAt), desc(evidenceObjects.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toEvidence), nextCursor };
  }
}

// ---------------------------------------------------------------------------
// UploadSession (M2-D Lane A — §6 raw-object upload flow).
// ---------------------------------------------------------------------------

export class DrizzleUploadSessionRepository implements UploadSessionRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(
    session: UploadSessionRecord,
    options: MutationOptions,
  ): Promise<UploadSessionRecord> {
    requireMutationScope(this.#ctx);
    assertUploadSessionRecord(session);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "upload_sessions",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: session.sessionId,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as UploadSessionId);
      if (stored === undefined) {
        throw replayMissing("upload session");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(uploadSessionsTable)
      .values({
        sessionId: session.sessionId,
        evidenceId: session.evidenceId,
        personId: session.personId,
        objectKey: session.objectKey,
        mediaType: session.mediaType,
        declaredSha256: session.declaredSha256,
        declaredSizeBytes: session.declaredSizeBytes,
        purpose: session.purpose,
        scope: [...session.scope],
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        state: session.state,
        ...(session.finalizedAt !== undefined ? { finalizedAt: session.finalizedAt } : {}),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("upload session (session or evidence id already stored)");
    }
    // No canonical UPLOAD_SESSION_* event type exists (§11) — a session
    // insert does not arm the outbox guard (create-before-publication
    // metadata, the persons/accounts precedent).
    this.#ctx.noteMutation(false);
    return toUploadSession(row);
  }

  async findById(sessionId: UploadSessionId): Promise<UploadSessionRecord | undefined> {
    const rows = await this.#ex
      .select()
      .from(uploadSessionsTable)
      .where(eq(uploadSessionsTable.sessionId, sessionId))
      .limit(1);
    return rows[0] === undefined ? undefined : toUploadSession(rows[0]);
  }

  async listByPerson(
    personId: PersonId,
    page?: CursorPage,
  ): Promise<CursorPageResult<UploadSessionRecord>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(uploadSessionsTable.personId, personId)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(
          page.cursor,
          uploadSessionsTable.createdAt,
          uploadSessionsTable.sessionId,
          "desc",
        ),
      );
    }
    const rows = await this.#ex
      .select()
      .from(uploadSessionsTable)
      .where(and(...conditions))
      .orderBy(desc(uploadSessionsTable.createdAt), desc(uploadSessionsTable.sessionId))
      .limit(limit + 1);
    // The anchor is (created_at, session_id); wrap the rows so the
    // generic pageOf sees a uniform (createdAt, id) anchor shape (the
    // same pattern as the outbox repository).
    const anchored = rows.map((row) => ({ createdAt: row.createdAt, id: row.sessionId, row }));
    const { items, nextCursor } = pageOf(anchored, limit);
    return { items: items.map((anchor) => toUploadSession(anchor.row)), nextCursor };
  }

  async markFinalized(
    sessionId: UploadSessionId,
    options: FinalizeSessionOptions,
  ): Promise<UploadSessionRecord> {
    requireMutationScope(this.#ctx);
    if (options.expectedFrom !== "open") {
      throw new PersistenceError(
        "invalid-request",
        "Invalid upload-session finalize: the only legal transition is open → finalized.",
      );
    }
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "upload_sessions",
      operation: "finalize",
      idempotencyKey: options.idempotencyKey,
      recordId: sessionId,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as UploadSessionId);
      if (stored === undefined) {
        throw replayMissing("upload session");
      }
      return stored;
    }
    const rows = await this.#ex
      .update(uploadSessionsTable)
      .set({ state: "finalized", finalizedAt: options.finalizedAt })
      .where(
        and(eq(uploadSessionsTable.sessionId, sessionId), eq(uploadSessionsTable.state, "open")),
      )
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      // The session flip itself has no canonical §11 event type — the
      // EVIDENCE_INGESTED event belongs to the evidence insert that this
      // transition accompanies (driven by the M2-D adapter, one
      // transaction).
      this.#ctx.noteMutation(false);
      return toUploadSession(row);
    }
    const current = await this.findById(sessionId);
    if (current === undefined) {
      throw notFound("upload session");
    }
    if (current.state === "finalized") {
      return current;
    }
    throw diverged("upload session");
  }
}

// ---------------------------------------------------------------------------
// MeasurementPlan.
// ---------------------------------------------------------------------------

export class DrizzleMeasurementPlanRepository implements MeasurementPlanRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(plan: MeasurementPlan, options: MutationOptions): Promise<MeasurementPlan> {
    requireMutationScope(this.#ctx);
    assertMeasurementPlan(plan);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "measurement_plans",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: plan.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as PlanId);
      if (stored === undefined) {
        throw replayMissing("measurement plan");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(measurementPlans)
      .values({
        id: plan.id,
        personId: plan.personId,
        intentId: plan.intentId,
        state: plan.state,
        metrics: [...plan.metrics],
        createdAt: plan.createdAt,
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("measurement plan");
    }
    // No canonical PLAN_CREATED type — a draft insert emits nothing.
    this.#ctx.noteMutation(false);
    return toPlan(row);
  }

  async findById(id: PlanId): Promise<MeasurementPlan | undefined> {
    const rows = await this.#ex
      .select()
      .from(measurementPlans)
      .where(eq(measurementPlans.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toPlan(rows[0]);
  }

  async listByPerson(personId: PersonId, page?: CursorPage): Promise<CursorPageResult<MeasurementPlan>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(measurementPlans.personId, personId)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, measurementPlans.createdAt, measurementPlans.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(measurementPlans)
      .where(and(...conditions))
      .orderBy(desc(measurementPlans.createdAt), desc(measurementPlans.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toPlan), nextCursor };
  }

  async transition(
    id: PlanId,
    to: PlanState,
    options: TransitionOptions<PlanState>,
  ): Promise<MeasurementPlan> {
    requireMutationScope(this.#ctx);
    assertPlanTransition(options.expectedFrom, to);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "measurement_plans",
      operation: "transition",
      idempotencyKey: options.idempotencyKey,
      recordId: id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as PlanId);
      if (stored === undefined) {
        throw replayMissing("measurement plan");
      }
      return stored;
    }
    const rows = await this.#ex
      .update(measurementPlans)
      .set({ state: to })
      .where(and(eq(measurementPlans.id, id), eq(measurementPlans.state, options.expectedFrom)))
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      // PLAN_PUBLISHED exists for the publish transition; the other
      // transitions have no canonical type (§11) and do not arm the guard.
      this.#ctx.noteMutation(to === "published");
      return toPlan(row);
    }
    const current = await this.requireCurrent(id);
    if (current.state === to) {
      return current;
    }
    throw diverged("measurement plan");
  }

  async requireCurrent(id: PlanId): Promise<MeasurementPlan> {
    const current = await this.findById(id);
    if (current === undefined) {
      throw notFound("measurement plan");
    }
    return current;
  }
}

// ---------------------------------------------------------------------------
// AccessGrant.
// ---------------------------------------------------------------------------

/** Ceiling for the unpaginated candidate-grant query (see docs below). */
export const GRANT_SAFETY_CEILING = 1000;

export class DrizzleAccessGrantRepository implements AccessGrantRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  async insert(grant: AccessGrant, options: MutationOptions): Promise<AccessGrant> {
    requireMutationScope(this.#ctx);
    assertAccessGrant(grant);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "access_grants",
      operation: "insert",
      idempotencyKey: options.idempotencyKey,
      recordId: grant.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as GrantId);
      if (stored === undefined) {
        throw replayMissing("access grant");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(accessGrants)
      .values({
        id: grant.id,
        subjectId: grant.subjectId,
        recipientId: grant.recipientId,
        purpose: grant.purpose,
        scope: [...grant.scope],
        state: grant.state,
        expiresAt: grant.expiresAt,
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw uniqueConflict("access grant");
    }
    // ACCESS_GRANTED (§11).
    this.#ctx.noteMutation(true);
    return toGrant(row);
  }

  async findById(id: GrantId): Promise<AccessGrant | undefined> {
    const rows = await this.#ex
      .select()
      .from(accessGrants)
      .where(eq(accessGrants.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toGrant(rows[0]);
  }

  async listBySubject(subjectId: PersonId, page?: CursorPage): Promise<CursorPageResult<AccessGrant>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(accessGrants.subjectId, subjectId)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, accessGrants.createdAt, accessGrants.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(accessGrants)
      .where(and(...conditions))
      .orderBy(desc(accessGrants.createdAt), desc(accessGrants.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toGrant), nextCursor };
  }

  async listBySubjectAndRecipient(
    subjectId: PersonId,
    recipientId: string,
  ): Promise<readonly AccessGrant[]> {
    if (typeof recipientId !== "string" || recipientId.length === 0) {
      throw new PersistenceError("invalid-request", "recipientId must be a non-empty string.");
    }
    // Safety ceiling, NOT pagination: the access evaluator must see
    // EVERY candidate grant — silent truncation would be a security bug.
    const rows = await this.#ex
      .select()
      .from(accessGrants)
      .where(and(eq(accessGrants.subjectId, subjectId), eq(accessGrants.recipientId, recipientId)))
      .limit(GRANT_SAFETY_CEILING + 1);
    if (rows.length > GRANT_SAFETY_CEILING) {
      throw new PersistenceError(
        "state-conflict",
        `Grant cardinality for one subject/recipient pair exceeds the safety ceiling of ${GRANT_SAFETY_CEILING}; refusing to evaluate a truncated candidate set.`,
      );
    }
    return rows.map(toGrant);
  }

  async transition(
    id: GrantId,
    to: GrantState,
    options: TransitionOptions<GrantState>,
  ): Promise<AccessGrant> {
    requireMutationScope(this.#ctx);
    assertGrantTransition(options.expectedFrom, to);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "access_grants",
      operation: "transition",
      idempotencyKey: options.idempotencyKey,
      recordId: id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as GrantId);
      if (stored === undefined) {
        throw replayMissing("access grant");
      }
      return stored;
    }
    const rows = await this.#ex
      .update(accessGrants)
      .set({ state: to })
      .where(and(eq(accessGrants.id, id), eq(accessGrants.state, options.expectedFrom)))
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      // ACCESS_REVOKED (§11) — the only legal transition.
      this.#ctx.noteMutation(true);
      return toGrant(row);
    }
    const current = await this.requireCurrent(id);
    if (current.state === to) {
      return current;
    }
    throw diverged("access grant");
  }

  async requireCurrent(id: GrantId): Promise<AccessGrant> {
    const current = await this.findById(id);
    if (current === undefined) {
      throw notFound("access grant");
    }
    return current;
  }
}

// ---------------------------------------------------------------------------
// AccessAudit — A20 append-only repository.
// ---------------------------------------------------------------------------

export class DrizzleAccessAuditRepository implements AccessAuditRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;
  readonly #ctx: MutationContext;

  constructor(ex: OrbbExecutor, clock: Clock, ctx: MutationContext) {
    this.#ex = ex;
    this.#clock = clock;
    this.#ctx = ctx;
  }

  /**
   * INSERT-only mutation. There is deliberately no update, no delete,
   * and no state transition anywhere on this surface; the append-only
   * trigger from migration 0001 backs the same invariant at the
   * database level.
   */
  async appendAccessAudit(
    record: AccessAuditRecord,
    options: MutationOptions,
  ): Promise<AccessAuditRecord> {
    requireMutationScope(this.#ctx);
    assertAccessAuditRecord(record);
    const claim = await claimIdempotency(this.#ex, this.#clock, {
      tableName: "access_audits",
      operation: "append",
      idempotencyKey: options.idempotencyKey,
      recordId: record.id,
    });
    if (claim.replayed) {
      const stored = await this.findById(claim.recordId as AccessAuditRecord["id"]);
      if (stored === undefined) {
        throw replayMissing("access audit");
      }
      return stored;
    }
    const rows = await this.#ex
      .insert(accessAudits)
      .values({
        id: record.id,
        decisionId: record.decisionId,
        subjectId: record.subjectId,
        decision: record.decision,
        at: record.at,
        actor: record.actor,
        requestDigest: record.requestDigest,
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) {
      // Either the audit id or the decision id is already stored.
      const byId = await this.findById(record.id);
      if (byId !== undefined) {
        throw uniqueConflict("access audit (id already stored)");
      }
      const byDecision = await this.#ex
        .select({ id: accessAudits.id })
        .from(accessAudits)
        .where(eq(accessAudits.decisionId, record.decisionId))
        .limit(1);
      if (byDecision[0] !== undefined) {
        throw uniqueConflict("access audit (decision already audited)");
      }
      throw uniqueConflict("access audit");
    }
    // ACCESS_EVALUATED (§11).
    this.#ctx.noteMutation(true);
    return toAudit(row);
  }

  async findById(id: AccessAuditRecord["id"]): Promise<AccessAuditRecord | undefined> {
    const rows = await this.#ex
      .select()
      .from(accessAudits)
      .where(eq(accessAudits.id, id))
      .limit(1);
    return rows[0] === undefined ? undefined : toAudit(rows[0]);
  }

  async listBySubject(
    subjectId: PersonId,
    page?: CursorPage,
  ): Promise<CursorPageResult<AccessAuditRecord>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(accessAudits.subjectId, subjectId)];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, accessAudits.createdAt, accessAudits.id, "desc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(accessAudits)
      .where(and(...conditions))
      .orderBy(desc(accessAudits.createdAt), desc(accessAudits.id))
      .limit(limit + 1);
    const { items, nextCursor } = pageOf(rows, limit);
    return { items: items.map(toAudit), nextCursor };
  }
}

// ---------------------------------------------------------------------------
// Outbox (publisher surface + in-transaction appends).
// ---------------------------------------------------------------------------

/** Truncation bound for stored publication errors. */
const LAST_ERROR_MAX_LENGTH = 2000;

export class DrizzleOutboxRepository implements OutboxRepository {
  readonly #ex: OrbbExecutor;
  readonly #clock: Clock;

  constructor(ex: OrbbExecutor, clock: Clock) {
    this.#ex = ex;
    this.#clock = clock;
  }

  async append(event: NewOutboxEvent): Promise<OutboxRecord> {
    const { record } = await this.appendInternal(event);
    return record;
  }

  /**
   * Internal: append + report whether THIS call wrote the row (a
   * same-content replay of an already-stored event writes nothing).
   * The unit-of-work facade uses the flag for its §4 guard.
   */
  async appendInternal(
    event: NewOutboxEvent,
  ): Promise<{ record: OutboxRecord; wrote: boolean }> {
    assertNewOutboxEvent(event);
    const rows = await this.#ex
      .insert(outboxTable)
      .values({
        eventId: event.eventId,
        eventType: event.eventType,
        payload: event.payload,
        status: "pending",
        attempts: 0,
        createdAt: this.#clock.now(),
      })
      .onConflictDoNothing({ target: outboxTable.eventId })
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      return { record: toOutbox(row), wrote: true };
    }
    const stored = await this.findById(event.eventId);
    if (stored === undefined) {
      throw uniqueConflict("outbox event");
    }
    if (stored.eventType !== event.eventType || stored.payload !== event.payload) {
      throw new PersistenceError(
        "state-conflict",
        "Outbox event id was reused with different content (type or payload differs).",
      );
    }
    return { record: stored, wrote: false };
  }

  async findById(eventId: NewOutboxEvent["eventId"]): Promise<OutboxRecord | undefined> {
    const rows = await this.#ex
      .select()
      .from(outboxTable)
      .where(eq(outboxTable.eventId, eventId))
      .limit(1);
    return rows[0] === undefined ? undefined : toOutbox(rows[0]);
  }

  async listPending(page?: CursorPage): Promise<CursorPageResult<OutboxRecord>> {
    const limit = clampPageLimit(page?.limit);
    const conditions: SQL[] = [eq(outboxTable.status, "pending")];
    if (page?.cursor !== undefined) {
      conditions.push(
        cursorCondition(page.cursor, outboxTable.createdAt, outboxTable.eventId, "asc"),
      );
    }
    const rows = await this.#ex
      .select()
      .from(outboxTable)
      .where(and(...conditions))
      .orderBy(asc(outboxTable.createdAt), asc(outboxTable.eventId))
      .limit(limit + 1);
    // The outbox anchor is (created_at, event_id); wrap the rows so the
    // generic pageOf sees a uniform (createdAt, id) anchor shape.
    const anchored = rows.map((row) => ({ createdAt: row.createdAt, id: row.eventId, row }));
    const { items, nextCursor } = pageOf(anchored, limit);
    return { items: items.map((anchor) => toOutbox(anchor.row)), nextCursor };
  }

  async markPublished(eventId: NewOutboxEvent["eventId"]): Promise<OutboxRecord> {
    const rows = await this.#ex
      .update(outboxTable)
      .set({ status: "published", publishedAt: this.#clock.now() })
      .where(and(eq(outboxTable.eventId, eventId), ne(outboxTable.status, "published")))
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      return toOutbox(row);
    }
    const stored = await this.findById(eventId);
    if (stored === undefined) {
      throw notFound("outbox event");
    }
    if (stored.status === "published") {
      return stored;
    }
    throw diverged("outbox event");
  }

  async markFailed(eventId: NewOutboxEvent["eventId"], lastError: string): Promise<OutboxRecord> {
    if (typeof lastError !== "string" || lastError.length === 0) {
      throw new PersistenceError("invalid-request", "lastError must be a non-empty string.");
    }
    const truncated = lastError.slice(0, LAST_ERROR_MAX_LENGTH);
    const rows = await this.#ex
      .update(outboxTable)
      .set({
        attempts: sql`${outboxTable.attempts} + 1`,
        status: "failed",
        lastError: truncated,
      })
      .where(eq(outboxTable.eventId, eventId))
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw notFound("outbox event");
    }
    return toOutbox(row);
  }
}

// Re-exported for the facade's ledger bookkeeping (internal use).
export { claimIdempotency, idempotencyLedger };
