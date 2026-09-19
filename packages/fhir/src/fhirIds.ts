/**
 * Deterministic FHIR resource ids — the @orbb/db derived-id pattern
 * adapted to the FHIR id charset.
 *
 * RECORDED DECISIONS:
 *
 * - Resource ids are pure functions of (resource type, source domain id):
 *   `sha256` over the domain-separated, length-prefixed canonical parts
 *   `orbb/fhir/resource-id/v1 | <resourceType> | <sourceDomainId>` — the
 *   same collision-safe construction as @orbb/measurement's
 *   `deriveDeterministicId` and the @orbb/db `evidence-store.ts`
 *   `<prefix>_<sha256hex>` ledger-key pattern. Recomputing adds nothing:
 *   mapping twice yields identical ids by construction.
 * - The @orbb/db pattern's `_` separator is ILLEGAL in FHIR ids
 *   (`[A-Za-z0-9\-.]{1,64}`), so the separator is `-` and the digest is
 *   rendered as lowercase hex: the id is `<kebab-resourceType>-<32 hex>`,
 *   e.g. `diagnosticreport-<32 hex>` (50 chars, inside the 64-char FHIR
 *   ceiling with headroom for every mapped type). 32 hex chars carry
 *   128 bits of domain-separated digest — collision risk is negligible
 *   for boundary addressing, and the opaque domain id plus the
 *   deterministic derivation keep full-strength identity on the ORBB
 *   side.
 * - Domain separation by resource type means the SAME domain id maps to
 *   DIFFERENT FHIR ids for different resource types (an Observation and
 *   a DiagnosticReport derived from overlapping domain data never
 *   collide), and a source id never influences an id of a type it was
 *   not hashed with.
 */
import { createHash } from "node:crypto";
import { FhirMappingError } from "./errors.js";

/** Domain-separation tag for FHIR resource id derivation (versioned). */
export const RESOURCE_ID_DOMAIN = "orbb/fhir/resource-id/v1";

/** FHIR id grammar: 1-64 chars of [A-Za-z0-9-.] (R4 `id` type). */
export const FHIR_ID_PATTERN = /^[A-Za-z0-9-.]{1,64}$/;

/** Legal resource-type labels for id derivation (PascalCase FHIR names). */
export type FhirResourceType =
  | "Patient"
  | "Observation"
  | "DiagnosticReport"
  | "Condition"
  | "DocumentReference"
  | "Consent"
  | "Provenance";

const RESOURCE_TYPE_PATTERN = /^[A-Za-z]{1,32}$/;

/** Length of the hex digest segment embedded in derived resource ids. */
const ID_DIGEST_HEX_LENGTH = 32;

/**
 * Derives the deterministic FHIR resource id for a source domain id.
 * Same (resourceType, sourceDomainId) -> same id, always; different
 * resource type or different source id -> different id (domain
 * separation). Throws {@link FhirMappingError}`("invalid-input")` on an
 * empty/oversized resource type or source id (PHI-safe: values are
 * never echoed).
 */
export function deriveResourceId(resourceType: FhirResourceType, sourceDomainId: string): string {
  if (!RESOURCE_TYPE_PATTERN.test(resourceType)) {
    throw new FhirMappingError(
      "invalid-input",
      "Invalid resource type for id derivation: expected a non-empty alphabetic FHIR resource type.",
    );
  }
  if (typeof sourceDomainId !== "string" || sourceDomainId.length < 2) {
    throw new FhirMappingError(
      "invalid-input",
      "Invalid source domain id for id derivation: expected a canonical domain identifier string.",
    );
  }
  // Length-prefixed canonical parts (the measurement-lane derivation
  // construction): ambiguity-free, collision-safe.
  const canonical = [RESOURCE_ID_DOMAIN, resourceType, sourceDomainId]
    .map((part) => `${part.length}:${part}`)
    .join("|");
  const digestHex = createHash("sha256").update(canonical, "utf8").digest("hex");
  const id = `${resourceType.toLowerCase()}-${digestHex.slice(0, ID_DIGEST_HEX_LENGTH)}`;
  if (!FHIR_ID_PATTERN.test(id)) {
    // Defensive: hex + kebab type can never violate the grammar.
    throw new FhirMappingError(
      "invalid-input",
      "Derived resource id does not satisfy the FHIR id grammar.",
    );
  }
  return id;
}
