/**
 * SYNTH evidence pack fixture (M6-A, Lane B): the single synthetic person's
 * ACTIVE evidence-pack version the intent journey displays and compiles
 * against — a structural mirror of the M5-A A36 pack, in wire form.
 *
 * PHI-free by construction (the A36 discipline): every entry summarizes ONE
 * capability (metric + method) with window coverage, observation counts,
 * quality mixes, and the provenance actor CLASS — never raw values, never
 * observation ids, never actor ids.
 *
 * RECORDED DECISIONS:
 *   - The pack is BUILT relative to an injected `now` (30-day windows ending
 *     at `now`), so the fixture is always current for display; it is
 *     DETERMINISTIC given `now` (pure function, directly unit-testable —
 *     the same discipline as the M4-B synthetic catalog).
 *   - Entry ids are SYNTH-marked fixtures of the content-addressed grammar
 *     (`evpe_<body>`); the real content-addressed derivation (domain-separated
 *     SHA-256 of the canonical entry content) lives in @orbb/intents and
 *     arrives with the engine wiring — recorded handoff.
 *   - The pack claims manual methods (person actor — the M4-B capture
 *     history) AND device seam methods (device actor — the M4-C seam's
 *     summarized capabilities). Claiming seam coverage does NOT make seam
 *     methods executable: the matcher mirror still drops them (`no-source`)
 *     because no device source is registered (display-only seam). This
 *     separation — PACK COVERAGE vs SOURCE REGISTRATION — is exactly the
 *     A40 boundary the review screen's drop audit renders.
 *   - The contentHash is a SYNTH-marked fixture string (the DataBox journey
 *     checksum convention, e.g. `sha256-SYNTH-…`), not a real digest: the
 *     real hash arrives with the engine wiring.
 */

import { SYNTHETIC_PERSON_ID } from "../capture/catalog";
import type {
  IntentEvidencePackView,
  IntentPackEntryView,
} from "./types";

/** Pack id of the synthetic person's single pack (SYNTH-marked fixture). */
export const SYNTHETIC_PACK_ID = "evpk_SYNTH-pack-0001";

/** Content hash fixture (display + explainability reference only). */
export const SYNTHETIC_PACK_CONTENT_HASH = "sha256-SYNTH-pack-v1-4d1f0a2b";

/** Coverage window length of the fixture entries (30 days, half-open). */
const WINDOW_DAYS = 30;

/** One fixture entry spec (before windowing against `now`). */
interface PackEntrySpec {
  readonly metricId: string;
  readonly methodId: string;
  readonly count: number;
  readonly measured: number;
  readonly estimated: number;
  readonly meanQuality: number;
  readonly provenanceActorClass: "person" | "device" | "source";
}

/**
 * The fixture entries — coverage varies per metric/method on purpose so the
 * composer's coverage badges and the review screen's explainability trail
 * render a rich, honest landscape:
 *   - every manual method is person-actor with a modest count;
 *   - every device seam method is device-actor with a larger count;
 *   - step/sleep manual entries are ESTIMATED (the M4-B evidence-note
 *     discipline: typed-from-memory entries are estimates, not measurements).
 */
const ENTRY_SPECS: readonly PackEntrySpec[] = [
  {
    metricId: "SYNTH-metric-bp-systolic",
    methodId: "SYNTH-method-bpsys-manual",
    count: 12,
    measured: 12,
    estimated: 0,
    meanQuality: 0.82,
    provenanceActorClass: "person",
  },
  {
    metricId: "SYNTH-metric-bp-systolic",
    methodId: "SYNTH-method-cuff-bp-panel",
    count: 20,
    measured: 20,
    estimated: 0,
    meanQuality: 0.91,
    provenanceActorClass: "device",
  },
  {
    metricId: "SYNTH-metric-bp-diastolic",
    methodId: "SYNTH-method-bpdia-manual",
    count: 12,
    measured: 12,
    estimated: 0,
    meanQuality: 0.82,
    provenanceActorClass: "person",
  },
  {
    metricId: "SYNTH-metric-heart-rate",
    methodId: "SYNTH-method-hr-manual",
    count: 6,
    measured: 6,
    estimated: 0,
    meanQuality: 0.72,
    provenanceActorClass: "person",
  },
  {
    metricId: "SYNTH-metric-heart-rate",
    methodId: "SYNTH-method-wearable-heart-rate",
    count: 30,
    measured: 30,
    estimated: 0,
    meanQuality: 0.88,
    provenanceActorClass: "device",
  },
  {
    metricId: "SYNTH-metric-body-weight",
    methodId: "SYNTH-method-wt-manual",
    count: 8,
    measured: 8,
    estimated: 0,
    meanQuality: 0.88,
    provenanceActorClass: "person",
  },
  {
    metricId: "SYNTH-metric-body-weight",
    methodId: "SYNTH-method-scale-body-weight",
    count: 8,
    measured: 8,
    estimated: 0,
    meanQuality: 0.95,
    provenanceActorClass: "device",
  },
  {
    metricId: "SYNTH-metric-step-count",
    methodId: "SYNTH-method-steps-manual",
    count: 4,
    measured: 0,
    estimated: 4,
    meanQuality: 0.42,
    provenanceActorClass: "person",
  },
  {
    metricId: "SYNTH-metric-step-count",
    methodId: "SYNTH-method-wearable-step-count",
    count: 60,
    measured: 60,
    estimated: 0,
    meanQuality: 0.9,
    provenanceActorClass: "device",
  },
  {
    metricId: "SYNTH-metric-sleep-minutes",
    methodId: "SYNTH-method-sleep-manual",
    count: 10,
    measured: 0,
    estimated: 10,
    meanQuality: 0.5,
    provenanceActorClass: "person",
  },
  {
    metricId: "SYNTH-metric-sleep-minutes",
    methodId: "SYNTH-method-wearable-sleep-minutes",
    count: 30,
    measured: 30,
    estimated: 0,
    meanQuality: 0.85,
    provenanceActorClass: "device",
  },
];

/** Deterministic fixture entry id for one spec (SYNTH-marked grammar). */
function fixtureEntryId(spec: PackEntrySpec): string {
  return `evpe_SYNTH-${spec.metricId.replace("SYNTH-metric-", "")}-${spec.methodId
    .replace("SYNTH-method-", "")
    .replace(/-panel$/, "")}-v1`;
}

/**
 * Builds the synthetic person's ACTIVE evidence pack (version 1) with
 * 30-day coverage windows ending at `now`. Deterministic given `now`.
 */
export function buildSyntheticEvidencePack(now: Date): IntentEvidencePackView {
  const windowStart = new Date(
    now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = now.toISOString();
  const entries: IntentPackEntryView[] = ENTRY_SPECS.map((spec) => ({
    entryId: fixtureEntryId(spec),
    metricId: spec.metricId,
    methodId: spec.methodId,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
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
  }));
  return {
    packId: SYNTHETIC_PACK_ID,
    personId: SYNTHETIC_PERSON_ID,
    version: 1,
    contentHash: SYNTHETIC_PACK_CONTENT_HASH,
    entries,
  };
}

/** Pack entries covering one metric (display grouping helper). */
export function packEntriesForMetric(
  pack: IntentEvidencePackView,
  metricId: string,
): readonly IntentPackEntryView[] {
  return pack.entries.filter((entry) => entry.metricId === metricId);
}
