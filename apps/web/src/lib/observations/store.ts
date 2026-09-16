/**
 * In-memory observation store (M6-B B5/B6, Lane B): process-local module
 * state backing the `/api/observations` route stub — the same stub-store
 * pattern as the M4-B capture store, now with structured provenance.
 *
 * Semantics:
 *   - Seeded ONCE per process from the deterministic SYNTH fixtures
 *     (resumable across client reloads inside the server session).
 *   - The DEVICE IMPORT action (golden journey #2): adds the SYNTH
 *     device-adapter BP observation for the same metric/window as the
 *     seeded manual BP observation, then runs the pure reconciliation
 *     mirror — the winner is validated, the loser superseded (terminal,
 *     provenance intact), and ONE canonical DERIVED view is stored with
 *     per-source provenance for BOTH originals. Data is never discarded.
 *   - The import is ONCE-ONLY per process (typed `import-already-completed`
 *     on repeat — the M5-C convention; the fixture demo has one batch).
 *   - Never any validation upgrades outside the reconciliation: fresh
 *     manual observations stay `pending` (the M4-B discipline).
 */

import {
  CANONICAL_BP_VIEW_INPUT,
  DEVICE_BP_IMPORT_OBSERVATION,
  OBSERVATION_PERSON_ID,
  SEEDED_OBSERVATIONS,
} from "./fixtures";
import {
  applyReconciliationStates,
  buildCanonicalView,
  reconcilePair,
  type ReconcileCandidate,
  type ReconcilePolicy,
} from "./reconcile";
import type {
  CanonicalObservationDetailView,
  ObservationDetailView,
} from "./types";

/** The reconciliation policy of the SYNTH demo (recorded): exact equality. */
const DEMO_RECONCILE_POLICY: ReconcilePolicy = {
  preferredMethodOrder: [
    "SYNTH-method-cuff-bp-panel",
    "SYNTH-method-manual-bp-panel",
  ],
  agreementTolerance: 0,
};

export interface ObservationBoard {
  readonly synthetic: true;
  readonly personId: string;
  readonly observations: readonly ObservationDetailView[];
  readonly canonical: CanonicalObservationDetailView | null;
  readonly deviceImportAvailable: boolean;
}

export type DeviceImportError = { readonly kind: "import-already-completed" };

export type DeviceImportResult =
  | {
      readonly ok: true;
      readonly imported: ObservationDetailView;
      readonly superseded: ObservationDetailView;
      readonly canonical: CanonicalObservationDetailView;
      readonly board: ObservationBoard;
    }
  | { readonly ok: false; readonly error: DeviceImportError };

let observations: readonly ObservationDetailView[] = [...SEEDED_OBSERVATIONS];
let canonical: CanonicalObservationDetailView | null = null;
let imported = false;

/** Resets the store to the seeded fixtures (test-only). */
export function resetObservationStore(): void {
  observations = [...SEEDED_OBSERVATIONS];
  canonical = null;
  imported = false;
}

/** The current board (wire form of GET /api/observations). */
export function listObservationBoard(): ObservationBoard {
  return {
    synthetic: true,
    personId: OBSERVATION_PERSON_ID,
    observations,
    canonical,
    deviceImportAvailable: !imported,
  };
}

function candidateOf(observation: ObservationDetailView): ReconcileCandidate {
  return {
    observation,
    qualityScore: observation.quality.score,
    observedAt: observation.capturedAtIso,
  };
}

/**
 * Runs the device-adapter import + reconciliation (golden journey #2).
 * The pair: the seeded MANUAL BP observation vs the imported DEVICE BP
 * observation — same metric, same window. Exactly two candidates (packet
 * scope — mirrors the M4 service's two-candidate contract).
 */
export function importDeviceObservation(): DeviceImportResult {
  if (imported) {
    return { ok: false, error: { kind: "import-already-completed" } };
  }
  const manual = observations.find(
    (observation) => observation.id === "obs_SYNTH-obs-bp-manual-0001",
  );
  if (manual === undefined) {
    // Defensive: the seed invariant is broken — programming error boundary.
    throw new Error("Observation store seed invariant violated: manual BP fixture missing.");
  }

  const importedObservation: ObservationDetailView = {
    ...DEVICE_BP_IMPORT_OBSERVATION,
  };
  const pair = reconcilePair(
    candidateOf(manual),
    candidateOf(importedObservation),
    DEMO_RECONCILE_POLICY,
  );

  // The winner is validated; the loser superseded (provenance intact).
  const updatedOriginals = applyReconciliationStates(
    [importedObservation, ...observations],
    pair,
  );
  const view = buildCanonicalView(pair, CANONICAL_BP_VIEW_INPUT);

  canonical = view;
  imported = true;
  // The canonical view leads the list (most recent record); originals follow.
  observations = [view.detail, ...updatedOriginals];

  const superseded = pair.loser.observation;
  return {
    ok: true,
    imported: pair.winner.observation,
    superseded,
    canonical: view,
    board: listObservationBoard(),
  };
}

/** Finds an observation view by id (the detail lookup). */
export function findObservation(id: string): ObservationDetailView | undefined {
  return observations.find((observation) => observation.id === id);
}

/** True when the id is the canonical view's id. */
export function isCanonicalObservationId(id: string): boolean {
  return canonical !== null && canonical.id === id;
}
