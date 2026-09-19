/**
 * @orbb/fhir — the deterministic internal-to-FHIR R4 boundary mapper
 * (M7-A A46, Lane A).
 *
 * FHIR R4 is the boundary representation for clinical integrations
 * (backend architecture §10): internal storage is optimized for
 * application behavior, and this package is the one-directional
 * translation layer — ORBB domain objects in, FHIR R4 JSON out. FHIR-to-
 * internal ingestion is NOT in scope and is recorded as a
 * future-milestone handoff.
 *
 * The seven resource mappers (all pure, all deterministic, all
 * fail-closed):
 *   - `mapPatient`            — PersonId -> Patient (privacy-first: identifier-only unless a deliberate DemographicPort discloses more)
 *   - `mapObservation`        — domain Observation -> Observation (status table incl. the supersession rule)
 *   - `mapDiagnosticReport`   — task attempt set -> DiagnosticReport (one report per task attempt set)
 *   - `mapCondition`          — HealthIntent -> Condition (verificationStatus ALWAYS provisional — binding doctrine)
 *   - `mapDocumentReference`  — evidence object -> DocumentReference (opaque-id attachment reference)
 *   - `mapConsent`            — AccessGrant -> Consent (deny-by-default survives: no grant, no permit-resource)
 *   - `mapProvenance`         — Provenance record + targets -> Provenance (stable provenance for every mapped clinical resource)
 *
 * Determinism (hard requirement): same input -> byte-identical JSON via
 * `serializeCanonical` (sorted keys, no whitespace variance); resource
 * ids are domain-separated SHA-256 functions of (resource type, source
 * domain id) — the @orbb/db derived-id pattern adapted to the FHIR id
 * charset. The mapper adds no wall-clock time of its own; every
 * timestamp comes from the domain objects (the context carries no
 * clock at all).
 *
 * PHI discipline: SYNTH fixtures only; the mapper moves opaque ids and
 * vocabulary labels — never free-text objectives or notes, never
 * evidence content bytes, never observation values beyond the typed
 * value shapes. See README.md for the field-by-field decision tables and
 * every recorded assumption.
 *
 * Zero runtime dependencies: src/ imports ONLY TYPES from @orbb/domain
 * and @orbb/measurement (see compat.ts — the compile-time drift locks);
 * the sole runtime import is node:crypto for the deterministic ids.
 */
export * from "./errors.js";
export * from "./canonical.js";
export * from "./fhirIds.js";
export * from "./vocabulary.js";
export * from "./fhir.js";
export * from "./inputs.js";
export * from "./context.js";
export * from "./references.js";
export * from "./patient.js";
export * from "./observation.js";
export * from "./diagnosticReport.js";
export * from "./condition.js";
export * from "./documentReference.js";
export * from "./consent.js";
export * from "./provenance.js";
export * from "./coverage.js";
