/**
 * Synthetic fixtures for @orbb/db tests (agent-protocol test-data rules:
 * never real medical data; every id is obviously synthetic via the
 * testkit `SYNTH-` marker).
 *
 * Determinism: a fixture world owns ONE DeterministicClock + ONE
 * DeterministicIdFactory; advancing the clock between inserts yields
 * strictly increasing pagination anchors, so cursor-page assertions
 * are stable. The same clock instance is injected into createTestDb so
 * repository-stamped `created_at` values share the timeline.
 */
import { createHash } from "node:crypto";
import type {
  AccessGrant,
  EvidenceLabel,
  HealthIntent,
  IntentState,
  MeasurementPlan,
  Observation,
  ObservationValidationState,
  PersonId,
  Provenance,
} from "@orbb/domain";
import type { EventId } from "@orbb/contracts";
import type { DomainEventType } from "@orbb/contracts";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import type {
  AccessAuditRecord,
  AccountRecord,
  EvidenceObjectRecord,
  NewOutboxEvent,
  PersonRecord,
} from "./contracts.js";

const MS_PER_DAY = 86_400_000;
const SYNTH_EVIDENCE_BYTES = "SYNTH-evidence-bytes-v1";

export const SYNTH_SHA256 = createHash("sha256").update(SYNTH_EVIDENCE_BYTES).digest("hex");
export const SYNTH_EVIDENCE_SIZE = Buffer.byteLength(SYNTH_EVIDENCE_BYTES);

export interface FixtureWorld {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  person(): PersonRecord;
  account(personId: PersonId): AccountRecord;
  provenance(subject: PersonId): Provenance;
  intent(personId: PersonId, state?: IntentState): HealthIntent;
  observation(
    personId: PersonId,
    provenanceId: Provenance["provenanceId"],
    overrides?: Partial<Pick<Observation, "id" | "validationState" | "supersedesId" | "value" | "evidenceId" | "quality">>,
  ): Observation;
  evidence(personId: PersonId, provenanceId: Provenance["provenanceId"]): EvidenceObjectRecord;
  plan(personId: PersonId, intentId: HealthIntent["id"]): MeasurementPlan;
  grant(subjectId: PersonId): AccessGrant;
  audit(subjectId: PersonId, decision?: "ALLOW" | "DENY"): AccessAuditRecord;
  event(eventType: DomainEventType, payload?: Record<string, unknown>): NewOutboxEvent;
}

/** Creates a deterministic fixture world (ids carry the SYNTH marker). */
export function fixtureWorld(seed: string): FixtureWorld {
  const clock = new DeterministicClock();
  const ids = new DeterministicIdFactory({ seed });

  const personId = (): PersonId => ids.next("prsn") as PersonId;

  return {
    clock,
    ids,
    person(): PersonRecord {
      return { id: personId(), displayName: `SYNTH-Person-${ids.issued}` };
    },
    account(pid: PersonId): AccountRecord {
      return { id: ids.next("acct") as AccountRecord["id"], personId: pid };
    },
    provenance(subject: PersonId): Provenance {
      return {
        provenanceId: ids.next("prov") as Provenance["provenanceId"],
        actor: subject,
        subject,
        occurredAt: clock.now(),
      };
    },
    intent(pid: PersonId, state: IntentState = "draft"): HealthIntent {
      return {
        id: ids.next("intent") as HealthIntent["id"],
        personId: pid,
        objective: `SYNTH-objective-${ids.issued}`,
        state,
        createdAt: clock.now(),
      };
    },
    observation(
      pid: PersonId,
      provId: Provenance["provenanceId"],
      overrides?: Partial<
        Pick<Observation, "id" | "validationState" | "supersedesId" | "value" | "evidenceId" | "quality">
      >,
    ): Observation {
      const observation: Observation = {
        id: ids.next("obs") as Observation["id"],
        personId: pid,
        conceptCode: "SYNTH-8867-4",
        value: 72,
        unit: "beats/min",
        effectiveAt: clock.now(),
        observedAt: clock.now(),
        sourceId: ids.next("src") as Observation["sourceId"],
        methodId: "SYNTH-method-manual",
        validationState: "pending",
        provenanceId: provId,
        evidenceLabel: "MEASURED" satisfies EvidenceLabel as Observation["evidenceLabel"],
        ...(overrides?.id !== undefined ? { id: overrides.id } : {}),
        ...(overrides?.validationState !== undefined
          ? { validationState: overrides.validationState as ObservationValidationState }
          : {}),
        ...(overrides?.supersedesId !== undefined ? { supersedesId: overrides.supersedesId } : {}),
        ...(overrides?.value !== undefined ? { value: overrides.value } : {}),
        ...(overrides?.evidenceId !== undefined ? { evidenceId: overrides.evidenceId } : {}),
        ...(overrides?.quality !== undefined ? { quality: overrides.quality } : {}),
      };
      return observation;
    },
    evidence(pid: PersonId, provId: Provenance["provenanceId"]): EvidenceObjectRecord {
      const id = ids.next("evid") as EvidenceObjectRecord["id"];
      return {
        id,
        personId: pid,
        objectKey: `evidence/v1/${id}/${SYNTH_SHA256}`,
        mediaType: "application/octet-stream",
        sha256: SYNTH_SHA256,
        sizeBytes: SYNTH_EVIDENCE_SIZE,
        capturedAt: clock.now(),
        sourceType: "SYNTH-device",
        provenanceId: provId,
        retentionClass: "original",
        state: "active",
      };
    },
    plan(pid: PersonId, intentId: HealthIntent["id"]): MeasurementPlan {
      return {
        id: ids.next("plan") as MeasurementPlan["id"],
        personId: pid,
        intentId,
        state: "draft",
        metrics: ["SYNTH-8867-4"],
        createdAt: clock.now(),
      };
    },
    grant(subjectId: PersonId): AccessGrant {
      return {
        id: ids.next("grant") as AccessGrant["id"],
        subjectId,
        recipientId: "SYNTH-recipient-1",
        purpose: "SYNTH-CARE_MANAGEMENT",
        scope: ["observations:read"],
        state: "active",
        expiresAt: new Date(clock.epochMs + 365 * MS_PER_DAY),
      };
    },
    audit(subjectId: PersonId, decision: "ALLOW" | "DENY" = "ALLOW"): AccessAuditRecord {
      return {
        id: ids.next("audit") as AccessAuditRecord["id"],
        decisionId: `SYNTH-decision-${ids.issued}`,
        subjectId,
        decision,
        at: clock.now(),
        actor: subjectId,
        requestDigest: `subject|${subjectId}|resourceKind|observation|operation|read|purpose|SYNTH-CARE|at|${clock.now().toISOString()}`,
      };
    },
    event(eventType: DomainEventType, payload: Record<string, unknown> = {}): NewOutboxEvent {
      return {
        eventId: ids.next("evt") as EventId,
        eventType,
        payload: JSON.stringify({ synthetic: true, ...payload }),
      };
    },
  };
}
