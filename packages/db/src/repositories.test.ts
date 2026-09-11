/**
 * Repository behavior tests (A15) against the PGlite in-memory harness
 * (real Postgres: FKs, checks, unique constraints, transactions).
 *
 * Covers: inserts + reads, idempotency-key replay semantics, state
 * transitions (optimistic + converged retries), FK enforcement, the
 * §4 mutation-scope rule, and the §4 outbox-required guard.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainInvariantError, type HealthIntent, type PersonId } from "@orbb/domain";
import type { Db } from "./contracts.js";
import { PersistenceError } from "./errors.js";
import { fixtureWorld, type FixtureWorld } from "./testfixtures.js";
import { createTestDb, type TestDbHandle } from "./testing.js";

let world: FixtureWorld;
let handle: TestDbHandle;
let db: Db;

beforeAll(async () => {
  world = fixtureWorld("repo-main");
  handle = await createTestDb({ clock: world.clock });
  db = handle.orbb;
});

afterAll(async () => {
  if (db !== undefined) {
    await db.close();
  }
});

describe("persons", () => {
  it("inserts and reads back a person (opaque prsn_ id round-trips)", async () => {
    const person = world.person();
    await db.transaction(async (uow) => {
      await uow.persons.insert(person, { idempotencyKey: "person-1" });
    });
    const stored = await db.persons.findById(person.id);
    expect(stored).toEqual(person);
    expect(person.id.startsWith("prsn_")).toBe(true);
  });

  it("replays an idempotent insert with the same key (no duplicate row)", async () => {
    const person = world.person();
    const first = await db.transaction((uow) =>
      uow.persons.insert(person, { idempotencyKey: "person-2" }),
    );
    const second = await db.transaction((uow) =>
      uow.persons.insert(person, { idempotencyKey: "person-2" }),
    );
    expect(second).toEqual(first);
    const all = await db.persons.list({ limit: 200 });
    expect(all.items.filter((p) => p.id === person.id)).toHaveLength(1);
  });

  it("rejects a duplicate id under a DIFFERENT idempotency key (state conflict)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "person-3a" }));
    await expect(
      db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "person-3b" })),
    ).rejects.toThrowError(PersistenceError);
  });

  it("rejects malformed records (grammar guarded, value never echoed)", async () => {
    await expect(
      db.transaction((uow) =>
        uow.persons.insert({ id: "not-a-prsn-id" as never, displayName: "SYNTH" }, {
          idempotencyKey: "person-bad-1",
        }),
      ),
    ).rejects.toThrowError(PersistenceError);
    await expect(
      db.transaction((uow) =>
        uow.persons.insert(world.person(), { idempotencyKey: "" }),
      ),
    ).rejects.toThrowError(PersistenceError);
  });

  it("REFUSES mutations outside a transaction (§4 discipline)", async () => {
    const person = world.person();
    await expect(
      db.persons.insert(person, { idempotencyKey: "person-root-1" }),
    ).rejects.toThrowError(/inside db\.transaction/);
  });

  it("DB check constraints back the record guards (display name)", async () => {
    const person = world.person();
    await expect(
      db.transaction((uow) =>
        uow.persons.insert({ ...person, displayName: "" }, { idempotencyKey: "person-bad-2" }),
      ),
    ).rejects.toThrowError(PersistenceError);
  });
});

describe("accounts + provenances", () => {
  it("inserts an account for a person and lists by person", async () => {
    const person = world.person();
    await db.transaction(async (uow) => {
      await uow.persons.insert(person, { idempotencyKey: "acct-person-1" });
    });
    const account = world.account(person.id);
    await db.transaction(async (uow) => {
      await uow.accounts.insert(account, { idempotencyKey: "account-1" });
    });
    const listed = await db.accounts.listByPerson(person.id);
    expect(listed.items).toEqual([account]);
    expect(account.id.startsWith("acct_")).toBe(true);
  });

  it("enforces the person FK on accounts", async () => {
    const account = world.account("prsn_SYNTH-does-not-exist-0001" as PersonId);
    await expect(
      db.transaction((uow) => uow.accounts.insert(account, { idempotencyKey: "account-fk-1" })),
    ).rejects.toThrow();
  });

  it("inserts provenance and lists it by subject (actor grammar holds)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "prov-person-1" }));
    const provenance = world.provenance(person.id);
    await db.transaction((uow) =>
      uow.provenances.insert(provenance, { idempotencyKey: "prov-1" }),
    );
    const listed = await db.provenances.listBySubject(person.id);
    expect(listed.items).toEqual([provenance]);
    expect(provenance.provenanceId.startsWith("prov_")).toBe(true);
  });
});

describe("health intents", () => {
  it("walks the frozen state machine and back-checks setPlan", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "intent-person-1" }));
    const intent = world.intent(person.id);
    await db.transaction(async (uow) => {
      await uow.intents.insert(intent, { idempotencyKey: "intent-1" });
      await uow.appendEvent(world.event("INTENT_CREATED", { intentId: intent.id }));
    });
    expect((await db.intents.findById(intent.id))?.state).toBe("draft");

    const active = await db.transaction((uow) =>
      uow.intents.transition(intent.id, "active", {
        idempotencyKey: "intent-1-active",
        expectedFrom: "draft",
      }),
    );
    expect(active.state).toBe("active");

    // Idempotent retry with the SAME key replays the stored record.
    const retried = await db.transaction((uow) =>
      uow.intents.transition(intent.id, "active", {
        idempotencyKey: "intent-1-active",
        expectedFrom: "draft",
      }),
    );
    expect(retried.state).toBe("active");

    // Converged retry with a FRESH key (expectedFrom no longer matches,
    // target state already reached) returns the current record.
    const converged = await db.transaction((uow) =>
      uow.intents.transition(intent.id, "active", {
        idempotencyKey: "intent-1-active-retry2",
        expectedFrom: "draft",
      }),
    );
    expect(converged.state).toBe("active");

    // Divergence: paused now, so active→achieved can no longer apply.
    await db.transaction((uow) =>
      uow.intents.transition(intent.id, "paused", {
        idempotencyKey: "intent-1-paused",
        expectedFrom: "active",
      }),
    );
    await expect(
      db.transaction((uow) =>
        uow.intents.transition(intent.id, "achieved", {
          idempotencyKey: "intent-1-achieved",
          expectedFrom: "active",
        }),
      ),
    ).rejects.toThrowError(PersistenceError);

    // The plan link is stored and read back.
    const plan = world.plan(person.id, intent.id);
    await db.transaction(async (uow) => {
      await uow.plans.insert(plan, { idempotencyKey: "plan-for-intent-1" });
    });
    const linked = await db.transaction((uow) =>
      uow.intents.setPlan(intent.id, plan.id, { idempotencyKey: "intent-1-plan" }),
    );
    expect(linked.planId).toBe(plan.id);
  });

  it("rejects ILLEGAL transitions through the domain guard (before any write)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "intent-person-2" }));
    const intent = world.intent(person.id);
    await db.transaction(async (uow) => {
      await uow.intents.insert(intent, { idempotencyKey: "intent-2" });
      await uow.appendEvent(world.event("INTENT_CREATED", { intentId: intent.id }));
    });
    // draft -> retired is illegal in the frozen machine.
    await expect(
      db.transaction((uow) =>
        uow.intents.transition(intent.id, "retired", {
          idempotencyKey: "intent-2-retired",
          expectedFrom: "draft",
        }),
      ),
    ).rejects.toThrowError(DomainInvariantError);
    expect((await db.intents.findById(intent.id))?.state).toBe("draft");
  });

  it("DB check constraint rejects an unknown intent state (defense in depth)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "intent-person-3" }));
    const intent = world.intent(person.id);
    await expect(
      db.transaction((uow) =>
        uow.intents.insert({ ...intent, state: "hijacked" as never }, {
          idempotencyKey: "intent-3-bad",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("measurement plans", () => {
  it("walks draft -> published -> active -> completed", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "plan-person-1" }));
    const intent = world.intent(person.id);
    await db.transaction(async (uow) => {
      await uow.intents.insert(intent, { idempotencyKey: "plan-intent-1" });
      await uow.appendEvent(world.event("INTENT_CREATED", { intentId: intent.id }));
    });
    const plan = world.plan(person.id, intent.id);
    await db.transaction((uow) => uow.plans.insert(plan, { idempotencyKey: "plan-1" }));
    const published = await db.transaction(async (uow) => {
      const next = await uow.plans.transition(plan.id, "published", {
        idempotencyKey: "plan-1-publish",
        expectedFrom: "draft",
      });
      // Publishing arms the outbox guard (PLAN_PUBLISHED exists).
      await uow.appendEvent(world.event("PLAN_PUBLISHED", { planId: plan.id }));
      return next;
    });
    expect(published.state).toBe("published");
    expect(published.metrics).toEqual(["SYNTH-8867-4"]);

    const active = await db.transaction((uow) =>
      uow.plans.transition(plan.id, "active", {
        idempotencyKey: "plan-1-active",
        expectedFrom: "published",
      }),
    );
    expect(active.state).toBe("active");
    const completed = await db.transaction((uow) =>
      uow.plans.transition(plan.id, "completed", {
        idempotencyKey: "plan-1-completed",
        expectedFrom: "active",
      }),
    );
    expect(completed.state).toBe("completed");
  });

  it("enforces the intent FK (a plan must reference a real intent)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "plan-person-2" }));
    const plan = world.plan(
      person.id,
      "intent_SYNTH-nonexistent-00001" as HealthIntent["id"],
    );
    await expect(
      db.transaction((uow) => uow.plans.insert(plan, { idempotencyKey: "plan-fk-1" })),
    ).rejects.toThrow();
  });

  it("DB check rejects an empty metrics array", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "plan-person-3" }));
    const intent = world.intent(person.id);
    await db.transaction(async (uow) => {
      await uow.intents.insert(intent, { idempotencyKey: "plan-intent-3" });
      await uow.appendEvent(world.event("INTENT_CREATED", { intentId: intent.id }));
    });
    const plan = { ...world.plan(person.id, intent.id), metrics: [] as string[] };
    await expect(
      db.transaction((uow) => uow.plans.insert(plan, { idempotencyKey: "plan-3-bad" })),
    ).rejects.toThrow();
  });
});

describe("access grants", () => {
  it("inserts, lists candidates for evaluation, and revokes", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "grant-person-1" }));
    const grant = world.grant(person.id);
    await db.transaction(async (uow) => {
      await uow.grants.insert(grant, { idempotencyKey: "grant-1" });
      await uow.appendEvent(world.event("ACCESS_GRANTED", { grantId: grant.id }));
    });

    const candidates = await db.grants.listBySubjectAndRecipient(
      person.id,
      "SYNTH-recipient-1",
    );
    expect(candidates).toEqual([grant]);

    const otherRecipient = await db.grants.listBySubjectAndRecipient(person.id, "SYNTH-nobody");
    expect(otherRecipient).toEqual([]);

    const revoked = await db.transaction(async (uow) => {
      const next = await uow.grants.transition(grant.id, "revoked", {
        idempotencyKey: "grant-1-revoke",
        expectedFrom: "active",
      });
      await uow.appendEvent(world.event("ACCESS_REVOKED", { grantId: grant.id }));
      return next;
    });
    expect(revoked.state).toBe("revoked");
    // Re-revoking with a fresh key CONVERGES (target already reached —
    // idempotent retry) instead of rejecting.
    const reRevoked = await db.transaction((uow) =>
      uow.grants.transition(grant.id, "revoked", {
        idempotencyKey: "grant-1-revoke-2",
        expectedFrom: "active",
      }),
    );
    expect(reRevoked.state).toBe("revoked");
    // And revocation is terminal in the domain grammar: revoked ->
    // active is illegal and fails the guard BEFORE any write.
    await expect(
      db.transaction((uow) =>
        uow.grants.transition(grant.id, "active", {
          idempotencyKey: "grant-1-reactivate",
          expectedFrom: "revoked",
        }),
      ),
    ).rejects.toThrowError(DomainInvariantError);
  });

  it("scopes candidate queries per (subject, recipient) pair", async () => {
    const personA = world.person();
    const personB = world.person();
    await db.transaction(async (uow) => {
      await uow.persons.insert(personA, { idempotencyKey: "grant-person-a" });
      await uow.persons.insert(personB, { idempotencyKey: "grant-person-b" });
    });
    const grantA = world.grant(personA.id);
    await db.transaction(async (uow) => {
      await uow.grants.insert(grantA, { idempotencyKey: "grant-a" });
      await uow.appendEvent(world.event("ACCESS_GRANTED", { grantId: grantA.id }));
    });
    const forB = await db.grants.listBySubjectAndRecipient(personB.id, "SYNTH-recipient-1");
    expect(forB).toEqual([]);
  });
});

describe("evidence objects", () => {
  it("inserts, finds by id AND by content-addressed object key", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "evid-person-1" }));
    const provenance = world.provenance(person.id);
    await db.transaction((uow) =>
      uow.provenances.insert(provenance, { idempotencyKey: "evid-prov-1" }),
    );
    const evidence = world.evidence(person.id, provenance.provenanceId);
    await db.transaction(async (uow) => {
      await uow.evidence.insert(evidence, { idempotencyKey: "evid-1" });
      await uow.appendEvent(world.event("EVIDENCE_INGESTED", { evidenceId: evidence.id }));
    });
    expect(await db.evidence.findById(evidence.id)).toEqual(evidence);
    expect(await db.evidence.findByObjectKey(evidence.objectKey)).toEqual(evidence);
    expect(evidence.objectKey.startsWith("evidence/v1/")).toBe(true);
  });

  it("rejects a second record claiming the SAME object key (content addressing)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "evid-person-2" }));
    const provenance = world.provenance(person.id);
    await db.transaction((uow) =>
      uow.provenances.insert(provenance, { idempotencyKey: "evid-prov-2" }),
    );
    const first = world.evidence(person.id, provenance.provenanceId);
    await db.transaction(async (uow) => {
      await uow.evidence.insert(first, { idempotencyKey: "evid-2a" });
      await uow.appendEvent(world.event("EVIDENCE_INGESTED", { evidenceId: first.id }));
    });
    const second = {
      ...world.evidence(person.id, provenance.provenanceId),
      objectKey: first.objectKey,
    };
    await expect(
      db.transaction(async (uow) => {
        await uow.evidence.insert(second, { idempotencyKey: "evid-2b" });
        await uow.appendEvent(world.event("EVIDENCE_INGESTED", { evidenceId: second.id }));
      }),
    ).rejects.toThrowError(PersistenceError);
  });

  it("guards record shape before any write (sha256 grammar, size, provenance)", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "evid-person-3" }));
    const provenance = world.provenance(person.id);
    await db.transaction((uow) =>
      uow.provenances.insert(provenance, { idempotencyKey: "evid-prov-3" }),
    );
    const evidence = world.evidence(person.id, provenance.provenanceId);
    await expect(
      db.transaction((uow) =>
        uow.evidence.insert(
          { ...evidence, sha256: "NOT-A-SHA256" },
          { idempotencyKey: "evid-3-bad" },
        ),
      ),
    ).rejects.toThrowError(PersistenceError);
    await expect(
      db.transaction((uow) =>
        uow.evidence.insert(
          { ...evidence, sizeBytes: -1 },
          { idempotencyKey: "evid-3-bad-2" },
        ),
      ),
    ).rejects.toThrowError(PersistenceError);
  });
});

describe("§4 outbox guard (mutation without an event rolls back)", () => {
  it("rejects a MUTATING transaction that appends no outbox event", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "guard-person-1" }));
    await expect(
      db.transaction(async (uow) => {
        await uow.intents.insert(world.intent(person.id), { idempotencyKey: "guard-intent-1" });
        // INTENT_CREATED is a canonical event type — the guard demands one.
      }),
    ).rejects.toThrowError(/outbox/);
    // And nothing was stored (rolled back).
    const intents = await db.intents.listByPerson(person.id);
    expect(intents.items).toEqual([]);
  });

  it("commits when the mutation is paired with its event", async () => {
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "guard-person-2" }));
    const intent = world.intent(person.id);
    await db.transaction(async (uow) => {
      await uow.intents.insert(intent, { idempotencyKey: "guard-intent-2" });
      await uow.appendEvent(world.event("INTENT_CREATED", { intentId: intent.id }));
    });
    expect(await db.intents.findById(intent.id)).toBeDefined();
  });

  it("does NOT arm for families without canonical events (persons)", async () => {
    const person = world.person();
    // Person insert is allowed without an event: no PERSON_* type
    // exists in the frozen §11 catalog (recorded handoff).
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "guard-person-3" }));
    expect(await db.persons.findById(person.id)).toEqual(person);
  });
});
