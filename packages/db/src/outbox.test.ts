/**
 * Transactional outbox tests (§4 / A15) against the PGlite harness:
 * outbox rows written INSIDE domain transactions, atomic rollback of
 * state+event together, eventId idempotency, pending drain order,
 * markPublished / markFailed bookkeeping.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEventId } from "@orbb/contracts";
import type { Db } from "./contracts.js";
import { PersistenceError } from "./errors.js";
import { fixtureWorld, type FixtureWorld } from "./testfixtures.js";
import { createTestDb, type TestDbHandle } from "./testing.js";

let world: FixtureWorld;
let handle: TestDbHandle;
let db: Db;

beforeAll(async () => {
  world = fixtureWorld("outbox-main");
  handle = await createTestDb({ clock: world.clock });
  db = handle.orbb;
});

afterAll(async () => {
  if (db !== undefined) {
    await db.close();
  }
});

describe("outbox rows commit with domain state (§4)", () => {
  it("writes the outbox row inside the SAME transaction as the intent", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "ob-person-1" }));
    const intent = world.intent(person.id);
    const event = world.event("INTENT_CREATED", { intentId: intent.id });
    await db.transaction(async (uow) => {
      await uow.intents.insert(intent, { idempotencyKey: "ob-intent-1" });
      const record = await uow.appendEvent(event);
      expect(record.status).toBe("pending");
      expect(record.attempts).toBe(0);
      expect(record.eventType).toBe("INTENT_CREATED");
      expect(record.payload).toBe(event.payload);
    });
    expect(await db.outbox.findById(event.eventId)).toBeDefined();
    expect(await db.intents.findById(intent.id)).toBeDefined();
  });

  it("rolls back state AND event together when the transaction fails mid-flight", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "ob-person-2" }));
    const intent = world.intent(person.id);
    const event = world.event("INTENT_CREATED", { intentId: intent.id });
    await expect(
      db.transaction(async (uow) => {
        await uow.intents.insert(intent, { idempotencyKey: "ob-intent-2" });
        await uow.appendEvent(event);
        throw new Error("SYNTH boom after the event was appended");
      }),
    ).rejects.toThrowError(/SYNTH boom/);
    // Neither the state nor the event survived.
    expect(await db.intents.findById(intent.id)).toBeUndefined();
    expect(await db.outbox.findById(event.eventId)).toBeUndefined();
  });

  it("the §4 guard rejects an intent insert with no event", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "ob-person-3" }));
    await expect(
      db.transaction((uow) => uow.intents.insert(world.intent(person.id), { idempotencyKey: "ob-intent-3" })),
    ).rejects.toThrowError(/outbox/);
  });
});

describe("eventId idempotency", () => {
  it("re-appending the SAME event id+content replays the stored row", async () => {
    const event = world.event("TASK_DUE", { due: "soon" });
    const first = await db.outbox.append(event);
    const second = await db.outbox.append(event);
    expect(second).toEqual(first);
    const page = await db.outbox.listPending({ limit: 200 });
    expect(page.items.filter((r) => r.eventId === event.eventId)).toHaveLength(1);
  });

  it("reusing an event id with DIFFERENT content is a state conflict", async () => {
    const event = world.event("TASK_DUE", { due: "soon" });
    await db.outbox.append(event);
    await expect(
      db.outbox.append({ ...event, payload: JSON.stringify({ synthetic: true, due: "later" }) }),
    ).rejects.toThrowError(PersistenceError);
  });

  it("validates the event shape (evt_ id, frozen type vocabulary, JSON payload)", async () => {
    await expect(
      db.outbox.append({
        eventId: "not-an-evt-id" as never,
        eventType: "TASK_DUE",
        payload: "{}",
      }),
    ).rejects.toThrowError(PersistenceError);
    await expect(
      db.outbox.append({
        eventId: world.event("TASK_DUE").eventId,
        eventType: "NOT_A_REAL_TYPE" as never,
        payload: "{}",
      }),
    ).rejects.toThrowError(PersistenceError);
    await expect(
      db.outbox.append({
        eventId: world.event("TASK_DUE").eventId,
        eventType: "TASK_DUE",
        payload: "not json {",
      }),
    ).rejects.toThrowError(PersistenceError);
  });
});

describe("pending drain + publication bookkeeping", () => {
  it("drains pending events OLDEST-FIRST (fair order) across pages", async () => {
    // Drain everything left pending by earlier tests so the order
    // assertions below are exact.
    let drainCursor: string | undefined = undefined;
    do {
      const pending = await db.outbox.listPending({ limit: 200, cursor: drainCursor });
      for (const record of pending.items) {
        await db.outbox.markPublished(record.eventId);
      }
      drainCursor = pending.nextCursor;
    } while (drainCursor !== undefined);

    world.clock.advance(10_000);
    const eventIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      world.clock.advance(1_000);
      const event = world.event("TASK_DUE", { n: i });
      await db.outbox.append(event);
      eventIds.push(event.eventId);
    }
    const page1 = await db.outbox.listPending({ limit: 3 });
    expect(page1.items.map((r) => r.eventId)).toEqual(eventIds.slice(0, 3));
    expect(page1.nextCursor).toBeTypeOf("string");
    const page2 = await db.outbox.listPending({ limit: 3, cursor: page1.nextCursor });
    expect(page2.items.map((r) => r.eventId)).toEqual(eventIds.slice(3));
    expect(page2.nextCursor).toBeUndefined();
  });

  it("markPublished stamps publishedAt and is idempotent", async () => {
    const event = world.event("STUDY_ENROLLED", { study: "SYNTH-study-1" });
    await db.outbox.append(event);
    const published = await db.outbox.markPublished(event.eventId);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toEqual(world.clock.now());
    // Draining pending no longer includes it.
    const pending = await db.outbox.listPending({ limit: 200 });
    expect(pending.items.find((r) => r.eventId === event.eventId)).toBeUndefined();
    // Idempotent re-publish returns the same stored record.
    const again = await db.outbox.markPublished(event.eventId);
    expect(again).toEqual(published);
  });

  it("markFailed increments attempts and stores a truncated reason", async () => {
    const event = world.event("EXTENSION_INSTALLED", { ext: "SYNTH-ext-1" });
    await db.outbox.append(event);
    const failed = await db.outbox.markFailed(event.eventId, "SYNTH delivery error");
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("SYNTH delivery error");
    const failedAgain = await db.outbox.markFailed(event.eventId, "SYNTH retry error 2");
    expect(failedAgain.attempts).toBe(2);
    // Errors are bounded to keep rows small.
    const huge = await db.outbox.markFailed(event.eventId, "X".repeat(5_000));
    expect((huge.lastError ?? "").length).toBeLessThanOrEqual(2_000);
    await expect(db.outbox.markFailed(event.eventId, "")).rejects.toThrowError(PersistenceError);
    await expect(
      db.outbox.markPublished(parseEventId("evt_SYNTH-nonexistent-00001")),
    ).rejects.toThrowError(PersistenceError);
  });
});

describe("root-level outbox surface", () => {
  it("allows infrastructure appends outside transactions (pure-event facts)", async () => {
    const event = world.event("SAFETY_FLAG_RAISED", { flag: "SYNTH-flag" });
    const record = await db.outbox.append(event);
    expect(record.status).toBe("pending");
    await db.outbox.markPublished(event.eventId);
  });
});
