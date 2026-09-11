/**
 * ORBB edge API — resource serializers (M3-A).
 *
 * Wire shapes are explicit, ordered, and Date → ISO-8601. Optional
 * fields appear only when present (exactOptionalPropertyTypes kept
 * honest with conditional spreads).
 *
 * RECORDED DECISION (evidence metadata): `GET /v1/evidence/:id` returns
 * the §5 operational field list plus the upload-plane linkage
 * (`createdAt`, `sessionId`) but NEVER `encryptedMetadata` — the
 * envelope ciphertext is sensitive-by-design and serves no read client.
 */
import type { HealthIntent, Observation } from "@orbb/domain";
import type { PersonRecord } from "@orbb/db";

/** Person profile (GET /v1/me). */
export interface PersonProfileJson {
  readonly id: string;
  readonly displayName: string;
}

export function serializePerson(person: PersonRecord): PersonProfileJson {
  return { id: person.id, displayName: person.displayName };
}

/** Health intent resource. */
export interface IntentJson {
  readonly id: string;
  readonly personId: string;
  readonly objective: string;
  readonly state: HealthIntent["state"];
  readonly createdAt: string;
  readonly evidencePackVersion?: number;
  readonly planId?: string;
}

export function serializeIntent(intent: HealthIntent): IntentJson {
  return {
    id: intent.id,
    personId: intent.personId,
    objective: intent.objective,
    state: intent.state,
    createdAt: intent.createdAt.toISOString(),
    ...(intent.evidencePackVersion !== undefined
      ? { evidencePackVersion: intent.evidencePackVersion }
      : {}),
    ...(intent.planId !== undefined ? { planId: intent.planId } : {}),
  };
}

/** Observation resource. */
export interface ObservationJson {
  readonly id: string;
  readonly personId: string;
  readonly conceptCode: string;
  readonly value: Observation["value"];
  readonly unit: string;
  readonly effectiveAt: string;
  readonly observedAt: string;
  readonly sourceId: string;
  readonly methodId: string;
  readonly validationState: Observation["validationState"];
  readonly provenanceId: string;
  readonly evidenceLabel: Observation["evidenceLabel"];
  readonly evidenceId?: string;
  readonly quality?: number;
  readonly supersedesId?: string;
}

export function serializeObservation(observation: Observation): ObservationJson {
  return {
    id: observation.id,
    personId: observation.personId,
    conceptCode: observation.conceptCode,
    value: observation.value,
    unit: observation.unit,
    effectiveAt: observation.effectiveAt.toISOString(),
    observedAt: observation.observedAt.toISOString(),
    sourceId: observation.sourceId,
    methodId: observation.methodId,
    validationState: observation.validationState,
    provenanceId: observation.provenanceId,
    evidenceLabel: observation.evidenceLabel,
    ...(observation.evidenceId !== undefined ? { evidenceId: observation.evidenceId } : {}),
    ...(observation.quality !== undefined ? { quality: observation.quality } : {}),
    ...(observation.supersedesId !== undefined ? { supersedesId: observation.supersedesId } : {}),
  };
}

/** Evidence object metadata (operational fields only — see module docs). */
export interface EvidenceMetadataJson {
  readonly id: string;
  readonly personId: string;
  readonly objectKey: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly capturedAt: string;
  readonly sourceType: string;
  readonly provenanceId: string;
  readonly retentionClass: string;
  readonly state: string;
  readonly createdAt?: string;
  readonly sessionId?: string;
}

export function serializeEvidenceMetadata(evidence: {
  readonly id: string;
  readonly personId: string;
  readonly objectKey: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly capturedAt: Date;
  readonly sourceType: string;
  readonly provenanceId: string;
  readonly retentionClass: string;
  readonly state: string;
  readonly createdAt?: Date | undefined;
  readonly sessionId?: string | undefined;
}): EvidenceMetadataJson {
  return {
    id: evidence.id,
    personId: evidence.personId,
    objectKey: evidence.objectKey,
    mediaType: evidence.mediaType,
    sha256: evidence.sha256,
    sizeBytes: evidence.sizeBytes,
    capturedAt: evidence.capturedAt.toISOString(),
    sourceType: evidence.sourceType,
    provenanceId: evidence.provenanceId,
    retentionClass: evidence.retentionClass,
    state: evidence.state,
    ...(evidence.createdAt !== undefined ? { createdAt: evidence.createdAt.toISOString() } : {}),
    ...(evidence.sessionId !== undefined ? { sessionId: evidence.sessionId } : {}),
  };
}

/**
 * Cursor-pagination envelope (architecture §3): `nextCursor` is `null`
 * (not absent) when the iteration is exhausted, and `hasMore` is the
 * boolean twin — RECORDED DECISION (self-describing for clients; the
 * repository returns `nextCursor?: undefined`, the API normalizes).
 */
export interface PageJson<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export function pageEnvelope<T>(
  items: readonly T[],
  nextCursor: string | undefined,
): PageJson<T> {
  return {
    items,
    nextCursor: nextCursor ?? null,
    hasMore: nextCursor !== undefined,
  };
}
