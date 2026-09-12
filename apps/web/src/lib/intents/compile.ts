/**
 * Deterministic intent-plan compilation mirror (M6-A, Lane B): the pure
 * pipeline behind the `/api/intents` stub and the plan review screen.
 *
 * It mirrors the M5 engine's stage order over the LOCAL view-model shapes
 * (NO @orbb/intents import — the recorded handoff lives in the report):
 *
 *   1. COMPILE (A38 mirror): for the goal metric, emit one DRAFT candidate
 *      per usable method — usable = registered in the local method index
 *      AND claimed by at least one pack entry AND not excluded by the
 *      method-preference constraint — ordered least-burden first (the
 *      frozen domain comparator semantics: ascending relativeBurden with
 *      id tiebreak). Each candidate carries the full A38 explainability
 *      audit trail (contributing pack entries, coverage windows, counts,
 *      actor classes, pack identity, method burden + evidence label).
 *      Goal metrics without pack coverage are reported in the gated audit
 *      with typed reasons (no-pack-coverage | no-usable-method |
 *      all-methods-excluded).
 *
 *   2. MATCH (A40 mirror): an EXECUTABLE candidate needs every plan metric
 *      bound to a usable method WITH an active registered source AND pack
 *      coverage. The manual source is the only registered source, so
 *      device/app seam candidates are dropped with the typed reason
 *      `no-source` (the M4-C seam is display-only). Drops are returned as
 *      the audit surface the review screen renders — never silently lost.
 *
 *   3. SAFETY (A41 mirror): the frozen DEFAULT rule-table values (max
 *      12 measurements/day; per-domain cadence floor/ceiling for the four
 *      seeded categories) evaluated as pure data. Cadence below a domain
 *      floor -> ESCALATE with the reason code (human review may accept
 *      it); cadence above a ceiling or total above the day guard ->
 *      REJECT. The PASS/ESCALATE literals are preserved: only PASS is
 *      publishable; ESCALATE requires human review.
 *
 *   4. BURDEN (A39 mirror): the burden summary projection — kind weights
 *      ordered manual(3) > app(2) > device(1), cadence cost multiplying
 *      the per-day units.
 *
 * DETERMINISM: every function is pure over its inputs (goal, constraints,
 * pack, catalog, injected `now`); identical inputs produce byte-identical
 * outputs. Candidate plan ids are content-derived slugs over the semantic
 * identity (metric + method + cadence), mirroring the A38 replay-stable
 * id discipline; store-level record ids (intent/entry/audit) stay
 * creation-scoped counters (the M5-C discipline).
 */

import {
  INTENT_MAX_MEASUREMENTS_PER_DAY,
  INTENT_METHOD_KIND_WEIGHTS,
  domainCadenceBounds,
  findGoalMetricOption,
  findIntentMethodOption,
  intentDirectionVerb,
  methodsForMetric,
} from "./catalog";
import { buildSyntheticEvidencePack } from "./pack";
import type {
  IntentBurdenSummaryView,
  IntentConstraintsView,
  IntentDroppedCandidateView,
  IntentEvidencePackView,
  IntentFiredRuleView,
  IntentGoalView,
  IntentPlanCandidateView,
  IntentSafetyOutcomeView,
} from "./types";
import { SYNTHETIC_PERSON_ID } from "../capture/catalog";

// ---------------------------------------------------------------------------
// Compilation output.
// ---------------------------------------------------------------------------

/** A goal metric that produced no candidates, with the typed reason. */
export interface IntentGatedMetricView {
  readonly metricId: string;
  readonly reason: "no-pack-coverage" | "no-usable-method" | "all-methods-excluded";
  readonly packEntryCount: number;
}

/** The full compilation output (the review entry's payload). */
export interface IntentCompilationView {
  /** Burden-ordered executable candidates (least burden first). */
  readonly executable: readonly IntentPlanCandidateView[];
  /** Candidates dropped by the matcher (audit). */
  readonly dropped: readonly IntentDroppedCandidateView[];
  /** Goal metrics gated out of expansion (audit). */
  readonly gated: readonly IntentGatedMetricView[];
  /** The pack compiled against. */
  readonly pack: IntentEvidencePackView;
}

// ---------------------------------------------------------------------------
// Objective statement composition (domain HealthIntent.objective is free
// text in M0; the composer derives it from the structured goal).
// ---------------------------------------------------------------------------

/** Composes the objective statement from a structured goal. */
export function composeObjectiveStatement(goal: IntentGoalView): string {
  const option = findGoalMetricOption(goal.metricId);
  const metricLabel = option?.metricLabel ?? goal.metricId;
  const unit = option?.unit ?? "";
  const targetLabel = unit !== "" ? `${goal.target} ${unit}` : String(goal.target);
  return `${intentDirectionVerb(goal.direction)} ${metricLabel} toward ${targetLabel}.`;
}

// ---------------------------------------------------------------------------
// Stage 1 — compile (A38 mirror).
// ---------------------------------------------------------------------------

/** Content-derived candidate plan id (replay-stable slug). */
function candidatePlanId(
  goal: IntentGoalView,
  methodId: string,
  cadencePerDay: number,
): string {
  const cadenceSlug = cadenceToSlug(cadencePerDay);
  const metricSlug = goal.metricId.replace("SYNTH-metric-", "");
  const methodSlug = methodId.replace("SYNTH-method-", "");
  return `plan_SYNTH-${metricSlug}-${methodSlug}-${cadenceSlug}`;
}

/** Cadence slug: 2 -> "2x-day", 1 -> "1x-day", 0.5 -> "1x-2day", 1/7 -> "1x-week". */
function cadenceToSlug(cadencePerDay: number): string {
  if (cadencePerDay === 2) {
    return "2x-day";
  }
  if (cadencePerDay === 1) {
    return "1x-day";
  }
  if (cadencePerDay === 0.5) {
    return "1x-2day";
  }
  if (Math.abs(cadencePerDay - 1 / 7) < 1e-9) {
    return "1x-week";
  }
  return `${cadencePerDay.toString().replace(/[^A-Za-z0-9]/g, "-")}x-day`;
}

/**
 * Compiles a goal + constraints against an evidence pack into the
 * candidate set + audits. Pure: deterministic given (goal, constraints,
 * pack, now). `intentId` rides the candidates (the store assigns it before
 * calling; tests pass a fixture).
 */
export function compileIntentPlan(input: {
  readonly intentId: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
  readonly pack: IntentEvidencePackView;
  readonly now: Date;
}): IntentCompilationView {
  const { intentId, goal, constraints, pack, now } = input;
  const option = findGoalMetricOption(goal.metricId);
  const metricLabel = option?.metricLabel ?? goal.metricId;
  const conceptCode = option?.conceptCode ?? goal.metricId;

  const entriesForMetric = pack.entries.filter(
    (entry) => entry.metricId === goal.metricId,
  );
  const gated: IntentGatedMetricView[] = [];
  const dropped: IntentDroppedCandidateView[] = [];
  const compiled: IntentPlanCandidateView[] = [];

  if (entriesForMetric.length === 0) {
    gated.push({
      metricId: goal.metricId,
      reason: "no-pack-coverage",
      packEntryCount: 0,
    });
  } else {
    // Usable = registered in the method index AND claimed by pack entries,
    // honoring the method-preference constraint (excluded method ids).
    const claimedMethodIds = new Set(entriesForMetric.map((entry) => entry.methodId));
    const registered = methodsForMetric(goal.metricId);
    const usable = registered.filter((method) => claimedMethodIds.has(method.id));
    if (usable.length === 0) {
      gated.push({
        metricId: goal.metricId,
        reason: "no-usable-method",
        packEntryCount: entriesForMetric.length,
      });
    } else {
      const excluded =
        constraints.methodPreference === "measured-only"
          ? new Set(
              registered
                .filter((method) => method.evidenceLabel !== "MEASURED")
                .map((method) => method.id),
            )
          : new Set<string>();
      const unexcluded = usable.filter((method) => !excluded.has(method.id));
      if (unexcluded.length === 0) {
        gated.push({
          metricId: goal.metricId,
          reason: "all-methods-excluded",
          packEntryCount: entriesForMetric.length,
        });
      } else {
        // Least-burden-first (ascending relativeBurden, id tiebreak).
        const ordered = [...unexcluded].sort(
          (a, b) => a.relativeBurden - b.relativeBurden || (a.id < b.id ? -1 : 1),
        );
        for (const method of ordered) {
          const contributing = entriesForMetric.filter(
            (entry) => entry.methodId === method.id,
          );
          compiled.push({
            planId: candidatePlanId(goal, method.id, constraints.cadencePerDay),
            state: "draft",
            personId: SYNTHETIC_PERSON_ID,
            intentId,
            metricId: goal.metricId,
            metricLabel,
            metrics: [conceptCode],
            conceptCode,
            methodId: method.id,
            methodLabel: method.label,
            methodKind: method.kind,
            methodEvidenceLabel: method.evidenceLabel,
            methodRelativeBurden: method.relativeBurden,
            cadencePerDay: constraints.cadencePerDay,
            pack: {
              packId: pack.packId,
              version: pack.version,
              contentHash: pack.contentHash,
            },
            contributingEntries: contributing.map((entry) => ({
              entryId: entry.entryId,
              methodId: entry.methodId,
              windowStart: entry.windowStart,
              windowEnd: entry.windowEnd,
              count: entry.count,
              provenanceActorClass: entry.provenanceActorClass,
            })),
            totalObservationCount: contributing.reduce(
              (sum, entry) => sum + entry.count,
              0,
            ),
            compiledAt: now.toISOString(),
          });
        }
        // Registered-but-excluded methods surface in the gated audit only;
        // the dropped audit below is the MATCHER's (source/coverage), kept
        // orthogonal to the constraint exclusion (typed audit separation).
      }
    }
  }

  // Stage 2 — match (A40 mirror): executability needs a registered source.
  const executable: IntentPlanCandidateView[] = [];
  for (const candidate of compiled) {
    const method = findIntentMethodOption(candidate.methodId);
    if (method !== undefined && method.sourceRegistered) {
      executable.push(candidate);
    } else {
      dropped.push({
        metricId: candidate.metricId,
        metricLabel: candidate.metricLabel,
        methodId: candidate.methodId,
        methodLabel: candidate.methodLabel,
        methodKind: candidate.methodKind,
        reason: "no-source",
        detail:
          "No active registered source backs this method yet (the device/app seam is display-only at this milestone).",
      });
    }
  }

  return { executable, dropped, gated, pack };
}

// ---------------------------------------------------------------------------
// Stage 3 — safety (A41 mirror over the frozen DEFAULT table values).
// ---------------------------------------------------------------------------

/**
 * Evaluates one candidate's cadence against the mirrored DEFAULT safety
 * rule table. Pure: the verdict is a function of (domain, cadencePerDay).
 */
export function evaluateSafetyOutcome(input: {
  readonly metricId: string;
  readonly domain: string;
  readonly cadencePerDay: number;
}): IntentSafetyOutcomeView {
  const { metricId, domain, cadencePerDay } = input;
  const firedRules: IntentFiredRuleView[] = [];

  if (cadencePerDay > INTENT_MAX_MEASUREMENTS_PER_DAY) {
    firedRules.push({
      ruleId: "safety/max-measurements-per-day/v1",
      ruleKind: "max-measurements-per-day",
      code: "exceeds-max-measurements-per-day",
      onViolation: "reject",
      inputsSummary: `Total proposed measurements per day exceed the day guard (${INTENT_MAX_MEASUREMENTS_PER_DAY}).`,
    });
  }

  const bounds = domainCadenceBounds(domain);
  if (bounds !== undefined) {
    if (cadencePerDay < bounds.floorPerDay) {
      firedRules.push({
        ruleId: `safety/cadence-floor/${domain}/v1`,
        ruleKind: "cadence-floor",
        code: "cadence-below-floor",
        onViolation: "escalate",
        inputsSummary: `Proposed cadence for ${metricId} is below the ${domain} domain floor (measurements per day).`,
      });
    }
    if (cadencePerDay > bounds.ceilingPerDay) {
      firedRules.push({
        ruleId: `safety/cadence-ceiling/${domain}/v1`,
        ruleKind: "cadence-ceiling",
        code: "cadence-above-ceiling",
        onViolation: "reject",
        inputsSummary: `Proposed cadence for ${metricId} is above the ${domain} domain ceiling (measurements per day).`,
      });
    }
  }

  if (firedRules.some((rule) => rule.onViolation === "reject")) {
    const reasonCodes = firedRules
      .filter((rule) => rule.onViolation === "reject")
      .map((rule) => rule.code);
    return {
      kind: "REJECT",
      requiresHumanReview: false,
      publishable: false,
      reasonCodes,
      firedRules,
    };
  }
  if (firedRules.length > 0) {
    return {
      kind: "ESCALATE",
      requiresHumanReview: true,
      publishable: false,
      reasonCodes: firedRules.map((rule) => rule.code),
      firedRules,
    };
  }
  return {
    kind: "PASS",
    requiresHumanReview: false,
    publishable: true,
    reasonCodes: [],
    firedRules: [],
  };
}

/** Evaluates the safety outcome OF a candidate (domain from the catalog). */
export function evaluateCandidateSafety(
  candidate: IntentPlanCandidateView,
): IntentSafetyOutcomeView {
  const option = findGoalMetricOption(candidate.metricId);
  return evaluateSafetyOutcome({
    metricId: candidate.metricId,
    domain: option?.category ?? "",
    cadencePerDay: candidate.cadencePerDay,
  });
}

// ---------------------------------------------------------------------------
// Stage 4 — burden summary (A39 display projection).
// ---------------------------------------------------------------------------

/** The burden summary of one candidate (pure projection). */
export function burdenSummaryOf(
  candidate: IntentPlanCandidateView,
): IntentBurdenSummaryView {
  const method = findIntentMethodOption(candidate.methodId);
  const kind = method?.kind ?? candidate.methodKind;
  const kindWeight = INTENT_METHOD_KIND_WEIGHTS[kind];
  return {
    methodCount: 1,
    measurementsPerDay: candidate.cadencePerDay,
    burdenUnitsPerDay: kindWeight * candidate.cadencePerDay,
    methodKindWeights: { ...INTENT_METHOD_KIND_WEIGHTS },
  };
}

// ---------------------------------------------------------------------------
// Convenience: the default person journey compile (store entry point).
// ---------------------------------------------------------------------------

/** Compiles for the synthetic person with the SYNTH pack fixture. */
export function compileForSyntheticPerson(input: {
  readonly intentId: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
  readonly now: Date;
}): IntentCompilationView {
  return compileIntentPlan({
    intentId: input.intentId,
    goal: input.goal,
    constraints: input.constraints,
    pack: buildSyntheticEvidencePack(input.now),
    now: input.now,
  });
}
