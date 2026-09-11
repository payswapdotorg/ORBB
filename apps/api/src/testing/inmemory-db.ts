/**
 * ORBB edge API — in-memory `Db` test double (M3-A test infrastructure).
 *
 * NO live bindings in unit tests (frozen rule): the repositories behind
 * the router are faked with an in-memory implementation of the frozen
 * `@orbb/db` `Db` interface. This file is TEST-ONLY — never imported
 * from the Worker entry — so value imports from @orbb/db (pure cursor
 * helpers + guards) are fine here.
 *
 * Fidelity contract (what the double mirrors from DrizzleDb/PGlite):
 *   - mutations outside `transaction()` are rejected (§4 discipline);
 *   - the idempotency ledger semantics of `claimIdempotency` —
 *     first-write-wins, replay returns the STORED record, malformed
 *     keys are "invalid-request", a vanished replay target is a
 *     "state-conflict";
 *   - duplicate primary keys under a FRESH key are "state-conflict";
 *   - the outbox-required guard: a transaction whose real mutations
 *     armed the guard (INTENT_CREATED / OBSERVATION_RECORDED /
 *     EVIDENCE_INGESTED / …) must append at least one outbox event —
 *     replays note nothing and demand nothing;
 *   - outbox append dedupe: same eventId + same content replays the
 *     stored row (wrote=false); different content is a "state-conflict";
 *   - `(createdAt, id)` newest-first cursor pagination over rows, using
 *     the REAL pure helpers from @orbb/db (clampPageLimit/applyCursor/
 *     pageOf) so cursor semantics cannot drift from production;
 *   - the Postgres FKs the API's writes traverse: observations reference
 *     persons/provenances/evidence; intents reference persons. FK
 *     violations throw plain Errors (like the driver) → 500 envelope.
 *
 * RECORDED LIMITATION: transactions are NOT rollback-isolated — a guard
 * failure leaves prior writes in the store. The API tests never depend
 * on rollback semantics (the PGlite harness in packages/db owns that
 * fidelity). Families the router never touches (upload sessions, plans,
 * grants, audits; outbox publisher methods) throw explicit
 * not-implemented errors.
 */
import {
  assertEvidenceObjectRecord,
  assertNewOutboxEvent,
  assertPersonRecord,
  clampPageLimit,
  applyCursor,
  pageOf,
  PersistenceError,
} from "@orbb/db";
import type {
  AccountRecord,
  AccountRepository,
  CursorPage,
  CursorPageResult,
  Db,
  EvidenceObjectRecord,
  EvidenceObjectRepository,
  HealthIntentRepository,
  MutationOptions,
  NewOutboxEvent,
  ObservationRepository,
  OutboxRepository,
  PersonRecord,
  PersonRepository,
  ProvenanceRepository,
  UnitOfWork,
} from "@orbb/db";
import {
  assertHealthIntent,
  assertObservation,
  assertProvenance,
  type HealthIntent,
  type IntentId,
  type IntentState,
  type Observation,
  type ObservationId,
  type ObservationValidationState,
  type PersonId,
  type PlanId,
  type Provenance,
  type ProvenanceId,
  type SupersededPair,
} from "@orbb/domain";
import type { OutboxRecord } from "@orbb/contracts";
import type { ApiClock } from "../context.js";

/** Internal mutation-scope plumbing (structural twin of @orbb/db's). */
interface MutationContext {
  readonly inTransaction: boolean;
  noteMutation(armsOutboxGuard: boolean): void;
}

function requireMutationScope(ctx: MutationContext): void {
  if (!ctx.inTransaction) {
    throw new PersistenceError(
      "invalid-request",
      "Domain mutations must run inside db.transaction() (architecture §4: state + outbox event commit atomically).",
    );
  }
}

function notImplemented(what: string): Error {
  return new Error(
    `The in-memory API test double does not implement ${what} (not on the /v1 router surface; use the PGlite harness in packages/db for that fidelity).`,
  );
}

function replayMissing(table: string): PersistenceError {
  return new PersistenceError(
    "state-conflict",
    `Idempotent replay for a ${table} mutation found no stored record; the ledger and the table disagree.`,
  );
}

function uniqueConflict(table: string): PersistenceError {
  return new PersistenceError(
    "state-conflict",
    `Unique key conflict while storing ${table} under a fresh idempotency key.`,
  );
}

/** A stored row plus its pagination anchor. */
interface RowBox<T> {
  readonly record: T;
  readonly anchor: { readonly createdAt: Date; readonly id: string };
}

/**
 * An anchor-shaped pagination entry: satisfies the pure `CursorAnchorRow`
 * contract ({ createdAt, id }) while carrying the record alongside, so
 * `applyCursor`/`pageOf` filter and slice real rows.
 */
interface AnchoredRow<T> {
  readonly createdAt: Date;
  readonly id: string;
  readonly record: T;
}

/**
 * The in-memory `Db`. One instance per test harness; deterministic clock
 * and id factory are injected by the harness.
 */
export class InMemoryDb implements Db {
  readonly #clock: ApiClock;
  readonly #ledger = new Map<string, string>();
  readonly #persons = new Map<string, RowBox<PersonRecord>>();
  readonly #accounts = new Map<string, RowBox<AccountRecord>>();
  readonly #provenances = new Map<string, RowBox<Provenance>>();
  readonly #intents = new Map<string, RowBox<HealthIntent>>();
  readonly #observations = new Map<string, RowBox<Observation>>();
  readonly #evidence = new Map<string, RowBox<EvidenceObjectRecord>>();
  readonly #outbox = new Map<string, OutboxRecord>();

  readonly persons: PersonRepository;
  readonly accounts: AccountRepository;
  readonly provenances: ProvenanceRepository;
  readonly intents: HealthIntentRepository;
  readonly observations: ObservationRepository;
  readonly evidence: EvidenceObjectRepository;
  readonly uploadSessions: Db["uploadSessions"];
  readonly plans: Db["plans"];
  readonly grants: Db["grants"];
  readonly audits: Db["audits"];
  readonly outbox: OutboxRepository;

  readonly #rootCtx: MutationContext = {
    inTransaction: false,
    noteMutation(): never {
      throw new PersistenceError(
        "invalid-request",
        "Domain mutations must run inside db.transaction() (architecture §4: state + outbox event commit atomically).",
      );
    },
  };

  constructor(clock: ApiClock) {
    this.#clock = clock;
    this.persons = this.#createPersonRepo(this.#rootCtx);
    this.accounts = this.#createAccountRepo(this.#rootCtx);
    this.provenances = this.#createProvenanceRepo(this.#rootCtx);
    this.intents = this.#createIntentRepo(this.#rootCtx);
    this.observations = this.#createObservationRepo(this.#rootCtx);
    this.evidence = this.#createEvidenceRepo(this.#rootCtx);
    this.uploadSessions = {
      insert: () => Promise.reject(notImplemented("uploadSessions.insert")),
      findById: () => Promise.reject(notImplemented("uploadSessions.findById")),
      listByPerson: () => Promise.reject(notImplemented("uploadSessions.listByPerson")),
      markFinalized: () => Promise.reject(notImplemented("uploadSessions.markFinalized")),
    };
    this.plans = {
      insert: () => Promise.reject(notImplemented("plans.insert")),
      findById: () => Promise.reject(notImplemented("plans.findById")),
      listByPerson: () => Promise.reject(notImplemented("plans.listByPerson")),
      transition: () => Promise.reject(notImplemented("plans.transition")),
    };
    this.grants = {
      insert: () => Promise.reject(notImplemented("grants.insert")),
      findById: () => Promise.reject(notImplemented("grants.findById")),
      listBySubject: () => Promise.reject(notImplemented("grants.listBySubject")),
      listBySubjectAndRecipient: () =>
        Promise.reject(notImplemented("grants.listBySubjectAndRecipient")),
      transition: () => Promise.reject(notImplemented("grants.transition")),
    };
    this.audits = {
      appendAccessAudit: () => Promise.reject(notImplemented("audits.appendAccessAudit")),
      findById: () => Promise.reject(notImplemented("audits.findById")),
      listBySubject: () => Promise.reject(notImplemented("audits.listBySubject")),
    };
    this.outbox = {
      append: async (event: NewOutboxEvent) => this.#appendOutboxEvent(event).record,
      findById: async (eventId) => this.#outbox.get(eventId),
      listPending: () => Promise.reject(notImplemented("outbox.listPending")),
      markPublished: () => Promise.reject(notImplemented("outbox.markPublished")),
      markFailed: () => Promise.reject(notImplemented("outbox.markFailed")),
    };
  }

  async transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    const state = { mutations: 0, events: 0 };
    const ctx: MutationContext = {
      inTransaction: true,
      noteMutation(armsOutboxGuard: boolean): void {
        if (armsOutboxGuard) {
          state.mutations += 1;
        }
      },
    };
    const uow: UnitOfWork = {
      persons: this.#createPersonRepo(ctx),
      accounts: this.#createAccountRepo(ctx),
      provenances: this.#createProvenanceRepo(ctx),
      intents: this.#createIntentRepo(ctx),
      observations: this.#createObservationRepo(ctx),
      evidence: this.#createEvidenceRepo(ctx),
      uploadSessions: this.uploadSessions,
      plans: this.plans,
      grants: this.grants,
      audits: this.audits,
      appendEvent: async (event: NewOutboxEvent): Promise<OutboxRecord> => {
        const { record, wrote } = this.#appendOutboxEvent(event);
        if (wrote) {
          state.events += 1;
        }
        return record;
      },
    };
    const result = await work(uow);
    if (state.mutations > 0 && state.events === 0) {
      throw new PersistenceError(
        "outbox-required",
        "A mutating transaction appended no outbox event (architecture §4: domain state and its event commit atomically); the transaction was rolled back.",
      );
    }
    return result;
  }

  async close(): Promise<void> {
    // No connections to close.
  }

  // --- Test-support introspection (harness only; NOT on the Db interface). ---

  /** Outbox rows, oldest-first (for event assertions). */
  listOutboxForTests(): readonly OutboxRecord[] {
    return [...this.#outbox.values()].sort((a, b) =>
      a.createdAt.getTime() === b.createdAt.getTime()
        ? (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
        : a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  /** Ledger claims, for idempotency-replay assertions. */
  countLedgerClaimsForTests(): number {
    return this.#ledger.size;
  }

  // --- Internals. ---

  #claim(
    table: string,
    operation: string,
    key: string,
    recordId: string,
  ): { replayed: false } | { replayed: true; recordId: string } {
    if (typeof key !== "string" || key.length === 0 || key.length > 256) {
      throw new PersistenceError(
        "invalid-request",
        "Invalid idempotency key: expected a non-empty string of at most 256 characters.",
      );
    }
    const claimKey = `${table}\u0000${operation}\u0000${key}`;
    const existing = this.#ledger.get(claimKey);
    if (existing === undefined) {
      this.#ledger.set(claimKey, recordId);
      return { replayed: false };
    }
    return { replayed: true, recordId: existing };
  }

  #appendOutboxEvent(event: NewOutboxEvent): { record: OutboxRecord; wrote: boolean } {
    assertNewOutboxEvent(event);
    const existing = this.#outbox.get(event.eventId);
    if (existing !== undefined) {
      if (existing.eventType !== event.eventType || existing.payload !== event.payload) {
        throw new PersistenceError(
          "state-conflict",
          "Outbox event id is already stored with different content.",
        );
      }
      return { record: existing, wrote: false };
    }
    const record: OutboxRecord = {
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.payload,
      status: "pending",
      attempts: 0,
      createdAt: this.#clock.now(),
    };
    this.#outbox.set(event.eventId, record);
    return { record, wrote: true };
  }

  #store<T>(map: Map<string, RowBox<T>>, record: T, anchor: { createdAt: Date; id: string }): void {
    map.set(anchor.id, { record, anchor });
  }

  #page<T>(
    map: Map<string, RowBox<T>>,
    page: CursorPage | undefined,
    filter?: (record: T) => boolean,
  ): CursorPageResult<T> {
    const limit = clampPageLimit(page?.limit);
    // Flatten rows into anchor-shaped entries ({ createdAt, id } plus the
    // record) so the REAL pure helpers (applyCursor/pageOf) drive the
    // semantics — cursor behavior cannot drift from production.
    let rows: readonly AnchoredRow<T>[] = [...map.values()].map((row) => ({
      createdAt: row.anchor.createdAt,
      id: row.anchor.id,
      record: row.record,
    }));
    if (filter !== undefined) {
      rows = rows.filter((row) => filter(row.record));
    }
    // Newest-first total order over the (createdAt, id) anchor.
    const sorted = [...rows].sort((a, b) =>
      a.createdAt.getTime() === b.createdAt.getTime()
        ? a.id < b.id
          ? 1
          : a.id > b.id
            ? -1
            : 0
        : b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const window =
      page?.cursor !== undefined ? applyCursor(sorted, page.cursor, "desc") : sorted;
    const { items, nextCursor } = pageOf(window, limit);
    return {
      items: items.map((row) => row.record),
      nextCursor,
    };
  }

  #createPersonRepo(ctx: MutationContext): PersonRepository {
    return {
      insert: async (person: PersonRecord, options: MutationOptions): Promise<PersonRecord> => {
        requireMutationScope(ctx);
        assertPersonRecord(person);
        const claim = this.#claim("persons", "insert", options.idempotencyKey, person.id);
        if (claim.replayed) {
          const stored = this.#persons.get(claim.recordId);
          if (stored === undefined) {
            throw replayMissing("person");
          }
          return stored.record;
        }
        if (this.#persons.has(person.id)) {
          throw uniqueConflict("person");
        }
        this.#store(this.#persons, person, { createdAt: this.#clock.now(), id: person.id });
        ctx.noteMutation(false);
        return person;
      },
      findById: async (id: PersonId) => {
        return this.#persons.get(id)?.record;
      },
      list: async (page?: CursorPage) => {
        return this.#page(this.#persons, page);
      },
    };
  }

  #createAccountRepo(ctx: MutationContext): AccountRepository {
    return {
      insert: async (account: AccountRecord, options: MutationOptions): Promise<AccountRecord> => {
        requireMutationScope(ctx);
        if (!this.#persons.has(account.personId)) {
          throw new Error("in-memory FK violation: accounts.person_id → persons.id");
        }
        const claim = this.#claim("accounts", "insert", options.idempotencyKey, account.id);
        if (claim.replayed) {
          const stored = this.#accounts.get(claim.recordId);
          if (stored === undefined) {
            throw replayMissing("account");
          }
          return stored.record;
        }
        if (this.#accounts.has(account.id)) {
          throw uniqueConflict("account");
        }
        this.#store(this.#accounts, account, { createdAt: this.#clock.now(), id: account.id });
        ctx.noteMutation(false);
        return account;
      },
      findById: async (id: string) => {
        return this.#accounts.get(id)?.record;
      },
      listByPerson: async (personId: PersonId, page?: CursorPage) => {
        return this.#page(this.#accounts, page, (record) => record.personId === personId);
      },
    };
  }

  #createProvenanceRepo(ctx: MutationContext): ProvenanceRepository {
    return {
      insert: async (provenance: Provenance, options: MutationOptions): Promise<Provenance> => {
        requireMutationScope(ctx);
        assertProvenance(provenance);
        if (!this.#persons.has(provenance.subject)) {
          throw new Error("in-memory FK violation: provenances.subject → persons.id");
        }
        const claim = this.#claim("provenances", "insert", options.idempotencyKey, provenance.provenanceId);
        if (claim.replayed) {
          const stored = this.#provenances.get(claim.recordId);
          if (stored === undefined) {
            throw replayMissing("provenance");
          }
          return stored.record;
        }
        if (this.#provenances.has(provenance.provenanceId)) {
          throw uniqueConflict("provenance");
        }
        this.#store(this.#provenances, provenance, {
          createdAt: this.#clock.now(),
          id: provenance.provenanceId,
        });
        ctx.noteMutation(false);
        return provenance;
      },
      findById: async (id: ProvenanceId) => {
        return this.#provenances.get(id)?.record;
      },
      listBySubject: async (subject: PersonId, page?: CursorPage) => {
        return this.#page(this.#provenances, page, (record) => record.subject === subject);
      },
    };
  }

  #createIntentRepo(ctx: MutationContext): HealthIntentRepository {
    return {
      insert: async (intent: HealthIntent, options: MutationOptions): Promise<HealthIntent> => {
        requireMutationScope(ctx);
        assertHealthIntent(intent);
        if (!this.#persons.has(intent.personId)) {
          throw new Error("in-memory FK violation: health_intents.person_id → persons.id");
        }
        const claim = this.#claim("health_intents", "insert", options.idempotencyKey, intent.id);
        if (claim.replayed) {
          const stored = this.#intents.get(claim.recordId);
          if (stored === undefined) {
            throw replayMissing("health intent");
          }
          return stored.record;
        }
        if (this.#intents.has(intent.id)) {
          throw uniqueConflict("health intent");
        }
        // The domain record owns its createdAt (stored verbatim, like Drizzle).
        this.#store(this.#intents, intent, { createdAt: intent.createdAt, id: intent.id });
        ctx.noteMutation(true); // INTENT_CREATED arms the §4 guard.
        return intent;
      },
      findById: async (id: IntentId) => {
        return this.#intents.get(id)?.record;
      },
      listByPerson: async (personId: PersonId, page?: CursorPage) => {
        return this.#page(this.#intents, page, (record) => record.personId === personId);
      },
      transition: (_id: IntentId, _to: IntentState): Promise<HealthIntent> => {
        void _id;
        void _to;
        throw notImplemented("intents.transition");
      },
      setPlan: (_id: IntentId, _planId: PlanId): Promise<HealthIntent> => {
        void _id;
        void _planId;
        throw notImplemented("intents.setPlan");
      },
    };
  }

  #createObservationRepo(ctx: MutationContext): ObservationRepository {
    return {
      insert: async (observation: Observation, options: MutationOptions): Promise<Observation> => {
        requireMutationScope(ctx);
        assertObservation(observation);
        if (!this.#persons.has(observation.personId)) {
          throw new Error("in-memory FK violation: observations.person_id → persons.id");
        }
        if (!this.#provenances.has(observation.provenanceId)) {
          throw new Error("in-memory FK violation: observations.provenance_id → provenances.id");
        }
        if (observation.evidenceId !== undefined && !this.#evidence.has(observation.evidenceId)) {
          throw new Error("in-memory FK violation: observations.evidence_id → evidence_objects.id");
        }
        const claim = this.#claim("observations", "insert", options.idempotencyKey, observation.id);
        if (claim.replayed) {
          const stored = this.#observations.get(claim.recordId);
          if (stored === undefined) {
            throw replayMissing("observation");
          }
          return stored.record;
        }
        if (this.#observations.has(observation.id)) {
          throw uniqueConflict("observation (id or supersedes linkage already stored)");
        }
        this.#store(this.#observations, observation, {
          createdAt: this.#clock.now(),
          id: observation.id,
        });
        ctx.noteMutation(true); // OBSERVATION_RECORDED arms the §4 guard.
        return observation;
      },
      findById: async (id: ObservationId) => {
        return this.#observations.get(id)?.record;
      },
      listByPerson: async (personId: PersonId, page?: CursorPage) => {
        return this.#page(this.#observations, page, (record) => record.personId === personId);
      },
      listByPersonAndConcept: async (
        personId: PersonId,
        conceptCode: string,
        page?: CursorPage,
      ) => {
        if (typeof conceptCode !== "string" || conceptCode.length === 0) {
          throw new PersistenceError("invalid-request", "conceptCode must be a non-empty string.");
        }
        return this.#page(
          this.#observations,
          page,
          (record) => record.personId === personId && record.conceptCode === conceptCode,
        );
      },
      transition: (
        _id: ObservationId,
        _to: ObservationValidationState,
      ): Promise<Observation> => {
        void _id;
        void _to;
        throw notImplemented("observations.transition");
      },
      applySupersession: (): Promise<SupersededPair> => {
        throw notImplemented("observations.applySupersession");
      },
    };
  }

  #createEvidenceRepo(ctx: MutationContext): EvidenceObjectRepository {
    return {
      insert: async (
        evidence: EvidenceObjectRecord,
        options: MutationOptions,
      ): Promise<EvidenceObjectRecord> => {
        requireMutationScope(ctx);
        assertEvidenceObjectRecord(evidence);
        if (!this.#persons.has(evidence.personId)) {
          throw new Error("in-memory FK violation: evidence_objects.person_id → persons.id");
        }
        if (!this.#provenances.has(evidence.provenanceId)) {
          throw new Error("in-memory FK violation: evidence_objects.provenance_id → provenances.id");
        }
        const claim = this.#claim("evidence_objects", "insert", options.idempotencyKey, evidence.id);
        if (claim.replayed) {
          const stored = this.#evidence.get(claim.recordId);
          if (stored === undefined) {
            throw replayMissing("evidence object");
          }
          return stored.record;
        }
        if (this.#evidence.has(evidence.id)) {
          throw uniqueConflict("evidence object");
        }
        this.#store(this.#evidence, evidence, {
          createdAt: evidence.createdAt ?? this.#clock.now(),
          id: evidence.id,
        });
        ctx.noteMutation(true); // EVIDENCE_INGESTED arms the §4 guard.
        return evidence;
      },
      findById: async (id: string) => {
        return this.#evidence.get(id)?.record;
      },
      findByObjectKey: async (objectKey: string) => {
        for (const row of this.#evidence.values()) {
          if (row.record.objectKey === objectKey) {
            return row.record;
          }
        }
        return undefined;
      },
      listByPerson: async (personId: PersonId, page?: CursorPage) => {
        return this.#page(this.#evidence, page, (record) => record.personId === personId);
      },
    };
  }
}
