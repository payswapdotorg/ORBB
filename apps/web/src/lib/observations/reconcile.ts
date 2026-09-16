/**
 * Reconciliation mirror (M6-B B5, Lane B) — the pure, local mirror of the
 * M4-A `ReconciliationService` ranking/verdict semantics
 * (`packages/measurement/src/reconciliation.ts`), over the wire-form
 * observation views.
 *
 * Why a mirror (recorded handoff): `apps/web` consumes `@orbb/measurement`
 * TYPE-ONLY (no runtime/dist coupling), so the engine service cannot be
 * invoked from the client bundle yet. The mirror implements the SAME
 * documented deterministic total order and verdict rule; unit tests pin
 * the semantics, and the integration wiring swaps this for the real
 * service (handoff recorded in the completion report).
 *
 * Mirrored semantics (M4, frozen):
 *   - Ranking: domain quality score DESCENDING (missing quality ranks 0),
 *     then the policy's preferred method order, then later `observedAt`,
 *     then observation id ascending.
 *   - Verdict: `concordant` when the values agree under the agreement
 *     policy (default exact equality; absolute tolerance injectable) —
 *     no clinical tolerances are invented here; `discordant` otherwise.
 *     Discordance never blocks reconciliation: the higher-ranked value
 *     becomes canonical and the verdict flags the divergence.
 *   - Nothing is discarded: the losing original is superseded (terminal
 *     validation state, provenance intact), the winning original is
 *     validated, and the canonical replacement carries per-source
 *     provenance for BOTH originals.
 */

import { OBSERVATION_SOURCE_KIND_LABELS } from "./types";
import type {
  CanonicalObservationDetailView,
  ObservationDetailView,
  ReconciledSourceProvenanceView,
  ReconciliationVerdict,
} from "./types";

/** A reconciliation candidate (the caller loads the detail views). */
export interface ReconcileCandidate {
  readonly observation: ObservationDetailView;
  /** The domain quality score in [0, 1] used for ranking (missing = 0). */
  readonly qualityScore: number;
  /** Ordering timestamp (the observation's recorded/observed time). */
  readonly observedAt: string;
}

/** The injectable policy (M4 `ReconciliationPolicy` mirror). */
export interface ReconcilePolicy {
  /** Preferred method order for ranking (earlier ranks higher). */
  readonly preferredMethodOrder?: readonly string[];
  /** Absolute agreement tolerance for quantity values; default 0. */
  readonly agreementTolerance?: number;
}

export interface ReconcilePairOutcome {
  readonly winner: ReconcileCandidate;
  readonly loser: ReconcileCandidate;
  readonly verdict: ReconciliationVerdict;
}

/** Rank index inside the policy's preferred method order (unlisted = last). */
function preferredMethodRank(
  methodId: string,
  preferred: readonly string[] | undefined,
): number {
  if (preferred === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }
  const index = preferred.indexOf(methodId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * The deterministic total order (M4 ranking, mirrored): quality desc,
 * preferred-method order, later observedAt, id asc. Pure.
 */
export function compareReconcileCandidates(
  a: ReconcileCandidate,
  b: ReconcileCandidate,
  policy: ReconcilePolicy,
): number {
  const byQuality = b.qualityScore - a.qualityScore;
  if (byQuality !== 0) {
    return byQuality;
  }
  const byMethod = preferredMethodRank(
    a.observation.method.id,
    policy.preferredMethodOrder,
  ) -
    preferredMethodRank(b.observation.method.id, policy.preferredMethodOrder);
  if (byMethod !== 0) {
    return byMethod;
  }
  const byTime = b.observedAt.localeCompare(a.observedAt);
  if (byTime !== 0) {
    return byTime;
  }
  return a.observation.id.localeCompare(b.observation.id);
}

/** The agreement rule: |a - b| <= tolerance (default 0 — exact equality). */
export function reconciliationVerdict(
  a: number,
  b: number,
  tolerance = 0,
): ReconciliationVerdict {
  return Math.abs(a - b) <= tolerance ? "concordant" : "discordant";
}

/** Ranks exactly two candidates and computes the verdict. Pure. */
export function reconcilePair(
  first: ReconcileCandidate,
  second: ReconcileCandidate,
  policy: ReconcilePolicy = {},
): ReconcilePairOutcome {
  const ranked = [first, second].sort((a, b) =>
    compareReconcileCandidates(a, b, policy),
  );
  const winner = ranked[0]!;
  const loser = ranked[1]!;
  return {
    winner,
    loser,
    verdict: reconciliationVerdict(
      first.observation.value,
      second.observation.value,
      policy.agreementTolerance ?? 0,
    ),
  };
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  "canonical-source": "Canonical source — the current value comes from this observation",
  "superseded-source": "Superseded — kept with full provenance, no longer the current value",
};

function sourceProvenanceOf(
  candidate: ReconcileCandidate,
  role: "canonical-source" | "superseded-source",
): ReconciledSourceProvenanceView {
  const observation = candidate.observation;
  return {
    observationId: observation.id,
    sourceKind: observation.sourceKind,
    sourceKindLabel: OBSERVATION_SOURCE_KIND_LABELS[observation.sourceKind],
    methodId: observation.method.id,
    methodLabel: observation.method.label,
    evidenceLabel: observation.evidenceLabel,
    qualityScore: candidate.qualityScore,
    role,
    roleLabel: ROLE_LABELS[role] ?? role,
    valueLabel: observation.valueLabel,
    capturedAtLabel: observation.time.capturedAtLabel,
    detailId: observation.id,
  };
}

/**
 * Builds the ONE canonical view from a ranked pair (the M4
 * `CanonicalObservationView` mirror, wire form). Pure.
 *
 * The canonical value is the WINNER's value; the canonical observation is
 * DERIVED (computed by the reconciliation act — the `synthesized` source
 * kind) and validated; per-source provenance covers BOTH originals.
 */
export function buildCanonicalView(
  pair: ReconcilePairOutcome,
  input: {
    readonly canonicalId: string;
    readonly windowLabel: string;
    readonly reconciledAtLabel: string;
    readonly reconciliationProvenanceId: string;
  },
): CanonicalObservationDetailView {
  const winner = pair.winner.observation;
  const sources = [
    sourceProvenanceOf(pair.winner, "canonical-source"),
    sourceProvenanceOf(pair.loser, "superseded-source"),
  ];
  const detail: ObservationDetailView = {
    id: input.canonicalId,
    metricId: winner.metricId,
    metricLabel: winner.metricLabel,
    conceptCode: winner.conceptCode,
    value: winner.value,
    unit: winner.unit,
    valueLabel: winner.valueLabel,
    evidenceLabel: "DERIVED",
    validationState: "validated",
    capturedBy: "ORBB reconciliation (two sources, one current value)",
    sourceKind: "synthesized",
    method: {
      id: "SYNTH-method-reconciliation",
      label: "Reconciliation of two sources",
    },
    deviceOrPerson: `Two sources: ${pair.winner.observation.method.label} and ${pair.loser.observation.method.label}`,
    time: {
      capturedAtLabel: winner.time.capturedAtLabel,
      recordedAtLabel: input.reconciledAtLabel,
    },
    quality: pair.winner.observation.quality,
    transformations: [
      ...winner.transformations,
      {
        id: "reconciliation-supersession",
        label: "Reconciliation",
        detail: `Two observations of the same metric in one window reconciled into one current value; the superseded source keeps its provenance (verdict: ${pair.verdict}).`,
      },
    ],
    ...(winner.evidence !== undefined ? { evidence: winner.evidence } : {}),
    ...(pair.verdict === "discordant"
      ? {
          uncertainty:
            "The two sources disagreed — the current value is the higher-quality source's reading, and the divergence is flagged, not hidden.",
        }
      : {}),
    capturedAtIso: winner.capturedAtIso,
  };
  return {
    id: input.canonicalId,
    metricId: winner.metricId,
    metricLabel: winner.metricLabel,
    conceptCode: winner.conceptCode,
    value: winner.value,
    unit: winner.unit,
    valueLabel: winner.valueLabel,
    evidenceLabel: "DERIVED",
    validationState: "validated",
    windowLabel: input.windowLabel,
    verdict: pair.verdict,
    sources,
    reconciledAtLabel: input.reconciledAtLabel,
    reconciliationProvenanceId: input.reconciliationProvenanceId,
    detail,
  };
}

/**
 * Applies the reconciliation outcome to the two original observation
 * views (the domain supersession mirror, presentation-side): the winner
 * becomes validated, the loser superseded — provenance intact. Pure.
 */
export function applyReconciliationStates(
  observations: readonly ObservationDetailView[],
  pair: ReconcilePairOutcome,
): readonly ObservationDetailView[] {
  return observations.map((observation) => {
    if (observation.id === pair.winner.observation.id) {
      return { ...observation, validationState: "validated" };
    }
    if (observation.id === pair.loser.observation.id) {
      return { ...observation, validationState: "superseded" };
    }
    return observation;
  });
}
