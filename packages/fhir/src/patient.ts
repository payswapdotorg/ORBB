/**
 * Patient mapper — privacy-first by construction.
 *
 * RECORDED BINDING DECISION (the brief's explicit requirement): the
 * default mapped Patient is IDENTIFIER-ONLY — `identifier` carries the
 * opaque canonical PersonId under ORBB's SYNTH namespace, and NOTHING
 * else. NO name, NO birthDate, NO telecom, NO address, NO gender is
 * ever invented: those elements appear ONLY when the caller supplies a
 * deliberate {@link DemographicPort} that discloses them for that person
 * (the port must be pure — determinism precondition). The mapper never
 * reads a Person "displayName" or any other demographic source; it maps
 * FROM a bare PersonId, exactly as the work order specifies.
 */
import { invalidInput, isNonEmptyString } from "./guards.js";
import type { FhirPatient } from "./fhir.js";
import type { FhirMappingContext, PatientDemographics } from "./context.js";
import { deriveResourceId } from "./fhirIds.js";
import { identifierSystem, isIdOfKind } from "./vocabulary.js";

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isBirthDate(value: unknown): value is string {
  if (typeof value !== "string" || !BIRTH_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isGenderValue(value: unknown): value is "male" | "female" | "other" | "unknown" {
  return (
    value === "male" || value === "female" || value === "other" || value === "unknown"
  );
}

function isContactSystem(value: unknown): value is "phone" | "email" | "url" | "other" {
  return value === "phone" || value === "email" || value === "url" || value === "other";
}

function isNonEmptyStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isNonEmptyString(entry))
  );
}

/**
 * Pure guard: asserts the demographic port's disclosure is well-formed
 * (runtime-checked — the port is an external boundary). Values are never
 * echoed.
 */
function assertDemographics(candidate: unknown): asserts candidate is PatientDemographics {
  const record = asRecord(candidate);
  if (record === undefined) {
    throw invalidInput("Invalid patient demographics: expected an object (or undefined for no disclosure).");
  }
  if (record.name !== undefined) {
    if (!Array.isArray(record.name) || record.name.length === 0) {
      throw invalidInput("Invalid patient demographics: name, when present, must be a non-empty list of { family, given? }.");
    }
    for (const entry of record.name) {
      const nameRecord = asRecord(entry);
      if (nameRecord === undefined || !isNonEmptyString(nameRecord.family)) {
        throw invalidInput("Invalid patient demographics: every name requires a non-empty family string.");
      }
      if (nameRecord.given !== undefined && !isNonEmptyStringList(nameRecord.given)) {
        throw invalidInput("Invalid patient demographics: given, when present, must be a non-empty list of non-empty strings.");
      }
    }
  }
  if (record.birthDate !== undefined && !isBirthDate(record.birthDate)) {
    throw invalidInput("Invalid patient demographics: birthDate must be a valid YYYY-MM-DD calendar date.");
  }
  if (record.gender !== undefined && !isGenderValue(record.gender)) {
    throw invalidInput("Invalid patient demographics: gender must be one of male | female | other | unknown (the FHIR administrative-gender value space).");
  }
  if (record.telecom !== undefined) {
    if (!Array.isArray(record.telecom) || record.telecom.length === 0) {
      throw invalidInput("Invalid patient demographics: telecom, when present, must be a non-empty list.");
    }
    for (const entry of record.telecom) {
      const contact = asRecord(entry);
      if (
        contact === undefined ||
        !isContactSystem(contact.system) ||
        !isNonEmptyString(contact.value)
      ) {
        throw invalidInput("Invalid patient demographics: every telecom entry requires a system of phone | email | url | other and a non-empty value.");
      }
    }
  }
  if (record.address !== undefined) {
    if (!Array.isArray(record.address) || record.address.length === 0) {
      throw invalidInput("Invalid patient demographics: address, when present, must be a non-empty list.");
    }
    for (const entry of record.address) {
      const address = asRecord(entry);
      if (address === undefined) {
        throw invalidInput("Invalid patient demographics: every address must be an object.");
      }
      if (address.line !== undefined && !isNonEmptyStringList(address.line)) {
        throw invalidInput("Invalid patient demographics: address line, when present, must be a non-empty list of non-empty strings.");
      }
      for (const key of ["city", "state", "postalCode", "country"] as const) {
        if (address[key] !== undefined && !isNonEmptyString(address[key])) {
          throw invalidInput("Invalid patient demographics: address parts, when present, must be non-empty strings.");
        }
      }
    }
  }
}

/**
 * Maps a PersonId to a FHIR R4 Patient resource — identifier-only by
 * default (privacy-first), demographics only through the deliberate
 * port. Pure and deterministic: the same (personId, context) yields
 * byte-identical output (the port is required to be a pure function).
 */
export function mapPatient(personId: string, context: FhirMappingContext): FhirPatient {
  if (!isIdOfKind("person", personId)) {
    throw invalidInput("Invalid person id for Patient mapping: expected a canonical person id (prsn_<body>).");
  }
  const base: FhirPatient = {
    resourceType: "Patient",
    id: deriveResourceId("Patient", personId),
    identifier: [{ system: identifierSystem(context.namespace, "person"), value: personId }],
  };
  const demographics = context.demographics.demographicsFor(personId);
  if (demographics === undefined) {
    return base;
  }
  assertDemographics(demographics);
  return { ...base, ...demographics };
}
