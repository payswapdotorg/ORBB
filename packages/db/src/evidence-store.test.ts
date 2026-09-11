/**
 * EvidenceMetadataStoreDb adapter tests (M2-D Lane A) against the PGlite
 * harness (real Postgres: FKs, unique constraints, transactions).
 *
 * Covers the adapter's contract surface:
 *   - create-before-publication sessions (create/get round-trip; the
 *     person FK; unknown ids read as undefined);
 *   - the finalize transaction: session flip + provenance + evidence
 *     upsert + EVIDENCE_INGESTED outbox row commit ATOMICALLY in ONE
 *     Db.transaction (the M2-C post-commit event gap, closed);
 *   - deterministic derived ids: the event id and the synthesized
 *     provenance id are pure functions of the session id;
 *   - idempotent finalize semantics: a replayed finalize returns the
 *     stored record unchanged; conflicting evidence ids are
 *     metadata-inconsistency failures (both on open and on finalized
 *     sessions);
 *   - envelope persistence: the stored jsonb carries ONLY base64
 *     ciphertext material (no plaintext purpose/scope) and round-trips
 *     losslessly for the crypto layer (same provider + context);
 *   - ROLLBACK ATOMICITY: a failure anywhere inside the finalize
 *     transaction — a unique-constraint conflict on the evidence row,
 *     or the outbox append itself exploding — commits NOTHING: session
 *     state, evidence, provenance, and the idempotency-ledger claims
 *     all roll back together, and a retry after the failure succeeds
 *     (which additionally proves the ledger claims were rolled back
 *     rather than leaked — a leaked claim would make the retry fail
 *     with a replay-missing error).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { EventId, OutboxRecord } from "@orbb/contracts";
import type { PersonId } from "@orbb/domain";
import {
  EnvelopeEncryptor,
  SecretKeyProvider,
  UploadFlowError,
  type EvidenceObjectRecord as DataBoxEvidence,
  type FinalizeEvidenceInput,
  type UploadFlowErrorCode,
  type UploadSessionRecord,
} from "@orbb/databox";
import { EvidenceMetadataStoreDb, evidenceIngestedEventId, uploadProvenanceId } from "./evidence-store.js";
import type { Db, PersonRecord } from "./contracts.js";
import { evidenceObjects } from "./schema.js";
import { fixtureWorld, type FixtureWorld } from "./testfixtures.js";
import { createTestDb, type TestDbHandle } from "./testing.js";

/** Context the databox service binds evidence envelopes under (pinned). */
const EVIDENCE_METADATA_KEY_SPACE = "orbb/databox/evidence-metadata";

let world: FixtureWorld;
let handle: TestDbHandle;
let db: Db;
let adapter: EvidenceMetadataStoreDb;
let encryptor: EnvelopeEncryptor;

beforeAll(async () => {
  world = fixtureWorld("m2d-store");
  handle = await createTestDb({ clock: world.clock });
  db = handle.orbb;
  adapter = new EvidenceMetadataStoreDb(db);
  // Injected development wrapping secret (>= 16 chars, obviously
  // synthetic) — never hardcoded in production code paths.
  encryptor = new EnvelopeEncryptor(
    new SecretKeyProvider({ secret: "SYNTH-adapter-wrapping-secret" }),
  );
});

afterAll(async () => {
  if (handle !== undefined) {
    await handle.orbb.close();
  }
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function insertPerson(idempotencyKey: string): Promise<PersonRecord> {
  const person = world.person();
  await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey }));
  return person;
}

async function openSession(personId: PersonId): Promise<UploadSessionRecord> {
  const session = world.uploadSession(personId);
  await adapter.createSession(session);
  return session;
}

/** Builds a finalize input carrying a REAL envelope over the session's sensitive metadata. */
async function finalizeInputFor(session: UploadSessionRecord): Promise<FinalizeEvidenceInput> {
  const createdAt = world.clock.now();
  const sensitive = {
    capturedAt: createdAt.toISOString(),
    purpose: session.purpose,
    scope: [...session.scope],
  };
  const encryptedMetadata = await encryptor.encrypt(
    new Uint8Array(Buffer.from(JSON.stringify(sensitive), "utf8")),
    {
      personId: session.personId,
      evidenceId: session.evidenceId,
      keySpace: EVIDENCE_METADATA_KEY_SPACE,
    },
  );
  const evidence: DataBoxEvidence = {
    id: session.evidenceId,
    personId: session.personId,
    objectKey: session.objectKey,
    mediaType: session.mediaType,
    sha256: session.declaredSha256,
    sizeBytes: session.declaredSizeBytes,
    retentionClass: "original",
    state: "active",
    createdAt,
    sessionId: session.sessionId,
    encryptedMetadata,
  };
  return { sessionId: session.sessionId, evidence };
}

async function expectUploadFlowError(
  promise: Promise<unknown>,
  code: UploadFlowErrorCode,
): Promise<void> {
  const thrown: unknown = await promise.then(
    () => new Error("expected the finalize call to reject, but it resolved"),
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(UploadFlowError);
  if (thrown instanceof UploadFlowError) {
    expect(thrown.code).toBe(code);
  }
}

async function requireOutboxRow(eventId: EventId): Promise<OutboxRecord> {
  const row = await db.outbox.findById(eventId);
  if (row === undefined) {
    throw new Error("expected the EVIDENCE_INGESTED outbox row to exist");
  }
  return row;
}

/**
 * Wraps a Db so every in-transaction `appendEvent` rejects — the §4
 * worst case simulated exactly at the gap-closer: after the state
 * writes, before the commit. Repositories and reads pass through.
 */
function withFailingAppendEvent(target: Db): Db {
  const transaction: Db["transaction"] = (work) =>
    target.transaction((uow) =>
      work({
        ...uow,
        appendEvent: () => Promise.reject(new Error("SYNTH-outbox-append-boom")),
      }),
    );
  return { ...target, close: () => target.close(), transaction };
}

// ---------------------------------------------------------------------------
// Sessions (create-before-publication, §6 step 2).
// ---------------------------------------------------------------------------

describe("EvidenceMetadataStoreDb — sessions", () => {
  it("createSession persists an open session; getSession round-trips it verbatim", async () => {
    const person = await insertPerson("es-p1");
    const session = await openSession(person.id);

    expect(session.state).toBe("open");
    const stored = await adapter.getSession(session.sessionId);
    expect(stored).toEqual(session);
    expect(stored?.state).toBe("open");
    expect(stored?.finalizedAt).toBeUndefined();
  });

  it("createSession enforces the person FK (unknown person rejects)", async () => {
    const session = world.uploadSession("prsn_SYNTH-no-such-person-1" as PersonId);
    await expect(adapter.createSession(session)).rejects.toThrow();
  });

  it("unknown ids read as undefined (sessions and evidence)", async () => {
    expect(await adapter.getSession("usess_SYNTH-never-created-1" as never)).toBeUndefined();
    expect(await adapter.getEvidence("evid_SYNTH-never-created-1" as never)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The finalize transaction (§6 step 6 + §4 transactional outbox).
// ---------------------------------------------------------------------------

describe("EvidenceMetadataStoreDb — finalize", () => {
  it("commits session flip + evidence + outbox event in ONE transaction, with deterministic derived ids", async () => {
    const person = await insertPerson("es-p2");
    const session = await openSession(person.id);
    const input = await finalizeInputFor(session);

    const result = await adapter.finalizeEvidence(input);

    // Returned record: the databox shape (upload-plane fields present).
    expect(result.id).toBe(session.evidenceId);
    expect(result.sessionId).toBe(session.sessionId);
    expect(result.personId).toBe(person.id);
    expect(result.objectKey).toBe(session.objectKey);
    expect(result.sha256).toBe(session.declaredSha256);
    expect(result.sizeBytes).toBe(session.declaredSizeBytes);
    expect(result.retentionClass).toBe("original");
    expect(result.state).toBe("active");
    expect(result.createdAt).toEqual(input.evidence.createdAt);

    // The session flipped, stamped with the finalize instant.
    const storedSession = await adapter.getSession(session.sessionId);
    expect(storedSession?.state).toBe("finalized");
    expect(storedSession?.evidenceId).toBe(session.evidenceId);
    expect(storedSession?.finalizedAt).toEqual(input.evidence.createdAt);

    // The evidence row reads back through the adapter, deep-equal.
    const storedEvidence = await adapter.getEvidence(session.evidenceId);
    expect(storedEvidence).toEqual(result);

    // Deterministic ids: event id + provenance id are pure functions of
    // the session id, and the provenance row exists with correlation.
    const eventId = evidenceIngestedEventId(session.sessionId);
    expect(eventId.startsWith("evt_")).toBe(true);
    expect(result.id).toBe(session.evidenceId);
    const provenanceId = uploadProvenanceId(session.sessionId);
    expect(provenanceId.startsWith("prov_")).toBe(true);
    const provenances = await db.provenances.listBySubject(person.id);
    expect(provenances.items).toHaveLength(1);
    expect(provenances.items[0]?.provenanceId).toBe(provenanceId);
    expect(provenances.items[0]?.actor).toBe(person.id);
    expect(provenances.items[0]?.subject).toBe(person.id);
    expect(provenances.items[0]?.correlationId).toBe(session.sessionId);

    // The EVIDENCE_INGESTED outbox row: pending, exact payload, no PHI.
    const row = await requireOutboxRow(eventId);
    expect(row.eventType).toBe("EVIDENCE_INGESTED");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(JSON.parse(row.payload)).toEqual({
      type: "EVIDENCE_INGESTED",
      eventId,
      evidenceId: session.evidenceId,
      personId: session.personId,
      objectKey: session.objectKey,
      mediaType: session.mediaType,
      sha256: session.declaredSha256,
      sizeBytes: session.declaredSizeBytes,
      occurredAt: input.evidence.createdAt.toISOString(),
      correlationId: session.sessionId,
    });
    expect(row.payload).not.toContain(session.purpose);
  });

  it("is idempotent: a replayed finalize returns the stored record and rewrites nothing", async () => {
    const person = await insertPerson("es-p3");
    const session = await openSession(person.id);
    const input = await finalizeInputFor(session);

    const first = await adapter.finalizeEvidence(input);
    const pendingBefore = await db.outbox.listPending({ limit: 100 });
    const second = await adapter.finalizeEvidence(input);

    expect(second).toEqual(first);
    expect(await adapter.getEvidence(session.evidenceId)).toEqual(first);
    // Exactly one pending EVIDENCE_INGESTED row — the replay appended nothing.
    const pendingAfter = await db.outbox.listPending({ limit: 100 });
    expect(pendingAfter.items).toHaveLength(pendingBefore.items.length);
    const eventId = evidenceIngestedEventId(session.sessionId);
    expect(pendingAfter.items.filter((row) => row.eventId === eventId)).toHaveLength(1);
  });

  it("rejects a CONFLICTING evidence id on a finalized session (metadata-inconsistency)", async () => {
    const person = await insertPerson("es-p4");
    const session = await openSession(person.id);
    const input = await finalizeInputFor(session);
    await adapter.finalizeEvidence(input);

    const conflicting: FinalizeEvidenceInput = {
      sessionId: session.sessionId,
      evidence: {
        ...input.evidence,
        id: "evid_SYNTH-conflicting-evidence-1" as DataBoxEvidence["id"],
      },
    };
    await expectUploadFlowError(adapter.finalizeEvidence(conflicting), "metadata-inconsistency");
  });

  it("rejects an evidence id that disagrees with the session's fixed id (open session)", async () => {
    const person = await insertPerson("es-p5");
    const session = await openSession(person.id);
    const input = await finalizeInputFor(session);

    const mismatched: FinalizeEvidenceInput = {
      sessionId: session.sessionId,
      evidence: {
        ...input.evidence,
        id: "evid_SYNTH-wrong-evidence-id-1" as DataBoxEvidence["id"],
      },
    };
    await expectUploadFlowError(adapter.finalizeEvidence(mismatched), "metadata-inconsistency");
    // The failed attempt left the session untouched.
    expect((await adapter.getSession(session.sessionId))?.state).toBe("open");
  });

  it("rejects finalize on a missing session (session-not-found)", async () => {
    const person = await insertPerson("es-p6");
    const ghost = world.uploadSession(person.id);
    const input = await finalizeInputFor(ghost);
    await expectUploadFlowError(adapter.finalizeEvidence(input), "session-not-found");
  });
});

// ---------------------------------------------------------------------------
// Envelope persistence (sensitive fields never in the clear).
// ---------------------------------------------------------------------------

describe("EvidenceMetadataStoreDb — envelope storage", () => {
  it("stores ONLY base64 ciphertext material in jsonb and round-trips for the crypto layer", async () => {
    const person = await insertPerson("es-p7");
    const session = await openSession(person.id);
    const input = await finalizeInputFor(session);
    const result = await adapter.finalizeEvidence(input);

    // The raw stored column: envelope fields are base64 strings; the
    // plaintext purpose/scope exist ONLY inside the ciphertext.
    const rawRows = await handle.drizzle
      .select()
      .from(evidenceObjects)
      .where(eq(evidenceObjects.id, session.evidenceId));
    expect(rawRows).toHaveLength(1);
    const rawEnvelope = JSON.stringify(rawRows[0]?.encryptedMetadata);
    expect(rawEnvelope).toContain("AES-256-GCM");
    expect(rawEnvelope).toContain("wrappedKey");
    expect(rawEnvelope).not.toContain(session.purpose);
    expect(rawEnvelope).not.toContain(session.scope[0] ?? "");

    // The adapter's record shape is decryptable with the SAME provider
    // and context — the serialize/deserialize round-trip is lossless.
    const decrypted = await encryptor.decrypt(result.encryptedMetadata, {
      personId: session.personId,
      evidenceId: session.evidenceId,
      keySpace: EVIDENCE_METADATA_KEY_SPACE,
    });
    expect(JSON.parse(Buffer.from(decrypted).toString("utf8"))).toEqual({
      capturedAt: input.evidence.createdAt.toISOString(),
      purpose: session.purpose,
      scope: [...session.scope],
    });
  });
});

// ---------------------------------------------------------------------------
// Rollback atomicity — the transaction commits ALL of it or NONE of it.
// ---------------------------------------------------------------------------

describe("EvidenceMetadataStoreDb — rollback atomicity", () => {
  it("a unique-constraint failure mid-transaction rolls back EVERYTHING (state, provenance, ledger)", async () => {
    const person = await insertPerson("es-p8");
    const session = await openSession(person.id);
    const input = await finalizeInputFor(session);

    // Decoy row: a DIFFERENT evidence object already claims the session's
    // content-addressed object key (uq_evidence_objects_object_key).
    const decoyPerson = await insertPerson("es-p9");
    const decoyProvenance = world.provenance(decoyPerson.id);
    const decoy = {
      ...world.evidence(decoyPerson.id, decoyProvenance.provenanceId),
      objectKey: session.objectKey,
    };
    await db.transaction(async (uow) => {
      await uow.provenances.insert(decoyProvenance, { idempotencyKey: "es-decoy-pr" });
      await uow.evidence.insert(decoy, { idempotencyKey: "es-decoy-ev" });
      await uow.appendEvent(world.event("EVIDENCE_INGESTED", { evidenceId: decoy.id }));
    });

    // The finalize transaction hits the conflict AFTER the provenance
    // insert — the whole transaction must roll back.
    await expect(adapter.finalizeEvidence(input)).rejects.toThrow(/already stored/);

    expect((await adapter.getSession(session.sessionId))?.state).toBe("open");
    expect(await adapter.getEvidence(session.evidenceId)).toBeUndefined();
    expect(await db.outbox.findById(evidenceIngestedEventId(session.sessionId))).toBeUndefined();
    const provenances = await db.provenances.listBySubject(person.id);
    expect(provenances.items).toHaveLength(0);
  });

  it("an appendEvent failure at the gap-closer commits NOTHING, and a retry afterwards succeeds", async () => {
    const person = await insertPerson("es-p10");
    const session = await openSession(person.id);
    const input = await finalizeInputFor(session);
    const eventId = evidenceIngestedEventId(session.sessionId);

    // The §4 worst case: the outbox append itself fails after the state
    // writes. (This is the transaction-scoped twin of the post-commit
    // sink-failure regression in journey.test.ts.)
    const sabotaged = new EvidenceMetadataStoreDb(withFailingAppendEvent(db));
    await expect(sabotaged.finalizeEvidence(input)).rejects.toThrow(/SYNTH-outbox-append-boom/);

    // NOTHING committed: session still open, no evidence, no event, no
    // provenance — the rollback undid every write and every ledger claim.
    expect((await adapter.getSession(session.sessionId))?.state).toBe("open");
    expect(await adapter.getEvidence(session.evidenceId)).toBeUndefined();
    expect(await db.outbox.findById(eventId)).toBeUndefined();
    expect((await db.provenances.listBySubject(person.id)).items).toHaveLength(0);

    // The retry (same deterministic keys) succeeds — proving the
    // idempotency-ledger claims rolled back with the transaction (a
    // leaked claim would replay into a missing record and fail).
    const result = await adapter.finalizeEvidence(input);
    expect(result.id).toBe(session.evidenceId);
    expect((await adapter.getSession(session.sessionId))?.state).toBe("finalized");
    const row = await requireOutboxRow(eventId);
    expect(row.status).toBe("pending");
  });
});
