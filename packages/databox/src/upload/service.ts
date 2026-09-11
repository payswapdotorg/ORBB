/**
 * A17 — upload-session orchestration (architecture §6 raw-object upload
 * flow), implemented strictly against INTERFACES:
 *
 *   1. authorize purpose/scope            -> injected UploadAuthorizationGuard
 *   2. create upload session              -> EvidenceMetadataStore.createSession
 *   3. short-lived signed upload URL      -> injected UploadUrlPresigner
 *   4. upload directly to the object store (client-side; not orchestrated here)
 *   5. verify checksum + size + mediaType -> injected ObjectStore + ChecksumVerifier
 *   6. finalize EvidenceObject transaction-> EvidenceMetadataStore.finalizeEvidence
 *   7. emit EVIDENCE_INGESTED             -> injected EventSink
 *   8. queue downstream processing        -> injected TaskSink
 *   9. retain the original                -> the stored object is never deleted
 *
 * WHAT GETS ENVELOPE-ENCRYPTED (recorded decision, architecture §7
 * "record what you encrypt"): the EvidenceObject's OPERATIONAL fields
 * (id, personId, objectKey, mediaType, sha256, sizeBytes, retentionClass,
 * state, createdAt, sessionId) are stored in the clear — they are opaque
 * ids, digests, and policy fields needed for indexing and verification.
 * The PRIVACY-SENSITIVE fields (capturedAt, purpose of collection, scope
 * tokens) are serialized to JSON and stored ONLY inside
 * `encryptedMetadata` (AES-256-GCM envelope, context-bound to
 * person + key-space + evidence id). Raw object PAYLOADS are NOT
 * envelope-encrypted in this packet: §6 mandates direct-to-store uploads
 * plus retention of the original, which excludes server-side payload
 * re-encryption without an architectural change (client-side or proxy
 * encryption is a recorded future refinement).
 *
 * Idempotency: a session's EvidenceId is fixed at creation, so a repeated
 * `finalizeUpload` returns the stored EvidenceObject (same id) and does
 * NOT re-emit the event or re-enqueue tasks.
 *
 * Known gap (recorded handoff to the Lane A integration packet): §4 wants
 * finalize + event emission inside one transactional outbox; M2-C emits
 * via the injected EventSink after the metadata transaction commits. If
 * the sink fails post-commit, the event is lost until the outbox-backed
 * store/sink pair lands.
 */
import { ID_PREFIXES, parseEvidenceId, type EvidenceId, type PersonId } from "@orbb/domain";
import type { ObjectStore } from "@orbb/platform";
import type { Clock, IdFactory } from "@orbb/testkit";
import type { ChecksumVerifier } from "../checksum.js";
import type { EnvelopeEncryptor } from "../crypto/envelope.js";
import { UploadFlowError } from "../errors.js";
import { contentAddressedKey, parseSha256Hex } from "../objectkeys.js";
import type {
  EventSink,
  EvidenceMetadataStore,
  EvidenceObjectRecord,
  PresignedUploadUrl,
  TaskSink,
  UploadAuthorizationGuard,
  UploadSessionId,
  UploadSessionRecord,
  UploadUrlPresigner,
} from "./contracts.js";

/** The sensitive metadata serialized into the encrypted envelope. */
export interface EvidenceSensitiveMetadata {
  /** Evidence finalization (capture) time, ISO-8601. */
  readonly capturedAt: string;
  /** Purpose of collection the upload was authorized under. */
  readonly purpose: string;
  /** Scope tokens the upload was authorized under. */
  readonly scope: readonly string[];
}

/** Input for creating an upload session (§6 steps 1–3). */
export interface CreateUploadSessionInput {
  readonly personId: PersonId;
  readonly mediaType: string;
  readonly declaredSha256: string;
  readonly declaredSizeBytes: number;
  readonly purpose: string;
  readonly scope: readonly string[];
}

/** Result of creating an upload session. */
export interface CreatedUploadSession {
  readonly session: UploadSessionRecord;
  readonly uploadUrl: PresignedUploadUrl;
}

/** Input for finalizing an upload (§6 steps 5–9). */
export interface FinalizeUploadInput {
  readonly sessionId: UploadSessionId;
  readonly receivedSha256: string;
  readonly size: number;
  readonly objectKey: string;
}

/** Tunable service defaults. */
export interface UploadSessionServiceOptions {
  /** Upload-session lifetime (default 900s = 15 minutes). */
  readonly sessionTtlSeconds?: number;
  /** Presigned upload-URL lifetime (default 900s; never above session TTL). */
  readonly presignTtlSeconds?: number;
  /** Maximum declared upload size in bytes (default 512 MiB). */
  readonly maxDeclaredSizeBytes?: number;
}

/** Constructor dependencies — every effect is an injected interface. */
export interface UploadSessionServiceDeps {
  readonly objectStore: ObjectStore;
  readonly presigner: UploadUrlPresigner;
  readonly metadataStore: EvidenceMetadataStore;
  readonly encryptor: EnvelopeEncryptor;
  readonly events: EventSink;
  readonly tasks: TaskSink;
  readonly guard: UploadAuthorizationGuard;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly checksum: ChecksumVerifier;
  readonly options?: UploadSessionServiceOptions;
}

const DEFAULT_SESSION_TTL_SECONDS = 900;
const DEFAULT_PRESIGN_TTL_SECONDS = 900;
const DEFAULT_MAX_DECLARED_SIZE_BYTES = 536_870_912; // 512 MiB
const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const RETENTION_CLASS_ORIGINAL = "original";
/** Encryption key-space label bound into every evidence metadata envelope. */
const EVIDENCE_METADATA_KEY_SPACE = "orbb/databox/evidence-metadata";

/**
 * Orchestrates the architecture §6 upload flow against injected
 * interfaces. Deny-by-default: a session is created only when the guard
 * explicitly authorizes the purpose/scope; finalize re-verifies
 * checksum, size, and media type against the STORED object before the
 * metadata transaction, event emission, and task enqueue.
 */
export class UploadSessionService {
  readonly #objectStore: ObjectStore;
  readonly #presigner: UploadUrlPresigner;
  readonly #metadataStore: EvidenceMetadataStore;
  readonly #encryptor: EnvelopeEncryptor;
  readonly #events: EventSink;
  readonly #tasks: TaskSink;
  readonly #guard: UploadAuthorizationGuard;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #checksum: ChecksumVerifier;
  readonly #sessionTtlSeconds: number;
  readonly #presignTtlSeconds: number;
  readonly #maxDeclaredSizeBytes: number;

  constructor(deps: UploadSessionServiceDeps) {
    this.#objectStore = deps.objectStore;
    this.#presigner = deps.presigner;
    this.#metadataStore = deps.metadataStore;
    this.#encryptor = deps.encryptor;
    this.#events = deps.events;
    this.#tasks = deps.tasks;
    this.#guard = deps.guard;
    this.#clock = deps.clock;
    this.#ids = deps.ids;
    this.#checksum = deps.checksum;
    this.#sessionTtlSeconds =
      deps.options?.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.#presignTtlSeconds =
      deps.options?.presignTtlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS;
    this.#maxDeclaredSizeBytes =
      deps.options?.maxDeclaredSizeBytes ?? DEFAULT_MAX_DECLARED_SIZE_BYTES;
  }

  /**
   * §6 steps 1–3: authorize purpose/scope, create the session (fixing the
   * EvidenceObject id and the content-addressed object key), and issue a
   * short-lived presigned upload URL bound to the declared media type.
   * Unauthorized requests are rejected with code "unauthorized"
   * (deny-by-default: anything but an explicit `true` denies).
   */
  async createUploadSession(input: CreateUploadSessionInput): Promise<CreatedUploadSession> {
    assertCreateInput(input, this.#maxDeclaredSizeBytes);

    // Deny-by-default (§7): the guard must return exactly `true`; a thrown
    // or falsy outcome denies — a failing guard never opens the door.
    let authorized: boolean;
    try {
      authorized = await this.#guard.authorize({
        personId: input.personId,
        purpose: input.purpose,
        scope: input.scope,
      });
    } catch {
      authorized = false;
    }
    if (authorized !== true) {
      throw new UploadFlowError(
        "unauthorized",
        "Upload denied: the purpose/scope combination is not authorized for this person (deny-by-default).",
      );
    }

    const evidenceId = this.#newEvidenceId();
    const objectKey = contentAddressedKey(evidenceId, input.declaredSha256);
    const sessionId = this.#newSessionId();
    const createdAt = this.#clock.now();
    const ttlSeconds = Math.min(this.#presignTtlSeconds, this.#sessionTtlSeconds);
    const uploadUrl = await this.#presigner.presignUpload({
      key: objectKey,
      contentType: input.mediaType,
      sizeBytes: input.declaredSizeBytes,
      ttlSeconds,
    });

    const session: UploadSessionRecord = {
      sessionId,
      evidenceId,
      personId: input.personId,
      objectKey,
      mediaType: input.mediaType,
      declaredSha256: input.declaredSha256,
      declaredSizeBytes: input.declaredSizeBytes,
      purpose: input.purpose,
      scope: [...input.scope],
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.#sessionTtlSeconds * 1_000),
      state: "open",
    };
    await this.#metadataStore.createSession(session);
    return { session, uploadUrl };
  }

  /**
   * §6 steps 5–9: verify the uploaded object (checksum, size, media type
   * — re-verified from the STORED bytes, not trusted from the request),
   * finalize the EvidenceObject metadata transaction (with the sensitive
   * fields envelope-encrypted), emit EVIDENCE_INGESTED, enqueue the
   * downstream processing task, and RETAIN the original (the object is
   * never deleted).
   *
   * Idempotent: replaying a finalize for an already-finalized session
   * returns the stored EvidenceObject (same id) without re-emitting the
   * event or re-enqueuing the task. Expired-but-unfinalized sessions are
   * rejected with code "session-expired".
   */
  async finalizeUpload(input: FinalizeUploadInput): Promise<EvidenceObjectRecord> {
    const session = await this.#metadataStore.getSession(input.sessionId);
    if (session === undefined) {
      throw new UploadFlowError("session-not-found", "Upload session not found.");
    }
    if (session.state === "finalized") {
      const stored = await this.#metadataStore.getEvidence(session.evidenceId);
      if (stored === undefined) {
        throw new UploadFlowError(
          "metadata-inconsistency",
          "Finalized session is missing its evidence object record.",
        );
      }
      return stored;
    }
    if (this.#clock.now().getTime() > session.expiresAt.getTime()) {
      throw new UploadFlowError(
        "session-expired",
        "Upload session expired before finalization (session TTL enforced by the injected clock).",
      );
    }
    if (input.objectKey !== session.objectKey) {
      throw new UploadFlowError(
        "object-key-mismatch",
        "Finalize object key does not match the session's content-addressed object key.",
      );
    }
    if (input.receivedSha256 !== session.declaredSha256) {
      throw new UploadFlowError(
        "checksum-mismatch",
        "Received checksum does not match the declared checksum.",
      );
    }
    if (input.size !== session.declaredSizeBytes) {
      throw new UploadFlowError(
        "size-mismatch",
        "Received size does not match the declared size.",
      );
    }

    // §6 step 5 — verify against the stored object itself.
    const storedObject = await this.#objectStore.get(session.objectKey);
    if (storedObject === undefined) {
      throw new UploadFlowError(
        "object-missing",
        "Uploaded object not found in the object store; nothing to finalize.",
      );
    }
    const actualChecksum = this.#checksum(storedObject.data.bytes);
    if (actualChecksum !== session.declaredSha256) {
      throw new UploadFlowError(
        "checksum-mismatch",
        "Stored object checksum does not match the declared checksum.",
      );
    }
    if (storedObject.data.bytes.byteLength !== session.declaredSizeBytes) {
      throw new UploadFlowError(
        "size-mismatch",
        "Stored object size does not match the declared size.",
      );
    }
    if (storedObject.data.contentType !== session.mediaType) {
      throw new UploadFlowError(
        "media-type-mismatch",
        "Stored object media type does not match the session's declared media type.",
      );
    }

    // §6 step 6 — finalize the EvidenceObject transaction. Sensitive
    // fields (capturedAt, purpose, scope) are envelope-encrypted with a
    // context bound to person + key-space + evidence id.
    const finalizedAt = this.#clock.now();
    const sensitive: EvidenceSensitiveMetadata = {
      capturedAt: finalizedAt.toISOString(),
      purpose: session.purpose,
      scope: [...session.scope],
    };
    const encryptedMetadata = await this.#encryptor.encrypt(
      new Uint8Array(Buffer.from(JSON.stringify(sensitive), "utf8")),
      {
        personId: session.personId,
        evidenceId: session.evidenceId,
        keySpace: EVIDENCE_METADATA_KEY_SPACE,
      },
    );
    const evidence: EvidenceObjectRecord = {
      id: session.evidenceId,
      personId: session.personId,
      objectKey: session.objectKey,
      mediaType: session.mediaType,
      sha256: session.declaredSha256,
      sizeBytes: session.declaredSizeBytes,
      retentionClass: RETENTION_CLASS_ORIGINAL,
      state: "active",
      createdAt: finalizedAt,
      sessionId: session.sessionId,
      encryptedMetadata,
    };
    const stored = await this.#metadataStore.finalizeEvidence({
      sessionId: session.sessionId,
      evidence,
    });

    // §6 steps 7–8 — emit exactly once, enqueue exactly once.
    await this.#events.emit({
      type: "EVIDENCE_INGESTED",
      eventId: this.#ids.next("evt"),
      evidenceId: stored.id,
      personId: stored.personId,
      objectKey: stored.objectKey,
      mediaType: stored.mediaType,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      occurredAt: finalizedAt,
      correlationId: session.sessionId,
    });
    await this.#tasks.enqueue({
      taskType: "EVIDENCE_PROCESSING",
      evidenceId: stored.id,
      objectKey: stored.objectKey,
      mediaType: stored.mediaType,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      queuedAt: finalizedAt,
    });

    // §6 step 9 — retain the original: the stored object is deliberately
    // left in the object store (no delete).
    return stored;
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  #newEvidenceId(): EvidenceId {
    return parseEvidenceId(this.#ids.next(ID_PREFIXES.evidence));
  }

  #newSessionId(): UploadSessionId {
    const raw = this.#ids.next("usess");
    if (!raw.startsWith("usess_")) {
      throw new UploadFlowError(
        "metadata-inconsistency",
        "Id factory emitted an upload session id with the wrong prefix.",
      );
    }
    return raw as UploadSessionId;
  }
}

/** Validates the create-session input (PHID-safe errors, nothing echoed). */
function assertCreateInput(input: CreateUploadSessionInput, maxDeclaredSizeBytes: number): void {
  if (typeof input.personId !== "string" || !input.personId.startsWith("prsn_")) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid upload request: personId must be a canonical prsn_<body> identifier.",
    );
  }
  if (
    typeof input.mediaType !== "string" ||
    input.mediaType.length > 255 ||
    !MEDIA_TYPE_PATTERN.test(input.mediaType)
  ) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid upload request: mediaType must be a type/subtype string.",
    );
  }
  parseSha256Hex(input.declaredSha256);
  if (
    !Number.isInteger(input.declaredSizeBytes) ||
    input.declaredSizeBytes < 1 ||
    input.declaredSizeBytes > maxDeclaredSizeBytes
  ) {
    throw new UploadFlowError(
      "invalid-request",
      `Invalid upload request: declared size must be an integer between 1 and ${maxDeclaredSizeBytes} bytes.`,
    );
  }
  if (typeof input.purpose !== "string" || input.purpose.length === 0 || input.purpose.length > 256) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid upload request: purpose must be a non-empty string (max 256 characters).",
    );
  }
  if (
    !Array.isArray(input.scope) ||
    input.scope.length === 0 ||
    input.scope.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.length > 256)
  ) {
    throw new UploadFlowError(
      "invalid-request",
      "Invalid upload request: scope must be a non-empty list of non-empty scope tokens.",
    );
  }
}
