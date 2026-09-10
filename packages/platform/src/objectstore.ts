/**
 * Object storage adapter (architecture provider map: Object data →
 * Cloudflare R2 → ObjectStore).
 *
 * Holds raw evidence objects (low cost, free egress). Recorded M0
 * assumptions:
 *   - Bodies are `Uint8Array`; streaming bodies for very large evidence
 *     objects are a refinement owned by the R2 implementation work item
 *     (A16), not by this portability boundary.
 *   - Keys are opaque strings owned by the caller; checksums, media types
 *     and provenance metadata are enforced at the domain/databox layer.
 */

/** Object bytes plus their media type. */
export interface ObjectData {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** Stored object metadata. */
export interface ObjectRecord {
  readonly key: string;
  readonly data: ObjectData;
  readonly sizeBytes: number;
}

/** Summary of a stored object (listing). */
export interface ObjectRecordSummary {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType: string;
}

/**
 * Replacement interface for the object-data concern.
 *
 * Provider default: Cloudflare R2. There is deliberately NO in-memory
 * implementation at M0 — see `environments.ts`.
 */
export interface ObjectStore {
  put(key: string, data: ObjectData): Promise<ObjectRecordSummary>;
  get(key: string): Promise<ObjectRecord | undefined>;
  delete(key: string): Promise<void>;
  /** Lists object summaries whose key starts with `prefix` ("" = all). */
  list(prefix?: string): Promise<readonly ObjectRecordSummary[]>;
}
