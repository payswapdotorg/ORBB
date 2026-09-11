/**
 * A28 — MeasurementMethod registry: the engine-side registry of domain
 * `MeasurementMethod` records.
 *
 * Recorded design decisions:
 *   - Append-only: a method id registers exactly once; re-registering a
 *     known id is a typed rejection (methods have no supersession
 *     lifecycle in the frozen domain — metric definitions do, method
 *     revisions are a future domain concern; handoff recorded).
 *   - A method may only bind to a metric that exists in the injected
 *     catalog (deny-by-default: the registry refuses orphan bindings, so
 *     `assertMethodForMetric` can never encounter an unknown metric).
 *   - `listForMetric` returns methods ordered least-burden-first via the
 *     domain comparator semantics (ascending `relativeBurden`), with the
 *     method id as the deterministic tiebreak — the same order the
 *     architecture prescribes for suggestion UX.
 *   - Sync interface (registry-shaped, in-memory reference
 *     implementation); async adaptation for the db boundary is a recorded
 *     handoff (same as `MetricCatalog`).
 */
import type { MeasurementMethod } from "@orbb/domain";
import { assertMeasurementMethod } from "@orbb/domain";
import { DomainInvariantError } from "@orbb/domain";
import { err, ok, type EngineResult } from "./result.js";
import type { MetricCatalog } from "./catalog.js";

/** Typed registration rejections (PHID-safe, values never echoed). */
export type MethodRegistrationError =
  | { readonly kind: "invalid-method" }
  | { readonly kind: "unknown-metric" }
  | { readonly kind: "duplicate-method" };

/** Successful registration outcome: the stored domain method record. */
export type MethodRegistrationOutcome = MeasurementMethod;

/** The measurement-method registry port consumed by the engine services. */
export interface MeasurementMethodRegistry {
  /** Registers one domain `MeasurementMethod` for its bound metric. */
  register(method: MeasurementMethod): EngineResult<MethodRegistrationOutcome, MethodRegistrationError>;
  /** Looks up a method by its opaque id. */
  find(methodId: string): MeasurementMethod | undefined;
  /**
   * All registered methods bound to the metric, ordered by ascending
   * burden rank (domain least-burden-first), method id as tiebreak.
   */
  listForMetric(metricId: string): readonly MeasurementMethod[];
}

/** In-memory reference `MeasurementMethodRegistry`. */
export class InMemoryMeasurementMethodRegistry implements MeasurementMethodRegistry {
  readonly #methods = new Map<string, MeasurementMethod>();
  readonly #catalog: MetricCatalog;

  constructor(catalog: MetricCatalog) {
    this.#catalog = catalog;
  }

  register(
    method: MeasurementMethod,
  ): EngineResult<MethodRegistrationOutcome, MethodRegistrationError> {
    try {
      assertMeasurementMethod(method);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "invalid-method" });
      }
      throw error;
    }
    if (this.#methods.has(method.id)) {
      return err({ kind: "duplicate-method" });
    }
    if (this.#catalog.resolveActive(method.metricId) === undefined) {
      return err({ kind: "unknown-metric" });
    }
    this.#methods.set(method.id, method);
    return ok(method);
  }

  find(methodId: string): MeasurementMethod | undefined {
    return this.#methods.get(methodId);
  }

  listForMetric(metricId: string): readonly MeasurementMethod[] {
    const bound: MeasurementMethod[] = [];
    for (const method of this.#methods.values()) {
      if (method.metricId === metricId) {
        bound.push(method);
      }
    }
    bound.sort((a, b) => a.relativeBurden - b.relativeBurden || (a.id < b.id ? -1 : 1));
    return bound;
  }
}
