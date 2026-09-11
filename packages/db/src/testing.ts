/**
 * @orbb/db in-memory test harness — PGlite (real Postgres, WASM).
 *
 * RECORDED DECISION (test-harness choice for this packet): there is no
 * live database in the development sandbox, so repository behavior is
 * verified against **PGlite** — an in-process build of real Postgres —
 * driven through Drizzle's own pglite adapter. This executes the ACTUAL
 * migration SQL (tables, checks, indexes, triggers, transactions), not
 * a hand-rolled emulation, while requiring no server and no
 * DATABASE_URL. Integration tests against a real connection remain
 * DATABASE_URL-gated and skip cleanly when it is absent.
 *
 * The PGlite drizzle instance is cast ONCE (below) into the postgres.js
 * `OrbbDb` type: the query-builder surface is driver-identical at
 * runtime (only the type-level query-result HKT differs, which the
 * repository code never touches). This is the single documented cast.
 *
 * This module is NOT exported from the package index: PGlite is a
 * devDependency, and production consumers must never load it.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Clock } from "@orbb/testkit";
import type { Db } from "./contracts.js";
import { DrizzleDb, SystemClock, type DbOptions } from "./db.js";
import type { OrbbDb } from "./driver.js";
import { schema } from "./schema.js";

/** Handle over an in-memory, fully migrated ORBB database. */
export interface TestDbHandle {
  /** The production facade (repositories + transactional outbox). */
  readonly orbb: Db;
  /** Raw Drizzle handle — for low-level assertions (e.g. the
   * append-only trigger) that intentionally bypass the repositories. */
  readonly drizzle: OrbbDb;
  /** The PGlite client (close via {@link Db.close} or directly). */
  readonly client: PGlite;
}

/**
 * Boots a fresh in-memory Postgres, applies ALL migrations from
 * `packages/db/migrations`, and returns the production `Db` facade.
 * Pass a deterministic clock for stable pagination anchors.
 */
export async function createTestDb(options?: DbOptions & { clock?: Clock }): Promise<TestDbHandle> {
  const client = new PGlite();
  const raw = drizzle(client, { schema });
  await migrate(raw, {
    migrationsFolder: new URL("../migrations", import.meta.url).pathname,
  });
  // The single documented driver cast (see module docs).
  const db = raw as unknown as OrbbDb;
  const clock = options?.clock ?? new SystemClock();
  const orbb: Db = new DrizzleDb(db, clock, () => client.close());
  return { orbb, drizzle: db, client };
}
