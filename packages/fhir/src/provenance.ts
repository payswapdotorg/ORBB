/**
 * Provenance mapper — the stable-provenance resource of the boundary.
 *
 * RECORDED DECISIONS:
 *   - `target` is the list of mapped resource references (the FHIR-native
 *     linkage direction: Provenance targets the resources it covers —
 *     R4 clinical resources carry no provenance backlink element, and
 *     inventing one is out of doctrine). Targets are an explicit mapper
 *     input because the domain Provenance record carries no target list
 *     (verified against @orbb/db `provenances` — actor/subject/time/
 *     correlation only); the linkage is supplied at mapping time from
 *     the domain object -> provenanceId edges ORBB already maintains.
 *   - `agent.type` carries the entity-KIND actor vocabulary
 *     (person | device | source) under the ORBB actor-kind namespace:
 *     the frozen domain vocabulary is entity-kind based, and R4's
 *     ProvenanceParticipantType is role-based with no entity-kind codes
 *     — under an extensible binding, the honest carrier for a code that
 *     does not exist in the bound system is a namespaced one.
 *   - `agent.who` is identifier-only (the opaque actor id under its own
 *     kind namespace) — see references.ts for the recorded rationale.
 *   - `recorded` (mandatory instant) and `occurredDateTime` both map the
 *     domain's single `occurredAt` instant: the domain carries no
 *     separate record time, and the mapper never invents one (a future
 *     domain recordedAt would split them).
 *   - `causationId`/`correlationId` are NOT emitted: R4 Provenance has
 *     no standard element for internal correlation tokens, and carrying
 *     them would require inventing an extension. They stay internal
 *     (recorded handoff).
 *   - R4 Provenance has NO Identifier element — the opaque `prov_` id is
 *     carried only through the deterministic resource id (recomputable
 *     from it). Recorded as a known R4 boundary limitation (future FHIR
 *     versions may add Provenance.identifier; re-evaluate then).
 */
import { assertProvenanceRecord } from "./guards.js";
import type { FhirMappingContext } from "./context.js";
import type { FhirProvenance, FhirReference } from "./fhir.js";
import type { ProvenanceRecordInput } from "./inputs.js";
import { deriveResourceId } from "./fhirIds.js";
import { actorKindOf, vocabularySystem } from "./vocabulary.js";
import { FhirMappingError } from "./errors.js";
import { invalidInput, isHttpUrl, isNonEmptyString } from "./guards.js";
import { toFhirTimestamp } from "./canonical.js";
import { actorReference } from "./references.js";

const RELATIVE_REFERENCE_PATTERN = /^[A-Za-z]+\/[A-Za-z0-9-.]{1,64}$/;

function assertTarget(candidate: unknown): asserts candidate is FhirReference {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw invalidInput("Invalid provenance target: expected a mapped resource reference.");
  }
  const target = candidate as Record<string, unknown>;
  if (typeof target.reference !== "string" || !RELATIVE_REFERENCE_PATTERN.test(target.reference)) {
    throw invalidInput(
      "Invalid provenance target: expected a relative reference of the form <ResourceType>/<id> with a FHIR-legal id.",
    );
  }
  if (typeof target.identifier !== "object" || target.identifier === null || Array.isArray(target.identifier)) {
    throw invalidInput("Invalid provenance target: expected the durable identifier.");
  }
  const identifier = target.identifier as Record<string, unknown>;
  if (!isHttpUrl(identifier.system) || !isNonEmptyString(identifier.value)) {
    throw invalidInput(
      "Invalid provenance target: the identifier requires an absolute http(s) system and a non-empty value.",
    );
  }
}

/**
 * Maps a domain Provenance record to a FHIR R4 Provenance resource
 * targeting the given mapped resources. Pure and deterministic;
 * fail-closed on malformed records, empty target lists, malformed
 * target references, and actors outside the frozen person/device/source
 * vocabulary.
 */
export function mapProvenance(
  provenance: ProvenanceRecordInput,
  targets: readonly FhirReference[],
  context: FhirMappingContext,
): FhirProvenance {
  assertProvenanceRecord(provenance);
  if (!Array.isArray(targets) || targets.length === 0) {
    throw invalidInput(
      "Invalid provenance mapping: at least one target is required (FHIR Provenance.target is 1..*).",
    );
  }
  for (const target of targets) {
    assertTarget(target);
  }
  const actorKind = actorKindOf(provenance.actor);
  if (actorKind === undefined) {
    // Defensive: the record guard already enforces the actor grammar.
    throw new FhirMappingError(
      "unknown-vocabulary",
      "Invalid provenance actor: the actor id matches no canonical person/device/source grammar.",
    );
  }

  return {
    resourceType: "Provenance",
    id: deriveResourceId("Provenance", provenance.provenanceId),
    target: [...targets],
    occurredDateTime: toFhirTimestamp(provenance.occurredAt),
    recorded: toFhirTimestamp(provenance.occurredAt),
    agent: [
      {
        type: {
          coding: [
            { system: vocabularySystem(context.namespace, "actor-kind"), code: actorKind },
          ],
        },
        who: actorReference(provenance.actor, actorKind, context),
      },
    ],
  };
}
