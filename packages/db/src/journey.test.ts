/**
 * M2-D Lane A — the E2E synthetic upload journey, service-wired.
 *
 * The REAL @orbb/databox `UploadSessionService` runs the full §6 flow
 * against the REAL components:
 *   - metadataStore: `EvidenceMetadataStoreDb` over the PGlite harness
 *     (real Postgres executing the real migration SQL — always-on, no
 *     DATABASE_URL gate);
 *   - objectStore: the in-memory ObjectStore reference double;
 *   - presigner: the synthetic presigner (deterministic expiry under
 *     the testkit clock);
 *   - encryptor: the real `EnvelopeEncryptor` over an injected
 *     `SecretKeyProvider` wrapping secret (>= 16 chars, obviously
 *     synthetic);
 *   - clock/ids: `DeterministicClock` + `DeterministicIdFactory`
 *     (SYNTH- marker in every id);
 *   - checksum: the real sha256 verifier;
 *   - EventSink: wired to the OUTBOX DRAIN — `emit` records the
 *     service-level post-commit emission and then publishes the durable
 *     outbox rows (listPending → deliver → markPublished round-trip).
 *
 * The journey walks: synthetic person → createUploadSession
 * (deny-by-default, presigned URL shape) → real bytes at the object
 * key → finalizeUpload with the REAL sha256 → metadata retrievable,
 * object bytes retrievable (original retained), sensitive fields only
 * inside the envelope, EVIDENCE_INGESTED in the outbox EXACTLY once
 * (drain + markPublished round-trip), double finalize idempotent, and
 * the append-only access-audit trail paginated newest-first.
 *
 * Plus the three M2-D regression guards:
 *   1. deny-by-default authorization (both directions, fail-closed);
 *   2. stored-object checksum mismatch refuses finalize;
 *   3. a post-commit EventSink failure cannot lose EVIDENCE_INGESTED —
 *      the M2-C gap, closed by the transactional outbox.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  EnvelopeEncryptor,
  InMemoryObjectStore,
  InMemoryTaskSink,
  SecretKeyProvider,
  StaticUploadAuthorizationGuard,
  SyntheticUploadPresigner,
  UploadFlowError,
  UploadSessionService,
  sha256Checksum,
  type EventSink,
  type EvidenceIngestedEvent,
  type UploadAuthorizationGuard,
  type UploadFlowErrorCode,
} from "@orbb/databox";
import { EvidenceMetadataStoreDb, evidenceIngestedEventId } from "./evidence-store.js";
import type { Db } from "./contracts.js";
import { evidenceObjects } from "./schema.js";
import { fixtureWorld, type FixtureWorld } from "./testfixtures.js";
import { createTestDb, type TestDbHandle } from "./testing.js";

/** Context the databox service binds evidence envelopes under (pinned). */
const EVIDENCE_METADATA_KEY_SPACE = "orbb/databox/evidence-metadata";
/** Injected development wrapping secret (>= 16 chars, obviously synthetic). */
const WRAPPING_SECRET = "SYNTH-journey-wrapping-secret";
/** The synthetic purpose/scope the journey's guard authorizes. */
const AUTHORIZED_PURPOSE = "SYNTH-SELF_TRACKING";
const AUTHORIZED_SCOPE = ["evidence:write"];

let world: FixtureWorld;
let handle: TestDbHandle;
let db: Db;

beforeAll(async () => {
  world = fixtureWorld("m2d-journey");
  handle = await createTestDb({ clock: world.clock });
  db = handle.orbb;
});

afterAll(async () => {
  if (handle !== undefined) {
    await handle.orbb.close();
  }
});

// ---------------------------------------------------------------------------
// The drain-wired EventSink (publisher semantics over the outbox).
// ---------------------------------------------------------------------------

/**
 * EventSink wired to the outbox drain: `emit` records the service-level
 * post-commit emission, then publishes every durable outbox row
 * (listPending → deliver → markPublished) exactly once. `failNextEmit`
 * simulates the M2-C post-commit sink failure for regression guard 3.
 */
class OutboxDrainingEventSink implements EventSink {
  readonly emissions: EvidenceIngestedEvent[] = [];
  readonly published: { eventId: string; eventType: string; payload: Record<string, unknown> }[] = [];
  readonly #db: Db;
  #failNextEmit = false;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Arms the next emit() to explode AFTER recording the emission. */
  failNextEmit(): void {
    this.#failNextEmit = true;
  }

  async emit(event: EvidenceIngestedEvent): Promise<void> {
    this.emissions.push(event);
    if (this.#failNextEmit) {
      this.#failNextEmit = false;
      throw new Error("SYNTH-post-commit-sink-boom");
    }
    await this.drain();
  }

  /** Publishes all pending outbox rows, oldest-first, exactly once each. */
  async drain(): Promise<void> {
    for (;;) {
      const page = await this.#db.outbox.listPending({ limit: 50 });
      if (page.items.length === 0) {
        return;
      }
      for (const row of page.items) {
        this.published.push({
          eventId: row.eventId,
          eventType: row.eventType,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        });
        await this.#db.outbox.markPublished(row.eventId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

/** One wired §6 upload stack over the shared PGlite database. */
interface JourneyHarness {
  readonly service: UploadSessionService;
  readonly adapter: EvidenceMetadataStoreDb;
  readonly encryptor: EnvelopeEncryptor;
  readonly sink: OutboxDrainingEventSink;
  readonly tasks: InMemoryTaskSink;
  readonly objectStore: InMemoryObjectStore;
}

function makeJourney(guard?: UploadAuthorizationGuard): JourneyHarness {
  const objectStore = new InMemoryObjectStore();
  const adapter = new EvidenceMetadataStoreDb(db);
  const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: WRAPPING_SECRET }));
  const sink = new OutboxDrainingEventSink(db);
  const tasks = new InMemoryTaskSink();
  const service = new UploadSessionService({
    objectStore,
    presigner: new SyntheticUploadPresigner({ nowMs: () => world.clock.epochMs }),
    metadataStore: adapter,
    encryptor,
    events: sink,
    tasks,
    guard:
      guard ??
      new StaticUploadAuthorizationGuard({
        allowedPurposes: [AUTHORIZED_PURPOSE],
        allowedScopes: AUTHORIZED_SCOPE,
      }),
    clock: world.clock,
    ids: world.ids,
    checksum: sha256Checksum,
  });
  return { service, adapter, encryptor, sink, tasks, objectStore };
}

async function expectFlowError(
  promise: Promise<unknown>,
  code: UploadFlowErrorCode,
): Promise<void> {
  const thrown: unknown = await promise.then(
    () => new Error("expected the upload call to reject, but it resolved"),
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(UploadFlowError);
  if (thrown instanceof UploadFlowError) {
    expect(thrown.code).toBe(code);
  }
}

async function insertPerson(idempotencyKey: string): Promise<ReturnType<FixtureWorld["person"]>> {
  const person = world.person();
  await db.transaction((uow) => uow.persons.insert(person, { idempotencyKey }));
  return person;
}

// ---------------------------------------------------------------------------
// The golden journey.
// ---------------------------------------------------------------------------

describe("E2E synthetic upload journey (service-wired, PGlite-backed)", () => {
  it("walks §6 end to end: authorize → session → presign → upload → finalize → event → audit", async () => {
    const { service, adapter, encryptor, sink, tasks, objectStore } = makeJourney();

    // The synthetic person (the upload session's person FK target).
    const person = await insertPerson("jr-p1");

    // Real bytes and their REAL sha256 (verified from stored bytes later).
    const payload = new Uint8Array(Buffer.from("SYNTH-journey-object-bytes-v1", "utf8"));
    const realSha256 = sha256Checksum(payload);

    // §6 steps 1–3: authorize, create the session, presign.
    const created = await service.createUploadSession({
      personId: person.id,
      mediaType: "image/jpeg",
      declaredSha256: realSha256,
      declaredSizeBytes: payload.byteLength,
      purpose: AUTHORIZED_PURPOSE,
      scope: AUTHORIZED_SCOPE,
    });
    const session = created.session;
    expect(session.state).toBe("open");
    expect(session.sessionId.startsWith("usess_")).toBe(true);
    expect(session.evidenceId.startsWith("evid_")).toBe(true);
    expect(session.objectKey).toBe(`evidence/v1/${session.evidenceId}/${realSha256}`);

    // Presigned URL shape (synthetic presigner; deterministic expiry).
    expect(created.uploadUrl.method).toBe("PUT");
    expect(created.uploadUrl.contentType).toBe("image/jpeg");
    expect(created.uploadUrl.url).toBe(`https://synthetic-upload.local/${session.objectKey}`);
    expect(created.uploadUrl.expiresAt.getTime()).toBe(world.clock.epochMs + 900_000);

    // §6 step 4: the "client" uploads the real bytes (the presigned URL
    // upload is simulated by writing to the in-memory store directly).
    await objectStore.put(session.objectKey, {
      bytes: payload,
      contentType: session.mediaType,
    });

    // §6 steps 5–9: finalize with the real checksum of the real bytes.
    const finalizeInput = {
      sessionId: session.sessionId,
      receivedSha256: realSha256,
      size: payload.byteLength,
      objectKey: session.objectKey,
    };
    const finalized = await service.finalizeUpload(finalizeInput);

    // §6 step 6 — the finalized metadata is retrievable from the store.
    expect(finalized.id).toBe(session.evidenceId);
    expect(finalized.personId).toBe(person.id);
    expect(finalized.sha256).toBe(realSha256);
    expect(finalized.sizeBytes).toBe(payload.byteLength);
    expect(finalized.retentionClass).toBe("original");
    expect(finalized.state).toBe("active");
    expect(finalized.sessionId).toBe(session.sessionId);
    const stored = await adapter.getEvidence(session.evidenceId);
    expect(stored).toEqual(finalized);

    // The session flipped to finalized in the SAME transaction.
    const storedSession = await adapter.getSession(session.sessionId);
    expect(storedSession?.state).toBe("finalized");
    expect(storedSession?.finalizedAt).toEqual(finalized.createdAt);

    // §6 step 9 — the original object is retained and retrievable.
    const object = await objectStore.get(session.objectKey);
    expect(object).toBeDefined();
    expect(object?.data.bytes).toEqual(payload);
    expect(object?.data.contentType).toBe("image/jpeg");
    expect(object?.sizeBytes).toBe(payload.byteLength);

    // Sensitive fields live ONLY inside the envelope — decrypt with the
    // SAME provider + context and the sensitive metadata round-trips.
    const decrypted = await encryptor.decrypt(finalized.encryptedMetadata, {
      personId: person.id,
      evidenceId: session.evidenceId,
      keySpace: EVIDENCE_METADATA_KEY_SPACE,
    });
    expect(JSON.parse(Buffer.from(decrypted).toString("utf8"))).toEqual({
      capturedAt: finalized.createdAt.toISOString(),
      purpose: AUTHORIZED_PURPOSE,
      scope: AUTHORIZED_SCOPE,
    });

    // ...and the raw stored jsonb carries NO plaintext sensitive fields.
    const rawRows = await handle.drizzle
      .select()
      .from(evidenceObjects)
      .where(eq(evidenceObjects.id, session.evidenceId));
    expect(rawRows).toHaveLength(1);
    const rawEnvelope = JSON.stringify(rawRows[0]?.encryptedMetadata);
    expect(rawEnvelope).toContain("AES-256-GCM");
    expect(rawEnvelope).not.toContain(AUTHORIZED_PURPOSE);
    expect(rawEnvelope).not.toContain(AUTHORIZED_SCOPE[0] ?? "");

    // §6 step 7 — EVIDENCE_INGESTED exactly once, DURABLY: the service
    // emitted once, and the drain-wired sink published the outbox row
    // once (listPending → deliver → markPublished round-trip).
    const eventId = evidenceIngestedEventId(session.sessionId);
    const outboxRow = await db.outbox.findById(eventId);
    expect(outboxRow?.status).toBe("published");
    expect(outboxRow?.eventType).toBe("EVIDENCE_INGESTED");
    expect(sink.emissions).toHaveLength(1);
    expect(sink.published).toHaveLength(1);
    const published = sink.published[0];
    expect(published?.eventId).toBe(eventId);
    expect(published?.payload).toEqual({
      type: "EVIDENCE_INGESTED",
      eventId,
      evidenceId: session.evidenceId,
      personId: person.id,
      objectKey: session.objectKey,
      mediaType: "image/jpeg",
      sha256: realSha256,
      sizeBytes: payload.byteLength,
      occurredAt: finalized.createdAt.toISOString(),
      correlationId: session.sessionId,
    });
    const emission = sink.emissions[0];
    expect(emission?.type).toBe("EVIDENCE_INGESTED");
    expect(emission?.evidenceId).toBe(session.evidenceId);
    expect(emission?.correlationId).toBe(session.sessionId);

    // Nothing left pending; re-draining is a no-op (no duplicates).
    expect((await db.outbox.listPending({ limit: 10 })).items).toHaveLength(0);
    await sink.drain();
    expect(sink.published).toHaveLength(1);

    // §6 step 8 — the downstream processing task, exactly once.
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0]).toMatchObject({
      taskType: "EVIDENCE_PROCESSING",
      evidenceId: session.evidenceId,
      objectKey: session.objectKey,
      mediaType: "image/jpeg",
      sha256: realSha256,
      sizeBytes: payload.byteLength,
    });

    // Double finalize is idempotent: the stored record comes back, with
    // no re-emission, no re-drain, no re-enqueue.
    const again = await service.finalizeUpload(finalizeInput);
    expect(again).toEqual(finalized);
    expect(sink.emissions).toHaveLength(1);
    expect(sink.published).toHaveLength(1);
    expect(tasks.tasks).toHaveLength(1);

    // The append-only access-audit trail, cursor-paginated newest-first.
    const auditIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const audit = world.audit(person.id);
      auditIds.push(audit.id);
      await db.transaction(async (uow) => {
        await uow.audits.appendAccessAudit(audit, { idempotencyKey: `jr-aud-${i}` });
        await uow.appendEvent(world.event("ACCESS_EVALUATED", { subject: person.id }));
      });
      world.clock.advance(1_000);
    }
    const page1 = await db.audits.listBySubject(person.id, { limit: 2 });
    expect(page1.items.map((audit) => audit.id)).toEqual([auditIds[4], auditIds[3]]);
    expect(page1.nextCursor).toBeDefined();
    const page2 = await db.audits.listBySubject(person.id, {
      cursor: page1.nextCursor,
      limit: 2,
    });
    expect(page2.items.map((audit) => audit.id)).toEqual([auditIds[2], auditIds[1]]);
    expect(page2.nextCursor).toBeDefined();
    const page3 = await db.audits.listBySubject(person.id, {
      cursor: page2.nextCursor,
      limit: 2,
    });
    expect(page3.items.map((audit) => audit.id)).toEqual([auditIds[0]]);
    expect(page3.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The three M2-D regression guards.
// ---------------------------------------------------------------------------

describe("regression guards", () => {
  it("GUARD 1: deny-by-default authorization — both directions, fail-closed, nothing persisted", async () => {
    const person = await insertPerson("jr-p2");
    const baseInput = {
      personId: person.id,
      mediaType: "image/jpeg",
      declaredSha256: sha256Checksum(new Uint8Array(Buffer.from("SYNTH-guard-declared-1", "utf8"))),
      declaredSizeBytes: 32,
      purpose: AUTHORIZED_PURPOSE,
      scope: AUTHORIZED_SCOPE,
    };

    const { service } = makeJourney();

    // A purpose outside the allowlist denies.
    await expectFlowError(
      service.createUploadSession({ ...baseInput, purpose: "SYNTH-UNAUTHORIZED" }),
      "unauthorized",
    );
    // A scope token outside the allowlist denies.
    await expectFlowError(
      service.createUploadSession({ ...baseInput, scope: ["evidence:read"] }),
      "unauthorized",
    );
    // A THROWING guard denies (fail-closed: a broken guard never opens
    // the door).
    const failing = makeJourney({
      authorize: () => {
        throw new Error("SYNTH-guard-boom");
      },
    });
    await expectFlowError(failing.service.createUploadSession(baseInput), "unauthorized");

    // NOTHING was persisted for the denied attempts.
    expect((await db.uploadSessions.listByPerson(person.id)).items).toHaveLength(0);

    // The other direction: the authorized combination DOES pass.
    const created = await service.createUploadSession(baseInput);
    expect(created.session.personId).toBe(person.id);
    expect((await db.uploadSessions.listByPerson(person.id)).items).toHaveLength(1);
  });

  it("GUARD 2: stored-object checksum mismatch refuses finalize — nothing persists", async () => {
    const person = await insertPerson("jr-p3");
    const declaredBytes = new Uint8Array(Buffer.from("SYNTH-declared-bytes-v1", "utf8"));
    const declaredSha256 = sha256Checksum(declaredBytes);

    const harness = makeJourney();
    const { service, adapter, objectStore } = harness;
    const { session } = await service.createUploadSession({
      personId: person.id,
      mediaType: "image/jpeg",
      declaredSha256,
      declaredSizeBytes: declaredBytes.byteLength,
      purpose: AUTHORIZED_PURPOSE,
      scope: AUTHORIZED_SCOPE,
    });

    // The uploader swears the declared checksum — but stores TAMPERED
    // bytes at the session's object key.
    const tamperedBytes = new Uint8Array(Buffer.from("SYNTH-tampered-bytes-v1", "utf8"));
    await objectStore.put(session.objectKey, {
      bytes: tamperedBytes,
      contentType: session.mediaType,
    });

    // §6 step 5: finalize re-verifies the checksum OF THE STORED OBJECT
    // (never trusting the request) — the mismatch refuses finalize.
    await expectFlowError(
      service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: declaredSha256,
        size: declaredBytes.byteLength,
        objectKey: session.objectKey,
      }),
      "checksum-mismatch",
    );

    // Nothing persisted: session still open, no evidence, no event, no
    // emission, no task.
    expect((await adapter.getSession(session.sessionId))?.state).toBe("open");
    expect(await adapter.getEvidence(session.evidenceId)).toBeUndefined();
    expect(await db.outbox.findById(evidenceIngestedEventId(session.sessionId))).toBeUndefined();
    expect(harness.sink.emissions).toHaveLength(0);
    expect(harness.tasks.tasks).toHaveLength(0);
  });

  it("GUARD 3: a post-commit EventSink failure cannot lose EVIDENCE_INGESTED (the M2-C gap, closed)", async () => {
    const person = await insertPerson("jr-p4");
    const payload = new Uint8Array(Buffer.from("SYNTH-sink-failure-bytes-v1", "utf8"));
    const realSha256 = sha256Checksum(payload);

    const harness = makeJourney();
    const { service, adapter, sink, objectStore, tasks } = harness;
    const { session } = await service.createUploadSession({
      personId: person.id,
      mediaType: "image/jpeg",
      declaredSha256: realSha256,
      declaredSizeBytes: payload.byteLength,
      purpose: AUTHORIZED_PURPOSE,
      scope: AUTHORIZED_SCOPE,
    });
    await objectStore.put(session.objectKey, {
      bytes: payload,
      contentType: session.mediaType,
    });

    // The sink explodes AFTER the finalize transaction committed — the
    // exact moment where M2-C LOST the EVIDENCE_INGESTED event forever.
    sink.failNextEmit();
    await expect(
      service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: realSha256,
        size: payload.byteLength,
        objectKey: session.objectKey,
      }),
    ).rejects.toThrow(/SYNTH-post-commit-sink-boom/);

    // The metadata DID commit before the sink fired (the caller may
    // retry; double finalize is idempotent)...
    expect((await adapter.getSession(session.sessionId))?.state).toBe("finalized");
    expect((await adapter.getEvidence(session.evidenceId))?.id).toBe(session.evidenceId);

    // ...and THE EVENT SURVIVED: it is durably PENDING in the outbox —
    // the gap-closer doing exactly what it was built for.
    const eventId = evidenceIngestedEventId(session.sessionId);
    const pendingRow = await db.outbox.findById(eventId);
    expect(pendingRow?.status).toBe("pending");
    expect(pendingRow?.eventType).toBe("EVIDENCE_INGESTED");

    // The publisher drains and publishes it exactly once (recovery).
    await sink.drain();
    const recovered = sink.published.find((event) => event.eventId === eventId);
    expect(recovered).toBeDefined();
    expect(recovered?.payload).toMatchObject({
      type: "EVIDENCE_INGESTED",
      evidenceId: session.evidenceId,
      personId: person.id,
      objectKey: session.objectKey,
      sha256: realSha256,
      correlationId: session.sessionId,
    });
    expect((await db.outbox.findById(eventId))?.status).toBe("published");

    // A retried finalize from the caller converges on the stored record
    // without re-emitting. (The EVIDENCE_PROCESSING task enqueue sits
    // downstream of the sink in the M2-C service order, so it stays
    // skipped here — the task lane is not outbox-protected in M2-D;
    // recorded handoff, NOT part of this packet's event-gap closure.)
    const retried = await service.finalizeUpload({
      sessionId: session.sessionId,
      receivedSha256: realSha256,
      size: payload.byteLength,
      objectKey: session.objectKey,
    });
    expect(retried.id).toBe(session.evidenceId);
    expect(sink.emissions).toHaveLength(1);
    expect(tasks.tasks).toHaveLength(0);
  });
});
