/**
 * M2-D Lane A — the db-backed `EvidenceMetadataStore` for @orbb/databox's
 * upload plane (architecture §6 + §4 transactional outbox).
 *
 * This adapter closes the M2-C recorded POST-COMMIT EVENT GAP:
 * `finalizeEvidence` runs inside ONE `Db.transaction()` that
 *   1. re-checks the session (idempotent-finalize semantics),
 *   2. synthesizes the upload-flow provenance (actor = the uploading
 *      person; correlation = the session id — the real sourceType /
 *      provenance plumbing is a recorded domain-promotion handoff),
 *   3. upserts the EvidenceObject (sensitive fields envelope-encrypted),
 *   4. flips the session to "finalized", and
 *   5. writes the EVIDENCE_INGESTED event into the transactional outbox
 *      IN THE SAME TRANSACTION — state + event commit atomically. A
 *      post-commit EventSink failure can no longer lose the event: it is
 *      durable in the outbox and the publisher drains it.
 *
 * Deterministic derived ids (recorded decision): the EVIDENCE_INGESTED
 * outbox event id and the synthesized provenance id are pure functions of
 * the upload session id (domain-separated SHA-256). This makes the whole
 * finalize flow idempotent under crash-retry: a retried transaction
 * derives the same ids, and the outbox append replays the same row.
 *
 * Idempotency keys are derived from the session id at runtime (never
 * hardcoded), so each repository claim is deterministic per session.
 */
import { createHash } from "node:crypto";
import type { EventId } from "@orbb/contracts";
import type { EvidenceId, ProvenanceId } from "@orbb/domain";
import { UploadFlowError } from "@orbb/databox";
import type {
  EvidenceMetadataStore,
  EvidenceObjectRecord as DataBoxEvidenceObjectRecord,
  FinalizeEvidenceInput,
  UploadSessionId,
  UploadSessionRecord,
} from "@orbb/databox";
import type {
  Db,
  EvidenceObjectRecord as DbEvidenceObjectRecord,
  NewOutboxEvent,
} from "./contracts.js";

/** Domain separator for the deterministic EVIDENCE_INGESTED event id. */
const EVIDENCE_INGESTED_ID_DOMAIN = "orbb/db/evidence-ingested/v1";
/** Domain separator for the deterministic upload-provenance id. */
const UPLOAD_PROVENANCE_ID_DOMAIN = "orbb/db/upload-provenance/v1";
/**
 * Recorded assumption: sourceType for upload-ingested objects until the
 * domain-promotion packet plumbs the real source taxonomy through the M2-C
 * inputs. A stable, non-PHI operational marker of the §6 ingestion path.
 */
const UPLOAD_SOURCE_TYPE = "upload";
/** Ledger-key prefixes (deterministic per session, derived at runtime). */
const KEY_SESSION = "usess:";
const KEY_PROVENANCE = "prov:";
const KEY_EVIDENCE = "evid:";
const KEY_FINALIZE = "fin:";

/**
 * Derives `<prefix>_<sha256hex>` from a domain separator + session id.
 * The 64-char hex body satisfies every canonical id grammar.
 */
function deriveId(domain: string, prefix: string, sessionId: UploadSessionId): string {
  return `${prefix}_${createHash("sha256").update(`${domain}|${sessionId}`).digest("hex")}`;
}

/** Deterministic EVIDENCE_INGESTED outbox event id for a session. */
export function evidenceIngestedEventId(sessionId: UploadSessionId): EventId {
  return deriveId(EVIDENCE_INGESTED_ID_DOMAIN, "evt", sessionId) as EventId;
}

/** Deterministic provenance id for a session's synthesized provenance. */
export function uploadProvenanceId(sessionId: UploadSessionId): ProvenanceId {
  return deriveId(UPLOAD_PROVENANCE_ID_DOMAIN, "prov", sessionId) as ProvenanceId;
}

/**
 * Builds the EVIDENCE_INGESTED outbox event payload. Field set mirrors
 * @orbb/databox's `EvidenceIngestedEvent` (opaque identifiers, digests,
 * and sizes only — NO PHI: purpose/scope stay inside the envelope).
 * `occurredAt` is serialized ISO-8601 (transport-boundary concern).
 */
function evidenceIngestedOutboxEvent(
  evidence: DataBoxEvidenceObjectRecord,
  session: UploadSessionRecord,
): NewOutboxEvent {
  const eventId = evidenceIngestedEventId(session.sessionId);
  return {
    eventId,
    eventType: "EVIDENCE_INGESTED",
    payload: JSON.stringify({
      type: "EVIDENCE_INGESTED" as const,
      eventId,
      evidenceId: evidence.id,
      personId: evidence.personId,
      objectKey: evidence.objectKey,
      mediaType: evidence.mediaType,
      sha256: evidence.sha256,
      sizeBytes: evidence.sizeBytes,
      occurredAt: evidence.createdAt.toISOString(),
      correlationId: session.sessionId,
    }),
  };
}

/**
 * Maps a stored db evidence record to the databox record shape. A row
 * that cannot be represented (missing createdAt / session linkage /
 * envelope) is a metadata inconsistency, never a silently degraded
 * record — the databox contract requires all three.
 */
function toDataBoxEvidence(stored: DbEvidenceObjectRecord): DataBoxEvidenceObjectRecord {
  if (
    stored.createdAt === undefined ||
    stored.sessionId === undefined ||
    stored.encryptedMetadata === undefined
  ) {
    throw new UploadFlowError(
      "metadata-inconsistency",
      "Stored evidence object record is missing its upload-plane fields (creation time, session linkage, or encrypted envelope).",
    );
  }
  return {
    id: stored.id,
    personId: stored.personId,
    objectKey: stored.objectKey,
    mediaType: stored.mediaType,
    sha256: stored.sha256,
    sizeBytes: stored.sizeBytes,
    retentionClass: stored.retentionClass,
    state: "active",
    createdAt: stored.createdAt,
    sessionId: stored.sessionId,
    encryptedMetadata: stored.encryptedMetadata,
  };
}

/**
 * The db-backed {@link EvidenceMetadataStore}: databox's upload-session
 * service persistence boundary over the M2-A repositories and the
 * transactional outbox. Constructor dependency is exactly the `Db`
 * facade — everything else (clock, guards, idempotency) is already
 * behind it.
 */
export class EvidenceMetadataStoreDb implements EvidenceMetadataStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** §6 step 2 — create-before-publication (state "open", no event). */
  async createSession(record: UploadSessionRecord): Promise<void> {
    await this.#db.transaction((uow) =>
      uow.uploadSessions.insert(record, {
        idempotencyKey: `${KEY_SESSION}${record.sessionId}`,
      }),
    );
  }

  async getSession(sessionId: UploadSessionId): Promise<UploadSessionRecord | undefined> {
    return this.#db.uploadSessions.findById(sessionId);
  }

  async getEvidence(evidenceId: EvidenceId): Promise<DataBoxEvidenceObjectRecord | undefined> {
    const stored = await this.#db.evidence.findById(evidenceId);
    return stored === undefined ? undefined : toDataBoxEvidence(stored);
  }

  /**
   * §6 step 6 + §4 — the finalize transaction. Idempotent: finalizing an
   * already-finalized session returns the stored evidence record
   * unchanged (same id ⇒ stored record; different id ⇒ metadata
   * inconsistency). On the open → finalized transition the transaction
   * writes session state, provenance, evidence, and the EVIDENCE_INGESTED
   * outbox row ATOMICALLY.
   */
  async finalizeEvidence(input: FinalizeEvidenceInput): Promise<DataBoxEvidenceObjectRecord> {
    return this.#db.transaction(async (uow) => {
      const session = await uow.uploadSessions.findById(input.sessionId);
      if (session === undefined) {
        throw new UploadFlowError(
          "session-not-found",
          "Upload session not found (db-backed metadata store).",
        );
      }
      if (session.state === "finalized") {
        const stored = await uow.evidence.findById(session.evidenceId);
        if (stored === undefined) {
          throw new UploadFlowError(
            "metadata-inconsistency",
            "Finalized session is missing its evidence object record.",
          );
        }
        if (stored.id !== input.evidence.id) {
          throw new UploadFlowError(
            "metadata-inconsistency",
            "Conflicting evidence id for a finalized upload session.",
          );
        }
        return toDataBoxEvidence(stored);
      }
      if (input.evidence.id !== session.evidenceId) {
        // The session fixed its EvidenceObject id at creation; a
        // different id is an inconsistency, not a second object.
        throw new UploadFlowError(
          "metadata-inconsistency",
          "Finalize evidence id does not match the session's evidence id (fixed at creation).",
        );
      }

      // Synthesized upload-flow provenance (recorded handoff: real
      // sourceType/provenance plumbed by the domain-promotion packet).
      // Deterministic id => idempotent under transaction retries.
      await uow.provenances.insert(
        {
          provenanceId: uploadProvenanceId(session.sessionId),
          actor: session.personId,
          subject: session.personId,
          occurredAt: input.evidence.createdAt,
          correlationId: session.sessionId,
        },
        { idempotencyKey: `${KEY_PROVENANCE}${session.sessionId}` },
      );

      // The EvidenceObject: operational fields clear, sensitive fields
      // ONLY inside the envelope (encrypted upstream by the service).
      const stored = await uow.evidence.insert(
        {
          id: input.evidence.id,
          personId: input.evidence.personId,
          objectKey: input.evidence.objectKey,
          mediaType: input.evidence.mediaType,
          sha256: input.evidence.sha256,
          sizeBytes: input.evidence.sizeBytes,
          capturedAt: input.evidence.createdAt,
          sourceType: UPLOAD_SOURCE_TYPE,
          provenanceId: uploadProvenanceId(session.sessionId),
          retentionClass: input.evidence.retentionClass,
          state: input.evidence.state,
          createdAt: input.evidence.createdAt,
          sessionId: input.sessionId,
          encryptedMetadata: input.evidence.encryptedMetadata,
        },
        { idempotencyKey: `${KEY_EVIDENCE}${session.sessionId}` },
      );

      await uow.uploadSessions.markFinalized(input.sessionId, {
        expectedFrom: "open",
        idempotencyKey: `${KEY_FINALIZE}${session.sessionId}`,
        finalizedAt: input.evidence.createdAt,
      });

      // THE GAP-CLOSER: the EVIDENCE_INGESTED event is committed with
      // the state above, in this same transaction (§4 transactional
      // outbox). A post-commit sink failure cannot lose it.
      await uow.appendEvent(evidenceIngestedOutboxEvent(input.evidence, session));

      return toDataBoxEvidence(stored);
    });
  }
}
