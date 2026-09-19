/**
 * FHIR R4 output shapes — exactly the elements the mapper emits, typed.
 *
 * These are deliberately NARROW structural types, not a full FHIR R4
 * metamodel: every field the mapper emits is typed with the value space
 * the mapper can produce (e.g. `status` is the three-value union the
 * domain state machine maps onto, not the full FHIR observation-status
 * vocabulary). Fields the mapper never emits are absent from the
 * interfaces — absence IS the privacy decision (a Patient without the
 * port carries no `name`, so the type has no `name` field that could be
 * accidentally populated).
 */

/** FHIR `Identifier` (system + value only — no period, assigner, or use). */
export interface FhirIdentifier {
  readonly system: string;
  readonly value: string;
}

/** FHIR `Coding` as emitted by the mapper (system + code, display only when supplied). */
export interface FhirCoding {
  readonly system: string;
  readonly code: string;
  readonly display?: string;
}

/** FHIR `CodeableConcept` as emitted by the mapper (codings only — no free text). */
export interface FhirCodeableConcept {
  readonly coding: readonly FhirCoding[];
}

/**
 * Cross-resource reference to one of the mapped resource types: a
 * relative `reference` (`Type/<deterministic-id>`, resolvable within the
 * mapped resource set) PLUS the durable business `identifier` (system =
 * id-kind namespace, value = the OPAQUE ORBB domain id). RECORDED
 * DECISION: both are always present — the relative form is resolvable
 * but derivation-fragile; the opaque identifier is the stable business
 * key that survives id-derimation changes.
 */
export interface FhirReference {
  readonly reference: string;
  readonly identifier: FhirIdentifier;
}

/** Identifier-only reference (used for target kinds that are NOT mapped resource types). */
export interface FhirIdentifierReference {
  readonly identifier: FhirIdentifier;
}

/** FHIR `Quantity` as emitted by the mapper (value + unit when non-empty). */
export interface FhirQuantity {
  readonly value: number;
  readonly unit?: string;
}

/** FHIR `Period` (ISO-8601 instants; `start` present only when the domain carries it). */
export interface FhirPeriod {
  readonly start?: string;
  readonly end?: string;
}

// ---------------------------------------------------------------------------
// Demographic port shapes (only reachable through the deliberate port).
// ---------------------------------------------------------------------------

/** FHIR `HumanName` subset the demographic port may disclose. */
export interface FhirHumanName {
  readonly family: string;
  readonly given?: readonly string[];
}

/** FHIR `ContactPoint` subset the demographic port may disclose. */
export interface FhirContactPoint {
  readonly system: "phone" | "email" | "url" | "other";
  readonly value: string;
}

/** FHIR `Address` subset the demographic port may disclose. */
export interface FhirAddress {
  readonly line?: readonly string[];
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

// ---------------------------------------------------------------------------
// The seven mapped resource shapes.
// ---------------------------------------------------------------------------

/**
 * Mapped Patient — privacy-first: `identifier` only, unless demographics
 * were deliberately disclosed through the context's DemographicPort.
 */
export interface FhirPatient {
  readonly resourceType: "Patient";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly name?: readonly FhirHumanName[];
  readonly birthDate?: string;
  readonly gender?: "male" | "female" | "other" | "unknown";
  readonly telecom?: readonly FhirContactPoint[];
  readonly address?: readonly FhirAddress[];
}

/** Mapped Observation (status space the domain state machine can produce). */
export interface FhirObservation {
  readonly resourceType: "Observation";
  readonly id: string;
  /** Evidence label carried as a namespaced workflow tag (R4 has no standard reliability element). */
  readonly meta: { readonly tag: readonly FhirCoding[] };
  readonly identifier: readonly FhirIdentifier[];
  readonly status: "preliminary" | "final" | "entered-in-error";
  readonly category?: readonly FhirCodeableConcept[];
  readonly code: FhirCodeableConcept;
  readonly subject: FhirReference;
  readonly effectiveDateTime: string;
  readonly issued: string;
  readonly method?: FhirCodeableConcept;
  readonly valueQuantity?: FhirQuantity;
  readonly valueString?: string;
  readonly valueBoolean?: boolean;
}

/** Mapped DiagnosticReport (status space the task/attempt model can produce). */
export interface FhirDiagnosticReport {
  readonly resourceType: "DiagnosticReport";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly basedOn: readonly FhirIdentifierReference[];
  readonly status: "registered" | "partial" | "final";
  readonly code: FhirCodeableConcept;
  readonly subject: FhirReference;
  readonly effectivePeriod: FhirPeriod;
  readonly issued?: string;
  readonly result: readonly FhirReference[];
}

/** Mapped Condition — verificationStatus is ALWAYS provisional (binding doctrine). */
export interface FhirCondition {
  readonly resourceType: "Condition";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly clinicalStatus: FhirCodeableConcept;
  readonly verificationStatus: FhirCodeableConcept;
  readonly code: FhirCodeableConcept;
  readonly subject: FhirReference;
  readonly recordedDate: string;
}

/** Attachment payload of a mapped DocumentReference. */
export interface FhirDocumentReferenceAttachment {
  readonly contentType: string;
  readonly url: string;
  readonly size: number;
  readonly hash: string;
  readonly creation: string;
}

/** Mapped DocumentReference — evidence objects are always `current`. */
export interface FhirDocumentReference {
  readonly resourceType: "DocumentReference";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly status: "current";
  readonly subject: FhirReference;
  readonly date?: string;
  readonly content: readonly { readonly attachment: FhirDocumentReferenceAttachment }[];
}

/** Permit provision of a mapped Consent. */
export interface FhirConsentProvision {
  readonly type: "permit";
  readonly period: FhirPeriod;
  readonly action: readonly FhirCodeableConcept[];
}

/** Mapped Consent — from an AccessGrant (deny-by-default survives: no grant, no resource). */
export interface FhirConsent {
  readonly resourceType: "Consent";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly status: "active" | "inactive";
  readonly scope: FhirCodeableConcept;
  readonly category: readonly FhirCodeableConcept[];
  readonly patient: FhirReference;
  readonly dateTime?: string;
  readonly provision: FhirConsentProvision;
}

/** One Provenance agent (the domain actor vocabulary, entity-kind based). */
export interface FhirProvenanceAgent {
  readonly type: FhirCodeableConcept;
  readonly who: FhirIdentifierReference;
}

/** Mapped Provenance — targets the mapped resources it covers. */
export interface FhirProvenance {
  readonly resourceType: "Provenance";
  readonly id: string;
  readonly target: readonly FhirReference[];
  readonly occurredDateTime: string;
  readonly recorded: string;
  readonly agent: readonly FhirProvenanceAgent[];
}

/** Union of the seven mapped resource shapes. */
export type FhirResource =
  | FhirPatient
  | FhirObservation
  | FhirDiagnosticReport
  | FhirCondition
  | FhirDocumentReference
  | FhirConsent
  | FhirProvenance;
