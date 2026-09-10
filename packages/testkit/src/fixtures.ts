/**
 * Synthetic domain fixtures for ORBB tests (agent-protocol test-data rules).
 *
 *   - Every fixture is tagged `synthetic: true` in a `metadata` field
 *     (`SyntheticMetadata`), together with its seed and sequence.
 *   - Fixture identities are obviously fake: every generated id body and
 *     every display name carries the `SYNTH-` marker, so fixtures can
 *     never be confused with real patient records.
 *   - Every observation fixture carries an `evidenceLabel` and a full
 *     embedded provenance record (architecture rule: every observation
 *     needs provenance), linked through `provenanceId`.
 *
 * Determinism contract: two `SyntheticFixtures` instances constructed with
 * the same seed, driven through the same call sequence and clock advances,
 * produce byte-identical JSON. The module-level builders
 * (`syntheticPerson()` etc.) construct a fresh seeded context per call, so
 * identical options always yield the identical fixture; use the class (or
 * distinct seeds) when distinct fixtures are needed.
 *
 * Domain compatibility: id prefixes and quality scores are produced
 * through the frozen `@orbb/domain` value guards (`ID_PREFIXES`,
 * `parseQualityScore`), so fixture shapes track the domain contracts.
 * Overrides can set but never remove optional fields, and can never
 * overwrite the `metadata` synthetic tag.
 */
import {
  ID_PREFIXES,
  parseQualityScore,
  type AccessGrant,
  type DeviceId,
  type EvidenceLabel,
  type GrantId,
  type Observation,
  type ObservationId,
  type PersonId,
  type Provenance,
  type ProvenanceId,
  type SourceId,
} from "@orbb/domain";
import { DeterministicClock } from "./clock.js";
import { DeterministicIdFactory } from "./ids.js";
import type { Resettable } from "./reset.js";

/** Prefix used for every obviously-fake generated name and id body. */
export const SYNTH_NAME_PREFIX = "SYNTH";

/** Default consent-grant lifetime (days) derived from the deterministic clock. */
export const DEFAULT_GRANT_LIFETIME_DAYS = 365;

const DEFAULT_OBSERVATION_CONCEPT_CODE = "SYNTH-8867-4";
const DEFAULT_OBSERVATION_METHOD_ID = "SYNTH-method-manual";
const DEFAULT_OBSERVATION_VALUE = 72;
const DEFAULT_OBSERVATION_UNIT = "beats/min";
const DEFAULT_OBSERVATION_QUALITY = 0.9;
const DEFAULT_EVIDENCE_LABEL: EvidenceLabel = "MEASURED";
const DEFAULT_GRANT_PURPOSE = "SYNTH-CARE_MANAGEMENT";
const DEFAULT_GRANT_SCOPE: readonly string[] = ["observations:read"];
const DEFAULT_DEVICE_MODEL = `${SYNTH_NAME_PREFIX}-Model-A`;
const MS_PER_DAY = 86_400_000;
const SEQUENCE_WIDTH = 8;

/**
 * Mandatory synthetic tag carried by every fixture. `synthetic: true` is
 * the machine-checkable marker required by the agent protocol.
 */
export interface SyntheticMetadata {
  readonly synthetic: true;
  /** Seed of the id factory that produced this fixture. */
  readonly seed: string;
  /** Id-factory counter value at fixture creation (deterministic). */
  readonly sequence: number;
}

/**
 * Partial overrides for a fixture shape. `undefined` values are ignored
 * (fields cannot be removed, only replaced). The `metadata` field is never
 * overridable — the synthetic tag is unconditional.
 */
export type FixtureOverrides<T> = { readonly [K in keyof T]?: T[K] | undefined };

/** Synthetic person (no Person aggregate exists in M0 domain — deliberately minimal). */
export interface SyntheticPerson {
  readonly id: PersonId;
  /** Obviously fake display name, e.g. `SYNTH-Person-00000001`. */
  readonly displayName: string;
  readonly createdAt: Date;
  readonly metadata: SyntheticMetadata;
}

/** Synthetic measurement device (no Device aggregate exists in M0 domain). */
export interface SyntheticDevice {
  readonly id: DeviceId;
  /** Obviously fake device name, e.g. `SYNTH-Device-00000002`. */
  readonly name: string;
  readonly model: string;
  readonly createdAt: Date;
  readonly metadata: SyntheticMetadata;
}

/** Synthetic provenance record — extends the frozen domain `Provenance`. */
export interface SyntheticProvenance extends Provenance {
  readonly metadata: SyntheticMetadata;
}

/**
 * Synthetic observation — extends the frozen domain `Observation` with an
 * embedded provenance record (`provenanceId` links the two) and the
 * synthetic tag.
 */
export interface SyntheticObservation extends Observation {
  readonly provenance: SyntheticProvenance;
  readonly metadata: SyntheticMetadata;
}

/** Synthetic consent grant — extends the frozen domain `AccessGrant`. */
export interface SyntheticConsentGrant extends AccessGrant {
  readonly metadata: SyntheticMetadata;
}

/** Options for constructing a {@link SyntheticFixtures} context. */
export interface SyntheticFixtureOptions {
  /** Seed for the id factory (see {@link DeterministicIdFactory}). Default "seed-0001". */
  readonly seed?: string | undefined;
  /** Initial clock epoch in milliseconds (default: Unix epoch 0). */
  readonly epochMs?: number | undefined;
}

/**
 * Deterministic fixture context: owns a `DeterministicClock` and a
 * `DeterministicIdFactory` so that call sequences replay exactly.
 * Implements `Resettable` (clock to epoch, counters to zero) and can be
 * registered with a `TestReset`.
 */
export class SyntheticFixtures implements Resettable {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  readonly seed: string;

  constructor(options?: SyntheticFixtureOptions) {
    this.ids = new DeterministicIdFactory({ seed: options?.seed });
    this.clock = new DeterministicClock({ epochMs: options?.epochMs });
    this.seed = this.ids.seed;
  }

  /** Builds a synthetic person. */
  person(overrides?: FixtureOverrides<Omit<SyntheticPerson, "metadata">>): SyntheticPerson {
    const id = asCanonicalId<PersonId>(this.ids.next(ID_PREFIXES.person));
    const sequence = this.ids.issued;
    const base: Omit<SyntheticPerson, "metadata"> = {
      id,
      displayName: `${SYNTH_NAME_PREFIX}-Person-${formatSequence(sequence)}`,
      createdAt: this.clock.now(),
    };
    return { ...apply(base, overrides), metadata: this.metadata(sequence) };
  }

  /** Builds a synthetic measurement device. */
  device(overrides?: FixtureOverrides<Omit<SyntheticDevice, "metadata">>): SyntheticDevice {
    const id = asCanonicalId<DeviceId>(this.ids.next(ID_PREFIXES.device));
    const sequence = this.ids.issued;
    const base: Omit<SyntheticDevice, "metadata"> = {
      id,
      name: `${SYNTH_NAME_PREFIX}-Device-${formatSequence(sequence)}`,
      model: DEFAULT_DEVICE_MODEL,
      createdAt: this.clock.now(),
    };
    return { ...apply(base, overrides), metadata: this.metadata(sequence) };
  }

  /**
   * Builds a synthetic provenance record. Defaults: subject and actor are
   * fresh synthetic person ids; `correlationId` is a `SYNTH-` token.
   * `causationId` is omitted unless overridden.
   */
  provenance(
    overrides?: FixtureOverrides<Omit<SyntheticProvenance, "metadata">>,
  ): SyntheticProvenance {
    const subject = overrides?.subject ?? asCanonicalId<PersonId>(this.ids.next(ID_PREFIXES.person));
    const actor = overrides?.actor ?? asCanonicalId<PersonId>(this.ids.next(ID_PREFIXES.person));
    const provenanceId = overrides?.provenanceId ?? asCanonicalId<ProvenanceId>(this.ids.next(ID_PREFIXES.provenance));
    const sequence = this.ids.issued;
    const base: Omit<SyntheticProvenance, "metadata"> = {
      provenanceId,
      actor,
      subject,
      occurredAt: this.clock.now(),
      correlationId: `${SYNTH_NAME_PREFIX}-correlation-${formatSequence(sequence)}`,
    };
    return { ...apply(base, overrides), metadata: this.metadata(sequence) };
  }

  /**
   * Builds a synthetic observation with `evidenceLabel` and a full
   * provenance record (subject defaults to the observation's person,
   * actor to its source). Overriding `provenance` or `personId`/`sourceId`
   * keeps the linkage consistent unless both sides are overridden
   * deliberately: `provenanceId` falls back to the embedded record's id.
   */
  observation(
    overrides?: FixtureOverrides<Omit<SyntheticObservation, "metadata">>,
  ): SyntheticObservation {
    const personId = overrides?.personId ?? asCanonicalId<PersonId>(this.ids.next(ID_PREFIXES.person));
    const sourceId = overrides?.sourceId ?? asCanonicalId<SourceId>(this.ids.next(ID_PREFIXES.source));
    const provenance = overrides?.provenance ?? this.provenance({ subject: personId, actor: sourceId });
    const provenanceId = overrides?.provenanceId ?? provenance.provenanceId;
    const id = asCanonicalId<ObservationId>(this.ids.next(ID_PREFIXES.observation));
    const sequence = this.ids.issued;
    const base: Omit<SyntheticObservation, "metadata"> = {
      id,
      personId,
      conceptCode: DEFAULT_OBSERVATION_CONCEPT_CODE,
      value: DEFAULT_OBSERVATION_VALUE,
      unit: DEFAULT_OBSERVATION_UNIT,
      effectiveAt: this.clock.now(),
      observedAt: this.clock.now(),
      sourceId,
      methodId: DEFAULT_OBSERVATION_METHOD_ID,
      quality: parseQualityScore(DEFAULT_OBSERVATION_QUALITY),
      validationState: "pending",
      provenanceId,
      evidenceLabel: DEFAULT_EVIDENCE_LABEL,
      provenance,
    };
    return { ...apply(base, overrides), metadata: this.metadata(sequence) };
  }

  /**
   * Builds a synthetic consent grant: `state` defaults to "active" and
   * `expiresAt` is derived deterministically from the clock (creation
   * time + {@link DEFAULT_GRANT_LIFETIME_DAYS} days) — there is no
   * wall-clock expiry in fixtures.
   */
  consentGrant(
    overrides?: FixtureOverrides<Omit<SyntheticConsentGrant, "metadata">>,
  ): SyntheticConsentGrant {
    const subjectId = overrides?.subjectId ?? asCanonicalId<PersonId>(this.ids.next(ID_PREFIXES.person));
    const id = asCanonicalId<GrantId>(this.ids.next(ID_PREFIXES.grant));
    const createdAt = this.clock.now();
    const sequence = this.ids.issued;
    const base: Omit<SyntheticConsentGrant, "metadata"> = {
      id,
      subjectId,
      recipientId: `${SYNTH_NAME_PREFIX}-Recipient-${formatSequence(sequence)}`,
      purpose: DEFAULT_GRANT_PURPOSE,
      scope: DEFAULT_GRANT_SCOPE,
      state: "active",
      expiresAt: new Date(createdAt.getTime() + DEFAULT_GRANT_LIFETIME_DAYS * MS_PER_DAY),
    };
    return { ...apply(base, overrides), metadata: this.metadata(sequence) };
  }

  /** Resets clock to epoch and id counters to zero (TestReset-compatible). */
  reset(): void {
    this.clock.reset();
    this.ids.reset();
  }

  private metadata(sequence: number): SyntheticMetadata {
    return { synthetic: true, seed: this.seed, sequence };
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience builders.
// ---------------------------------------------------------------------------

/** Builds one synthetic person in a fresh deterministic context (same options => identical fixture). */
export function syntheticPerson(
  overrides?: FixtureOverrides<Omit<SyntheticPerson, "metadata">>,
  options?: SyntheticFixtureOptions,
): SyntheticPerson {
  return new SyntheticFixtures(options).person(overrides);
}

/** Builds one synthetic device in a fresh deterministic context. */
export function syntheticDevice(
  overrides?: FixtureOverrides<Omit<SyntheticDevice, "metadata">>,
  options?: SyntheticFixtureOptions,
): SyntheticDevice {
  return new SyntheticFixtures(options).device(overrides);
}

/** Builds one synthetic provenance record in a fresh deterministic context. */
export function syntheticProvenance(
  overrides?: FixtureOverrides<Omit<SyntheticProvenance, "metadata">>,
  options?: SyntheticFixtureOptions,
): SyntheticProvenance {
  return new SyntheticFixtures(options).provenance(overrides);
}

/** Builds one synthetic observation in a fresh deterministic context. */
export function syntheticObservation(
  overrides?: FixtureOverrides<Omit<SyntheticObservation, "metadata">>,
  options?: SyntheticFixtureOptions,
): SyntheticObservation {
  return new SyntheticFixtures(options).observation(overrides);
}

/** Builds one synthetic consent grant in a fresh deterministic context. */
export function syntheticConsentGrant(
  overrides?: FixtureOverrides<Omit<SyntheticConsentGrant, "metadata">>,
  options?: SyntheticFixtureOptions,
): SyntheticConsentGrant {
  return new SyntheticFixtures(options).consentGrant(overrides);
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Casts a factory-generated string to a branded canonical id type. Safe by
 * construction: `DeterministicIdFactory` emits bodies that satisfy the
 * canonical id grammar (tests assert domain-guard compatibility for every
 * prefix used here).
 */
function asCanonicalId<T extends string>(value: string): T {
  return value as T;
}

function formatSequence(sequence: number): string {
  return sequence.toString().padStart(SEQUENCE_WIDTH, "0");
}

/** Merges non-undefined overrides over a base fixture value. */
function apply<T extends object>(base: T, overrides: FixtureOverrides<T> | undefined): T {
  if (overrides === undefined) {
    return base;
  }
  const defined = Object.fromEntries(
    Object.entries(overrides).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
  return { ...base, ...defined };
}
