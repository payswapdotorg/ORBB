/**
 * Mobile intent journey model (M6-A, Lane B) — pure data + pure functions.
 *
 * The same intent-journey view model as the web flow, mirrored for React
 * Native: the M5-shape view interfaces (goal, constraints, candidate plan
 * with the A38 explainability audit trail, matcher drop audit, A41 safety
 * outcomes, A39 burden projection, A43 review entry + published plan), the
 * SYNTH catalog/pack vocabulary (ids aligned with the M4-A engine seed,
 * the web `apps/web/src/lib/intents/*`, and this app's capture model), and
 * the deterministic compile mirror.
 *
 * Why a local mirror instead of importing the web libs or `@orbb/intents`:
 * `apps/mobile` declares only `@orbb/ui` as a workspace dependency (plus
 * the RN/Expo stack); adding anything else would change `pnpm-lock.yaml`,
 * which this packet must not touch. The screens consume this pure model;
 * the engine wiring at integration promotes it (recorded handoff).
 *
 * The mobile journey is CLIENT-LOCAL (no route stubs in the RN shell at
 * this milestone): creation, approval, and rejection are pure functions
 * over an immutable session record — the same discipline as the M4-B
 * offline capture queue. No React Native imports in this module — it is
 * plain-node unit-testable.
 */

import { CAPTURE_SHAPES } from "../capture/model";

// ---------------------------------------------------------------------------
// View interfaces (M5-shape mirrors, field-for-field with the web
// `lib/intents/types.ts` — the shared local view-model contract).
// ---------------------------------------------------------------------------

export type IntentDirection = "decrease" | "increase" | "maintain";

export type IntentMethodKind = "manual" | "app" | "device";

export type IntentActorClass = "person" | "device" | "source";

export type IntentDropReason = "metric-uncovered" | "no-method" | "no-source";

export type IntentSafetyCode =
  | "exceeds-max-measurements-per-day"
  | "min-gap-between-metrics"
  | "forbidden-metric-combination"
  | "cadence-below-floor"
  | "cadence-above-ceiling";

export type IntentSafetyRuleKind =
  | "max-measurements-per-day"
  | "min-gap-between-metrics"
  | "forbidden-metric-combination"
  | "cadence-floor"
  | "cadence-ceiling";

export type IntentReviewState = "pending" | "approved" | "rejected";

export type IntentMethodPreference = "any" | "measured-only";

/** One structured goal: metric + direction + numeric target. */
export interface IntentGoalView {
  readonly metricId: string;
  readonly direction: IntentDirection;
  readonly target: number;
}

/** Compilation constraints (cadence window + method preference). */
export interface IntentConstraintsView {
  readonly cadencePerDay: number;
  readonly methodPreference: IntentMethodPreference;
}

/** One pack entry summary (A36 mirror; ISO string windows). */
export interface IntentPackEntryView {
  readonly entryId: string;
  readonly metricId: string;
  readonly methodId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly count: number;
  readonly qualityMix: {
    readonly byEvidenceLabel: {
      readonly MEASURED: number;
      readonly ESTIMATED: number;
      readonly IMPORTED: number;
      readonly DERIVED: number;
    };
    readonly meanQuality?: number;
  };
  readonly provenanceActorClass: IntentActorClass;
}

/** The person's evidence pack (one ACTIVE version). */
export interface IntentEvidencePackView {
  readonly packId: string;
  readonly personId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly entries: readonly IntentPackEntryView[];
}

/** One candidate plan (A38 explainability shape; always draft here). */
export interface IntentPlanCandidateView {
  readonly planId: string;
  readonly state: "draft";
  readonly personId: string;
  readonly intentId: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly metrics: readonly string[];
  readonly conceptCode: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly methodKind: IntentMethodKind;
  readonly methodEvidenceLabel: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  readonly methodRelativeBurden: number;
  readonly cadencePerDay: number;
  readonly pack: {
    readonly packId: string;
    readonly version: number;
    readonly contentHash: string;
  };
  readonly contributingEntries: readonly {
    readonly entryId: string;
    readonly methodId: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly count: number;
    readonly provenanceActorClass: IntentActorClass;
  }[];
  readonly totalObservationCount: number;
  readonly compiledAt: string;
}

/** A candidate the matcher dropped (A40 audit surface). */
export interface IntentDroppedCandidateView {
  readonly metricId: string;
  readonly metricLabel: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly methodKind: IntentMethodKind;
  readonly reason: IntentDropReason;
  readonly detail: string;
}

/** Safety verdict (A41 mirror; ESCALATE literals preserved). */
export type IntentSafetyOutcomeView =
  | {
      readonly kind: "PASS";
      readonly requiresHumanReview: false;
      readonly publishable: true;
      readonly reasonCodes: readonly [];
      readonly firedRules: readonly IntentFiredRuleView[];
    }
  | {
      readonly kind: "ESCALATE";
      readonly requiresHumanReview: true;
      readonly publishable: false;
      readonly reasonCodes: readonly IntentSafetyCode[];
      readonly firedRules: readonly IntentFiredRuleView[];
    }
  | {
      readonly kind: "REJECT";
      readonly requiresHumanReview: false;
      readonly publishable: false;
      readonly reasonCodes: readonly IntentSafetyCode[];
      readonly firedRules: readonly IntentFiredRuleView[];
    };

export interface IntentFiredRuleView {
  readonly ruleId: string;
  readonly ruleKind: IntentSafetyRuleKind;
  readonly code: IntentSafetyCode;
  readonly onViolation: "reject" | "escalate";
  readonly inputsSummary: string;
}

/** Burden summary projection (A39 mirror). */
export interface IntentBurdenSummaryView {
  readonly methodCount: number;
  readonly measurementsPerDay: number;
  readonly burdenUnitsPerDay: number;
  readonly methodKindWeights: Readonly<Record<IntentMethodKind, number>>;
}

/** One stored intent (domain HealthIntent-shaped summary). */
export interface IntentRecordView {
  readonly intentId: string;
  readonly draftId: string;
  readonly personId: string;
  readonly objective: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
  readonly evidencePackVersion: number;
  readonly createdAt: string;
}

/** One review queue entry (A43 mirror). */
export interface IntentReviewEntryView {
  readonly entryId: string;
  readonly intentId: string;
  readonly state: IntentReviewState;
  readonly enqueuedAt: string;
  readonly candidate: IntentPlanCandidateView | null;
  readonly alternatives: readonly IntentPlanCandidateView[];
  readonly dropped: readonly IntentDroppedCandidateView[];
  readonly safety: IntentSafetyOutcomeView | null;
  readonly burden: IntentBurdenSummaryView | null;
}

/** A PUBLISHED plan (the review transition's only output). */
export interface IntentPublishedPlanView {
  readonly planId: string;
  readonly personId: string;
  readonly intentId: string;
  readonly metrics: readonly string[];
  readonly metricLabel: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly cadencePerDay: number;
  readonly state: "published";
  readonly publishedAt: string;
  readonly reviewerNote?: string;
}

// ---------------------------------------------------------------------------
// Vocabulary (mirrors the web intent catalog; ids identical).
// ---------------------------------------------------------------------------

/** The single synthetic person of the mobile session (self-tracking). */
export const SYNTHETIC_PERSON_ID = "prsn_SYNTH-person-0001";

export const SYNTHETIC_PACK_ID = "evpk_SYNTH-pack-0001";
export const SYNTHETIC_PACK_CONTENT_HASH = "sha256-SYNTH-pack-v1-4d1f0a2b";

/** One goal metric option (derived from the M4-B capture catalog). */
export interface IntentGoalMetricOption {
  readonly metricId: string;
  readonly metricLabel: string;
  readonly conceptCode: string;
  readonly category: string;
  readonly unit: string;
  readonly targetMin: number;
  readonly targetMax: number;
  readonly targetStep: number;
  readonly defaultTarget: number;
  readonly summary: string;
}

export const GOAL_METRIC_OPTIONS: readonly IntentGoalMetricOption[] =
  CAPTURE_SHAPES.flatMap((shape) =>
    shape.fields.map((field) => ({
      metricId: field.metric.id,
      metricLabel: field.metric.displayName,
      conceptCode: field.metric.conceptCode,
      category: field.metric.category,
      unit: field.metric.unitDomain[0] ?? "",
      targetMin: field.min,
      targetMax: field.max,
      targetStep: field.step,
      defaultTarget:
        Math.round(((field.min + field.max) / 2) / field.step) * field.step,
      summary: `${shape.displayName} — ${shape.summary}`,
    })),
  );

export function findGoalMetricOption(
  metricId: string,
): IntentGoalMetricOption | undefined {
  return GOAL_METRIC_OPTIONS.find((option) => option.metricId === metricId);
}

/** Direction options (labels + verbs for the objective statement). */
export const INTENT_DIRECTION_OPTIONS: readonly {
  readonly value: IntentDirection;
  readonly label: string;
  readonly verb: string;
}[] = [
  { value: "decrease", label: "Lower", verb: "Lower" },
  { value: "increase", label: "Raise", verb: "Raise" },
  { value: "maintain", label: "Keep steady", verb: "Keep steady" },
];

export function intentDirectionLabel(direction: IntentDirection): string {
  return (
    INTENT_DIRECTION_OPTIONS.find((option) => option.value === direction)
      ?.label ?? direction
  );
}

/** Cadence window options (per-day rates). */
export interface IntentCadenceOption {
  readonly id: string;
  readonly label: string;
  readonly cadencePerDay: number;
  readonly description: string;
}

export const INTENT_CADENCE_OPTIONS: readonly IntentCadenceOption[] = [
  {
    id: "SYNTH-cadence-twice-daily",
    label: "Twice a day",
    cadencePerDay: 2,
    description: "Two measurements per day — the densest window offered.",
  },
  {
    id: "SYNTH-cadence-daily",
    label: "Daily",
    cadencePerDay: 1,
    description: "One measurement per day.",
  },
  {
    id: "SYNTH-cadence-alternate-days",
    label: "Every other day",
    cadencePerDay: 0.5,
    description: "A measurement every second day.",
  },
  {
    id: "SYNTH-cadence-weekly",
    label: "Weekly",
    cadencePerDay: 1 / 7,
    description: "One measurement per week.",
  },
];

export function findCadenceOption(
  cadenceId: string,
): IntentCadenceOption | undefined {
  return INTENT_CADENCE_OPTIONS.find((option) => option.id === cadenceId);
}

/** Method preference options. */
export const INTENT_METHOD_PREFERENCE_OPTIONS: readonly {
  readonly value: IntentMethodPreference;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: "any",
    label: "Any available method",
    description:
      "Manual, device, and app routes may all be proposed (subject to source registration).",
  },
  {
    value: "measured-only",
    label: "Measured evidence only",
    description:
      "Exclude estimated-from-memory methods — plans must rest on MEASURED evidence.",
  },
];

/** One registered method (manual from the capture catalog + M4-C seams). */
export interface IntentMethodOption {
  readonly id: string;
  readonly metricId: string;
  readonly label: string;
  readonly kind: IntentMethodKind;
  readonly evidenceLabel: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  readonly relativeBurden: number;
  readonly sourceRegistered: boolean;
  readonly note: string;
}

export const INTENT_METHOD_OPTIONS: readonly IntentMethodOption[] =
  CAPTURE_SHAPES.flatMap((shape) => [
    ...shape.fields.map((field) => ({
      id: field.method.id,
      metricId: field.metric.id,
      label: `${shape.manualMethodOption.label} · ${field.label}`,
      kind: "manual" as const,
      evidenceLabel: field.method.evidenceLabel,
      relativeBurden: field.method.relativeBurden,
      sourceRegistered: true,
      note: "Manual · source registered (src_SYNTH-source-manual)",
    })),
    ...shape.futureMethodOptions.map((option) => ({
      id: option.id,
      metricId: shape.fields[0]?.metric.id ?? "",
      label: option.label,
      kind: (option.id.includes("app-") ? "app" : "device") as IntentMethodKind,
      evidenceLabel: "MEASURED" as const,
      relativeBurden: option.id.includes("app-") ? 2 : 1,
      sourceRegistered: false,
      note: option.meta,
    })),
  ]);

export function methodsForMetric(
  metricId: string,
): readonly IntentMethodOption[] {
  return INTENT_METHOD_OPTIONS.filter(
    (method) => method.metricId === metricId,
  ).sort(
    (a, b) => a.relativeBurden - b.relativeBurden || (a.id < b.id ? -1 : 1),
  );
}

export function findIntentMethodOption(
  methodId: string,
): IntentMethodOption | undefined {
  return INTENT_METHOD_OPTIONS.find((method) => method.id === methodId);
}

/** Registered sources: the manual source only (seams are display-only). */
export const INTENT_REGISTERED_SOURCES: readonly {
  readonly sourceId: string;
  readonly kind: IntentMethodKind;
  readonly capabilities: readonly string[];
}[] = [
  {
    sourceId: "src_SYNTH-source-manual",
    kind: "manual",
    capabilities: INTENT_METHOD_OPTIONS.filter(
      (method) => method.kind === "manual",
    ).map((method) => method.id),
  },
];

export function hasRegisteredSource(methodId: string): boolean {
  return INTENT_REGISTERED_SOURCES.some((source) =>
    source.capabilities.includes(methodId),
  );
}

/** Safety domain bounds (the frozen M5-B default table mirror). */
export const INTENT_MAX_MEASUREMENTS_PER_DAY = 12;

export const INTENT_DOMAIN_CADENCE_BOUNDS: readonly {
  readonly domain: string;
  readonly floorPerDay: number;
  readonly ceilingPerDay: number;
}[] = [
  { domain: "vital-signs", floorPerDay: 1, ceilingPerDay: 4 },
  { domain: "body-composition", floorPerDay: 1 / 7, ceilingPerDay: 2 },
  { domain: "activity", floorPerDay: 1, ceilingPerDay: 24 },
  { domain: "sleep", floorPerDay: 1, ceilingPerDay: 4 },
];

export function domainCadenceBounds(
  category: string,
): { domain: string; floorPerDay: number; ceilingPerDay: number } | undefined {
  return INTENT_DOMAIN_CADENCE_BOUNDS.find(
    (bounds) => bounds.domain === category,
  );
}

/** Kind weights ordered manual(3) > app(2) > device(1) (frozen default). */
export const INTENT_METHOD_KIND_WEIGHTS: Readonly<
  Record<IntentMethodKind, number>
> = { manual: 3, app: 2, device: 1 };

// ---------------------------------------------------------------------------
// SYNTH evidence pack fixture (mirror of the web pack; 30-day windows).
// ---------------------------------------------------------------------------

const PACK_WINDOW_DAYS = 30;

interface PackEntrySpec {
  readonly metricId: string;
  readonly methodId: string;
  readonly count: number;
  readonly measured: number;
  readonly estimated: number;
  readonly meanQuality: number;
  readonly provenanceActorClass: IntentActorClass;
}

const ENTRY_SPECS: readonly PackEntrySpec[] = [
  { metricId: "SYNTH-metric-bp-systolic", methodId: "SYNTH-method-bpsys-manual", count: 12, measured: 12, estimated: 0, meanQuality: 0.82, provenanceActorClass: "person" },
  { metricId: "SYNTH-metric-bp-systolic", methodId: "SYNTH-method-cuff-bp-panel", count: 20, measured: 20, estimated: 0, meanQuality: 0.91, provenanceActorClass: "device" },
  { metricId: "SYNTH-metric-bp-diastolic", methodId: "SYNTH-method-bpdia-manual", count: 12, measured: 12, estimated: 0, meanQuality: 0.82, provenanceActorClass: "person" },
  { metricId: "SYNTH-metric-heart-rate", methodId: "SYNTH-method-hr-manual", count: 6, measured: 6, estimated: 0, meanQuality: 0.72, provenanceActorClass: "person" },
  { metricId: "SYNTH-metric-heart-rate", methodId: "SYNTH-method-wearable-heart-rate", count: 30, measured: 30, estimated: 0, meanQuality: 0.88, provenanceActorClass: "device" },
  { metricId: "SYNTH-metric-body-weight", methodId: "SYNTH-method-wt-manual", count: 8, measured: 8, estimated: 0, meanQuality: 0.88, provenanceActorClass: "person" },
  { metricId: "SYNTH-metric-body-weight", methodId: "SYNTH-method-scale-body-weight", count: 8, measured: 8, estimated: 0, meanQuality: 0.95, provenanceActorClass: "device" },
  { metricId: "SYNTH-metric-step-count", methodId: "SYNTH-method-steps-manual", count: 4, measured: 0, estimated: 4, meanQuality: 0.42, provenanceActorClass: "person" },
  { metricId: "SYNTH-metric-step-count", methodId: "SYNTH-method-wearable-step-count", count: 60, measured: 60, estimated: 0, meanQuality: 0.9, provenanceActorClass: "device" },
  { metricId: "SYNTH-metric-sleep-minutes", methodId: "SYNTH-method-sleep-manual", count: 10, measured: 0, estimated: 10, meanQuality: 0.5, provenanceActorClass: "person" },
  { metricId: "SYNTH-metric-sleep-minutes", methodId: "SYNTH-method-wearable-sleep-minutes", count: 30, measured: 30, estimated: 0, meanQuality: 0.85, provenanceActorClass: "device" },
];

function fixtureEntryId(spec: PackEntrySpec): string {
  return `evpe_SYNTH-${spec.metricId.replace("SYNTH-metric-", "")}-${spec.methodId
    .replace("SYNTH-method-", "")
    .replace(/-panel$/, "")}-v1`;
}

/** Builds the synthetic person's ACTIVE evidence pack (deterministic). */
export function buildSyntheticEvidencePack(now: Date): IntentEvidencePackView {
  const windowStart = new Date(
    now.getTime() - PACK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  return {
    packId: SYNTHETIC_PACK_ID,
    personId: SYNTHETIC_PERSON_ID,
    version: 1,
    contentHash: SYNTHETIC_PACK_CONTENT_HASH,
    entries: ENTRY_SPECS.map((spec) => ({
      entryId: fixtureEntryId(spec),
      metricId: spec.metricId,
      methodId: spec.methodId,
      windowStart: windowStart.toISOString(),
      windowEnd: now.toISOString(),
      count: spec.count,
      qualityMix: {
        byEvidenceLabel: {
          MEASURED: spec.measured,
          ESTIMATED: spec.estimated,
          IMPORTED: 0,
          DERIVED: 0,
        },
        meanQuality: spec.meanQuality,
      },
      provenanceActorClass: spec.provenanceActorClass,
    })),
  };
}

export function packEntriesForMetric(
  pack: IntentEvidencePackView,
  metricId: string,
): readonly IntentPackEntryView[] {
  return pack.entries.filter((entry) => entry.metricId === metricId);
}

// ---------------------------------------------------------------------------
// Deterministic compile + safety + burden mirrors.
// ---------------------------------------------------------------------------

/** Objective statement composed from the structured goal. */
export function composeObjectiveStatement(goal: IntentGoalView): string {
  const option = findGoalMetricOption(goal.metricId);
  const metricLabel = option?.metricLabel ?? goal.metricId;
  const unit = option?.unit ?? "";
  const targetLabel =
    unit !== "" ? `${goal.target} ${unit}` : String(goal.target);
  const verb =
    INTENT_DIRECTION_OPTIONS.find((option) => option.value === goal.direction)
      ?.verb ?? goal.direction;
  return `${verb} ${metricLabel} toward ${targetLabel}.`;
}

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
 * The compile mirror: goal + constraints + pack -> executable candidates
 * (burden-ordered) + matcher drops + gated audit. Deterministic.
 */
export function compileIntentPlan(input: {
  readonly intentId: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
  readonly pack: IntentEvidencePackView;
  readonly now: Date;
}): {
  readonly executable: readonly IntentPlanCandidateView[];
  readonly dropped: readonly IntentDroppedCandidateView[];
} {
  const { intentId, goal, constraints, pack, now } = input;
  const option = findGoalMetricOption(goal.metricId);
  const metricLabel = option?.metricLabel ?? goal.metricId;
  const conceptCode = option?.conceptCode ?? goal.metricId;

  const entriesForMetric = pack.entries.filter(
    (entry) => entry.metricId === goal.metricId,
  );
  const dropped: IntentDroppedCandidateView[] = [];
  const compiled: IntentPlanCandidateView[] = [];

  if (entriesForMetric.length > 0) {
    const claimedMethodIds = new Set(entriesForMetric.map((entry) => entry.methodId));
    const registered = methodsForMetric(goal.metricId);
    const usable = registered.filter((method) => claimedMethodIds.has(method.id));
    const excluded =
      constraints.methodPreference === "measured-only"
        ? new Set(
            usable
              .filter((method) => method.evidenceLabel !== "MEASURED")
              .map((method) => method.id),
          )
        : new Set<string>();
    const unexcluded = usable.filter((method) => !excluded.has(method.id));
    const ordered = [...unexcluded].sort(
      (a, b) => a.relativeBurden - b.relativeBurden || (a.id < b.id ? -1 : 1),
    );
    for (const method of ordered) {
      const contributing = entriesForMetric.filter(
        (entry) => entry.methodId === method.id,
      );
      compiled.push({
        planId: `plan_SYNTH-${goal.metricId.replace("SYNTH-metric-", "")}-${method.id
          .replace("SYNTH-method-", "")
          .replace(/-panel$/, "")}-${cadenceToSlug(constraints.cadencePerDay)}`,
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
  }

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
  return { executable, dropped };
}

/** The A41 safety mirror (domain floor/ceiling + day guard). */
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
    return {
      kind: "REJECT",
      requiresHumanReview: false,
      publishable: false,
      reasonCodes: firedRules
        .filter((rule) => rule.onViolation === "reject")
        .map((rule) => rule.code),
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

/** Safety of a candidate (domain from the catalog). */
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

/** Burden summary projection. */
export function burdenSummaryOf(
  candidate: IntentPlanCandidateView,
): IntentBurdenSummaryView {
  const method = findIntentMethodOption(candidate.methodId);
  const kind = method?.kind ?? candidate.methodKind;
  return {
    methodCount: 1,
    measurementsPerDay: candidate.cadencePerDay,
    burdenUnitsPerDay: INTENT_METHOD_KIND_WEIGHTS[kind] * candidate.cadencePerDay,
    methodKindWeights: { ...INTENT_METHOD_KIND_WEIGHTS },
  };
}

// ---------------------------------------------------------------------------
// The domain plan-state machine mirror (frozen upstream, mirrored locally).
// ---------------------------------------------------------------------------

const ALLOWED_PLAN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["published"],
  published: ["active"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * The domain-transition mirror — the ONLY way a plan reaches `published`
 * on mobile (the local mirror of the frozen domain guard; the integration
 * station swaps this for the real review stub, handoff recorded).
 */
export function applyPlanTransitionMirror<T extends { state: string }>(
  plan: T,
  to: string,
): T & { state: string } {
  const allowed = ALLOWED_PLAN_TRANSITIONS[plan.state] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal plan transition mirror: ${plan.state} -> ${to}.`);
  }
  return { ...plan, state: to };
}

// ---------------------------------------------------------------------------
// The intent session (immutable journey record; creation-scoped counters).
// ---------------------------------------------------------------------------

/** One person's intent journey state (create -> review -> act). */
export interface IntentSession {
  readonly intent: IntentRecordView;
  readonly review: IntentReviewEntryView;
  readonly published?: IntentPublishedPlanView;
  /** Terminal rejection reason (absent unless rejected). */
  readonly rejectionReason?: string;
}

/** Creation-scoped id counters (the caller owns a running counter). */
export interface IntentIdCounters {
  intent: number;
  entry: number;
}

export function initialIntentIdCounters(): IntentIdCounters {
  return { intent: 0, entry: 0 };
}

/**
 * Creates an intent session (compile + enqueue). The draft id keys the
 * journey the same way the web stub's idempotency works: the screen keeps
 * one draft id per composer run.
 */
export function createIntentSession(input: {
  readonly draftId: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
  readonly now: Date;
  readonly counters: IntentIdCounters;
}): { readonly session: IntentSession; readonly counters: IntentIdCounters } {
  const counters: IntentIdCounters = {
    intent: input.counters.intent + 1,
    entry: input.counters.entry + 1,
  };
  const intentId = `intent_SYNTH-intent-${String(counters.intent).padStart(6, "0")}`;
  const intent: IntentRecordView = {
    intentId,
    draftId: input.draftId,
    personId: SYNTHETIC_PERSON_ID,
    objective: composeObjectiveStatement(input.goal),
    goal: input.goal,
    constraints: input.constraints,
    evidencePackVersion: 1,
    createdAt: input.now.toISOString(),
  };
  const compilation = compileIntentPlan({
    intentId,
    goal: input.goal,
    constraints: input.constraints,
    pack: buildSyntheticEvidencePack(input.now),
    now: input.now,
  });
  const [primary, ...alternatives] = compilation.executable;
  const session: IntentSession = {
    intent,
    review: {
      entryId: `revq_SYNTH-${String(counters.entry).padStart(6, "0")}`,
      intentId,
      state: "pending",
      enqueuedAt: input.now.toISOString(),
      candidate: primary ?? null,
      alternatives,
      dropped: compilation.dropped,
      safety: primary !== undefined ? evaluateCandidateSafety(primary) : null,
      burden: primary !== undefined ? burdenSummaryOf(primary) : null,
    },
  };
  return { session, counters };
}

/** Approve-with-edits: publishes ONLY through the transition mirror. */
export function approveIntentSession(
  session: IntentSession,
  edits: { readonly metrics?: readonly string[]; readonly note?: string } | undefined,
  now: Date,
): IntentSession {
  const candidate = session.review.candidate;
  if (candidate === null || session.review.state !== "pending") {
    throw new Error("Approval requires a pending review entry with a candidate.");
  }
  const metrics =
    edits?.metrics !== undefined ? [...edits.metrics] : [...candidate.metrics];
  if (metrics.length === 0) {
    throw new Error("Edited metrics must stay non-empty.");
  }
  const transitioned = applyPlanTransitionMirror(
    {
      planId: candidate.planId,
      personId: candidate.personId,
      intentId: candidate.intentId,
      metrics,
      metricLabel: candidate.metricLabel,
      methodId: candidate.methodId,
      methodLabel: candidate.methodLabel,
      cadencePerDay: candidate.cadencePerDay,
      reviewerNote: edits?.note,
      state: "draft",
    },
    "published",
  );
  return {
    ...session,
    review: { ...session.review, state: "approved" },
    published: {
      planId: transitioned.planId,
      personId: transitioned.personId,
      intentId: transitioned.intentId,
      metrics: [...transitioned.metrics],
      metricLabel: transitioned.metricLabel,
      methodId: transitioned.methodId,
      methodLabel: transitioned.methodLabel,
      cadencePerDay: transitioned.cadencePerDay,
      state: "published",
      publishedAt: now.toISOString(),
      ...(edits?.note !== undefined ? { reviewerNote: edits.note } : {}),
    },
  };
}

/** Reject: terminal for the entry. */
export function rejectIntentSession(
  session: IntentSession,
  reason: string,
  now: Date,
): IntentSession {
  if (session.review.state !== "pending") {
    throw new Error("Rejection requires a pending review entry.");
  }
  if (reason.trim() === "") {
    throw new Error("A rejection reason is required.");
  }
  void now;
  return {
    ...session,
    review: { ...session.review, state: "rejected" },
    rejectionReason: reason,
  };
}
