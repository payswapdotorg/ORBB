/**
 * A32 — Device-source abstraction (Lane C packet M4-C): the
 * `MeasurementSourceRegistry` and the `DeviceSourceAdapter` sample-fetch
 * contract that bridge native health platforms into the measurement plane
 * as SOURCES with methods (architecture §5 measurement family).
 *
 * SEAM PLACEMENT (recorded): this seam lives in `@orbb/platform`
 * (`packages/platform/src/health/`) because the lane model places
 * adapters in Lane C (Platform/QA), while the measurement ENGINE
 * (`packages/measurement`) is owned by Lane A and is not imported by this
 * seam beyond the frozen `@orbb/domain` contracts. The engine will
 * implement/consume these seams (handoff recorded in the packet report).
 *
 * Deny-by-default discipline (mirroring the engine's A28 capability
 * index): a source is registered explicitly, a fetch is only served for a
 * REGISTERED + ACTIVE source whose capability covers the metric, and every
 * expected rejection is a TYPED RESULT — never a thrown exception.
 *
 * Source kinds mirror the Lane A engine vocabulary exactly
 * ("manual" | "device" | "app"); the packet's "app-adapter" phrasing maps
 * to the "app" kind (recorded assumption). `direction` declares the
 * sample-flow a capability supports: "pull" (the app queries the platform
 * on demand — anchored queries / readRecords) or "push" (the platform or
 * person delivers samples into the app — manual entry, background
 * delivery).
 */
import type {
  EvidenceLabel,
  Observation,
  ObservationId,
  ObservationValidationState,
  PersonId,
  Provenance,
  ProvenanceId,
  QualityScore,
  SourceId,
} from "@orbb/domain";
import {
  assertObservationValidationTransition,
  isIdOf,
  isQualityScore,
} from "@orbb/domain";
import { err, ok, type HealthResult } from "./result.js";
import type { UnitConversionSpec } from "./units.js";
import { applyUnitConversion, conversionTableFor } from "./units.js";

// ---------------------------------------------------------------------------
// Source kinds, directions, capabilities.
// ---------------------------------------------------------------------------

/**
 * The three source kinds a person can register. Values mirror the Lane A
 * engine's `MEASUREMENT_SOURCE_KINDS` exactly ("manual" entry, a "device",
 * an "app" adapter such as HealthKit / Health Connect).
 */
export const MEASUREMENT_SOURCE_KINDS = ["manual", "device", "app"] as const;

export type MeasurementSourceKind = (typeof MEASUREMENT_SOURCE_KINDS)[number];

export function isMeasurementSourceKind(value: unknown): value is MeasurementSourceKind {
  return (
    typeof value === "string" &&
    (MEASUREMENT_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

/** Sample-flow direction a source capability supports. */
export const SOURCE_DIRECTIONS = ["pull", "push"] as const;

export type SourceDirection = (typeof SOURCE_DIRECTIONS)[number];

export function isSourceDirection(value: unknown): value is SourceDirection {
  return (
    typeof value === "string" && (SOURCE_DIRECTIONS as readonly string[]).includes(value)
  );
}

/**
 * Typed capability of one registered source: WHICH metric it can serve,
 * via WHICH methods, and in which direction the samples flow.
 */
export interface SourceCapability {
  readonly metricId: string;
  /** Non-empty list of opaque method codes this source can serve for the metric. */
  readonly methodIds: readonly string[];
  readonly direction: SourceDirection;
}

/**
 * A measurement source registered for a person (manual entry, a device, or
 * an app adapter). A structural SUPERSET of the Lane A engine's
 * `RegisteredMeasurementSource` (sourceId, personId, kind,
 * supportedMethodIds, active): the shared fields align by name and value,
 * and this record adds the per-metric capability declarations (with
 * direction) plus the declared unit conversions — the engine's capability
 * index can consume the shared fields directly at integration (handoff
 * recorded).
 */
export interface RegisteredMeasurementSource {
  /** Canonical `SourceId` (domain grammar, `src_` prefix). */
  readonly sourceId: SourceId;
  readonly personId: PersonId;
  readonly kind: MeasurementSourceKind;
  /** Non-empty capability list, at most one capability per metric. */
  readonly capabilities: readonly SourceCapability[];
  /**
   * Unit conversions declared per source — the SOURCE OF TRUTH for
   * normalizing this source's native units into canonical metric units.
   * Manual sources declare an empty list (entry is in canonical units).
   */
  readonly unitConversions: readonly UnitConversionSpec[];
  /** Inactive sources are excluded from resolution (deny-by-default). */
  readonly active: boolean;
}

/** Typed registration rejections (PHID-safe, values never echoed). */
export type SourceRegistrationError =
  | { readonly kind: "invalid-source" }
  | { readonly kind: "invalid-capability" }
  | { readonly kind: "invalid-conversion" }
  | { readonly kind: "person-mismatch" };

/** Typed resolution deny reasons — the "WHY" a fetch path is denied. */
export type SourceResolutionDenyReason =
  | { readonly kind: "no-registered-source" }
  | { readonly kind: "no-active-source" }
  | { readonly kind: "metric-unsupported" };

/** One resolved capability: the source serving the metric, and how. */
export interface ResolvedSourceCapability {
  readonly source: RegisteredMeasurementSource;
  readonly capability: SourceCapability;
}

/** The measurement-source registry port (in-memory reference below). */
export interface MeasurementSourceRegistry {
  /**
   * Registers (or re-registers with changed capabilities/conversions/
   * active) a source for a person. Re-registration must keep the same
   * personId — moving a source between people is a typed rejection.
   */
  register(
    source: RegisteredMeasurementSource,
  ): HealthResult<RegisteredMeasurementSource, SourceRegistrationError>;
  /** Looks up a registered source by id. */
  find(sourceId: SourceId): RegisteredMeasurementSource | undefined;
  /** All sources registered for a person, in registration order. */
  listForPerson(personId: PersonId): readonly RegisteredMeasurementSource[];
  /**
   * Resolves the sources that can serve a person + metric.
   * Deny-by-default: never throws; every denial is a typed reason.
   */
  resolve(input: {
    readonly personId: PersonId;
    readonly metricId: string;
  }): HealthResult<readonly ResolvedSourceCapability[], SourceResolutionDenyReason>;
}

function isValidCapability(value: unknown): value is SourceCapability {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof SourceCapability, unknown>>;
  if (typeof candidate.metricId !== "string" || candidate.metricId.length === 0) {
    return false;
  }
  if (
    !Array.isArray(candidate.methodIds) ||
    candidate.methodIds.length === 0 ||
    candidate.methodIds.some((methodId) => typeof methodId !== "string" || methodId.length === 0)
  ) {
    return false;
  }
  return isSourceDirection(candidate.direction);
}

/** In-memory reference {@link MeasurementSourceRegistry}. */
export class InMemoryMeasurementSourceRegistry implements MeasurementSourceRegistry {
  readonly #sources = new Map<string, RegisteredMeasurementSource>();
  readonly #owners = new Map<string, PersonId>();
  readonly #order: string[] = [];

  register(
    source: RegisteredMeasurementSource,
  ): HealthResult<RegisteredMeasurementSource, SourceRegistrationError> {
    if (
      typeof source !== "object" ||
      source === null ||
      !isIdOf("source", source.sourceId) ||
      !isIdOf("person", source.personId) ||
      !isMeasurementSourceKind(source.kind) ||
      typeof source.active !== "boolean" ||
      !Array.isArray(source.capabilities) ||
      source.capabilities.length === 0 ||
      !Array.isArray(source.unitConversions)
    ) {
      return err({ kind: "invalid-source" });
    }
    const metricIds = new Set<string>();
    for (const capability of source.capabilities) {
      if (!isValidCapability(capability)) {
        return err({ kind: "invalid-capability" });
      }
      if (metricIds.has(capability.metricId)) {
        return err({ kind: "invalid-capability" });
      }
      metricIds.add(capability.metricId);
    }
    const conversionKeys = new Set<string>();
    for (const spec of source.unitConversions) {
      const specOk =
        typeof spec === "object" &&
        spec !== null &&
        typeof spec.metricId === "string" &&
        spec.metricId.length > 0 &&
        typeof spec.fromUnit === "string" &&
        spec.fromUnit.length > 0 &&
        typeof spec.toUnit === "string" &&
        spec.toUnit.length > 0 &&
        typeof spec.factor === "number" &&
        Number.isFinite(spec.factor) &&
        spec.factor > 0;
      if (!specOk) {
        return err({ kind: "invalid-conversion" });
      }
      const key = `${spec.metricId}\u0000${spec.fromUnit}`;
      if (conversionKeys.has(key)) {
        return err({ kind: "invalid-conversion" });
      }
      conversionKeys.add(key);
    }
    const existingOwner = this.#owners.get(source.sourceId);
    if (existingOwner !== undefined && existingOwner !== source.personId) {
      return err({ kind: "person-mismatch" });
    }
    if (!this.#sources.has(source.sourceId)) {
      this.#order.push(source.sourceId);
    }
    this.#sources.set(source.sourceId, source);
    this.#owners.set(source.sourceId, source.personId);
    return ok(source);
  }

  find(sourceId: SourceId): RegisteredMeasurementSource | undefined {
    return this.#sources.get(sourceId);
  }

  listForPerson(personId: PersonId): readonly RegisteredMeasurementSource[] {
    const owned: RegisteredMeasurementSource[] = [];
    for (const sourceId of this.#order) {
      const source = this.#sources.get(sourceId);
      if (source !== undefined && source.personId === personId) {
        owned.push(source);
      }
    }
    return owned;
  }

  resolve(input: {
    readonly personId: PersonId;
    readonly metricId: string;
  }): HealthResult<readonly ResolvedSourceCapability[], SourceResolutionDenyReason> {
    const owned = this.listForPerson(input.personId);
    if (owned.length === 0) {
      return err({ kind: "no-registered-source" });
    }
    const active = owned.filter((source) => source.active);
    if (active.length === 0) {
      return err({ kind: "no-active-source" });
    }
    const resolved: ResolvedSourceCapability[] = [];
    for (const source of active) {
      for (const capability of source.capabilities) {
        if (capability.metricId === input.metricId) {
          resolved.push({ source, capability });
        }
      }
    }
    if (resolved.length === 0) {
      return err({ kind: "metric-unsupported" });
    }
    return ok(resolved);
  }
}

// ---------------------------------------------------------------------------
// DeviceSourceAdapter — the sample fetch contract (A32).
// ---------------------------------------------------------------------------

/** Half-open measurement window [startsAt, endsAt). */
export interface MeasurementWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** One sample fetch request: metric + window for a person via a source. */
export interface SampleFetchRequest {
  readonly personId: PersonId;
  readonly sourceId: SourceId;
  readonly metricId: string;
  readonly window: MeasurementWindow;
}

/**
 * One raw sample from a native health platform: the native timestamp, the
 * value in the source's DECLARED native unit, and the native source
 * metadata that provenance preserves (architecture rule: every raw
 * evidence object retains its source metadata).
 */
export interface RawDeviceSample {
  readonly metricId: string;
  /** Native timestamp (HealthKit startDate / Health Connect sample time). */
  readonly timestamp: Date;
  /** Value in the native unit declared by the source. */
  readonly value: number;
  /** Native unit string exactly as the platform reports it (e.g. "count/min"). */
  readonly unit: string;
  /** Native record identifier (HealthKit UUID / Health Connect recordId). */
  readonly nativeId: string;
  /** Opaque native source metadata (device name, bundle id, …). */
  readonly sourceMetadata: Readonly<Record<string, string>>;
}

/** Normalized authorization status across the platform surfaces. */
export const AUTHORIZATION_STATUSES = ["not-determined", "denied", "authorized"] as const;

export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

/**
 * Fetch result: the authorization-gate outcome plus the raw samples.
 * An UNAUTHORIZED fetch is a typed EMPTY result (`authorized: false`,
 * zero samples) — never a throw, never partial data (packet rule).
 */
export interface SampleFetchResult {
  readonly authorized: boolean;
  readonly samples: readonly RawDeviceSample[];
}

/** Typed fetch rejections (PHID-safe, values never echoed). */
export type SampleFetchError =
  | { readonly kind: "source-not-registered" }
  | { readonly kind: "source-inactive" }
  | { readonly kind: "metric-unsupported" }
  | { readonly kind: "capability-denied"; readonly reason: SourceResolutionDenyReason }
  | { readonly kind: "invalid-window" }
  | { readonly kind: "native-error" };

/**
 * The device-source adapter port: bridges a native health platform into
 * the measurement plane as a SOURCE. `fetchSamples` returns RAW samples;
 * `normalizeSamples` turns raw samples into domain-shaped observation
 * drafts by applying the source-declared unit conversions. Real native
 * bindings implement the platform `NativeModule` interfaces
 * (HealthKitNativeModule / HealthConnectNativeModule); this packet ships
 * TypeScript seams plus SYNTHETIC doubles (handoff recorded).
 */
export interface DeviceSourceAdapter {
  /** The registered source this adapter serves. */
  readonly sourceId: SourceId;
  /** Metric ids this adapter's native surface covers. */
  readonly supportedMetrics: readonly string[];
  /** Current authorization status for one metric's native type. */
  authorizationStatus(metricId: string): Promise<AuthorizationStatus>;
  /**
   * Explicit authorization request flow (UX-initiated — a fetch NEVER
   * auto-requests). Returns whether authorization was granted.
   */
  requestAuthorization(): Promise<boolean>;
  /**
   * Fetches raw samples for a metric within a window. Authorization-gated:
   * an unauthorized fetch resolves to a typed EMPTY result.
   */
  fetchSamples(
    request: SampleFetchRequest,
  ): Promise<HealthResult<SampleFetchResult, SampleFetchError>>;
  /** Normalizes raw samples into domain-shaped observation drafts. */
  normalizeSamples(input: NormalizeSamplesInput): HealthResult<readonly ObservationDraft[], NormalizationError>;
}

/** Input to normalization: the raw samples plus the person/source context. */
export interface NormalizeSamplesInput {
  readonly personId: PersonId;
  readonly sourceId: SourceId;
  readonly samples: readonly RawDeviceSample[];
}

/** Typed normalization rejections (PHID-safe, values never echoed). */
export type NormalizationError =
  | { readonly kind: "source-not-registered" }
  | { readonly kind: "metric-unsupported" }
  | { readonly kind: "invalid-sample" }
  | { readonly kind: "missing-conversion" };

// ---------------------------------------------------------------------------
// Observation drafts + provenance (packet: every normalized draft carries
// provenance — source id, method, native timestamp, unit conversion
// applied y/n).
// ---------------------------------------------------------------------------

/** Unit-conversion detail recorded on every draft's provenance. */
export interface UnitConversionProvenance {
  /** Was a non-identity conversion applied at normalization? */
  readonly applied: boolean;
  readonly fromUnit: string;
  readonly toUnit: string;
  readonly factor: number;
}

/** Provenance block carried by every observation draft. */
export interface DraftProvenance {
  readonly sourceId: SourceId;
  readonly methodId: string;
  /** Native timestamp of the raw sample the draft was normalized from. */
  readonly nativeTimestamp: Date;
  /** Native record id of the raw sample (evidence chain anchor). */
  readonly nativeSampleId: string;
  /** Unit conversion applied y/n, with the full declared detail. */
  readonly unitConversion: UnitConversionProvenance;
  /** Source metadata retained from the raw sample (never discarded). */
  readonly sourceMetadata: Readonly<Record<string, string>>;
}

/**
 * A domain-shaped observation DRAFT: every field of the domain
 * `Observation` except the canonical ids (minted at materialization) and
 * the terminal validation state (drafts enter life `pending`). The engine
 * owns execution of validation/reconciliation; this seam produces the
 * drafts and models the validation CALLER (handoff recorded).
 */
export interface ObservationDraft {
  readonly personId: PersonId;
  readonly sourceId: SourceId;
  readonly metricId: string;
  readonly conceptCode: string;
  readonly value: number;
  /** Canonical unit (post-conversion). */
  readonly unit: string;
  /** Clinically relevant time — when the value applies. */
  readonly effectiveAt: Date;
  /** Time the draft was produced (normalization / capture time). */
  readonly observedAt: Date;
  readonly methodId: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly quality?: QualityScore;
  readonly validationState: "pending";
  readonly provenance: DraftProvenance;
}

// ---------------------------------------------------------------------------
// Materialization: draft -> domain Observation + domain Provenance.
// ---------------------------------------------------------------------------

/**
 * Minimal id-source port (structural: `@orbb/testkit`'s
 * `DeterministicIdFactory` satisfies it directly). Emits canonical
 * `<prefix>_<body>` ids for the minted observation/provenance records.
 */
export interface DraftIdSource {
  next(prefix: string): string;
}

/** Dependencies for materializing a draft into domain records. */
export interface MaterializeDraftDeps {
  readonly ids: DraftIdSource;
  readonly nowMs: () => number;
  /** Correlation token threaded onto the domain provenance record. */
  readonly correlationId?: string;
}

/** A materialized draft: the domain pair plus the retained draft (nothing discarded). */
export interface MaterializedObservation {
  readonly observation: Observation;
  readonly provenance: Provenance;
  /** The originating draft, retained so raw source metadata is never lost. */
  readonly draft: ObservationDraft;
}

/**
 * Pure materialization: mints the canonical observation id and provenance
 * id from the injected id source and produces the domain `Observation`
 * (validation state `pending` — the legal entry state of the domain
 * validation state machine) plus its linked domain `Provenance` record
 * (actor = the acquiring source; subject = the person; occurredAt = the
 * native timestamp; provenanceId links the pair).
 */
export function materializeDraft(
  draft: ObservationDraft,
  deps: MaterializeDraftDeps,
): MaterializedObservation {
  const observationId = deps.ids.next("obs") as ObservationId;
  const provenanceId = deps.ids.next("prov") as ProvenanceId;
  const observedAt = new Date(deps.nowMs());
  const observation: Observation = {
    id: observationId,
    personId: draft.personId,
    conceptCode: draft.conceptCode,
    value: draft.value,
    unit: draft.unit,
    effectiveAt: draft.effectiveAt,
    observedAt,
    sourceId: draft.sourceId,
    methodId: draft.methodId,
    ...(draft.quality !== undefined ? { quality: draft.quality } : {}),
    validationState: "pending",
    provenanceId,
    evidenceLabel: draft.evidenceLabel,
  };
  const provenance: Provenance = {
    provenanceId,
    actor: draft.sourceId,
    subject: draft.personId,
    occurredAt: draft.provenance.nativeTimestamp,
    ...(deps.correlationId !== undefined ? { correlationId: deps.correlationId } : {}),
  };
  return { observation, provenance, draft };
}

// ---------------------------------------------------------------------------
// The validation CALLER (packet: drafts feed the domain observation
// validation states pending -> validated|rejected; the engine owns
// execution — this models the caller that submits drafts to the domain
// validation state machine).
// ---------------------------------------------------------------------------

/** Typed rejection reasons of the reference draft validator. */
export type DraftRejectionReason =
  | { readonly kind: "invalid-value" }
  | { readonly kind: "invalid-quality" }
  | { readonly kind: "invalid-timestamps" }
  | { readonly kind: "invalid-identifiers" };

/** A validator verdict for one draft. */
export type DraftValidationVerdict =
  | { readonly kind: "validated" }
  | { readonly kind: "rejected"; readonly reason: DraftRejectionReason };

/**
 * The draft-validator port. The ENGINE owns execution policy (quality
 * gates, metric conformance, duplicate suppression, …); this interface is
 * the seam it implements (handoff recorded).
 */
export interface ObservationDraftValidator {
  decide(draft: ObservationDraft): DraftValidationVerdict;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Reference validator: structural well-formedness only (finite value,
 * legal quality, valid timestamps, canonical ids, non-empty vocabulary
 * strings). Deliberately does NOT encode clinical/quality policy — that
 * is the engine's execution concern.
 */
export class StructuralDraftValidator implements ObservationDraftValidator {
  decide(draft: ObservationDraft): DraftValidationVerdict {
    if (
      !isIdOf("person", draft.personId) ||
      !isIdOf("source", draft.sourceId) ||
      typeof draft.conceptCode !== "string" ||
      draft.conceptCode.length === 0 ||
      typeof draft.methodId !== "string" ||
      draft.methodId.length === 0 ||
      typeof draft.metricId !== "string" ||
      draft.metricId.length === 0
    ) {
      return { kind: "rejected", reason: { kind: "invalid-identifiers" } };
    }
    if (typeof draft.value !== "number" || !Number.isFinite(draft.value)) {
      return { kind: "rejected", reason: { kind: "invalid-value" } };
    }
    if (draft.quality !== undefined && !isQualityScore(draft.quality)) {
      return { kind: "rejected", reason: { kind: "invalid-quality" } };
    }
    if (
      !isTimestamp(draft.effectiveAt) ||
      !isTimestamp(draft.observedAt) ||
      !isTimestamp(draft.provenance.nativeTimestamp)
    ) {
      return { kind: "rejected", reason: { kind: "invalid-timestamps" } };
    }
    return { kind: "validated" };
  }
}

/** The outcome of applying a validation verdict to a materialized draft. */
export type DraftValidationOutcome =
  | { readonly kind: "validated"; readonly observation: Observation; readonly provenance: Provenance }
  | {
      readonly kind: "rejected";
      readonly observation: Observation;
      readonly provenance: Provenance;
      readonly reason: DraftRejectionReason;
    };

/**
 * Applies a validator verdict to a materialized (pending) observation via
 * the FROZEN domain validation state machine (`pending -> validated |
 * rejected` is asserted with the domain transition guard; illegal
 * transitions would throw `DomainInvariantError` — a programming
 * invariant, since drafts enter life pending).
 */
export function applyDraftValidation(
  materialized: MaterializedObservation,
  verdict: DraftValidationVerdict,
): DraftValidationOutcome {
  const target: ObservationValidationState = verdict.kind === "validated" ? "validated" : "rejected";
  assertObservationValidationTransition(
    materialized.observation.validationState,
    target,
  );
  const observation: Observation = { ...materialized.observation, validationState: target };
  if (verdict.kind === "validated") {
    return { kind: "validated", observation, provenance: materialized.provenance };
  }
  return {
    kind: "rejected",
    observation,
    provenance: materialized.provenance,
    reason: verdict.reason,
  };
}

// ---------------------------------------------------------------------------
// Shared normalization core used by the platform adapters.
// ---------------------------------------------------------------------------

/**
 * Normalizes raw samples into drafts for a REGISTERED source: resolves the
 * declared conversion for each sample's (metricId, native unit) and
 * applies it. All-or-nothing: any sample that cannot be normalized
 * rejects the batch with a typed error — the raw samples stay with the
 * caller, so nothing is ever silently discarded.
 *
 * `methodId`/`evidenceLabel`/`conceptCode`/`quality` come from the
 * adapter's metric binding for each sample's metric (the binding is the
 * adapter's typed declaration of its native metric surface).
 */
export function normalizeSamplesForBinding(
  input: NormalizeSamplesInput,
  registry: MeasurementSourceRegistry,
  bindingFor: (metricId: string) =>
    | {
        readonly metricId: string;
        readonly conceptCode: string;
        readonly methodId: string;
        readonly evidenceLabel: EvidenceLabel;
        readonly quality?: QualityScore;
      }
    | undefined,
  nowMs: () => number,
): HealthResult<readonly ObservationDraft[], NormalizationError> {
  const source = registry.find(input.sourceId);
  if (source === undefined) {
    return err({ kind: "source-not-registered" });
  }
  const table = conversionTableFor(source.unitConversions);
  const drafts: ObservationDraft[] = [];
  for (const sample of input.samples) {
    const binding = bindingFor(sample.metricId);
    if (binding === undefined) {
      return err({ kind: "metric-unsupported" });
    }
    if (
      typeof sample.value !== "number" ||
      !Number.isFinite(sample.value) ||
      !isTimestamp(sample.timestamp) ||
      typeof sample.nativeId !== "string" ||
      sample.nativeId.length === 0 ||
      typeof sample.unit !== "string" ||
      sample.unit.length === 0
    ) {
      return err({ kind: "invalid-sample" });
    }
    const spec = table.resolve(sample.metricId, sample.unit);
    if (spec === undefined) {
      return err({ kind: "missing-conversion" });
    }
    const normalized = applyUnitConversion(sample.value, spec);
    drafts.push({
      personId: input.personId,
      sourceId: input.sourceId,
      metricId: sample.metricId,
      conceptCode: binding.conceptCode,
      value: normalized.value,
      unit: normalized.unit,
      effectiveAt: sample.timestamp,
      observedAt: new Date(nowMs()),
      methodId: binding.methodId,
      evidenceLabel: binding.evidenceLabel,
      ...(binding.quality !== undefined ? { quality: binding.quality } : {}),
      validationState: "pending",
      provenance: {
        sourceId: input.sourceId,
        methodId: binding.methodId,
        nativeTimestamp: sample.timestamp,
        nativeSampleId: sample.nativeId,
        unitConversion: normalized.conversion,
        sourceMetadata: sample.sourceMetadata,
      },
    });
  }
  return ok(drafts);
}
