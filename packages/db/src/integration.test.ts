/**
 * DATABASE_URL-gated integration tests (A14/A15/A20) against a REAL
 * Postgres (e.g. Neon, `postgres://…`). These tests SKIP CLEANLY when
 * no Postgres DATABASE_URL is set — the PGlite suites in this package
 * are the always-on verification path.
 *
 * They exercise the pieces that only a real server can fully prove:
 * the postgres.js driver wiring (`createDb`), the runtime migrator
 * over the journal (`applyMigrations`), and the append-only trigger
 * from migration 0001.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { applyMigrations, createDb } from "./index.js";
import { fixtureWorld, type FixtureWorld } from "./testfixtures.js";
import type { Db } from "./contracts.js";
import { schema } from "./schema.js";

/** Only postgres:// (or postgresql://) URLs can drive these tests — a
 * DATABASE_URL pointing at a non-Postgres store (e.g. a file: URL) is
 * treated as absent, so the suite always skips cleanly. */
function isPostgresUrl(value: string | undefined): value is string {
  return value !== undefined && /^postgres(ql)?:\/\//.test(value);
}

const rawDatabaseUrl = process.env.DATABASE_URL;
const databaseUrl = isPostgresUrl(rawDatabaseUrl) ? rawDatabaseUrl : undefined;

describe.skipIf(databaseUrl === undefined)("integration: live Postgres via DATABASE_URL", () => {
  let world: FixtureWorld;
  let db: Db;

  beforeAll(async () => {
    world = fixtureWorld("integration");
    await applyMigrations(databaseUrl!);
    db = createDb(databaseUrl!, { clock: world.clock });
  });

  afterAll(async () => {
    if (db !== undefined) {
      await db.close();
    }
  });

  it("applies migrations and round-trips a full domain transaction with its outbox event", async () => {
    const person = world.person();
    const intent = world.intent(person.id);
    const event = world.event("INTENT_CREATED", { intentId: intent.id });
    await db.transaction(async (uow) => {
      await uow.persons.insert(person, { idempotencyKey: "integ-person-1" });
      await uow.intents.insert(intent, { idempotencyKey: "integ-intent-1" });
      await uow.appendEvent(event);
    });
    expect(await db.intents.findById(intent.id)).toEqual(intent);
    const outboxRow = await db.outbox.findById(event.eventId);
    expect(outboxRow?.status).toBe("pending");
  });

  it("drains the pending outbox and marks publication", async () => {
    const pending = await db.outbox.listPending({ limit: 10 });
    expect(pending.items.length).toBeGreaterThan(0);
    const target = pending.items[0]!;
    const published = await db.outbox.markPublished(target.eventId);
    expect(published.status).toBe("published");
  });

  it("enforces the append-only audit trigger on the live database (raw SQL tampering fails)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "integ-person-2" }));
    const audit = world.audit(person.id);
    await db.transaction(async (uow) => {
      await uow.audits.appendAccessAudit(audit, { idempotencyKey: "integ-audit-1" });
      await uow.appendEvent(world.event("ACCESS_EVALUATED", { decisionId: audit.decisionId }));
    });

    // A second, raw connection bypasses the facade entirely — the
    // database trigger must still reject the tampering.
    const client = postgres(databaseUrl!, { max: 1 });
    const raw = drizzle(client, { schema });
    try {
      await expect(
        raw.execute(sql`update access_audits set actor = 'SYNTH-tamper'`),
      ).rejects.toThrowError(/append-only/i);
      await expect(raw.execute(sql`delete from access_audits`)).rejects.toThrowError(
        /append-only/i,
      );
    } finally {
      await client.end();
    }
  });
});
