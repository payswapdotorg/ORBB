/**
 * In-memory reference implementations for the DataBox upload plane.
 *
 * RECORDED DECISION: the packet says tests run against "the in-memory
 * ObjectStore (from platform)" — but @orbb/platform deliberately ships NO
 * in-memory ObjectStore at M0 (see platform/src/inmemory.ts: only Cache
 * and RateLimiter have reference implementations, and ownership of this
 * packet cannot modify @orbb/platform). The in-memory ObjectStore
 * therefore lives HERE, implementing the frozen platform interface.
 * Handoff recorded for platform: adopt/hoist these reference doubles if
 * other lanes need them.
 *
 * Everything here is for tests and local harnesses only — never a
 * production persistence backend (architecture: the object plane is R2 in
 * every environment; wrangler dev simulates it locally).
 *
 * Determinism: the stores are plain Maps keyed by canonical ids; the
 * synthetic presigner accepts an injectable time source so expiry is
 * deterministic under the testkit clock.
 */
import type { ObjectData, ObjectRecord, ObjectRecordSummary, ObjectStore } from "@orbb/platform";
import { UploadFlowError } from "./errors.js";
import type {
  EventSink,
  EvidenceIngestedEvent,
  EvidenceMetadataStore,
  EvidenceObjectRecord,
  EvidenceProcessingTask,
  FinalizeEvidenceInput,
  PresignUploadRequest,
  PresignedUploadUrl,
  TaskSink,
  UploadAuthorizationGuard,
  UploadAuthorizationRequest,
  UploadSessionId,
  UploadSessionRecord,
  UploadUrlPresigner,
} from "./upload/contracts.js";

/**
 * In-memory `ObjectStore` (the platform interface). Defensive copies on
 * the way in AND out so callers cannot alias stored bytes. Supports the
 * full interface including prefix listing.
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, ObjectData>();

  async put(key: string, data: ObjectData): Promise<ObjectRecordSummary> {
    this.#objects.set(key, {
      bytes: new Uint8Array(data.bytes),
      contentType: data.contentType,
    });
    return {
      key,
      sizeBytes: data.bytes.byteLength,
      contentType: data.contentType,
    };
  }

  async get(key: string): Promise<ObjectRecord | undefined> {
    const data = this.#objects.get(key);
    if (data === undefined) {
      return undefined;
    }
    return {
      key,
      data: { bytes: new Uint8Array(data.bytes), contentType: data.contentType },
      sizeBytes: data.bytes.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
  }

  async list(prefix?: string): Promise<readonly ObjectRecordSummary[]> {
    const effectivePrefix = prefix ?? "";
    const summaries: ObjectRecordSummary[] = [];
    for (const [key, data] of this.#objects) {
      if (key.startsWith(effectivePrefix)) {
        summaries.push({
          key,
          sizeBytes: data.bytes.byteLength,
          contentType: data.contentType,
        });
      }
    }
    return summaries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** Test convenience: number of stored objects. */
  get size(): number {
    return this.#objects.size;
  }

  /** Test convenience: empties the store. */
  clear(): void {
    this.#objects.clear();
  }
}

/**
 * In-memory `EvidenceMetadataStore`. Records are stored as given and
 * treated as immutable; `finalizeEvidence` is transactional in the
 * single-threaded sense (session flip + evidence upsert happen together)
 * and idempotent per the interface contract.
 */
export class InMemoryEvidenceMetadataStore implements EvidenceMetadataStore {
  readonly #sessions = new Map<UploadSessionId, UploadSessionRecord>();
  readonly #evidence = new Map<string, EvidenceObjectRecord>();

  async createSession(record: UploadSessionRecord): Promise<void> {
    if (this.#sessions.has(record.sessionId)) {
      throw new UploadFlowError(
        "metadata-inconsistency",
        "Upload session id collision: refusing to overwrite an existing session.",
      );
    }
    this.#sessions.set(record.sessionId, record);
  }

  async getSession(sessionId: UploadSessionId): Promise<UploadSessionRecord | undefined> {
    return this.#sessions.get(sessionId);
  }

  async finalizeEvidence(input: FinalizeEvidenceInput): Promise<EvidenceObjectRecord> {
    const session = this.#sessions.get(input.sessionId);
    if (session === undefined) {
      throw new UploadFlowError(
        "session-not-found",
        "Upload session not found (in-memory metadata store).",
      );
    }
    if (session.state === "finalized") {
      const existing = this.#evidence.get(input.evidence.id);
      if (existing === undefined) {
        throw new UploadFlowError(
          "metadata-inconsistency",
          "Finalized session is missing its evidence object record.",
        );
      }
      return existing;
    }
    this.#evidence.set(input.evidence.id, input.evidence);
    this.#sessions.set(input.sessionId, {
      ...session,
      state: "finalized",
      finalizedAt: input.evidence.createdAt,
    });
    return input.evidence;
  }

  async getEvidence(evidenceId: string): Promise<EvidenceObjectRecord | undefined> {
    return this.#evidence.get(evidenceId);
  }

  /** Test convenience: number of stored sessions. */
  get sessionCount(): number {
    return this.#sessions.size;
  }

  /** Test convenience: number of stored evidence records. */
  get evidenceCount(): number {
    return this.#evidence.size;
  }

  /** Test convenience: empties the store. */
  clear(): void {
    this.#sessions.clear();
    this.#evidence.clear();
  }
}

/** In-memory `EventSink` — records emitted events in order. */
export class InMemoryEventSink implements EventSink {
  readonly #events: EvidenceIngestedEvent[] = [];

  emit(event: EvidenceIngestedEvent): void {
    this.#events.push(event);
  }

  /** Emitted events, in emission order (defensive copy). */
  get events(): readonly EvidenceIngestedEvent[] {
    return [...this.#events];
  }

  /** Test convenience. */
  clear(): void {
    this.#events.length = 0;
  }
}

/** In-memory `TaskSink` — records enqueued tasks in order. */
export class InMemoryTaskSink implements TaskSink {
  readonly #tasks: EvidenceProcessingTask[] = [];

  enqueue(task: EvidenceProcessingTask): void {
    this.#tasks.push(task);
  }

  /** Enqueued tasks, in enqueue order (defensive copy). */
  get tasks(): readonly EvidenceProcessingTask[] {
    return [...this.#tasks];
  }

  /** Test convenience. */
  clear(): void {
    this.#tasks.length = 0;
  }
}

/** Options for {@link StaticUploadAuthorizationGuard}. */
export interface StaticUploadAuthorizationGuardOptions {
  /** Purposes that may be authorized. Empty (default) denies everything. */
  readonly allowedPurposes?: readonly string[];
  /** Scope tokens that may be authorized. Empty (default) denies everything. */
  readonly allowedScopes?: readonly string[];
}

/**
 * Static allowlist `UploadAuthorizationGuard`. Deny-by-default: the
 * purpose must be allowlisted AND every requested scope token must be
 * allowlisted; anything else denies. Purely in-memory, for tests/local.
 */
export class StaticUploadAuthorizationGuard implements UploadAuthorizationGuard {
  readonly #purposes: ReadonlySet<string>;
  readonly #scopes: ReadonlySet<string>;

  constructor(options: StaticUploadAuthorizationGuardOptions = {}) {
    this.#purposes = new Set(options.allowedPurposes ?? []);
    this.#scopes = new Set(options.allowedScopes ?? []);
  }

  authorize(request: UploadAuthorizationRequest): boolean {
    if (!this.#purposes.has(request.purpose)) {
      return false;
    }
    return request.scope.every((token) => this.#scopes.has(token));
  }
}

/** Options for {@link SyntheticUploadPresigner}. */
export interface SyntheticUploadPresignerOptions {
  /** Time source for URL expiry (default `Date.now`; tests inject a clock). */
  readonly nowMs?: () => number;
}

/**
 * Non-functional `UploadUrlPresigner` for tests and local harnesses:
 * returns deterministic synthetic URLs (`https://synthetic-upload.local/…`)
 * that CANNOT actually be uploaded to — tests simulate the direct upload
 * by writing to an {@link InMemoryObjectStore} at the session's object
 * key. Deterministic under an injected time source.
 */
export class SyntheticUploadPresigner implements UploadUrlPresigner {
  readonly #nowMs: () => number;

  constructor(options: SyntheticUploadPresignerOptions = {}) {
    this.#nowMs = options.nowMs ?? Date.now;
  }

  presignUpload(request: PresignUploadRequest): Promise<PresignedUploadUrl> {
    const expiresAt = new Date(this.#nowMs() + request.ttlSeconds * 1_000);
    return Promise.resolve({
      url: `https://synthetic-upload.local/${request.key
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`,
      method: "PUT",
      expiresAt,
      contentType: request.contentType,
    });
  }
}
