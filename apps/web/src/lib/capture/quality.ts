import type { DueWindowTone } from "@orbb/ui";
import type { CaptureQualityState } from "./types";

/**
 * Quality-state mapping (M4-B): the review step's self-assessment maps onto
 * the completion-quality domain vocabulary (`complete | partial |
 * low-quality`) and onto a normalized domain quality score in [0, 1].
 *
 * Score derivation (recorded assumption): the self-assessed state maps to
 * a deterministic point of the method's typical-quality range —
 *   complete     -> typicalQuality.max (the method delivered its typical best)
 *   partial      -> 0.75 * typicalQuality.min (between the partial floor and
 *                   the typical minimum)
 *   low-quality  -> 0.25 * typicalQuality.min (below the partial floor)
 *
 * These points are chosen so `classifyQualityScore` — the mirror of the
 * engine's A31 default `TypicalRangeQualityPolicy` (partial floor fraction
 * 0.5) — classifies each derived score back to the SAME state for every
 * method in the catalog (round-trip proven by unit tests). The recorded
 * state itself is the self-assessment and is never re-derived at runtime:
 * partial/low-quality submissions land as such, never silently upgraded.
 */

/** Mirror of the A31 default partial-floor fraction (recorded assumption). */
export const CAPTURE_PARTIAL_FLOOR_FRACTION = 0.5;

/** Visible labels for the quality states (text is the status carrier). */
export const CAPTURE_QUALITY_LABELS: Readonly<Record<CaptureQualityState, string>> = {
  complete: "Complete",
  partial: "Partial",
  "low-quality": "Low quality",
};

/** Badge tones for the quality states (reinforcement only — WCAG 1.4.1). */
export const CAPTURE_QUALITY_TONES: Readonly<Record<CaptureQualityState, DueWindowTone>> = {
  complete: "success",
  partial: "warning",
  "low-quality": "danger",
};

/** Typical-quality range shape consumed by the pure quality functions. */
export interface TypicalQualityLike {
  readonly min: number;
  readonly max: number;
}

function assertUsableRange(typical: TypicalQualityLike): void {
  if (
    !Number.isFinite(typical.min) ||
    !Number.isFinite(typical.max) ||
    typical.min <= 0 ||
    typical.max > 1 ||
    typical.min > typical.max
  ) {
    throw new RangeError(
      "Typical quality range must have 0 < min <= max <= 1 (the catalog invariant keeps every manual method's partial/low-quality score space non-degenerate).",
    );
  }
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * Derives the domain quality score in [0, 1] from the self-assessed state
 * and the method's typical quality range. Pure and deterministic.
 */
export function qualityScoreFromState(
  state: CaptureQualityState,
  typical: TypicalQualityLike,
): number {
  assertUsableRange(typical);
  switch (state) {
    case "complete":
      return round3(typical.max);
    case "partial":
      return round3(0.75 * typical.min);
    case "low-quality":
      return round3(0.25 * typical.min);
  }
}

/**
 * Classifies a quality score against a typical-quality range using the
 * A31-default policy semantics (score >= min -> complete; score >=
 * partialFloorFraction * min -> partial; otherwise low-quality). Pure
 * mirror of the engine's classification so round-trips are provable.
 */
export function classifyQualityScore(
  score: number,
  typical: TypicalQualityLike,
): CaptureQualityState {
  assertUsableRange(typical);
  if (score >= typical.min) {
    return "complete";
  }
  if (score >= CAPTURE_PARTIAL_FLOOR_FRACTION * typical.min) {
    return "partial";
  }
  return "low-quality";
}
