/**
 * Observation repository tests (A15 + M1 supersession) against the
 * PGlite harness: jsonb value-type preservation, validation-state
 * transitions, atomic applySupersession, unique supersedes linkage,
 * and cursor pagination round-trips over (created_at, id).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseQualityScore,
  supersede,
  type Observation,
  type PersonId,
  type ProvenanceId,
} from "@orbb/domain";
import type { Db } from "./contracts.js";
import { PersistenceError } from "./errors.js";
import { fixtureWorld, type FixtureWorld } from "./testfixtures.js";
import { createTestDb, type TestDbHandle } from "./testing.js";

let world: FixtureWorld;
let handle: TestDbHandle;
let db: Db;
let personId: PersonId;
let provenanceId: ProvenanceId;

async function insertObservation(observation: Observation, key: string): Promise<Observation> {
  return db.transaction(async (uow) => {
    const stored = await uow.observations.insert(observation, { idempotencyKey: key });
    await uow.appendEvent(world.event("OBSERVATION_RECORDED", { observationId: observation.id }));
    return stored;
  });
}

beforeAll(async () => {
  world = fixtureWorld("obs-main");
  handle = await createTestDb({ clock: world.clock });
  db = handle.orbb;
  const person = world.person();
  await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "obs-person-1" }));
  personId = person.id;
  const provenance = world.provenance(personId);
  await db.transaction((uow) =>
    uow.provenances.insert(provenance, { idempotencyKey: "obs-prov-1" }),
  );
  provenanceId = provenance.provenanceId;
});

afterAll(async () => {
  if (db !== undefined) {
    await db.close();
  }
});

describe("observation persistence", () => {
  it("round-trips a full observation (optional fields absent stay absent)", async () => {
    const observation = world.observation(personId, provenanceId);
    const stored = await insertObservation(observation, "obs-1");
    expect(stored).toEqual(observation);
    expect(stored.evidenceId).toBeUndefined();
    expect(stored.quality).toBeUndefined();
    expect(stored.supersedesId).toBeUndefined();
  });

  it("preserves the jsonb value TYPE (72 vs \"72\" vs true)", async () => {
    const numeric = await insertObservation(
      world.observation(personId, provenanceId, { value: 72 }),
      "obs-json-1",
    );
    const textual = await insertObservation(
      world.observation(personId, provenanceId, { value: "72" }),
      "obs-json-2",
    );
    const boolean = await insertObservation(
      world.observation(personId, provenanceId, { value: true }),
      "obs-json-3",
    );
    expect(typeof (await db.observations.findById(numeric.id))?.value).toBe("number");
    expect(typeof (await db.observations.findById(textual.id))?.value).toBe("string");
    expect(typeof (await db.observations.findById(boolean.id))?.value).toBe("boolean");
  });

  it("round-trips optional fields when present (quality, evidence link)", async () => {
    const evidence = world.evidence(personId, provenanceId);
    await db.transaction(async (uow) => {
      await uow.evidence.insert(evidence, { idempotencyKey: "obs-evid-1" });
      await uow.appendEvent(world.event("EVIDENCE_INGESTED", { evidenceId: evidence.id }));
    });
    const observation = world.observation(personId, provenanceId, {
      quality: parseQualityScore(0.9),
      evidenceId: evidence.id,
    });
    const stored = await insertObservation(observation, "obs-2");
    expect(stored.quality).toBe(0.9);
    expect(stored.evidenceId).toBe(evidence.id);
  });

  it("enforces the provenance FK (no observation without provenance)", async () => {
    const observation = world.observation(
      personId,
      "prov_SYNTH-nonexistent-00001" as ProvenanceId,
    );
    await expect(insertObservation(observation, "obs-fk-1")).rejects.toThrow();
  });

  it("transitions pending -> validated, idempotently", async () => {
    const observation = await insertObservation(
      world.observation(personId, provenanceId),
      "obs-3",
    );
    const validated = await db.transaction((uow) =>
      uow.observations.transition(observation.id, "validated", {
        idempotencyKey: "obs-3-validate",
        expectedFrom: "pending",
      }),
    );
    expect(validated.validationState).toBe("validated");
    // Same-key retry replays; fresh-key converged retry returns current.
    const replay = await db.transaction((uow) =>
      uow.observations.transition(observation.id, "validated", {
        idempotencyKey: "obs-3-validate",
        expectedFrom: "pending",
      }),
    );
    expect(replay.validationState).toBe("validated");
    const converged = await db.transaction((uow) =>
      uow.observations.transition(observation.id, "validated", {
        idempotencyKey: "obs-3-validate-2",
        expectedFrom: "pending",
      }),
    );
    expect(converged.validationState).toBe("validated");
  });
});

describe("M1 supersession (applySupersession)", () => {
  it("persists the amendment pair atomically", async () => {
    const original = await insertObservation(
      world.observation(personId, provenanceId),
      "obs-sup-1",
    );
    await db.transaction((uow) =>
      uow.observations.transition(original.id, "validated", {
        idempotencyKey: "obs-sup-1-validate",
        expectedFrom: "pending",
      }),
    );

    const replacementInput = world.observation(personId, provenanceId, {
      supersedesId: original.id,
      value: 71,
    });
    const pair = supersede(
      (await db.observations.findById(original.id))!,
      replacementInput,
    );

    const storedPair = await db.transaction(async (uow) => {
      const result = await uow.observations.applySupersession(pair, {
        idempotencyKey: "obs-sup-1-apply",
      });
      await uow.appendEvent(
        world.event("OBSERVATION_SUPERSEDED", { replacementId: pair.replacement.id }),
      );
      return result;
    });

    expect(storedPair.superseded.validationState).toBe("superseded");
    expect(storedPair.superseded.id).toBe(original.id);
    expect(storedPair.replacement.validationState).toBe("validated");
    expect(storedPair.replacement.supersedesId).toBe(original.id);
    expect(storedPair.replacement.value).toBe(71);

    // Both rows are readable through the repository.
    const oldRow = await db.observations.findById(original.id);
    const newRow = await db.observations.findById(pair.replacement.id);
    expect(oldRow?.validationState).toBe("superseded");
    expect(newRow?.validationState).toBe("validated");
  });

  it("replays an idempotent supersession (same key returns the stored pair)", async () => {
    const original = await insertObservation(
      world.observation(personId, provenanceId),
      "obs-sup-2",
    );
    await db.transaction((uow) =>
      uow.observations.transition(original.id, "validated", {
        idempotencyKey: "obs-sup-2-validate",
        expectedFrom: "pending",
      }),
    );
    const replacement = world.observation(personId, provenanceId, {
      supersedesId: original.id,
    });
    const pair = supersede((await db.observations.findById(original.id))!, replacement);
    const first = await db.transaction(async (uow) => {
      const result = await uow.observations.applySupersession(pair, {
        idempotencyKey: "obs-sup-2-apply",
      });
      await uow.appendEvent(
        world.event("OBSERVATION_SUPERSEDED", { replacementId: pair.replacement.id }),
      );
      return result;
    });
    // Full retry of the same transaction content: no error, same pair.
    const retry = await db.transaction(async (uow) => {
      const result = await uow.observations.applySupersession(pair, {
        idempotencyKey: "obs-sup-2-apply",
      });
      await uow.appendEvent(
        world.event("OBSERVATION_SUPERSEDED", { replacementId: pair.replacement.id }),
      );
      return result;
    });
    expect(retry).toEqual(first);
  });

  it("rejects pairs NOT produced by the domain supersede() function", async () => {
    const original = await insertObservation(
      world.observation(personId, provenanceId),
      "obs-sup-3",
    );
    const replacement = world.observation(personId, provenanceId, {
      supersedesId: original.id,
    });
    // Hand-forged pair with wrong states:
    const forged = {
      superseded: original,
      replacement,
    };
    await expect(
      db.transaction((uow) =>
        uow.observations.applySupersession(forged, { idempotencyKey: "obs-sup-3-bad" }),
      ),
    ).rejects.toThrowError(PersistenceError);
  });

  it("uniquely enforces one replacement per superseded observation", async () => {
    const original = await insertObservation(
      world.observation(personId, provenanceId),
      "obs-sup-4",
    );
    await db.transaction((uow) =>
      uow.observations.transition(original.id, "validated", {
        idempotencyKey: "obs-sup-4-validate",
        expectedFrom: "pending",
      }),
    );
    const replacement = world.observation(personId, provenanceId, {
      supersedesId: original.id,
    });
    const pair = supersede((await db.observations.findById(original.id))!, replacement);
    await db.transaction(async (uow) => {
      await uow.observations.applySupersession(pair, { idempotencyKey: "obs-sup-4-apply" });
      await uow.appendEvent(
        world.event("OBSERVATION_SUPERSEDED", { replacementId: pair.replacement.id }),
      );
    });
    // A second, differently-keyed observation claiming the same
    // supersedes linkage hits the unique constraint.
    const impostor = world.observation(personId, provenanceId, {
      supersedesId: original.id,
    });
    await expect(
      insertObservation(impostor, "obs-sup-4-impostor"),
    ).rejects.toThrowError(PersistenceError);
  });
});

describe("cursor pagination round-trips (DB)", () => {
  it("pages observations by person newest-first without skips or duplicates", async () => {
    // Fresh person with a fresh clock timeline.
    world.clock.advance(10_000);
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "page-person-1" }));
    const prov = world.provenance(person.id);
    await db.transaction((uow) => uow.provenances.insert(prov, { idempotencyKey: "page-prov-1" }));

    const inserted: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      world.clock.advance(1_000);
      const observation = world.observation(person.id, prov.provenanceId);
      await insertObservation(observation, `page-obs-${i}`);
      inserted.push(observation.id);
    }

    const collected: string[] = [];
    let cursor: string | undefined = undefined;
    let pages = 0;
    do {
      const page = await db.observations.listByPerson(person.id, { limit: 3, cursor });
      collected.push(...page.items.map((o) => o.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== undefined && pages < 10);

    expect(collected).toEqual([...inserted].reverse()); // newest-first
    expect(pages).toBe(3); // 7 items: 3 + 3 + 1
  });

  it("pages observations filtered by person AND concept code", async () => {
    world.clock.advance(10_000);
    const person = world.person();
    await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey: "page-person-2" }));
    const prov = world.provenance(person.id);
    await db.transaction((uow) => uow.provenances.insert(prov, { idempotencyKey: "page-prov-2" }));

    const heartRate: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      world.clock.advance(1_000);
      const observation = {
        ...world.observation(person.id, prov.provenanceId),
        conceptCode: "SYNTH-8863-5",
      };
      await insertObservation(observation, `page-hr-${i}`);
      heartRate.push(observation.id);
    }
    for (let i = 0; i < 2; i += 1) {
      world.clock.advance(1_000);
      const observation = {
        ...world.observation(person.id, prov.provenanceId),
        conceptCode: "SYNTH-29463-7",
      };
      await insertObservation(observation, `page-other-${i}`);
    }

    const page = await db.observations.listByPersonAndConcept(person.id, "SYNTH-8863-5", {
      limit: 2,
    });
    expect(page.items.map((o) => o.id)).toEqual([...heartRate].reverse().slice(0, 2));
    const page2 = await db.observations.listByPersonAndConcept(person.id, "SYNTH-8863-5", {
      limit: 2,
      cursor: page.nextCursor,
    });
    expect(page2.items.map((o) => o.id)).toEqual([...heartRate].reverse().slice(2));
    expect(page2.nextCursor).toBeUndefined();
  });

  it("rejects malformed cursors and out-of-range limits", async () => {
    await expect(db.observations.listByPerson(personId, { cursor: "garbage!!" })).rejects.toThrowError(
      PersistenceError,
    );
    await expect(db.observations.listByPerson(personId, { limit: 0 })).rejects.toThrowError(
      PersistenceError,
    );
    await expect(db.observations.listByPerson(personId, { limit: 201 })).rejects.toThrowError(
      PersistenceError,
    );
  });
});
