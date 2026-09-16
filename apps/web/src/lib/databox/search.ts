/**
 * DataBox search + filter model (M6-B B6, Lane B) — pure functions over
 * the observation board. The frozen §DataBox UX contract: timeline plus
 * collections, human-readable by default, with SEARCH and the four
 * filters — TIME, CONCEPT (metric), SOURCE, CONFIDENCE/QUALITY.
 *
 * Everything here is pure (no hooks, no fetch) so the DataBox surface and
 * its unit tests share one deterministic derivation. All fixture
 * timestamps are pinned to the synthetic reference date; the time filter
 * compares against the fixed reference instant, never a wall clock.
 */

import type { ObservationDetailView } from "../observations/types";

// ---------------------------------------------------------------------------
// Filter model.
// ---------------------------------------------------------------------------

export const DATABOX_TIME_FILTERS = ["all", "today", "last-7-days"] as const;

export type DataboxTimeFilter = (typeof DATABOX_TIME_FILTERS)[number];

export const DATABOX_TIME_FILTER_LABELS: Readonly<Record<DataboxTimeFilter, string>> = {
  all: "All time",
  today: "Today (Sep 10)",
  "last-7-days": "Last 7 days",
};

export const DATABOX_QUALITY_FILTERS = ["all", "complete", "partial", "low-quality"] as const;

export type DataboxQualityFilter = (typeof DATABOX_QUALITY_FILTERS)[number];

export const DATABOX_QUALITY_FILTER_LABELS: Readonly<
  Record<DataboxQualityFilter, string>
> = {
  all: "Any quality",
  complete: "Complete",
  partial: "Partial",
  "low-quality": "Low quality",
};

/** The combined filter state (one value per §DataBox UX filter axis). */
export interface DataboxFilters {
  /** Free-text search (matches metric, method, value, evidence, summary). */
  readonly search: string;
  /** TIME filter (reference-day-relative). */
  readonly time: DataboxTimeFilter;
  /** CONCEPT (metric) filter — the metric id, or "all". */
  readonly concept: string;
  /** SOURCE filter — the source kind, or "all". */
  readonly source: string;
  /** CONFIDENCE/QUALITY filter. */
  readonly quality: DataboxQualityFilter;
}

export const EMPTY_DATABOX_FILTERS: DataboxFilters = {
  search: "",
  time: "all",
  concept: "all",
  source: "all",
  quality: "all",
};

export function isEmptyDataboxFilters(filters: DataboxFilters): boolean {
  return (
    filters.search === "" &&
    filters.time === "all" &&
    filters.concept === "all" &&
    filters.source === "all" &&
    filters.quality === "all"
  );
}

// ---------------------------------------------------------------------------
// Derivations (pure).
// ---------------------------------------------------------------------------

/** Day-of the fixed reference instant, as "YYYY-MM-DD" (UTC). */
function referenceDay(referenceNowIso: string): string {
  return referenceNowIso.slice(0, 10);
}

/** True when the observation's capture day passes the TIME filter. Pure. */
export function matchesTimeFilter(
  observation: ObservationDetailView,
  time: DataboxTimeFilter,
  referenceNowIso: string,
): boolean {
  if (time === "all") {
    return true;
  }
  const day = observation.capturedAtIso.slice(0, 10);
  if (time === "today") {
    return day === referenceDay(referenceNowIso);
  }
  // last-7-days: [reference - 7 days, reference] inclusive.
  const referenceMs = new Date(referenceNowIso).getTime();
  const capturedMs = new Date(observation.capturedAtIso).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return capturedMs >= referenceMs - sevenDaysMs && capturedMs <= referenceMs;
}

/** Case-insensitive free-text match across the human-readable fields. */
export function matchesSearch(
  observation: ObservationDetailView,
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  const haystack = [
    observation.id,
    observation.metricLabel,
    observation.valueLabel,
    observation.method.label,
    observation.method.id,
    observation.capturedBy,
    observation.deviceOrPerson,
    observation.evidenceLabel,
    ...(observation.evidence !== undefined
      ? [observation.evidence.id, observation.evidence.summary]
      : []),
    ...(observation.modelVersion !== undefined ? [observation.modelVersion] : []),
  ]
    .join(" \n ")
    .toLowerCase();
  return haystack.includes(needle);
}

/** Applies search + the four filters. Pure; order preserved (most recent first). */
export function filterObservations(
  observations: readonly ObservationDetailView[],
  filters: DataboxFilters,
  referenceNowIso: string,
): readonly ObservationDetailView[] {
  return observations.filter(
    (observation) =>
      matchesSearch(observation, filters.search) &&
      matchesTimeFilter(observation, filters.time, referenceNowIso) &&
      (filters.concept === "all" || observation.metricId === filters.concept) &&
      (filters.source === "all" || observation.sourceKind === filters.source) &&
      (filters.quality === "all" || observation.quality.state === filters.quality),
  );
}

/** One human-readable collection (concept grouping). */
export interface DataboxCollection {
  readonly metricId: string;
  readonly metricLabel: string;
  readonly count: number;
  /** The collection's observations, most recent first. */
  readonly observations: readonly ObservationDetailView[];
}

/**
 * Derives the COLLECTIONS (concept groupings) from the current — already
 * filtered — observation set. Pure; stable metric order (first appearance).
 */
export function deriveCollections(
  observations: readonly ObservationDetailView[],
): readonly DataboxCollection[] {
  const order: string[] = [];
  const byMetric = new Map<string, ObservationDetailView[]>();
  for (const observation of observations) {
    let group = byMetric.get(observation.metricId);
    if (group === undefined) {
      group = [];
      byMetric.set(observation.metricId, group);
      order.push(observation.metricId);
    }
    group.push(observation);
  }
  return order.map((metricId) => {
    const group = byMetric.get(metricId) ?? [];
    return {
      metricId,
      metricLabel: group[0]?.metricLabel ?? metricId,
      count: group.length,
      observations: group,
    };
  });
}

/** The distinct concept options (metric id + label), stable order. */
export function conceptOptions(
  observations: readonly ObservationDetailView[],
): readonly { readonly id: string; readonly label: string }[] {
  return deriveCollections(observations).map((collection) => ({
    id: collection.metricId,
    label: collection.metricLabel,
  }));
}

/** The distinct source-kind options present, stable order. */
export function sourceOptions(
  observations: readonly ObservationDetailView[],
): readonly { readonly id: string; readonly label: string }[] {
  const seen = new Map<string, string>();
  for (const observation of observations) {
    if (!seen.has(observation.sourceKind)) {
      seen.set(
        observation.sourceKind,
        observation.sourceKind === "manual"
          ? "Manual entry"
          : observation.sourceKind === "device-adapter"
            ? "Device adapter import"
            : "Synthesized by ORBB",
      );
    }
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}
