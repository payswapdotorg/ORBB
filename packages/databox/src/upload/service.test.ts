import { describe, expect, it } from "vitest";
import { parseEvidenceId, parsePersonId, type PersonId } from "@orbb/domain";
import { sha256Checksum } from "../checksum.js";
import { EnvelopeEncryptor } from "../crypto/envelope.js";
import { SecretKeyProvider } from "../crypto/keyprovider.js";
import { UploadFlowError } from "../errors.js";
import {
  InMemoryEventSink,
  InMemoryEvidenceMetadataStore,
  InMemoryObjectStore,
  InMemoryTaskSink,
  StaticUploadAuthorizationGuard,
  SyntheticUploadPresigner,
} from "../inmemory.js";
import { contentAddressedKey } from "../objectkeys.js";
import type { UploadAuthorizationGuard } from "./contracts.js";
import { parseUploadSessionId } from "./contracts.js";
import { UploadSessionService, type CreatedUploadSession, type CreateUploadSessionInput } from "./service.js";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";

const SECRET = "synthetic-dev-secret-EEEE-0005";
const EPOCH = Date.UTC(2025, 0, 15, 9, 0, 0);
const BYTES = new Uint8Array([10, 20, 30, 40, 50]);
const BYTES_SHA256 = sha256Checksum(BYTES);
const OTHER_BYTES = new Uint8Array([1, 1, 2, 3, 5, 8]);
const DEFAULT_TTL_MS = 900_000;

interface Harness {
  readonly clock: DeterministicClock;
  readonly service: UploadSessionService;
  readonly objectStore: InMemoryObjectStore;
  readonly metadataStore: InMemoryEvidenceMetadataStore;
  readonly events: InMemoryEventSink;
  readonly tasks: InMemoryTaskSink;
  readonly personId: PersonId;
}

function buildHarness(options?: { readonly sessionTtlSeconds?: number }): Harness {
  const clock = new DeterministicClock({ epochMs: EPOCH });
  const ids = new DeterministicIdFactory({ seed: "m2c" });
  const fixtureIds = new DeterministicIdFactory({ seed: "fixture" });
  const objectStore = new InMemoryObjectStore();
  const metadataStore = new InMemoryEvidenceMetadataStore();
  const events = new InMemoryEventSink();
  const tasks = new InMemoryTaskSink();
  const guard = new StaticUploadAuthorizationGuard({
    allowedPurposes: ["SELF_TRACKING", "CARE_MANAGEMENT"],
    allowedScopes: ["evidence:write", "observations:read"],
  });
  const presigner = new SyntheticUploadPresigner({ nowMs: () => clock.epochMs });
  const encryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
  const base = {
    objectStore,
    presigner,
    metadataStore,
    encryptor,
    events,
    tasks,
    guard,
    clock,
    ids,
    checksum: sha256Checksum,
  };
  const service = new UploadSessionService({
    ...base,
    ...(options?.sessionTtlSeconds !== undefined
      ? { options: { sessionTtlSeconds: options.sessionTtlSeconds } }
      : {}),
  });
  const personId = parsePersonId(fixtureIds.next("prsn"));
  return { clock, service, objectStore, metadataStore, events, tasks, personId };
}

function createInput(personId: PersonId): CreateUploadSessionInput {
  return {
    personId,
    mediaType: "image/jpeg",
    declaredSha256: BYTES_SHA256,
    declaredSizeBytes: BYTES.byteLength,
    purpose: "SELF_TRACKING",
    scope: ["evidence:write"],
  };
}

async function createUploadedSession(harness: Harness): Promise<CreatedUploadSession> {
  const created = await harness.service.createUploadSession(createInput(harness.personId));
  await harness.objectStore.put(created.session.objectKey, {
    bytes: BYTES,
    contentType: created.session.mediaType,
  });
  return created;
}

describe("UploadSessionService.createUploadSession (§6 steps 1–3)", () => {
  it("creates an open session with opaque ids, a content-addressed key, and a short-lived presigned URL", async () => {
    const h = buildHarness();
    const { session, uploadUrl } = await h.service.createUploadSession(createInput(h.personId));

    expect(session.sessionId).toMatch(/^usess_[A-Za-z0-9_-]{16,}$/);
    expect(session.evidenceId).toMatch(/^evid_[A-Za-z0-9_-]{16,}$/);
    expect(session.state).toBe("open");
    expect(session.personId).toBe(h.personId);
    expect(session.mediaType).toBe("image/jpeg");
    expect(session.declaredSha256).toBe(BYTES_SHA256);
    expect(session.declaredSizeBytes).toBe(5);
    expect(session.purpose).toBe("SELF_TRACKING");
    expect(session.scope).toEqual(["evidence:write"]);
    expect(session.objectKey).toBe(contentAddressedKey(session.evidenceId, BYTES_SHA256));
    expect(session.objectKey).toMatch(/^evidence\/v1\//);
    expect(session.createdAt.getTime()).toBe(EPOCH);
    expect(session.expiresAt.getTime()).toBe(EPOCH + DEFAULT_TTL_MS);

    expect(uploadUrl.method).toBe("PUT");
    expect(uploadUrl.contentType).toBe("image/jpeg");
    expect(uploadUrl.url).toContain("evidence/v1/");
    expect(uploadUrl.expiresAt.getTime()).toBe(EPOCH + DEFAULT_TTL_MS);

    const stored = await h.metadataStore.getSession(session.sessionId);
    expect(stored?.state).toBe("open");
  });

  it("presign TTL never exceeds the session TTL", async () => {
    const h = buildHarness({ sessionTtlSeconds: 60 });
    const { session, uploadUrl } = await h.service.createUploadSession(createInput(h.personId));
    expect(session.expiresAt.getTime()).toBe(EPOCH + 60_000);
    expect(uploadUrl.expiresAt.getTime()).toBe(EPOCH + 60_000);
  });

  it("rejects unauthorized purposes (deny-by-default)", async () => {
    const h = buildHarness();
    await expect(
      h.service.createUploadSession({ ...createInput(h.personId), purpose: "MARKETING" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "unauthorized" }));
    expect(h.metadataStore.sessionCount).toBe(0);
  });

  it("rejects unauthorized scope tokens", async () => {
    const h = buildHarness();
    await expect(
      h.service.createUploadSession({
        ...createInput(h.personId),
        scope: ["evidence:write", "admin:all"],
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "unauthorized" }));
  });

  it("denies when the guard itself throws (a failing guard never opens the door)", async () => {
    const h = buildHarness();
    const throwingGuard: UploadAuthorizationGuard = {
      authorize: () => {
        throw new Error("guard backend down");
      },
    };
    const service = new UploadSessionService({
      objectStore: h.objectStore,
      presigner: new SyntheticUploadPresigner({ nowMs: () => h.clock.epochMs }),
      metadataStore: h.metadataStore,
      encryptor: new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET })),
      events: h.events,
      tasks: h.tasks,
      guard: throwingGuard,
      clock: h.clock,
      ids: new DeterministicIdFactory({ seed: "throwing" }),
      checksum: sha256Checksum,
    });
    await expect(service.createUploadSession(createInput(h.personId))).rejects.toThrowError(
      expect.objectContaining({ code: "unauthorized" }),
    );
  });

  it("rejects malformed create requests without creating sessions", async () => {
    const h = buildHarness();
    const base = createInput(h.personId);
    const invalid: CreateUploadSessionInput[] = [
      { ...base, mediaType: "image" },
      { ...base, mediaType: "" },
      { ...base, declaredSha256: BYTES_SHA256.toUpperCase() },
      { ...base, declaredSha256: "short" },
      { ...base, declaredSizeBytes: 0 },
      { ...base, declaredSizeBytes: 1.5 },
      { ...base, purpose: "" },
      { ...base, scope: [] },
      { ...base, scope: [""] },
      { ...base, personId: "not-a-canonical-id" as unknown as PersonId },
    ];
    for (const input of invalid) {
      await expect(h.service.createUploadSession(input)).rejects.toThrowError(
        expect.objectContaining({ code: "invalid-request" }),
      );
    }
    expect(h.metadataStore.sessionCount).toBe(0);
  });
});

describe("UploadSessionService.finalizeUpload (§6 steps 5–9) — happy path", () => {
  it("verifies, finalizes, emits EVIDENCE_INGESTED once, queues the task, and retains the original", async () => {
    const h = buildHarness();
    const { session } = await createUploadedSession(h);

    const evidence = await h.service.finalizeUpload({
      sessionId: session.sessionId,
      receivedSha256: BYTES_SHA256,
      size: 5,
      objectKey: session.objectKey,
    });

    expect(evidence.id).toBe(session.evidenceId);
    expect(evidence.personId).toBe(h.personId);
    expect(evidence.objectKey).toBe(session.objectKey);
    expect(evidence.mediaType).toBe("image/jpeg");
    expect(evidence.sha256).toBe(BYTES_SHA256);
    expect(evidence.sizeBytes).toBe(5);
    expect(evidence.retentionClass).toBe("original");
    expect(evidence.state).toBe("active");
    expect(evidence.sessionId).toBe(session.sessionId);
    expect(evidence.createdAt.getTime()).toBe(EPOCH);

    // §6 step 7 — exactly one EVIDENCE_INGESTED.
    expect(h.events.events).toHaveLength(1);
    const event = h.events.events[0]!;
    expect(event.type).toBe("EVIDENCE_INGESTED");
    expect(event.eventId).toMatch(/^evt_[A-Za-z0-9_-]{16,}$/);
    expect(event.evidenceId).toBe(evidence.id);
    expect(event.personId).toBe(h.personId);
    expect(event.objectKey).toBe(evidence.objectKey);
    expect(event.mediaType).toBe("image/jpeg");
    expect(event.sha256).toBe(BYTES_SHA256);
    expect(event.sizeBytes).toBe(5);
    expect(event.occurredAt.getTime()).toBe(EPOCH);
    expect(event.correlationId).toBe(session.sessionId);

    // §6 step 8 — exactly one downstream task.
    expect(h.tasks.tasks).toHaveLength(1);
    const task = h.tasks.tasks[0]!;
    expect(task.taskType).toBe("EVIDENCE_PROCESSING");
    expect(task.evidenceId).toBe(evidence.id);
    expect(task.objectKey).toBe(evidence.objectKey);
    expect(task.mediaType).toBe("image/jpeg");
    expect(task.sha256).toBe(BYTES_SHA256);
    expect(task.sizeBytes).toBe(5);
    expect(task.queuedAt.getTime()).toBe(EPOCH);

    // §6 step 9 — the original is retained (never deleted).
    const stored = await h.objectStore.get(session.objectKey);
    expect(stored).toBeDefined();
    expect([...stored!.data.bytes]).toEqual([...BYTES]);

    // The session flipped to finalized.
    const updated = await h.metadataStore.getSession(session.sessionId);
    expect(updated?.state).toBe("finalized");
    expect(updated?.finalizedAt?.getTime()).toBe(EPOCH);
  });

  it("envelope-encrypts exactly the sensitive fields (capturedAt, purpose, scope) with context binding", async () => {
    const h = buildHarness();
    const { session } = await createUploadedSession(h);
    const evidence = await h.service.finalizeUpload({
      sessionId: session.sessionId,
      receivedSha256: BYTES_SHA256,
      size: 5,
      objectKey: session.objectKey,
    });

    // The clear record carries ONLY operational fields.
    expect(evidence).not.toHaveProperty("purpose");
    expect(evidence).not.toHaveProperty("scope");
    expect(evidence).not.toHaveProperty("capturedAt");

    // The sensitive fields decrypt under the binding context.
    const decryptor = new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET }));
    const context = {
      personId: h.personId,
      evidenceId: evidence.id,
      keySpace: "orbb/databox/evidence-metadata",
    };
    const decrypted = await decryptor.decrypt(evidence.encryptedMetadata, context);
    const sensitive = JSON.parse(Buffer.from(decrypted).toString("utf8")) as {
      capturedAt: string;
      purpose: string;
      scope: string[];
    };
    expect(sensitive.capturedAt).toBe(new Date(EPOCH).toISOString());
    expect(sensitive.purpose).toBe("SELF_TRACKING");
    expect(sensitive.scope).toEqual(["evidence:write"]);

    // Context binding: another person cannot decrypt this metadata.
    const otherPerson = parsePersonId(new DeterministicIdFactory({ seed: "other" }).next("prsn"));
    await expect(
      decryptor.decrypt(evidence.encryptedMetadata, { ...context, personId: otherPerson }),
    ).rejects.toThrowError(expect.objectContaining({ code: "context-mismatch" }));
  });

  it("double finalize is idempotent: same EvidenceObject id out, no duplicate events or tasks", async () => {
    const h = buildHarness();
    const { session } = await createUploadedSession(h);
    const finalizeInput = {
      sessionId: session.sessionId,
      receivedSha256: BYTES_SHA256,
      size: 5,
      objectKey: session.objectKey,
    };
    const first = await h.service.finalizeUpload(finalizeInput);
    const second = await h.service.finalizeUpload(finalizeInput);
    expect(second).toEqual(first);
    expect(second.id).toBe(first.id);
    expect(h.events.events).toHaveLength(1);
    expect(h.tasks.tasks).toHaveLength(1);
    expect(h.metadataStore.evidenceCount).toBe(1);

    // Even a replay with DIFFERENT received values returns the original
    // result (idempotency is keyed on the session, not the payload).
    const replayed = await h.service.finalizeUpload({
      sessionId: session.sessionId,
      receivedSha256: "0".repeat(64),
      size: 999,
      objectKey: "evidence/v1/somewhere/else",
    });
    expect(replayed).toEqual(first);
    expect(h.events.events).toHaveLength(1);
  });
});

describe("UploadSessionService.finalizeUpload — verification rejections", () => {
  it("rejects a received checksum that does not match the declared checksum", async () => {
    const h = buildHarness();
    const { session } = await createUploadedSession(h);
    await expect(
      h.service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: sha256Checksum(OTHER_BYTES),
        size: 5,
        objectKey: session.objectKey,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "checksum-mismatch" }));
    expect(h.events.events).toHaveLength(0);
    expect(h.tasks.tasks).toHaveLength(0);
    expect(h.metadataStore.evidenceCount).toBe(0);
    expect((await h.metadataStore.getSession(session.sessionId))?.state).toBe("open");
  });

  it("rejects when the STORED object's bytes do not hash to the declared checksum (independent verification)", async () => {
    const h = buildHarness();
    const { session } = await h.service.createUploadSession(createInput(h.personId));
    // The uploader claims the declared checksum but stored different bytes.
    await h.objectStore.put(session.objectKey, { bytes: OTHER_BYTES, contentType: "image/jpeg" });
    await expect(
      h.service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: session.objectKey,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "checksum-mismatch" }));
  });

  it("rejects a received size that does not match the declared size", async () => {
    const h = buildHarness();
    const { session } = await createUploadedSession(h);
    await expect(
      h.service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 6,
        objectKey: session.objectKey,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "size-mismatch" }));
    expect(h.events.events).toHaveLength(0);
  });

  it("rejects a media-type mismatch between the stored object and the session", async () => {
    const h = buildHarness();
    const { session } = await h.service.createUploadSession(createInput(h.personId));
    await h.objectStore.put(session.objectKey, { bytes: BYTES, contentType: "image/png" });
    await expect(
      h.service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: session.objectKey,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "media-type-mismatch" }));
  });

  it("rejects when nothing was uploaded (object missing)", async () => {
    const h = buildHarness();
    const { session } = await h.service.createUploadSession(createInput(h.personId));
    await expect(
      h.service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: session.objectKey,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "object-missing" }));
  });

  it("rejects an object key that does not match the session's content-addressed key", async () => {
    const h = buildHarness();
    const { session } = await createUploadedSession(h);
    await expect(
      h.service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: contentAddressedKey(parseEvidenceId("evid_OTHERobjectid00009"), BYTES_SHA256),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "object-key-mismatch" }));
  });

  it("rejects finalize for an unknown session", async () => {
    const h = buildHarness();
    await expect(
      h.service.finalizeUpload({
        sessionId: parseUploadSessionId("usess_MISSINGsessionid001"),
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: "evidence/v1/x/y",
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "session-not-found" }));
  });
});

describe("UploadSessionService.finalizeUpload — expiry (injected clock)", () => {
  it("enforces the session TTL: boundary is inclusive, past it is expired", async () => {
    const h = buildHarness({ sessionTtlSeconds: 60 });
    const { session } = await createUploadedSession(h);
    h.clock.advance(60_000); // exactly at expiry — still finalizable
    await expect(
      h.service.finalizeUpload({
        sessionId: session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: session.objectKey,
      }),
    ).resolves.toBeDefined();

    const second = await createUploadedSession(h);
    h.clock.advance(60_001); // one millisecond past expiry
    await expect(
      h.service.finalizeUpload({
        sessionId: second.session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: second.session.objectKey,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "session-expired" }));
    expect(h.events.events).toHaveLength(1); // only the first finalize emitted
  });

  it("a replayed finalize of an already-finalized session succeeds even after the session expired", async () => {
    const h = buildHarness({ sessionTtlSeconds: 60 });
    const { session } = await createUploadedSession(h);
    const first = await h.service.finalizeUpload({
      sessionId: session.sessionId,
      receivedSha256: BYTES_SHA256,
      size: 5,
      objectKey: session.objectKey,
    });
    h.clock.advance(3_600_000);
    const replay = await h.service.finalizeUpload({
      sessionId: session.sessionId,
      receivedSha256: BYTES_SHA256,
      size: 5,
      objectKey: session.objectKey,
    });
    expect(replay).toEqual(first);
    expect(h.events.events).toHaveLength(1);
  });
});

describe("UploadSessionService — documented post-commit gap (outbox lands with Lane A)", () => {
  it("a failing event sink after commit does not roll back metadata; replay stays idempotent", async () => {
    const h = buildHarness();
    const failingEvents = {
      emit: (): Promise<void> => {
        return Promise.reject(new Error("sink down"));
      },
    };
    const service = new UploadSessionService({
      objectStore: h.objectStore,
      presigner: new SyntheticUploadPresigner({ nowMs: () => h.clock.epochMs }),
      metadataStore: h.metadataStore,
      encryptor: new EnvelopeEncryptor(new SecretKeyProvider({ secret: SECRET })),
      events: failingEvents,
      tasks: h.tasks,
      guard: new StaticUploadAuthorizationGuard({
        allowedPurposes: ["SELF_TRACKING"],
        allowedScopes: ["evidence:write"],
      }),
      clock: h.clock,
      ids: new DeterministicIdFactory({ seed: "gap" }),
      checksum: sha256Checksum,
    });
    const created = await service.createUploadSession(createInput(h.personId));
    await h.objectStore.put(created.session.objectKey, {
      bytes: BYTES,
      contentType: created.session.mediaType,
    });
    await expect(
      service.finalizeUpload({
        sessionId: created.session.sessionId,
        receivedSha256: BYTES_SHA256,
        size: 5,
        objectKey: created.session.objectKey,
      }),
    ).rejects.toThrowError();

    // Metadata committed; event lost (the recorded §4 outbox gap).
    expect((await h.metadataStore.getSession(created.session.sessionId))?.state).toBe("finalized");
    expect(h.metadataStore.evidenceCount).toBe(1);
    expect(h.events.events).toHaveLength(0);
    expect(h.tasks.tasks).toHaveLength(0);

    // Replay is idempotent and does NOT retroactively emit the lost event.
    const replay = await service.finalizeUpload({
      sessionId: created.session.sessionId,
      receivedSha256: BYTES_SHA256,
      size: 5,
      objectKey: created.session.objectKey,
    });
    expect(replay.id).toBe(created.session.evidenceId);
    expect(h.events.events).toHaveLength(0);
    expect(h.tasks.tasks).toHaveLength(0);
  });
});

describe("UploadSessionService error taxonomy", () => {
  it("rejections are UploadFlowError instances with stable codes and PHID-safe messages", async () => {
    const h = buildHarness();
    const failure = await h.service
      .createUploadSession({ ...createInput(h.personId), purpose: "MARKETING" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UploadFlowError);
    const flowError = failure as UploadFlowError;
    expect(flowError.code).toBe("unauthorized");
    expect(flowError.message).not.toContain(h.personId);
    expect(flowError.message).not.toContain("SELF_TRACKING");
  });
});
