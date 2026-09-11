/**
 * @orbb/databox — DataBox boundary package (M2-C).
 *
 * Owns the evidence/object plane per architecture §6/§7:
 *   - Upload-session orchestration (`UploadSessionService`) against
 *     injected interfaces: ObjectStore (@orbb/platform), presigner,
 *     metadata store, guard (deny-by-default), event sink, task sink,
 *     checksum verifier, deterministic clock and id factory.
 *   - Application-layer envelope encryption (`EnvelopeEncryptor` +
 *     `KeyProvider`; development `SecretKeyProvider` over node:crypto
 *     AES-256-GCM; production KMS pluggable behind the same interface).
 *   - The R2 (S3-compatible) ObjectStore adapter with hand-rolled SigV4
 *     signing and short-TTL presigned PUT/GET URLs (SHAPE-VERIFIED, not
 *     live-verified — see objectstore-r2.ts).
 *   - In-memory reference implementations for tests and local harnesses
 *     (ObjectStore, metadata store, event/task sinks, static guard,
 *     synthetic presigner).
 *
 * Runtime dependencies: @orbb/domain, @orbb/platform, @orbb/testkit
 * (workspace:*) + node:crypto (builtin) — deliberately NO aws-sdk
 * (recorded decision: hand-rolled SigV4 keeps this package
 * dependency-light and provider-portable).
 */
export type { EvidenceId, EvidenceLabel, SourceId } from "@orbb/domain";

export * from "./errors.js";
export * from "./objectkeys.js";
export * from "./checksum.js";
export * from "./crypto/keyprovider.js";
export * from "./crypto/envelope.js";
export * from "./sigv4.js";
export * from "./objectstore-r2.js";
export * from "./upload/contracts.js";
export * from "./upload/service.js";
export * from "./inmemory.js";
