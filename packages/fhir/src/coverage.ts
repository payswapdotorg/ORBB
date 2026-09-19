/**
 * The provenance-linkage invariant — the world-level half of the
 * stable-provenance doctrine.
 *
 * "Every mapped clinical resource must carry a Provenance linkage": in
 * FHIR R4 the linkage lives on the PROVENANCE side (Provenance.target
 * points at the covered resources — R4 clinical resources have no
 * provenance backlink element). The invariant is therefore asserted over
 * a whole mapped set: every mapped NON-Provenance resource must be
 * targeted by at least one mapped Provenance.
 *
 * The mapper-internal half (already enforced by the individual mappers):
 * domain objects that carry a provenanceId (Observation, EvidenceObject,
 * MeasurementAttempt) fail closed when their provenance record is absent
 * from the context. Domain objects WITHOUT a provenance field (the bare
 * PersonId, HealthIntent, AccessGrant, attempt-less tasks) have no edge
 * to enforce internally, so their linkage is asserted HERE, over the
 * composed world — which is why the checker is part of the mapper
 * package: the invariant is mechanical, not caller discipline.
 */
import { FhirMappingError } from "./errors.js";
import type { FhirProvenance, FhirResource } from "./fhir.js";

/**
 * Fail-closed coverage check: asserts that every mapped non-Provenance
 * resource in `resources` is targeted by at least one Provenance in
 * `provenances`. Throws {@link FhirMappingError}`("provenance-coverage")`
 * naming the uncovered resources by type and derived id (derived FHIR
 * ids are deterministic hashes of opaque ids — safe to name; no PHI).
 */
export function assertProvenanceCoverage(
  resources: readonly FhirResource[],
  provenances: readonly FhirProvenance[],
): void {
  const targeted = new Set<string>();
  for (const provenance of provenances) {
    for (const target of provenance.target) {
      targeted.add(target.reference);
    }
  }
  const uncovered: string[] = [];
  for (const resource of resources) {
    if (resource.resourceType === "Provenance") {
      continue;
    }
    const reference = `${resource.resourceType}/${resource.id}`;
    if (!targeted.has(reference)) {
      uncovered.push(reference);
    }
  }
  if (uncovered.length > 0) {
    throw new FhirMappingError(
      "provenance-coverage",
      `Provenance coverage failed: ${uncovered.length} mapped clinical resource(s) are not targeted by any Provenance: ${uncovered.join(", ")}. Every mapped clinical resource must carry a Provenance linkage.`,
    );
  }
}
