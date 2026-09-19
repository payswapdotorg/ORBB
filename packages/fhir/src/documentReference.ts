/**
 * DocumentReference mapper — evidence objects to FHIR R4.
 *
 * RECORDED DECISIONS:
 *   - `status` is `current` (the frozen evidence-object lifecycle has
 *     exactly one state, "active"; future lifecycle states extend this
 *     table, they do not reinterpret it).
 *   - `content.attachment.url` carries the OPAQUE EvidenceId — exactly
 *     as the work order pins ("the evidence-object reference (opaque
 *     id)"). Deliberately NOT the content-addressed object key (an
 *     object-plane storage detail) and NEVER a presigned URL (§6:
 *     "never send full PHI through ... URLs"; short-lived URLs would
 *     also destroy determinism). The boundary carries the opaque
 *     reference; resolution happens through ORBB's authorized object
 *     plane.
 *   - `attachment.contentType` is the recorded mime type verbatim;
 *     `attachment.size` is the recorded byte size; `attachment.hash` is
 *     the recorded sha256 digest, base64-encoded per the R4 Attachment
 *     hash representation (hex -> bytes -> base64, deterministic).
 *   - `attachment.creation` is the capturedAt instant. `date` (when the
 *     DocumentReference itself was created) is emitted ONLY when the
 *     evidence record carries its optional `createdAt` — never invented.
 *   - `type`/`category`/`custodian`/`author` are omitted: this packet
 *     supplies no document-type vocabulary and maps no Organization —
 *     omitting beats inventing.
 *   - The provenance record linked by the evidence object's
 *     `provenanceId` MUST exist in the context (fail-closed).
 *   - The evidence CONTENT BYTES never cross the boundary — only the
 *     digest, size, mime, and opaque reference move (PHI discipline;
 *     envelope-encrypted metadata is not even part of the input type).
 */
import { assertEvidenceObjectInput } from "./guards.js";
import { requireProvenanceRecord } from "./context.js";
import type { FhirMappingContext } from "./context.js";
import type { FhirDocumentReference } from "./fhir.js";
import type { EvidenceObjectInput } from "./inputs.js";
import { deriveResourceId } from "./fhirIds.js";
import { identifierSystem } from "./vocabulary.js";
import { toFhirTimestamp } from "./canonical.js";
import { patientReference } from "./references.js";

/** Converts a lowercase-hex sha256 digest to the R4 Attachment base64 hash form. */
export function sha256HexToBase64(hex: string): string {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      // Unreachable behind the input guard (64-char lowercase hex); defensive only.
      throw new TypeError("Invalid sha256 hex digest.");
    }
    bytes[index] = byte;
  }
  return Buffer.from(bytes).toString("base64");
}

/**
 * Maps a finalized EvidenceObject record (the architecture §5 field list
 * as realized by the @orbb/db record) to a FHIR R4 DocumentReference
 * resource. Pure and deterministic; fail-closed on malformed input,
 * unknown lifecycle vocabulary, and missing provenance linkage.
 */
export function mapDocumentReference(
  evidence: EvidenceObjectInput,
  context: FhirMappingContext,
): FhirDocumentReference {
  assertEvidenceObjectInput(evidence);
  requireProvenanceRecord(evidence.provenanceId, context);

  return {
    resourceType: "DocumentReference",
    id: deriveResourceId("DocumentReference", evidence.id),
    identifier: [{ system: identifierSystem(context.namespace, "evidence"), value: evidence.id }],
    status: "current",
    subject: patientReference(evidence.personId, context),
    ...(evidence.createdAt !== undefined
      ? { date: toFhirTimestamp(evidence.createdAt) }
      : {}),
    content: [
      {
        attachment: {
          contentType: evidence.mediaType,
          url: evidence.id,
          size: evidence.sizeBytes,
          hash: sha256HexToBase64(evidence.sha256),
          creation: toFhirTimestamp(evidence.capturedAt),
        },
      },
    ],
  };
}
