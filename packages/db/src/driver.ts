/**
 * Driver-facing type aliases for the Drizzle-backed implementations.
 *
 * The production driver is postgres.js (`postgres`): it connects to Neon
 * Postgres over the standard connection string (pooled endpoint) and,
 * with `max: 1`, supports the transactions the §4 outbox pattern
 * requires. Provider portability is preserved by confining every
 * driver decision to THIS package; nothing here leaks upward.
 *
 * Recorded decision (test harness): the in-memory harness uses PGlite
 * (real Postgres compiled to WASM, running in-process — no server, no
 * DATABASE_URL). PGlite and postgres.js expose the identical Drizzle
 * query-builder surface at runtime; `testing.ts` performs ONE
 * documented cast of the PGlite database into {@link OrbbDb}.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

/** The full @orbb/db Drizzle (pg) schema. */
export type OrbbSchema = typeof schema;

/** Canonical Drizzle database handle for @orbb/db (postgres.js). */
export type OrbbDb = PostgresJsDatabase<OrbbSchema>;

/** Transaction-scoped executor, extracted from OrbbDb's own signature. */
export type OrbbTransaction = Parameters<Parameters<OrbbDb["transaction"]>[0]>[0];

/** Root database or transaction-scoped executor used by repositories. */
export type OrbbExecutor = OrbbDb | OrbbTransaction;
