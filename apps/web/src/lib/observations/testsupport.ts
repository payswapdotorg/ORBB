/**
 * Observation test support (M6-B B5, Lane B): pure fixture accessors for
 * component tests — the seeded detail views (exported for assertions) and
 * a PURE reconciliation runner over the same fixtures the store uses, so
 * component tests never depend on module store state.
 */

import {
  CANONICAL_BP_VIEW_INPUT,
  DEVICE_BP_IMPORT_OBSERVATION,
  SEEDED_OBSERVATIONS,
} from "./fixtures";
import {
  buildCanonicalView,
  reconcilePair,
  type ReconcileCandidate,
  type ReconcilePolicy,
} from "./reconcile";
import type {
  CanonicalObservationDetailView,
  ObservationDetailView,
} from "./types";

export { DEVICE_BP_IMPORT_OBSERVATION } from "./fixtures";

/** The seeded manual BP observation (the reconciled pair's manual side). */
export const MANUAL_BP_FIXTURE: ObservationDetailView = SEEDED_OBSERVATIONS.find(
  (observation) => observation.id === "obs_SYNTH-obs-bp-manual-0001",
)!;

/** The seeded ESTIMATED temperature observation (the teaching case). */
export const ESTIMATED_TEMPERATURE_FIXTURE: ObservationDetailView =
  SEEDED_OBSERVATIONS.find(
    (observation) => observation.id === "obs_SYNTH-obs-temp-photo-0003",
  )!;

/** The same policy the store's demo import uses (recorded). */
const DEMO_RECONCILE_POLICY: ReconcilePolicy = {
  preferredMethodOrder: [
    "SYNTH-method-cuff-bp-panel",
    "SYNTH-method-manual-bp-panel",
  ],
  agreementTolerance: 0,
};

function candidateOf(observation: ObservationDetailView): ReconcileCandidate {
  return {
    observation,
    qualityScore: observation.quality.score,
    observedAt: observation.capturedAtIso,
  };
}

/**
 * Runs the pure reconciliation over the demo fixtures (no store state):
 * the imported device BP observation vs the seeded manual original.
 * Returns the canonical view plus both post-reconciliation originals.
 */
export function buildImportedFixtureForTests(): {
  readonly canonical: CanonicalObservationDetailView;
  readonly imported: ObservationDetailView;
  readonly superseded: ObservationDetailView;
} {
  const pair = reconcilePair(
    candidateOf(MANUAL_BP_FIXTURE),
    candidateOf(DEVICE_BP_IMPORT_OBSERVATION),
    DEMO_RECONCILE_POLICY,
  );
  const canonical = buildCanonicalView(pair, CANONICAL_BP_VIEW_INPUT);
  return {
    canonical,
    imported: pair.winner.observation,
    superseded: pair.loser.observation,
  };
}
