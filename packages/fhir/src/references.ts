/**
 * Cross-resource reference builders.
 *
 * RECORDED DECISION (uniform reference policy):
 *   - References to one of the SEVEN mapped resource types carry BOTH a
 *     relative `reference` ("Type/<deterministic-id>", resolvable within
 *     the mapped resource set) and the durable business `identifier`
 *     (system = the id-kind namespace, value = the OPAQUE domain id).
 *   - References to kinds ORBB does NOT map in this packet (e.g. the
 *     plan behind a DiagnosticReport's basedOn) are identifier-only:
 *     an honest linkage without asserting an unmapped FHIR resource
 *     exists.
 *   - No reference ever carries a `display` (names are PHI; the boundary
 *     references opaque ids only).
 */
import { FhirMappingError } from "./errors.js";
import { deriveResourceId, type FhirResourceType } from "./fhirIds.js";
import type { FhirReference } from "./fhir.js";
import type { FhirMappingContext } from "./context.js";
import { identifierSystem, isIdOfKind, type ActorKind, type IdKind } from "./vocabulary.js";

/** Maps a mapped resource type to the canonical id kind of its source domain id. */
export const ID_KIND_BY_RESOURCE_TYPE: Readonly<
  Record<FhirResourceType, IdKind>
> = {
  Patient: "person",
  Observation: "observation",
  DiagnosticReport: "task",
  Condition: "intent",
  DocumentReference: "evidence",
  Consent: "grant",
  Provenance: "provenance",
};

/**
 * Builds the reference to a mapped resource from its source domain id.
 * Validates the id grammar (fail-closed) and derives the deterministic
 * resource id — same inputs, same reference, always.
 */
export function fhirResourceReference(
  resourceType: FhirResourceType,
  domainId: string,
  context: FhirMappingContext,
): FhirReference {
  const kind = ID_KIND_BY_RESOURCE_TYPE[resourceType];
  if (!isIdOfKind(kind, domainId)) {
    throw new FhirMappingError(
      "invalid-input",
      `Invalid reference source id: expected a canonical ${kind} id for a ${resourceType} reference.`,
    );
  }
  return {
    reference: `${resourceType}/${deriveResourceId(resourceType, domainId)}`,
    identifier: { system: identifierSystem(context.namespace, kind), value: domainId },
  };
}

/** Convenience: the Patient reference for a person id. */
export function patientReference(personId: string, context: FhirMappingContext): FhirReference {
  return fhirResourceReference("Patient", personId, context);
}

/** Convenience: the Observation reference for an observation id. */
export function observationReference(
  observationId: string,
  context: FhirMappingContext,
): FhirReference {
  return fhirResourceReference("Observation", observationId, context);
}

/**
 * Builds the identifier-only actor reference for a Provenance agent
 * (`who`): the opaque actor id under its own kind namespace. RECORDED
 * DECISION: identifier-only, uniformly for person/device/source actors —
 * the actor vocabulary is entity-kind based, this packet maps no
 * Device/Practitioner/RelatedPerson resources, and a Patient-typed
 * reference would falsely assert that every person actor is the subject
 * of the mapped output set.
 */
export function actorReference(
  actor: string,
  kind: ActorKind,
  context: FhirMappingContext,
): { readonly identifier: { readonly system: string; readonly value: string } } {
  return {
    identifier: {
      system: identifierSystem(context.namespace, kind),
      value: actor,
    },
  };
}
