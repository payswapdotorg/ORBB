/**
 * Consent mapper — AccessGrant to FHIR R4, carrying the deny-by-default
 * kernel doctrine across the boundary.
 *
 * DENY-BY-DEFAULT SURVIVAL (binding): a Consent permit-resource exists
 * ONLY as the mapping OF a grant — the grant's existence IS the
 * permission. There is exactly ONE Consent-producing entry point in this
 * package (`mapConsent`), its input is structurally an AccessGrant, and
 * no other exported function emits a Consent resource. The absence of a
 * grant can therefore NEVER yield a permit-resource: the package surface
 * makes it impossible (tested: the exported-API snapshot plus the
 * domain-evaluator proof — evaluateAccess with no grants decides DENY,
 * and a grantless world maps zero Consents).
 *
 * RECORDED DECISIONS:
 *   - `scope`: TWO codings — the standard `patient-privacy` (recorded
 *     assumption: an AccessGrant is definitionally a consent governing
 *     access to the person's health information; not a guess about the
 *     purpose's MEANING) plus the purpose-of-use label verbatim under
 *     the ORBB purpose vocabulary. FHIR ConsentScope is required, and
 *     CodeableConcept codings are standard translations.
 *   - `category`: the purpose-of-use label under the ORBB vocabulary
 *     (the caller's purpose label moved verbatim — the consent lane
 *     owns the vocabulary; binding purposes to standard category codes
 *     is future vocabulary curation, not the mapper's to invent).
 *   - `provision.type` is `permit` with `period` from issued/expiresAt.
 *     The issued instant is OPTIONAL on the input (the domain grant has
 *     only expiresAt; the @orbb/db row's createdAt is the issued time —
 *     callers pass it explicitly): without it the period carries ONLY
 *     its end, and `dateTime` is omitted. The mapper NEVER invents a
 *     period start.
 *   - Revoked grants map with `status: inactive` (the provision remains
 *     as the historical record of what the grant was — revocation is
 *     the resource status, never a permit that still reads active).
 *   - `provision.action` carries the grant's scope entries verbatim
 *     under the ORBB scope-permission vocabulary, in DOMAIN ORDER
 *     (order is domain data; canonical serialization preserves it
 *     deterministically).
 */
import { assertConsentGrantInput } from "./guards.js";
import type { FhirMappingContext } from "./context.js";
import type { FhirConsent } from "./fhir.js";
import type { ConsentGrantInput } from "./inputs.js";
import { deriveResourceId } from "./fhirIds.js";
import { FHIR_STANDARD_SYSTEMS, identifierSystem, vocabularySystem } from "./vocabulary.js";
import { toFhirTimestamp } from "./canonical.js";
import { patientReference } from "./references.js";

/**
 * Maps a domain AccessGrant to a FHIR R4 Consent resource. Pure and
 * deterministic; fail-closed on malformed input and unknown grant-state
 * vocabulary. Active grants -> status "active"; revoked grants ->
 * status "inactive"; the provision is always the permit the grant was.
 */
export function mapConsent(grant: ConsentGrantInput, context: FhirMappingContext): FhirConsent {
  assertConsentGrantInput(grant);

  return {
    resourceType: "Consent",
    id: deriveResourceId("Consent", grant.id),
    identifier: [{ system: identifierSystem(context.namespace, "grant"), value: grant.id }],
    status: grant.state === "active" ? "active" : "inactive",
    scope: {
      coding: [
        { system: FHIR_STANDARD_SYSTEMS.consentScope, code: "patient-privacy" },
        { system: vocabularySystem(context.namespace, "purpose-of-use"), code: grant.purpose },
      ],
    },
    category: [
      {
        coding: [
          { system: vocabularySystem(context.namespace, "purpose-of-use"), code: grant.purpose },
        ],
      },
    ],
    patient: patientReference(grant.subjectId, context),
    ...(grant.issuedAt !== undefined ? { dateTime: toFhirTimestamp(grant.issuedAt) } : {}),
    provision: {
      type: "permit",
      period: {
        ...(grant.issuedAt !== undefined
          ? { start: toFhirTimestamp(grant.issuedAt) }
          : {}),
        end: toFhirTimestamp(grant.expiresAt),
      },
      action: grant.scope.map((entry) => ({
        coding: [{ system: vocabularySystem(context.namespace, "scope-permission"), code: entry }],
      })),
    },
  };
}
