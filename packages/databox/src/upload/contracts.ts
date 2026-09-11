/**
 * DataBox upload-plane contracts (architecture §6 raw-object upload flow):
 * the interfaces the upload-session service orchestrates AGAINST. This
 * packet's persistence boundary is exactly these interfaces plus in-memory
 * reference implementations (see `../inmemory.ts`) — db-backed
 * implementations arrive in a later integration packet (Lane A handoff).
 *
 * Recorded design decisions:
 *   - `EvidenceObjectRecord` follows the architecture §5 EvidenceObject
 *     field list (`id, personId, objectKey, mediaType, sha256, capturedAt,
 *     sourceType, provenanceId, retentionClass`) as far as M2-C inputs go:
 *     `sourceType` and `provenanceId` are NOT plumbed through the M2-C
 *     session/finalize inputs, so they are absent here (handoff recorded
 *     for the domain-promotion packet; §6 says "record what you encrypt").
 *   - The session carries its EvidenceId from CREATION (architecture: an
 *     R2 object has a metadata record before publication) — this is what
 *     makes double-finalize naturally idempotent: same session, same id.
 *   - `EVIDENCE_INGESTED` event shape is local to @orbb/databox (runtime
 *     dependency policy forbids @orbb/contracts here); alignment with the
 *     contracts `DomainEventEnvelope` is a recorded handoff.
 */
import type { EvidenceId, PersonId } from "@orbb/domain";
import type { EncryptedEnvelope } from "../crypto/envelope.js";

// ---------------------------------------------------------------------------
// Upload-session identifier (local branded id, contracts-style).
// ---------------------------------------------------------------------------

declare const uploadSessionIdBrand: unique symbol;

/** Branded canonical upload-session identifier: `usess_<body>`. */
export type UploadSessionId = string & { readonly [uploadSessionIdBrand]: "UploadSessionId" };

/** Prefix of every upload-session id. */
export const UPLOAD_SESSION_ID_PREFIX = "usess";

const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a canonical upload-session id? */
export function isUploadSessionId(value: unknown): value is UploadSessionId {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${UPLOAD_SESSION_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(UPLOAD_SESSION_ID_PREFIX.length + 1));
}

/**
 * Parses and validates a raw value as an upload-session id. Throws a
 * RangeError describing the grammar — the offending value is never echoed.
 */
export function parseUploadSessionId(value: unknown): UploadSessionId {
  if (!isUploadSessionId(value)) {
    throw new RangeError(
      `Invalid upload session id: expected "usess_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Upload authorization (§6 step 1 — deny-by-default).
// ---------------------------------------------------------------------------

/** Authorization question for an upload: subject, purpose, scope. */
export interface UploadAuthorizationRequest {
  readonly personId: PersonId;
  readonly purpose: string;
  readonly scope: readonly string[];
}

/**
 * Purpose/scope guard for uploads. Deny-by-default contract: the caller is
 * authorized ONLY when `authorize` returns exactly `true`; `false`, thrown
 * errors, or any other outcome means deny.
 */
export interface UploadAuthorizationGuard {
  authorize(request: UploadAuthorizationRequest): boolean | Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Presigned upload URLs (§6 step 3 — short-lived signed upload URL).
// ---------------------------------------------------------------------------

/** Request for a short-lived presigned PUT URL. */
export interface PresignUploadRequest {
  /** Opaque content-addressed object key the URL uploads to. */
  readonly key: string;
  /** Content type bound into the URL signature (client must send exactly). */
  readonly contentType: string;
  /** Declared size (advisory for the presigner; enforced at finalize). */
  readonly sizeBytes: number;
  /** Signed URL lifetime in seconds (short-lived by contract). */
  readonly ttlSeconds: number;
}

/** A short-lived presigned PUT URL plus its binding constraints. */
export interface PresignedUploadUrl {
  readonly url: string;
  readonly method: "PUT";
  /** Expiry instant of the signed URL. */
  readonly expiresAt: Date;
  /** The Content-Type the uploader MUST send for the signature to hold. */
  readonly contentType: string;
}

/**
 * Issues short-lived presigned upload URLs (implemented by the R2 adapter
 * via SigV4 query auth; faked deterministically in tests/local by
 * `SyntheticUploadPresigner`).
 */
export interface UploadUrlPresigner {
  presignUpload(request: PresignUploadRequest): Promise<PresignedUploadUrl>;
}

// ---------------------------------------------------------------------------
// Evidence metadata persistence (the M2-C repository boundary).
// ---------------------------------------------------------------------------

/** Lifecycle state of an upload session. */
export type UploadSessionState = "open" | "finalized";

/**
 * The pre-publication metadata record for one raw-object upload (created
 * at session creation, transitioned to "finalized" at §6 step 6).
 */
export interface UploadSessionRecord {
  readonly sessionId: UploadSessionId;
  /** EvidenceObject id fixed at session creation (idempotency anchor). */
  readonly evidenceId: EvidenceId;
  readonly personId: PersonId;
  /** Opaque content-addressed key (`evidence/v1/<id>/<sha256>`). */
  readonly objectKey: string;
  readonly mediaType: string;
  readonly declaredSha256: string;
  readonly declaredSizeBytes: number;
  /** Purpose of collection the upload was authorized under. */
  readonly purpose: string;
  /** Scope tokens the upload was authorized under. */
  readonly scope: readonly string[];
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly state: UploadSessionState;
  /** Present iff state is "finalized". */
  readonly finalizedAt?: Date;
}

/**
 * Finalized EvidenceObject record (architecture §5 EvidenceObject, M2-C
 * subset). Operational fields are stored in the clear; privacy-sensitive
 * fields ({@link EvidenceSensitiveMetadata}) are stored only inside
 * {@link encryptedMetadata} (recorded decision — see service docs).
 */
export interface EvidenceObjectRecord {
  readonly id: EvidenceId;
  readonly personId: PersonId;
  readonly objectKey: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Retention class; "original" = retain the raw original (§6 step 9). */
  readonly retentionClass: string;
  readonly state: "active";
  /** Finalization time (= EvidenceObject creation time). */
  readonly createdAt: Date;
  readonly sessionId: UploadSessionId;
  /** Envelope-encrypted sensitive metadata. */
  readonly encryptedMetadata: EncryptedEnvelope;
}

/** Input to the finalize transaction. */
export interface FinalizeEvidenceInput {
  readonly sessionId: UploadSessionId;
  readonly evidence: EvidenceObjectRecord;
}

/**
 * Evidence metadata repository boundary (in-memory in this packet; the
 * db-backed implementation lands in a later integration packet and MUST
 * preserve the create-before-publication and idempotent-finalize
 * semantics).
 */
export interface EvidenceMetadataStore {
  /** Persists a newly created session record (state "open"). */
  createSession(record: UploadSessionRecord): Promise<void>;
  getSession(sessionId: UploadSessionId): Promise<UploadSessionRecord | undefined>;
  /**
   * Finalizes atomically (mark session "finalized" + upsert the evidence
   * record). Idempotent: finalizing an already-finalized session returns
   * the stored evidence record unchanged; a conflicting evidence id for a
   * finalized session is a metadata-inconsistency failure.
   */
  finalizeEvidence(input: FinalizeEvidenceInput): Promise<EvidenceObjectRecord>;
  getEvidence(evidenceId: EvidenceId): Promise<EvidenceObjectRecord | undefined>;
}

// ---------------------------------------------------------------------------
// EVIDENCE_INGESTED event sink (§6 step 7).
// ---------------------------------------------------------------------------

/**
 * EVIDENCE_INGESTED — emitted once per successfully finalized upload.
 * Contains only opaque identifiers, digests, and sizes (no PHI).
 * Recorded handoff: promote into the @orbb/contracts
 * DomainEventEnvelope { eventId, type, version, occurredAt, actor, subject,
 * correlationId, causationId, payloadSchemaVersion } when contracts becomes
 * an allowed dependency of this package.
 */
export interface EvidenceIngestedEvent {
  readonly type: "EVIDENCE_INGESTED";
  readonly eventId: string;
  readonly evidenceId: EvidenceId;
  readonly personId: PersonId;
  readonly objectKey: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly occurredAt: Date;
  /** Correlation token: the upload session id. */
  readonly correlationId: string;
}

/** Outbound event sink (in-memory impl for tests; outbox adapter later). */
export interface EventSink {
  emit(event: EvidenceIngestedEvent): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Downstream task queue (§6 step 8).
// ---------------------------------------------------------------------------

/**
 * Evidence-processing task enqueued after EVIDENCE_INGESTED. Recorded
 * decision: one EVIDENCE_PROCESSING task carrying the media type — the
 * extraction/transcoding/classification fan-out decision belongs to the
 * downstream worker lane, not to the upload orchestrator.
 */
export interface EvidenceProcessingTask {
  readonly taskType: "EVIDENCE_PROCESSING";
  readonly evidenceId: EvidenceId;
  readonly objectKey: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly queuedAt: Date;
}

/** Downstream task sink (in-memory impl for tests; queue adapter later). */
export interface TaskSink {
  enqueue(task: EvidenceProcessingTask): void | Promise<void>;
}
