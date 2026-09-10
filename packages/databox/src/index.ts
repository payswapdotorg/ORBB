/**
 * @orbb/databox — DataBox boundary package (M0).
 *
 * Future responsibility (architecture §6, §7): owns the evidence/object
 * plane — upload sessions, opaque object addressing, checksum
 * verification, EvidenceObject finalization, and application-layer
 * envelope encryption behind a KeyProvider interface. Raw evidence is
 * retained with its source metadata and every ingest emits
 * EVIDENCE_INGESTED.
 *
 * M0 boundary: no runtime behavior yet. Re-exports (type-only) the
 * evidence-plane types from @orbb/domain that this lane will own.
 */
export type { EvidenceId, EvidenceLabel, SourceId } from "@orbb/domain";
