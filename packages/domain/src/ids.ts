/**
 * Canonical domain identifiers (branded, nominal-typed).
 *
 * Grammar (M0 baseline, recorded assumption):
 *   `<prefix>_<body>`
 *   - `prefix`  — a fixed, lowercase kind tag (see {@link ID_PREFIXES}),
 *     e.g. `prsn` for PersonId.
 *   - `body`    — 16–128 characters of `[A-Za-z0-9_-]` (URL-safe). This
 *     admits prefixed ULIDs (26 chars), UUIDs without dashes (32 chars),
 *     and nanoids (21 chars) so generation strategy stays an infrastructure
 *     concern, not a domain concern.
 *
 * Branding makes cross-kind assignment a compile-time error:
 * `const p: PersonId = deviceId` does not type-check.
 */
import { DomainInvariantError } from "./errors.js";

declare const canonicalIdBrand: unique symbol;

/** Nominal branding applied to canonical ORBB identifier types. */
type BrandedValue<T, B extends string> = T & { readonly [canonicalIdBrand]: B };

export type PersonId = BrandedValue<string, "PersonId">;
export type IntentId = BrandedValue<string, "IntentId">;
export type ObservationId = BrandedValue<string, "ObservationId">;
export type EvidenceId = BrandedValue<string, "EvidenceId">;
export type PlanId = BrandedValue<string, "PlanId">;
export type TaskId = BrandedValue<string, "TaskId">;
export type GrantId = BrandedValue<string, "GrantId">;
export type DeviceId = BrandedValue<string, "DeviceId">;
export type SourceId = BrandedValue<string, "SourceId">;
export type ProvenanceId = BrandedValue<string, "ProvenanceId">;

/** Maps a canonical id kind to its branded type. */
export interface CanonicalIdTypes {
  readonly person: PersonId;
  readonly intent: IntentId;
  readonly observation: ObservationId;
  readonly evidence: EvidenceId;
  readonly plan: PlanId;
  readonly task: TaskId;
  readonly grant: GrantId;
  readonly device: DeviceId;
  readonly source: SourceId;
  readonly provenance: ProvenanceId;
}

/** The set of canonical id kinds owned by `@orbb/domain` in M0. */
export type CanonicalIdKind = keyof CanonicalIdTypes;

/** Resolves a canonical id kind to its branded type. */
export type CanonicalIdFor<K extends CanonicalIdKind> = CanonicalIdTypes[K];

/** Fixed kind prefixes used by the canonical id grammar. */
export const ID_PREFIXES = {
  person: "prsn",
  intent: "intent",
  observation: "obs",
  evidence: "evid",
  plan: "plan",
  task: "task",
  grant: "grant",
  device: "dev",
  source: "src",
  provenance: "prov",
} as const satisfies Record<CanonicalIdKind, string>;

/** Valid body segment of a canonical id: 16–128 URL-safe characters. */
export const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Type guard: is `value` a canonical id of the given kind?
 */
export function isIdOf<K extends CanonicalIdKind>(
  kind: K,
  value: unknown,
): value is CanonicalIdFor<K> {
  if (typeof value !== "string") {
    return false;
  }
  const prefix = ID_PREFIXES[kind];
  if (!value.startsWith(`${prefix}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(prefix.length + 1));
}

/**
 * Parses and validates a raw value as a canonical id of the given kind.
 * Throws {@link DomainInvariantError} describing the expected grammar —
 * the offending value is never echoed back.
 */
export function parseId<K extends CanonicalIdKind>(kind: K, value: unknown): CanonicalIdFor<K> {
  if (!isIdOf(kind, value)) {
    throw new DomainInvariantError(
      `Invalid canonical id for kind "${kind}": expected "${ID_PREFIXES[kind]}_<body>" where <body> is 16-128 characters of [A-Za-z0-9_-].`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Per-kind convenience guards and parsers.
// ---------------------------------------------------------------------------

export function isPersonId(value: unknown): value is PersonId {
  return isIdOf("person", value);
}

export function parsePersonId(value: unknown): PersonId {
  return parseId("person", value);
}

export function isIntentId(value: unknown): value is IntentId {
  return isIdOf("intent", value);
}

export function parseIntentId(value: unknown): IntentId {
  return parseId("intent", value);
}

export function isObservationId(value: unknown): value is ObservationId {
  return isIdOf("observation", value);
}

export function parseObservationId(value: unknown): ObservationId {
  return parseId("observation", value);
}

export function isEvidenceId(value: unknown): value is EvidenceId {
  return isIdOf("evidence", value);
}

export function parseEvidenceId(value: unknown): EvidenceId {
  return parseId("evidence", value);
}

export function isPlanId(value: unknown): value is PlanId {
  return isIdOf("plan", value);
}

export function parsePlanId(value: unknown): PlanId {
  return parseId("plan", value);
}

export function isTaskId(value: unknown): value is TaskId {
  return isIdOf("task", value);
}

export function parseTaskId(value: unknown): TaskId {
  return parseId("task", value);
}

export function isGrantId(value: unknown): value is GrantId {
  return isIdOf("grant", value);
}

export function parseGrantId(value: unknown): GrantId {
  return parseId("grant", value);
}

export function isDeviceId(value: unknown): value is DeviceId {
  return isIdOf("device", value);
}

export function parseDeviceId(value: unknown): DeviceId {
  return parseId("device", value);
}

export function isSourceId(value: unknown): value is SourceId {
  return isIdOf("source", value);
}

export function parseSourceId(value: unknown): SourceId {
  return parseId("source", value);
}

export function isProvenanceId(value: unknown): value is ProvenanceId {
  return isIdOf("provenance", value);
}

export function parseProvenanceId(value: unknown): ProvenanceId {
  return parseId("provenance", value);
}
