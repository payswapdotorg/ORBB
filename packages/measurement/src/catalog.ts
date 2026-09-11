/**
 * A27 — Metric catalog: the registry of `MetricDefinition`s the
 * measurement engine can compile plans against and validate observations
 * with.
 *
 * Recorded design decisions (architecture §5 Measurement family, frozen):
 *   - Metric ids are stable, opaque concept-code strings owned by this
 *     lane (`@orbb/domain` deliberately keeps them unbranded strings).
 *     The catalog adds the version dimension the domain value object does
 *     not carry: definitions evolve, and evolution is supersession-shaped.
 *   - Versioned supersession MIRRORS the frozen domain supersession
 *     semantics (observation.ts): a replacement version enters life
 *     active; the version it supersedes moves to the terminal
 *     `superseded` state and is NEVER mutated or discarded — it stays
 *     resolvable for provenance and audit; only the ACTIVE version of a
 *     metric may be superseded (the domain rule "only a validated
 *     observation can be superseded" restated for catalog versions);
 *     re-superseding a superseded version or resurrecting one is illegal.
 *   - The supersession pair result mirrors the domain `SupersededPair`
 *     shape (`{ superseded, replacement }`), adapted to catalog version
 *     records.
 *   - "Lookup by domain" is interpreted as lookup by the metric's
 *     `category` grouping label (e.g. "vital-signs") — the domain's
 *     grouping field. The unit domain (`unitDomain`) is the closed set of
 *     legal units and is enforced by the domain guards, not an index key.
 *   - The catalog interface is synchronous: it is a registry of
 *     configuration-shaped data with an in-memory reference
 *     implementation. The db-backed adapter (later integration packet)
 *     will wrap it — handoff recorded: an async/cacheable variant may be
 *     needed at the persistence boundary.
 *   - All rejections are typed results (never throws for expected
 *     failures); the frozen domain guard `assertMetricDefinition` is
 *     invoked on every registration and its `DomainInvariantError` is
 *     converted to a typed rejection at this boundary.
 */
import type { MetricDefinition } from "@orbb/domain";
import { assertMetricDefinition } from "@orbb/domain";
import { DomainInvariantError } from "@orbb/domain";
import type { Clock } from "@orbb/testkit";
import { err, ok, type EngineResult } from "./result.js";

/**
 * Lifecycle state of a metric version. `active` is the resolvable current
 * version; `superseded` is terminal (mirrors the domain observation
 * validation state vocabulary).
 */
export const METRIC_VERSION_STATES = ["active", "superseded"] as const;

export type MetricVersionState = (typeof METRIC_VERSION_STATES)[number];

/** One version of a metric definition inside the catalog. */
export interface MetricVersionRecord {
  /** Stable opaque metric id (identical across versions of one metric). */
  readonly metricId: string;
  /** 1-based version number, monotonically increasing per metric. */
  readonly version: number;
  /** The domain `MetricDefinition` value for this version. */
  readonly definition: MetricDefinition;
  readonly state: MetricVersionState;
  /**
   * Version this version supersedes. Present exactly on replacement
   * versions (mirrors the domain `supersedesId` semantics).
   */
  readonly supersedesVersion?: number;
  /** When this version was superseded (present iff state is superseded). */
  readonly supersededAt?: Date;
}

/**
 * Result of a legal version supersession, mirroring the domain
 * `SupersededPair` shape: the superseded version record (now terminal)
 * and the replacement version record (now active).
 */
export interface SupersededMetricVersionPair {
  readonly superseded: MetricVersionRecord;
  readonly replacement: MetricVersionRecord;
}

/** Registration input: a domain definition plus optional supersession. */
export interface RegisterMetricInput {
  readonly definition: MetricDefinition;
  /**
   * Version to supersede. REQUIRED when the metric already exists (the
   * chain only grows via explicit supersession, like the domain); must be
   * absent for a brand-new metric id.
   */
  readonly supersedes?: number;
}

/** Successful registration outcome. */
export interface MetricRegistrationOutcome {
  /** The record as registered (version 1 or a replacement). */
  readonly record: MetricVersionRecord;
  /** Present iff this registration superseded a prior active version. */
  readonly pair?: SupersededMetricVersionPair;
}

/**
 * Typed registration rejections (PHID-safe: structural context only,
 * received values are never echoed).
 */
export type MetricRegistrationError =
  | { readonly kind: "invalid-definition" }
  | { readonly kind: "version-conflict" }
  | { readonly kind: "unknown-supersede-target" }
  | { readonly kind: "target-not-active" }
  | { readonly kind: "supersede-required" };

/** The metric catalog port consumed by the engine services. */
export interface MetricCatalog {
  /**
   * Registers a definition. Fresh metric id => version 1 (active).
   * Existing metric id => explicit supersession of the current ACTIVE
   * version, installing the next version as active and moving the target
   * to the terminal superseded state.
   */
  register(input: RegisterMetricInput): EngineResult<MetricRegistrationOutcome, MetricRegistrationError>;
  /** Resolves the ACTIVE version's definition, or undefined for unknown ids. */
  resolveActive(metricId: string): MetricDefinition | undefined;
  /** Resolves one exact version record (superseded versions stay resolvable). */
  resolveVersion(metricId: string, version: number): MetricVersionRecord | undefined;
  /** All active definitions, in registration order. */
  listActive(): readonly MetricDefinition[];
  /** Active definitions of one category ("domain") grouping, in registration order. */
  listActiveByCategory(category: string): readonly MetricDefinition[];
}

/**
 * In-memory reference `MetricCatalog`. Deterministic: lookups and
 * listings are pure functions of the registration sequence; `supersededAt`
 * is stamped from the injected clock so version history is reproducible
 * under the testkit `DeterministicClock`.
 */
export class InMemoryMetricCatalog implements MetricCatalog {
  readonly #versions = new Map<string, MetricVersionRecord[]>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  register(
    input: RegisterMetricInput,
  ): EngineResult<MetricRegistrationOutcome, MetricRegistrationError> {
    try {
      assertMetricDefinition(input.definition);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "invalid-definition" });
      }
      throw error;
    }
    const definition = input.definition;
    const metricId = definition.id;
    const chain = this.#versions.get(metricId);
    const now = this.#clock.now();

    if (chain === undefined || chain.length === 0) {
      if (input.supersedes !== undefined) {
        // Superseding a version of a metric the catalog has never seen.
        return err({ kind: "unknown-supersede-target" });
      }
      const record: MetricVersionRecord = { metricId, version: 1, definition, state: "active" };
      this.#versions.set(metricId, [record]);
      return ok({ record });
    }

    if (input.supersedes === undefined) {
      // Existing metric: the chain only grows via explicit supersession.
      return err({ kind: "supersede-required" });
    }

    const targetVersion = input.supersedes;
    const target =
      targetVersion >= 1 && targetVersion <= chain.length
        ? chain[targetVersion - 1]
        : undefined;
    if (target === undefined) {
      return err({ kind: "unknown-supersede-target" });
    }
    if (target.state !== "active") {
      // Domain mirror: only a validated observation can be superseded;
      // only the ACTIVE version of a metric can be superseded.
      return err({ kind: "target-not-active" });
    }

    const superseded: MetricVersionRecord = {
      ...target,
      state: "superseded",
      supersededAt: now,
    };
    const replacement: MetricVersionRecord = {
      metricId,
      version: chain.length + 1,
      definition,
      state: "active",
      supersedesVersion: targetVersion,
    };
    const nextChain: MetricVersionRecord[] = [...chain];
    nextChain[targetVersion - 1] = superseded;
    nextChain.push(replacement);
    this.#versions.set(metricId, nextChain);
    return ok({ record: replacement, pair: { superseded, replacement } });
  }

  resolveActive(metricId: string): MetricDefinition | undefined {
    return this.#activeRecord(metricId)?.definition;
  }

  resolveVersion(metricId: string, version: number): MetricVersionRecord | undefined {
    const chain = this.#versions.get(metricId);
    if (chain === undefined) {
      return undefined;
    }
    return version >= 1 && version <= chain.length ? chain[version - 1] : undefined;
  }

  listActive(): readonly MetricDefinition[] {
    const active: MetricDefinition[] = [];
    for (const metricId of this.#versions.keys()) {
      const record = this.#activeRecord(metricId);
      if (record !== undefined) {
        active.push(record.definition);
      }
    }
    return active;
  }

  listActiveByCategory(category: string): readonly MetricDefinition[] {
    return this.listActive().filter((definition) => definition.category === category);
  }

  #activeRecord(metricId: string): MetricVersionRecord | undefined {
    const chain = this.#versions.get(metricId);
    if (chain === undefined) {
      return undefined;
    }
    // The active version is always the latest registered replacement.
    const latest = chain[chain.length - 1];
    return latest !== undefined && latest.state === "active" ? latest : undefined;
  }
}
