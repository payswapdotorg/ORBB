/**
 * The `Db` unit-of-work facade — A15 (architecture §4).
 *
 * `transaction(work)`:
 *   1. opens ONE Postgres transaction;
 *   2. binds fresh repositories to it via a transaction-scoped
 *      {@link MutationContext} (mutations noted, replayed idempotent
 *      calls NOT noted);
 *   3. hands `work` a {@link UnitOfWork} whose `appendEvent` writes
 *      outbox rows INSIDE the same transaction (state + event commit
 *      atomically — the transactional outbox pattern);
 *   4. before commit, ENFORCES the §4 rule: a transaction that really
 *      mutated domain state must have appended at least one outbox
 *      event, otherwise it throws and rolls everything back.
 *
 * The root handle exposes the same repositories for READS; their
 * mutating methods reject calls outside a transaction.
 *
 * Production driver: postgres.js against the Neon Postgres connection
 * string (`max: 1` so transactions are supported; `prepare: false` for
 * pg compatibility). The in-memory PGlite harness shares the exact
 * same repository code (see `testing.ts`).
 */
import type { Clock } from "@orbb/testkit";
import type { OutboxRecord } from "@orbb/contracts";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as migratePostgresJs } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Db, NewOutboxEvent, UnitOfWork } from "./contracts.js";
import { PersistenceError } from "./errors.js";
import type { OrbbDb } from "./driver.js";
import {
  ROOT_MUTATION_CONTEXT,
  DrizzleAccessAuditRepository,
  DrizzleAccessGrantRepository,
  DrizzleAccountRepository,
  DrizzleEvidenceObjectRepository,
  DrizzleHealthIntentRepository,
  DrizzleMeasurementPlanRepository,
  DrizzleObservationRepository,
  DrizzleOutboxRepository,
  DrizzlePersonRepository,
  DrizzleProvenanceRepository,
  DrizzleUploadSessionRepository,
  type MutationContext,
} from "./repositories.js";
import { schema } from "./schema.js";

/** Options for constructing a {@link Db}. */
export interface DbOptions {
  /**
   * Injectable time source (deterministic clocks in tests). Stamps
   * persistence-layer `created_at` anchors and outbox bookkeeping.
   */
  readonly clock?: Clock | undefined;
}

/** Wall-clock default time source. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Internal transaction bookkeeping for the outbox guard. */
interface TransactionState {
  mutations: number;
  events: number;
}

class DrizzleDb implements Db {
  readonly #db: OrbbDb;
  readonly #clock: Clock;
  readonly #close: () => Promise<void>;

  // Root-bound repositories: reads allowed, mutations rejected.
  readonly persons: Db["persons"];
  readonly accounts: Db["accounts"];
  readonly provenances: Db["provenances"];
  readonly intents: Db["intents"];
  readonly observations: Db["observations"];
  readonly evidence: Db["evidence"];
  readonly uploadSessions: Db["uploadSessions"];
  readonly plans: Db["plans"];
  readonly grants: Db["grants"];
  readonly audits: Db["audits"];
  readonly outbox: Db["outbox"];

  constructor(db: OrbbDb, clock: Clock, close: () => Promise<void>) {
    this.#db = db;
    this.#clock = clock;
    this.#close = close;
    this.persons = new DrizzlePersonRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.accounts = new DrizzleAccountRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.provenances = new DrizzleProvenanceRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.intents = new DrizzleHealthIntentRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.observations = new DrizzleObservationRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.evidence = new DrizzleEvidenceObjectRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.uploadSessions = new DrizzleUploadSessionRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.plans = new DrizzleMeasurementPlanRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.grants = new DrizzleAccessGrantRepository(db, clock, ROOT_MUTATION_CONTEXT);
    this.audits = new DrizzleAccessAuditRepository(db, clock, ROOT_MUTATION_CONTEXT);
    // Outbox bookkeeping (append/drain/mark*) is infrastructure, not
    // domain state: it is legitimately reachable on the root handle
    // (publisher side) and inside transactions (appendEvent).
    this.outbox = new DrizzleOutboxRepository(db, clock);
  }

  transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return this.#db.transaction(async (tx) => {
      const state: TransactionState = { mutations: 0, events: 0 };
      const ctx: MutationContext = {
        inTransaction: true,
        noteMutation(armsOutboxGuard: boolean): void {
          // Only mutations whose canonical §11 event type exists arm
          // the guard (see repositories.ts for the per-method table).
          if (armsOutboxGuard) {
            state.mutations += 1;
          }
        },
      };
      const txOutbox = new DrizzleOutboxRepository(tx, this.#clock);
      const uow: UnitOfWork = {
        persons: new DrizzlePersonRepository(tx, this.#clock, ctx),
        accounts: new DrizzleAccountRepository(tx, this.#clock, ctx),
        provenances: new DrizzleProvenanceRepository(tx, this.#clock, ctx),
        intents: new DrizzleHealthIntentRepository(tx, this.#clock, ctx),
        observations: new DrizzleObservationRepository(tx, this.#clock, ctx),
        evidence: new DrizzleEvidenceObjectRepository(tx, this.#clock, ctx),
        uploadSessions: new DrizzleUploadSessionRepository(tx, this.#clock, ctx),
        plans: new DrizzleMeasurementPlanRepository(tx, this.#clock, ctx),
        grants: new DrizzleAccessGrantRepository(tx, this.#clock, ctx),
        audits: new DrizzleAccessAuditRepository(tx, this.#clock, ctx),
        appendEvent: async (event: NewOutboxEvent): Promise<OutboxRecord> => {
          const { record, wrote } = await txOutbox.appendInternal(event);
          // Only rows written by THIS transaction arm the guard: a
          // same-content replay of an already-stored event was emitted
          // by the original transaction (its mutation replayed too and
          // was not counted).
          if (wrote) {
            state.events += 1;
          }
          return record;
        },
      };
      const result = await work(uow);
      // §4 guard: a transaction that REALLY mutated domain state must
      // carry at least one outbox event — otherwise nothing commits.
      if (state.mutations > 0 && state.events === 0) {
        throw new PersistenceError(
          "outbox-required",
          "A mutating transaction appended no outbox event (architecture §4: domain state and its event commit atomically); the transaction was rolled back.",
        );
      }
      return result;
    });
  }

  close(): Promise<void> {
    return this.#close();
  }
}

/**
 * Constructs the production {@link Db} facade over a Postgres
 * connection string (Neon Postgres — architecture §12). postgres.js is
 * configured with `max: 1` (transactions) and `prepare: false`
 * (pg-bouncer/Neon pooler compatibility); all driver specifics stay
 * inside this package (provider portability).
 */
export function createDb(connectionString: string, options?: DbOptions): Db {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new PersistenceError(
      "invalid-request",
      "A non-empty Postgres connection string is required.",
    );
  }
  const client = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(client, { schema }) as unknown as OrbbDb;
  const clock = options?.clock ?? new SystemClock();
  return new DrizzleDb(db, clock, () => client.end());
}

/**
 * Applies the package's SQL migrations to the database named by
 * `connectionString` (expand/contract discipline; this packet is
 * expand-only). Used by DATABASE_URL-gated integration tests and by
 * deployment tooling — never automatically at runtime.
 */
export async function applyMigrations(
  connectionString: string,
  migrationsFolder?: string,
): Promise<void> {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new PersistenceError(
      "invalid-request",
      "A non-empty Postgres connection string is required.",
    );
  }
  const client = postgres(connectionString, { max: 1, prepare: false });
  try {
    const db = drizzle(client, { schema });
    await migratePostgresJs(db, {
      migrationsFolder: migrationsFolder ?? defaultMigrationsFolder(),
    });
  } finally {
    await client.end();
  }
}

function defaultMigrationsFolder(): string {
  return new URL("../migrations", import.meta.url).pathname;
}

export { DrizzleDb };
