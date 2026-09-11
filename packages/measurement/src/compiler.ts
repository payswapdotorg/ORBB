/**
 * A29 — Plan compiler: compiles an authored protocol definition (pure
 * data, `protocol.ts`) into a domain `MeasurementPlan` draft plus the
 * expanded `PlanMetric` records (the §5 concept the measurement lane
 * owns).
 *
 * Determinism and purity: compilation reads ONLY its inputs — the
 * protocol, the injected catalog/method registries, the injected clock,
 * and the injected id factory. No ambient state, no wall clock, no I/O,
 * no randomness. Same inputs + same factory/clock state => byte-identical
 * output.
 *
 * Validation (all typed rejections, never throws for expected authoring
 * errors): every metric selector resolves against the catalog's ACTIVE
 * versions; every method preference references a REGISTERED method that
 * is LEGAL for its metric (the domain `assertMethodForMetric` guard is
 * invoked); schedules satisfy the non-overlap and horizon constraints.
 *
 * Publication stays a DOMAIN state transition you invoke: the compiler
 * emits `draft` plans only; `applyPlanTransition` invokes the frozen
 * domain `assertPlanTransition` guard (draft -> published -> active ->
 * completed | cancelled). The compiler never bypasses or reimplements
 * the plan state machine.
 */
import type {
  IntentId,
  MeasurementPlan,
  MetricDefinition,
  PersonId,
  PlanId,
  PlanState,
} from "@orbb/domain";
import {
  ID_PREFIXES,
  assertMeasurementPlan,
  assertMethodForMetric,
  assertPlanTransition,
  DomainInvariantError,
  parseIntentId,
  parsePersonId,
} from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import { err, ok, type EngineResult } from "./result.js";
import type { MetricCatalog } from "./catalog.js";
import type { MeasurementMethodRegistry } from "./methods.js";
import { deriveDeterministicId, PLAN_METRIC_ID_PREFIX } from "./ids.js";
import type {
  MethodPreference,
  MissedWindowPolicy,
  ProtocolDefinition,
  ScheduleOverride,
  ScheduleRules,
} from "./protocol.js";

/** Domain-separation tag for plan-metric id derivation. */
const PLAN_METRIC_ID_DOMAIN = "orbb/measurement/plan-metric-id/v1";

/**
 * A `PlanMetric`: the compiled, fully-resolved commitment for ONE metric
 * inside ONE plan — its resolved schedule and its ordered method chain
 * (preferred first, fallback order after).
 */
export interface PlanMetric {
  /**
   * Deterministic lane-local id derived from (planId, metricId): stable
   * across replays of the same compiled plan (`pm_<digest>`).
   */
  readonly id: string;
  readonly planId: PlanId;
  /** Opaque metric id (catalog). */
  readonly metricId: string;
  /** Concept code of the metric's ACTIVE definition (joined for observation validation). */
  readonly conceptCode: string;
  /** Fully resolved schedule (defaults + selector override + anchor). */
  readonly schedule: ResolvedSchedule;
  /** Ordered method chain: preferred first, fallback order after. */
  readonly methodOrder: readonly string[];
}

/** The schedule of a `PlanMetric` after defaults and overrides are merged. */
export interface ResolvedSchedule {
  readonly anchorAt: Date;
  readonly intervalMs: number;
  readonly windowDurationMs: number;
  readonly horizonMs: number;
  readonly missedWindowPolicy: MissedWindowPolicy;
}

/** Compile input: identities + the authored protocol. */
export interface CompileProtocolInput {
  readonly personId: PersonId;
  readonly intentId: IntentId;
  readonly protocol: ProtocolDefinition;
}

/** Compile output: the draft plan + its expanded `PlanMetric` records. */
export interface CompiledPlan {
  /** Domain `MeasurementPlan` in the `draft` state (publication is a separate domain transition). */
  readonly plan: MeasurementPlan;
  readonly planMetrics: readonly PlanMetric[];
}

/**
 * Typed compile rejections. `selectorIndex` / `preferenceIndex` /
 * `methodPosition` carry structural position context only — received ids
 * and values are never echoed (PHID-safe).
 */
export type CompileProtocolError =
  | { readonly kind: "invalid-person-id" }
  | { readonly kind: "invalid-intent-id" }
  | { readonly kind: "invalid-protocol" }
  | { readonly kind: "no-metric-selectors" }
  | { readonly kind: "selector-without-target"; readonly selectorIndex: number }
  | { readonly kind: "ambiguous-selector"; readonly selectorIndex: number }
  | { readonly kind: "unknown-metric"; readonly selectorIndex: number }
  | { readonly kind: "empty-category"; readonly selectorIndex: number }
  | { readonly kind: "duplicate-metric"; readonly selectorIndex: number }
  | { readonly kind: "unknown-method"; readonly preferenceIndex: number; readonly methodPosition: number }
  | { readonly kind: "method-metric-mismatch"; readonly preferenceIndex: number }
  | { readonly kind: "duplicate-method-preference"; readonly preferenceIndex: number }
  | { readonly kind: "no-methods-for-metric"; readonly selectorIndex: number }
  | { readonly kind: "invalid-schedule"; readonly selectorIndex: number; readonly rule: InvalidScheduleRule }
  | { readonly kind: "invalid-plan" };

export type InvalidScheduleRule =
  | "non-positive-interval"
  | "non-positive-window"
  | "window-exceeds-interval"
  | "horizon-below-interval";

/** Local union produced by method-chain resolution (mapped into `CompileProtocolError`). */
type MethodOrderError =
  | { readonly kind: "no-methods-for-metric" }
  | { readonly kind: "unknown-method"; readonly preferenceIndex: number; readonly methodPosition: number }
  | { readonly kind: "method-metric-mismatch"; readonly preferenceIndex: number }
  | { readonly kind: "duplicate-method-preference"; readonly preferenceIndex: number };

/** Constructor deps for the compiler (all injectable; no ambient access). */
export interface PlanCompilerDeps {
  readonly catalog: MetricCatalog;
  readonly methods: MeasurementMethodRegistry;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

/**
 * Plan compiler — deterministic, pure, no I/O. Produces draft plans and
 * expanded `PlanMetric` records from authored protocol definitions.
 */
export class PlanCompiler {
  readonly #catalog: MetricCatalog;
  readonly #methods: MeasurementMethodRegistry;
  readonly #clock: Clock;
  readonly #ids: IdFactory;

  constructor(deps: PlanCompilerDeps) {
    this.#catalog = deps.catalog;
    this.#methods = deps.methods;
    this.#clock = deps.clock;
    this.#ids = deps.ids;
  }

  compile(input: CompileProtocolInput): EngineResult<CompiledPlan, CompileProtocolError> {
    try {
      parsePersonId(input.personId);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "invalid-person-id" });
      }
      throw error;
    }
    try {
      parseIntentId(input.intentId);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "invalid-intent-id" });
      }
      throw error;
    }
    const protocol = input.protocol;
    if (
      typeof protocol.protocolId !== "string" ||
      protocol.protocolId.length === 0 ||
      !Array.isArray(protocol.metricSelectors) ||
      protocol.metricSelectors.length === 0
    ) {
      return err({ kind: "invalid-protocol" });
    }

    // Phase 1 — expand selectors against the catalog's ACTIVE versions.
    const expanded: { metric: MetricDefinition; override: ScheduleOverride | undefined }[] = [];
    const seenMetricIds = new Set<string>();
    for (const [selectorIndex, selector] of protocol.metricSelectors.entries()) {
      const hasMetricId = selector.metricId !== undefined;
      const hasCategory = selector.category !== undefined;
      if (!hasMetricId && !hasCategory) {
        return err({ kind: "selector-without-target", selectorIndex });
      }
      if (hasMetricId && hasCategory) {
        return err({ kind: "ambiguous-selector", selectorIndex });
      }
      let selected: readonly MetricDefinition[];
      if (hasMetricId) {
        const definition = this.#catalog.resolveActive(selector.metricId);
        if (definition === undefined) {
          return err({ kind: "unknown-metric", selectorIndex });
        }
        selected = [definition];
      } else {
        selected = this.#catalog.listActiveByCategory(selector.category);
        if (selected.length === 0) {
          return err({ kind: "empty-category", selectorIndex });
        }
      }
      for (const metric of selected) {
        if (seenMetricIds.has(metric.id)) {
          return err({ kind: "duplicate-metric", selectorIndex });
        }
        seenMetricIds.add(metric.id);
        expanded.push({ metric, override: selector.schedule });
      }
    }

    // Phase 2 — validate and resolve schedules (per expanded metric).
    const schedules: ResolvedSchedule[] = [];
    for (const [selectorIndex, entry] of expanded.entries()) {
      const resolved = this.#resolveSchedule(protocol.defaultSchedule, entry.override);
      if (!resolved.ok) {
        return err({ kind: "invalid-schedule", selectorIndex, rule: resolved.error.rule });
      }
      schedules.push(resolved.value);
    }

    // Phase 3 — resolve method chains per metric.
    const preferences = protocol.methodPreferences ?? [];
    const methodOrders: (readonly string[])[] = [];
    for (const [selectorIndex, entry] of expanded.entries()) {
      const preferenceIndex = preferences.findIndex((p) => p.metricId === entry.metric.id);
      const preference =
        preferenceIndex >= 0 ? (preferences[preferenceIndex] as MethodPreference) : undefined;
      const chain = this.#resolveMethodOrder(entry.metric, preference, preferenceIndex);
      if (!chain.ok) {
        const error: CompileProtocolError =
          chain.error.kind === "no-methods-for-metric"
            ? { kind: "no-methods-for-metric", selectorIndex }
            : chain.error;
        return err(error);
      }
      methodOrders.push(chain.value);
    }

    // Phase 4 — build the domain plan draft + PlanMetric records.
    const planId = this.#ids.next(ID_PREFIXES.plan) as PlanId;
    const createdAt = this.#clock.now();
    const plan: MeasurementPlan = {
      id: planId,
      personId: input.personId,
      intentId: input.intentId,
      state: "draft",
      metrics: expanded.map((entry) => entry.metric.conceptCode),
      createdAt,
    };
    try {
      assertMeasurementPlan(plan);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "invalid-plan" });
      }
      throw error;
    }
    const planMetrics: PlanMetric[] = expanded.map((entry, index) => ({
      id: deriveDeterministicId(PLAN_METRIC_ID_PREFIX, PLAN_METRIC_ID_DOMAIN, [
        planId,
        entry.metric.id,
      ]),
      planId,
      metricId: entry.metric.id,
      conceptCode: entry.metric.conceptCode,
      schedule: schedules[index] as ResolvedSchedule,
      methodOrder: methodOrders[index] as readonly string[],
    }));
    return ok({ plan, planMetrics });
  }

  #resolveSchedule(
    defaults: ScheduleRules,
    override: ScheduleOverride | undefined,
  ): EngineResult<ResolvedSchedule, { rule: InvalidScheduleRule }> {
    const intervalMs = override?.intervalMs ?? defaults.intervalMs;
    const windowDurationMs = override?.windowDurationMs ?? defaults.windowDurationMs;
    const horizonMs = override?.horizonMs ?? defaults.horizonMs;
    const missedWindowPolicy = override?.missedWindowPolicy ?? defaults.missedWindowPolicy;
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      return err({ rule: "non-positive-interval" });
    }
    if (!Number.isInteger(windowDurationMs) || windowDurationMs < 1) {
      return err({ rule: "non-positive-window" });
    }
    if (windowDurationMs > intervalMs) {
      return err({ rule: "window-exceeds-interval" });
    }
    if (!Number.isInteger(horizonMs) || horizonMs < intervalMs) {
      return err({ rule: "horizon-below-interval" });
    }
    return ok({
      anchorAt: defaults.anchorAt ?? this.#clock.now(),
      intervalMs,
      windowDurationMs,
      horizonMs,
      missedWindowPolicy,
    });
  }

  #resolveMethodOrder(
    metric: MetricDefinition,
    preference: MethodPreference | undefined,
    preferenceIndex: number,
  ): EngineResult<readonly string[], MethodOrderError> {
    if (preference === undefined) {
      const registered = this.#methods.listForMetric(metric.id);
      if (registered.length === 0) {
        return err({ kind: "no-methods-for-metric" });
      }
      return ok(registered.map((method) => method.id));
    }
    if (!Array.isArray(preference.orderedMethodIds) || preference.orderedMethodIds.length === 0) {
      return err({ kind: "duplicate-method-preference", preferenceIndex });
    }
    const seen = new Set<string>();
    for (const [methodPosition, methodId] of preference.orderedMethodIds.entries()) {
      if (seen.has(methodId)) {
        return err({ kind: "duplicate-method-preference", preferenceIndex });
      }
      seen.add(methodId);
      const method = this.#methods.find(methodId);
      if (method === undefined) {
        return err({ kind: "unknown-method", preferenceIndex, methodPosition });
      }
      try {
        assertMethodForMetric(method, metric);
      } catch (error) {
        if (error instanceof DomainInvariantError) {
          return err({ kind: "method-metric-mismatch", preferenceIndex });
        }
        throw error;
      }
    }
    return ok([...preference.orderedMethodIds]);
  }
}

/**
 * Invokes the frozen domain plan state machine: returns the plan with the
 * new state, or lets the domain `DomainInvariantError` propagate (illegal
 * transitions are programmer/authoring mistakes, not typed engine
 * rejections — the domain guard is the authority).
 * `draft -> published -> active -> completed | cancelled`.
 */
export function applyPlanTransition(plan: MeasurementPlan, to: PlanState): MeasurementPlan {
  assertPlanTransition(plan.state, to);
  return { ...plan, state: to };
}
