/**
 * A20 — immutable access audit tests, against the PGlite harness.
 *
 * Immutability is proven at THREE levels:
 *   1. TYPE-level: the AccessAuditRepository surface exposes ONLY
 *      append/find/list — no update/delete/patch/remove method exists
 *      (asserted with expectTypeOf over the exact key union).
 *   2. RUNTIME surface: the concrete repository object has no
 *      update/delete-ish own or prototype method reachable dynamically.
 *   3. DATABASE level: the migration-0001 trigger rejects UPDATE,
 *      DELETE, and TRUNCATE outright — even by callers that bypass the
 *      repository and speak raw SQL.
 *
 * Plus: append semantics (idempotent replay, decision uniqueness) and
 * the paginated subject audit-trail query.
 */
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { sql } from "drizzle-orm";
import type { PersonId } from "@orbb/domain";
import type { AccessAuditRepository, AccessAuditRecord } from "./contracts.js";
import { PersistenceError } from "./errors.js";
import { fixtureWorld, type FixtureWorld } from "./testfixtures.js";
import { createTestDb, type TestDbHandle } from "./testing.js";
import type { Db } from "./contracts.js";

let world: FixtureWorld;
let handle: TestDbHandle;
let db: Db;
let subjectId: PersonId;

async function appendAudit(decision: "ALLOW" | "DENY", key: string) {
  const record = world.audit(subjectId, decision);
  await db.transaction(async (uow) => {
    await uow.audits.appendAccessAudit(record, { idempotencyKey: key });
    // ACCESS_EVALUATED is a canonical event type — the §4 guard demands
    // it, mirroring how the API layer will audit access evaluations.
    await uow.appendEvent(world.event("ACCESS_EVALUATED", { decisionId: record.decisionId }));
  });
  return record;
}

beforeAll(async () => {
  world = fixtureWorld("audit-main");
  handle = await createTestDb({ clock: world.clock });
  db = handle.orbb;
  const person = world.person();
  await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "audit-person-1" }));
  subjectId = person.id;
});

afterAll(async () => {
  if (db !== undefined) {
    await db.close();
  }
});

describe("A20 level 1 — TYPE-level immutability of the repository surface", () => {
  it("exposes EXACTLY append/find/list — no update or delete can even be typed", () => {
    expectTypeOf<keyof AccessAuditRepository>().toEqualTypeOf<
      "appendAccessAudit" | "findById" | "listBySubject"
    >();
  });

  it("the append method is the only mutation on the surface", () => {
    expectTypeOf<AccessAuditRepository["appendAccessAudit"]>().returns.resolves.toBeObject();
    expectTypeOf<AccessAuditRepository>().not.toHaveProperty("update");
    expectTypeOf<AccessAuditRepository>().not.toHaveProperty("delete");
    expectTypeOf<AccessAuditRepository>().not.toHaveProperty("deleteAccessAudit");
    expectTypeOf<AccessAuditRepository>().not.toHaveProperty("updateAccessAudit");
  });

  it("the UnitOfWork exposes the same append-only audit surface", () => {
    expectTypeOf<Parameters<Parameters<Db["transaction"]>[0]>[0]["audits"]>().toEqualTypeOf<
      AccessAuditRepository
    >();
  });
});

describe("A20 level 2 — RUNTIME surface of the concrete repository", () => {
  it("has no dynamically reachable update/delete/remove/patch method", () => {
    const repo = db.audits as unknown as Record<string, unknown>;
    const names = new Set<string>(Object.keys(repo));
    const proto = Object.getPrototypeOf(db.audits) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      names.add(key);
    }
    const forbidden = [...names].filter((name) =>
      /^(update|delete|remove|patch|truncate|erase|edit)/i.test(name),
    );
    expect(forbidden).toEqual([]);
    expect(names.has("appendAccessAudit")).toBe(true);
  });
});

/** Collects an error's message plus every nested cause message. */
function deepErrorMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current instanceof Error && depth < 5) {
    parts.push(current.message);
    current = (current as Error & { cause?: unknown }).cause;
    depth += 1;
  }
  return parts.join("\n");
}

async function expectAppendOnlyRejection(statement: ReturnType<typeof sql>): Promise<void> {
  let caught: unknown;
  try {
    await handle.drizzle.execute(statement);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(deepErrorMessage(caught)).toMatch(/append-only/i);
}

describe("A20 level 3 — DATABASE-level immutability (append-only trigger)", () => {
  it("rejects raw UPDATE on access_audits even when bypassing the repository", async () => {
    const record = await appendAudit("ALLOW", "audit-trigger-1");
    await expectAppendOnlyRejection(
      sql`update access_audits set actor = 'SYNTH-tamper'`,
    );
    // The row is unchanged.
    expect((await db.audits.findById(record.id))?.actor).toBe(record.actor);
  });

  it("rejects raw DELETE on access_audits", async () => {
    await appendAudit("ALLOW", "audit-trigger-2");
    await expectAppendOnlyRejection(sql`delete from access_audits`);
  });

  it("rejects raw TRUNCATE on access_audits", async () => {
    await expectAppendOnlyRejection(sql`truncate access_audits`);
  });
});

describe("append semantics", () => {
  it("appends records and reads them back (audit_ ids round-trip)", async () => {
    const record = await appendAudit("ALLOW", "audit-1");
    expect(record.id.startsWith("audit_")).toBe(true);
    expect(await db.audits.findById(record.id)).toEqual(record);
  });

  it("replays an idempotent append with the same key", async () => {
    const record = await appendAudit("DENY", "audit-2");
    const replay = await db.transaction((uow) =>
      uow.audits.appendAccessAudit(record, { idempotencyKey: "audit-2" }),
    );
    expect(replay).toEqual(record);
    const trail = await db.audits.listBySubject(subjectId, { limit: 200 });
    expect(trail.items.filter((r) => r.id === record.id)).toHaveLength(1);
  });

  it("rejects a second audit for the SAME decision (unique decision id)", async () => {
    const record = await appendAudit("ALLOW", "audit-3");
    const impostor = { ...world.audit(subjectId, "DENY"), decisionId: record.decisionId };
    await expect(
      db.transaction((uow) =>
        uow.audits.appendAccessAudit(impostor, { idempotencyKey: "audit-3-impostor" }),
      ),
    ).rejects.toThrowError(PersistenceError);
  });

  it("rejects a duplicate audit id under a different key", async () => {
    const record = await appendAudit("ALLOW", "audit-4");
    await expect(
      db.transaction((uow) =>
        uow.audits.appendAccessAudit(record, { idempotencyKey: "audit-4-other-key" }),
      ),
    ).rejects.toThrowError(PersistenceError);
  });

  it("guards the record shape (audit_ grammar, ALLOW|DENY, digest)", async () => {
    const bad = {
      ...world.audit(subjectId),
      id: "not-an-audit-id" as AccessAuditRecord["id"],
    };
    await expect(
      db.transaction((uow) =>
        uow.audits.appendAccessAudit(bad, { idempotencyKey: "audit-bad-1" }),
      ),
    ).rejects.toThrowError(PersistenceError);
    const badDecision = { ...world.audit(subjectId), decision: "MAYBE" as never };
    await expect(
      db.transaction((uow) =>
        uow.audits.appendAccessAudit(badDecision, { idempotencyKey: "audit-bad-2" }),
      ),
    ).rejects.toThrowError(PersistenceError);
  });
});

describe("subject audit trail (paginated query)", () => {
  it("pages the trail newest-first across pages without skips or duplicates", async () => {
    world.clock.advance(10_000);
    const otherPerson = world.person();
    await db.transaction((uow) =>
      uow.persons.insert(otherPerson, { idempotencyKey: "audit-person-other" }),
    );

    // Snapshot the trail accumulated by earlier tests — it must appear
    // AFTER the new audits (older created_at anchors).
    const before = await db.audits.listBySubject(subjectId, { limit: 200 });
    const beforeIds = before.items.map((r) => r.id);

    const inserted: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      world.clock.advance(1_000);
      const record = await appendAudit(i % 2 === 0 ? "ALLOW" : "DENY", `audit-trail-${i}`);
      inserted.push(record.id);
      // Noise: another subject's audit must never leak into the trail.
      const noise = world.audit(otherPerson.id);
      await db.transaction(async (uow) => {
        await uow.audits.appendAccessAudit(noise, { idempotencyKey: `audit-noise-${i}` });
        await uow.appendEvent(
          world.event("ACCESS_EVALUATED", { decisionId: noise.decisionId }),
        );
      });
    }

    const collected: string[] = [];
    let cursor: string | undefined = undefined;
    let pages = 0;
    do {
      const page = await db.audits.listBySubject(subjectId, { limit: 2, cursor });
      collected.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== undefined && pages < 20);

    // The full trail: the 5 new audits (newest first, insertion order
    // reversed) followed by everything that existed before, in order.
    expect(collected).toEqual([...inserted.slice().reverse(), ...beforeIds]);
    // The other subject's trail contains exactly its own audits.
    const otherTrail = await db.audits.listBySubject(otherPerson.id, { limit: 200 });
    expect(otherTrail.items).toHaveLength(5);
  });

  it("rejects malformed pagination input", async () => {
    await expect(db.audits.listBySubject(subjectId, { cursor: "!!!" })).rejects.toThrowError(
      PersistenceError,
    );
    await expect(db.audits.listBySubject(subjectId, { limit: -5 })).rejects.toThrowError(
      PersistenceError,
    );
  });
});
