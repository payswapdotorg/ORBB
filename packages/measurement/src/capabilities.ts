/**
 * A28 — CapabilityIndex: resolves, for a person + metric, the ordered set
 * of usable measurement methods given the measurement sources registered
 * for that person.
 *
 * DENY-BY-DEFAULT (the packet's hard rule): a method is usable only when
 *   (1) the metric exists in the catalog,
 *   (2) at least one method is registered for the metric, and
 *   (3) the person has an ACTIVE registered source that declares support
 *       for that method.
 * A person with no registered source resolves to NO methods, and the
 * typed result reports WHY (a stable `kind` per deny reason) — the
 * capture path branches on the reason; the engine NEVER throws for a
 * capability denial.
 *
 * Registered sources model the three source kinds named by the packet:
 * manual entry (the person typing a value), a device, an app.
 *
 * Recorded design decisions:
 *   - Source records are lane-local (the domain has no MeasurementSource
 *     aggregate yet): `{ sourceId, personId, kind, supportedMethodIds,
 *     active }`. The domain `MeasurementCapability` association
 *     (personId, methodId, active) is DERIVED per usable method so the
 *     engine consumes the frozen domain vocabulary directly.
 *   - Ordering: usable methods are ordered by ascending domain burden
 *     rank (least-burden-first suggestion order), method id as the
 *     deterministic tiebreak. When multiple sources support the same
 *     method, the FIRST registered active source is attributed
 *     deterministically.
 *   - Sync interface (registry-shaped, in-memory reference
 *     implementation); db adaptation is a recorded handoff.
 */
import type { MeasurementCapability, MeasurementMethod, PersonId, SourceId } from "@orbb/domain";
import { isIdOf } from "@orbb/domain";
import { err, ok, type EngineResult } from "./result.js";
import type { MeasurementMethodRegistry } from "./methods.js";
import type { MetricCatalog } from "./catalog.js";

/** The three source kinds a person can register (packet A28). */
export const MEASUREMENT_SOURCE_KINDS = ["manual", "device", "app"] as const;

export type MeasurementSourceKind = (typeof MEASUREMENT_SOURCE_KINDS)[number];

export function isMeasurementSourceKind(value: unknown): value is MeasurementSourceKind {
  return (
    typeof value === "string" &&
    (MEASUREMENT_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A measurement source registered for a person: manual entry, a device,
 * or an app. `supportedMethodIds` declares the opaque method codes this
 * source can serve.
 */
export interface RegisteredMeasurementSource {
  /** Canonical `SourceId` (domain grammar, `src_` prefix). */
  readonly sourceId: SourceId;
  readonly personId: PersonId;
  readonly kind: MeasurementSourceKind;
  /** Non-empty list of method ids this source can serve. */
  readonly supportedMethodIds: readonly string[];
  /** Inactive sources are excluded from resolution (deny-by-default). */
  readonly active: boolean;
}

/** One usable method for a person: the method, via which source, and the derived domain capability record. */
export interface ResolvedCapability {
  readonly method: MeasurementMethod;
  /** The registered source that makes this method usable. */
  readonly viaSource: RegisteredMeasurementSource;
  /** Domain `MeasurementCapability` association derived from the resolution (always active). */
  readonly capability: MeasurementCapability;
}

/**
 * Typed deny reasons — the "WHY" the capture path reports. Ordered from
 * most specific (metric unknown) to the general deny-by-default cases.
 */
export type CapabilityDenyReason =
  | { readonly kind: "metric-not-found" }
  | { readonly kind: "no-methods-for-metric" }
  | { readonly kind: "no-registered-source" }
  | { readonly kind: "no-capable-source" };

/** Resolution outcome: the ordered usable method set, or the typed deny reason. */
export type CapabilityResolution = EngineResult<readonly ResolvedCapability[], CapabilityDenyReason>;

/** Typed source-registration rejections (PHID-safe, values never echoed). */
export type SourceRegistrationError =
  | { readonly kind: "invalid-source" }
  | { readonly kind: "unknown-method" }
  | { readonly kind: "duplicate-source" };

/** The capability index port consumed by the engine services. */
export interface CapabilityIndex {
  /** Registers (or re-registers with changed `active`/support) a source for a person. */
  registerSource(source: RegisteredMeasurementSource): EngineResult<RegisteredMeasurementSource, SourceRegistrationError>;
  /** All sources registered for a person, in registration order. */
  listSources(personId: PersonId): readonly RegisteredMeasurementSource[];
  /**
   * Resolves the ordered usable methods for a person + metric.
   * Deny-by-default: never throws; every denial is a typed reason.
   */
  resolve(input: { personId: PersonId; metricId: string }): CapabilityResolution;
}

/** In-memory reference `CapabilityIndex`. */
export class InMemoryCapabilityIndex implements CapabilityIndex {
  readonly #sources = new Map<string, RegisteredMeasurementSource>();
  readonly #methods: MeasurementMethodRegistry;
  readonly #catalog: MetricCatalog;

  constructor(input: { methods: MeasurementMethodRegistry; catalog: MetricCatalog }) {
    this.#methods = input.methods;
    this.#catalog = input.catalog;
  }

  registerSource(
    source: RegisteredMeasurementSource,
  ): EngineResult<RegisteredMeasurementSource, SourceRegistrationError> {
    if (!isIdOf("source", source.sourceId)) {
      return err({ kind: "invalid-source" });
    }
    if (!isIdOf("person", source.personId)) {
      return err({ kind: "invalid-source" });
    }
    if (!isMeasurementSourceKind(source.kind)) {
      return err({ kind: "invalid-source" });
    }
    if (
      !Array.isArray(source.supportedMethodIds) ||
      source.supportedMethodIds.length === 0 ||
      source.supportedMethodIds.some((methodId) => typeof methodId !== "string" || methodId.length === 0)
    ) {
      return err({ kind: "invalid-source" });
    }
    for (const methodId of source.supportedMethodIds) {
      if (this.#methods.find(methodId) === undefined) {
        return err({ kind: "unknown-method" });
      }
    }
    this.#sources.set(source.sourceId, source);
    return ok(source);
  }

  listSources(personId: PersonId): readonly RegisteredMeasurementSource[] {
    const owned: RegisteredMeasurementSource[] = [];
    for (const source of this.#sources.values()) {
      if (source.personId === personId) {
        owned.push(source);
      }
    }
    return owned;
  }

  resolve(input: { personId: PersonId; metricId: string }): CapabilityResolution {
    const definition = this.#catalog.resolveActive(input.metricId);
    if (definition === undefined) {
      return err({ kind: "metric-not-found" });
    }
    const methods = this.#methods.listForMetric(input.metricId);
    if (methods.length === 0) {
      return err({ kind: "no-methods-for-metric" });
    }
    const activeSources = this.listSources(input.personId).filter((source) => source.active);
    if (activeSources.length === 0) {
      return err({ kind: "no-registered-source" });
    }
    const resolved: ResolvedCapability[] = [];
    for (const method of methods) {
      const viaSource = activeSources.find((source) =>
        source.supportedMethodIds.includes(method.id),
      );
      if (viaSource === undefined) {
        continue;
      }
      resolved.push({
        method,
        viaSource,
        capability: { personId: input.personId, methodId: method.id, active: true },
      });
    }
    if (resolved.length === 0) {
      return err({ kind: "no-capable-source" });
    }
    return ok(resolved);
  }
}
