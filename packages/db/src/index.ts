/**
 * @orbb/db — persistence boundary package (M2-A + M2-D Lane A).
 *
 * Public surface (provider SDK types — Drizzle/Neon/postgres.js — never
 * leak through this index; they stay behind the `Db` facade):
 *   - the Drizzle pg schema lives in `schema.ts` (internal; consumed by
 *     drizzle-kit and the repository layer);
 *   - typed, domain-shaped `*Repository` interfaces + record types
 *     (`contracts.ts`), including the M2-D upload-session repository
 *     over the frozen @orbb/databox `UploadSessionRecord`;
 *   - the `Db` unit-of-work facade with the transactional outbox (§4)
 *     and `createDb` / `applyMigrations` (`db.ts`);
 *   - the M2-D `EvidenceMetadataStoreDb` adapter (`evidence-store.ts`):
 *     @orbb/databox's `EvidenceMetadataStore` over the repositories —
 *     finalize + EVIDENCE_INGESTED outbox event commit in ONE
 *     transaction (the recorded M2-C post-commit gap, closed);
 *   - pure cursor pagination helpers (`cursor.ts`);
 *   - the persistence error taxonomy (`errors.ts`);
 *   - `testing.ts` (PGlite harness) is deliberately NOT exported here —
 *     PGlite is a devDependency; import it relatively from within this
 *     package's tests.
 */
export * from "./errors.js";
export * from "./cursor.js";
export * from "./contracts.js";
export { createDb, applyMigrations, SystemClock, DrizzleDb, type DbOptions } from "./db.js";
export type { Db, UnitOfWork } from "./contracts.js";
export {
  EvidenceMetadataStoreDb,
  evidenceIngestedEventId,
  uploadProvenanceId,
} from "./evidence-store.js";
