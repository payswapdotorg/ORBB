import { describe, expect, it } from "vitest";
import { parseEvidenceId, parsePersonId } from "@orbb/domain";
import type { EncryptedEnvelope } from "./crypto/envelope.js";
import {
  InMemoryEventSink,
  InMemoryEvidenceMetadataStore,
  InMemoryObjectStore,
  InMemoryTaskSink,
  StaticUploadAuthorizationGuard,
  SyntheticUploadPresigner,
} from "./inmemory.js";
import { UploadFlowError } from "./errors.js";
import {
  parseUploadSessionId,
  type EvidenceObjectRecord,
  type UploadSessionRecord,
} from "./upload/contracts.js";

const PERSON_ID = parsePersonId("prsn_TESTpersonid00001");
const EVIDENCE_ID = parseEvidenceId("evid_TESTobjectid000001");
const SESSION_ID = parseUploadSessionId("usess_TESTsessionid001");

function fakeEnvelope(): EncryptedEnvelope {
  return {
    algorithm: "AES-256-GCM",
    ciphertext: new Uint8Array([1, 2, 3]),
    wrappedKey: {
      algorithm: "AES-256-GCM",
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(32),
      tag: new Uint8Array(16),
    },
    iv: new Uint8Array(12),
    tag: new Uint8Array(16),
    context: { keySpace: "test" },
  };
}

function openSession(): UploadSessionRecord {
  return {
    sessionId: SESSION_ID,
    evidenceId: EVIDENCE_ID,
    personId: PERSON_ID,
    objectKey: `evidence/v1/${EVIDENCE_ID}/abc`,
    mediaType: "image/jpeg",
    declaredSha256: "a".repeat(64),
    declaredSizeBytes: 3,
    purpose: "SELF_TRACKING",
    scope: ["evidence:write"],
    createdAt: new Date(1_000),
    expiresAt: new Date(1_000 + 900_000),
    state: "open",
  };
}

function evidenceRecord(): EvidenceObjectRecord {
  return {
    id: EVIDENCE_ID,
    personId: PERSON_ID,
    objectKey: `evidence/v1/${EVIDENCE_ID}/abc`,
    mediaType: "image/jpeg",
    sha256: "a".repeat(64),
    sizeBytes: 3,
    retentionClass: "original",
    state: "active",
    createdAt: new Date(2_000),
    sessionId: SESSION_ID,
    encryptedMetadata: fakeEnvelope(),
  };
}

describe("InMemoryObjectStore", () => {
  it("put/get round-trips bytes and metadata", async () => {
    const store = new InMemoryObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const summary = await store.put("k1", { bytes, contentType: "text/plain" });
    expect(summary).toEqual({ key: "k1", sizeBytes: 3, contentType: "text/plain" });
    const record = await store.get("k1");
    expect(record?.data.contentType).toBe("text/plain");
    expect(record?.sizeBytes).toBe(3);
    expect([...record!.data.bytes]).toEqual([1, 2, 3]);
  });

  it("defensively copies bytes on the way in and out", async () => {
    const store = new InMemoryObjectStore();
    const input = new Uint8Array([1, 2, 3]);
    await store.put("k1", { bytes: input, contentType: "text/plain" });
    input[0] = 99; // caller mutates after put
    const first = await store.get("k1");
    first!.data.bytes[1] = 77; // caller mutates the returned copy
    const second = await store.get("k1");
    expect([...first!.data.bytes]).toEqual([1, 77, 3]);
    expect([...second!.data.bytes]).toEqual([1, 2, 3]);
  });

  it("get returns undefined for missing keys; delete removes; list filters by prefix", async () => {
    const store = new InMemoryObjectStore();
    await store.put("evidence/v1/a", { bytes: new Uint8Array([1]), contentType: "a" });
    await store.put("evidence/v1/b", { bytes: new Uint8Array([2]), contentType: "b" });
    await store.put("other/c", { bytes: new Uint8Array([3]), contentType: "c" });
    expect(await store.get("missing")).toBeUndefined();
    expect((await store.list("evidence/v1/")).map((s) => s.key)).toEqual([
      "evidence/v1/a",
      "evidence/v1/b",
    ]);
    expect((await store.list()).length).toBe(3);
    await store.delete("evidence/v1/a");
    expect(await store.get("evidence/v1/a")).toBeUndefined();
    expect(store.size).toBe(2);
  });
});

describe("InMemoryEvidenceMetadataStore", () => {
  it("createSession persists and getSession returns the record", async () => {
    const store = new InMemoryEvidenceMetadataStore();
    await store.createSession(openSession());
    expect((await store.getSession(SESSION_ID))?.sessionId).toBe(SESSION_ID);
    expect(await store.getSession(parseUploadSessionId("usess_MISSINGsessionid001"))).toBeUndefined();
  });

  it("refuses duplicate session ids (factory collision = inconsistency)", async () => {
    const store = new InMemoryEvidenceMetadataStore();
    await store.createSession(openSession());
    await expect(store.createSession(openSession())).rejects.toThrowError(UploadFlowError);
  });

  it("finalizeEvidence stores evidence and flips the session to finalized", async () => {
    const store = new InMemoryEvidenceMetadataStore();
    await store.createSession(openSession());
    const stored = await store.finalizeEvidence({ sessionId: SESSION_ID, evidence: evidenceRecord() });
    expect(stored.id).toBe(EVIDENCE_ID);
    const session = await store.getSession(SESSION_ID);
    expect(session?.state).toBe("finalized");
    expect(session?.finalizedAt?.getTime()).toBe(2_000);
    expect((await store.getEvidence(EVIDENCE_ID))?.id).toBe(EVIDENCE_ID);
  });

  it("finalizeEvidence is idempotent for an already-finalized session", async () => {
    const store = new InMemoryEvidenceMetadataStore();
    await store.createSession(openSession());
    const first = await store.finalizeEvidence({ sessionId: SESSION_ID, evidence: evidenceRecord() });
    const second = await store.finalizeEvidence({ sessionId: SESSION_ID, evidence: evidenceRecord() });
    expect(second).toEqual(first);
    expect(store.evidenceCount).toBe(1);
  });

  it("finalizeEvidence rejects unknown sessions", async () => {
    const store = new InMemoryEvidenceMetadataStore();
    await expect(
      store.finalizeEvidence({ sessionId: SESSION_ID, evidence: evidenceRecord() }),
    ).rejects.toThrowError(UploadFlowError);
  });
});

describe("InMemoryEventSink / InMemoryTaskSink", () => {
  it("record emissions in order and return defensive copies", () => {
    const events = new InMemoryEventSink();
    events.emit({
      type: "EVIDENCE_INGESTED",
      eventId: "evt_TESTeventid000001",
      evidenceId: EVIDENCE_ID,
      personId: PERSON_ID,
      objectKey: "evidence/v1/x",
      mediaType: "image/jpeg",
      sha256: "a".repeat(64),
      sizeBytes: 3,
      occurredAt: new Date(1),
      correlationId: SESSION_ID,
    });
    const snapshot = events.events;
    events.clear();
    expect(snapshot).toHaveLength(1);
    expect(events.events).toHaveLength(0);
  });

  it("records tasks in order", () => {
    const tasks = new InMemoryTaskSink();
    tasks.enqueue({
      taskType: "EVIDENCE_PROCESSING",
      evidenceId: EVIDENCE_ID,
      objectKey: "evidence/v1/x",
      mediaType: "image/jpeg",
      sha256: "a".repeat(64),
      sizeBytes: 3,
      queuedAt: new Date(1),
    });
    expect(tasks.tasks[0]?.taskType).toBe("EVIDENCE_PROCESSING");
    expect(tasks.tasks).toHaveLength(1);
  });
});

describe("StaticUploadAuthorizationGuard (deny-by-default)", () => {
  const guard = new StaticUploadAuthorizationGuard({
    allowedPurposes: ["SELF_TRACKING"],
    allowedScopes: ["evidence:write", "observations:read"],
  });

  it("allows an allowlisted purpose with fully allowlisted scopes", () => {
    expect(
      guard.authorize({
        personId: PERSON_ID,
        purpose: "SELF_TRACKING",
        scope: ["evidence:write", "observations:read"],
      }),
    ).toBe(true);
  });

  it("denies unknown purposes and unlisted scope tokens", () => {
    expect(
      guard.authorize({ personId: PERSON_ID, purpose: "MARKETING", scope: ["evidence:write"] }),
    ).toBe(false);
    expect(
      guard.authorize({ personId: PERSON_ID, purpose: "SELF_TRACKING", scope: ["admin:all"] }),
    ).toBe(false);
  });

  it("an empty allowlist denies everything", () => {
    const empty = new StaticUploadAuthorizationGuard();
    expect(
      empty.authorize({ personId: PERSON_ID, purpose: "SELF_TRACKING", scope: ["evidence:write"] }),
    ).toBe(false);
  });
});

describe("SyntheticUploadPresigner", () => {
  it("issues deterministic synthetic PUT URLs with expiry from the injected clock", async () => {
    let now = 5_000;
    const presigner = new SyntheticUploadPresigner({ nowMs: () => now });
    const first = await presigner.presignUpload({
      key: "evidence/v1/evid_TESTobjectid000001/abc",
      contentType: "image/jpeg",
      sizeBytes: 3,
      ttlSeconds: 60,
    });
    expect(first.method).toBe("PUT");
    expect(first.contentType).toBe("image/jpeg");
    expect(first.url).toContain("evidence/v1/");
    expect(first.expiresAt.getTime()).toBe(65_000);
    const second = await presigner.presignUpload({
      key: "evidence/v1/evid_TESTobjectid000001/abc",
      contentType: "image/jpeg",
      sizeBytes: 3,
      ttlSeconds: 60,
    });
    expect(second.url).toBe(first.url);
    now = 6_000;
    const third = await presigner.presignUpload({
      key: "evidence/v1/evid_TESTobjectid000001/abc",
      contentType: "image/jpeg",
      sizeBytes: 3,
      ttlSeconds: 60,
    });
    expect(third.expiresAt.getTime()).toBe(66_000);
  });
});
