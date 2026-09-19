/**
 * Clinical-local canonical identifiers (branded, nominal-typed) — the M7-A
 * catalog-mirror pattern.
 *
 * The kernel id grammar (`@orbb/domain` `ids.ts`) is FROZEN: adding new
 * canonical id kinds to `CanonicalIdTypes` is a tech-lead promotion, not a
 * worker-lane change. The A44 clinical entities (organizations, clinics,
 * practitioners) need their own canonical ids NOW, so — exactly like the
 * M6-A measurement lane and the contracts lane's `evt_` ids before it —
 * this package defines clinical-local branded ids that mirror the kernel
 * grammar letter-for-letter:
 *
 *   `<prefix>_<body>`
 *   - `prefix`  — a fixed, lowercase kind tag (see
 *     {@link CLINICAL_ID_PREFIXES}), e.g. `org` for OrganizationId.
 *   - `body`    — 16–128 characters of `[A-Za-z0-9_-]` (URL-safe), checked
 *     against the REAL kernel body pattern (`ID_BODY_PATTERN` imported
 *     from `@orbb/domain`) so clinical ids can never drift from the
 *     canonical grammar.
 *
 * Branding makes cross-kind assignment a compile-time error:
 * `const o: OrganizationId = practitionerId` does not type-check — and
 * cross-kind confusion is additionally rejected at runtime by the guards.
 *
 * KERNEL-PROMOTION HANDOFF (recorded, not performed here): when the
 * tech-lead lane promotes the clinical kinds, `organization`, `clinic`,
 * and `practitioner` move into `CanonicalIdTypes` + `ID_PREFIXES` in
 * `packages/domain/src/ids.ts`, and this module reduces to a re-export of
 * the kernel guards. The prefixes chosen here (`org`, `clin`, `pract`)
 * deliberately collide with NO existing kernel prefix (`prsn`, `intent`,
 * `obs`, `evid`, `plan`, `task`, `grant`, `dev`, `src`, `prov`), so the
 * promotion rebrands nothing — existing clinical ids stay canonical
 * verbatim.
 */
import { DomainInvariantError, ID_BODY_PATTERN } from "@orbb/domain";

declare const clinicalIdBrand: unique symbol;

/** Nominal branding applied to clinical-local identifier types. */
type BrandedClinicalValue<T, B extends string> = T & {
  readonly [clinicalIdBrand]: B;
};

/** Organization id: `org_<body>`. */
export type OrganizationId = BrandedClinicalValue<string, "OrganizationId">;
/** Clinic id: `clin_<body>`. */
export type ClinicId = BrandedClinicalValue<string, "ClinicId">;
/** Practitioner id: `pract_<body>`. */
export type PractitionerId = BrandedClinicalValue<string, "PractitionerId">;

/** Maps a clinical id kind to its branded type. */
export interface ClinicalIdTypes {
  readonly organization: OrganizationId;
  readonly clinic: ClinicId;
  readonly practitioner: PractitionerId;
}

/** The set of clinical id kinds owned by `@orbb/clinical` in M7-A. */
export type ClinicalIdKind = keyof ClinicalIdTypes;

/** Resolves a clinical id kind to its branded type. */
export type ClinicalIdFor<K extends ClinicalIdKind> = ClinicalIdTypes[K];

/**
 * Fixed kind prefixes used by the clinical-local id grammar. Values are
 * the kernel-mirroring kind tags WITHOUT the separating underscore (the
 * same convention as `ID_PREFIXES` in `@orbb/domain`).
 */
export const CLINICAL_ID_PREFIXES = {
  organization: "org",
  clinic: "clin",
  practitioner: "pract",
} as const satisfies Record<ClinicalIdKind, string>;

/**
 * Type guard: is `value` a clinical-local canonical id of the given kind?
 * Uses the REAL kernel body grammar, so a clinical id is exactly as
 * permissive — and exactly as strict — as a kernel canonical id.
 */
export function isClinicalIdOf<K extends ClinicalIdKind>(
  kind: K,
  value: unknown,
): value is ClinicalIdFor<K> {
  if (typeof value !== "string") {
    return false;
  }
  const prefix = CLINICAL_ID_PREFIXES[kind];
  if (!value.startsWith(`${prefix}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(prefix.length + 1));
}

/**
 * Parses and validates a raw value as a clinical-local canonical id of the
 * given kind. Throws {@link DomainInvariantError} describing the expected
 * grammar — the offending value is never echoed back (same PHI-adjacent
 * discipline as the kernel `parseId`).
 */
export function parseClinicalId<K extends ClinicalIdKind>(
  kind: K,
  value: unknown,
): ClinicalIdFor<K> {
  if (!isClinicalIdOf(kind, value)) {
    throw new DomainInvariantError(
      `Invalid clinical id for kind "${kind}": expected "${CLINICAL_ID_PREFIXES[kind]}_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Per-kind convenience guards and parsers.
// ---------------------------------------------------------------------------

export function isOrganizationId(value: unknown): value is OrganizationId {
  return isClinicalIdOf("organization", value);
}

export function parseOrganizationId(value: unknown): OrganizationId {
  return parseClinicalId("organization", value);
}

export function isClinicId(value: unknown): value is ClinicId {
  return isClinicalIdOf("clinic", value);
}

export function parseClinicId(value: unknown): ClinicId {
  return parseClinicalId("clinic", value);
}

export function isPractitionerId(value: unknown): value is PractitionerId {
  return isClinicalIdOf("practitioner", value);
}

export function parsePractitionerId(value: unknown): PractitionerId {
  return parseClinicalId("practitioner", value);
}
