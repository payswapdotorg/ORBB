/**
 * DataBox search/filter/collection engine (M6-B B6, Lane B) — pure
 * functions over the corpus entries.
 *
 * No hooks, no DOM, no fetch — directly unit-testable (the lib/ pattern).
 * The four filters (time, concept, source, confidence/quality) and the
 * free-text search compose; every predicate is explicit and every empty
 * result is the filters' honest truth.
 */

import type {
  DataboxCollectionView,
  DataboxEntryView,
  DataboxFilterOption,
  DataboxFilters,
  DataboxQualityBand,
  DataboxSourceKind,
  DataboxTimeFilter,
} from "./types";

// ---------------------------------------------------------------------------
// Filter vocabularies (derived from the corpus; never invented).
// ---------------------------------------------------------------------------

/** Time-filter options (the pinned corpus spans the reference week). */
export const DATABOX_TIME_OPTIONS: readonly DataboxFilterOption[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "last-7-days", label: "Last 7 days" },
];

/** Source-kind filter options. */
export const DATABOX_SOURCE_OPTIONS: readonly DataboxFilterOption[] = [
  { value: "all", label: "All sources" },
  { value: "device", label: "Device (automatic sync)" },
  { value: "manual", label: "Manual (typed or uploaded)" },
  { value: "chw", label: "CHW-assisted" },
  { value: "synthesized", label: "Synthesized fixtures" },
];

/** Quality-band filter options (the confidence/quality filter). */
export const DATABOX_QUALITY_OPTIONS: readonly DataboxFilterOption[] = [
  { value: "all", label: "Any quality" },
  { value: "high", label: "High (0.8+)" },
  { value: "moderate", label: "Moderate (0.5–0.79)" },
  { value: "low", label: "Low (below 0.5)" },
  { value: "not-scored", label: "Not scored (raw evidence)" },
];

/** The pinned reference "today" of the SYNTH corpus (M3-B design). */
export const DATABOX_REFERENCE_NOW = new Date("2026-09-10T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Search + filters (pure).
// ---------------------------------------------------------------------------

/** Normalizes free-text search (case/diacritic-insensitive-ish, trimmed). */
function searchNeedle(search: string): string {
  return search.trim().toLowerCase();
}

function haystackOf(entry: DataboxEntryView): string {
  return [
    entry.title,
    entry.subtitle,
    entry.conceptLabel,
    entry.sourceLabel,
    entry.provenanceActor,
    entry.evidenceLabel ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** True when the entry is inside the time filter's bucket. */
function matchesTime(
  entry: DataboxEntryView,
  time: DataboxTimeFilter,
): boolean {
  if (time === "all") {
    return true;
  }
  const reference = DATABOX_REFERENCE_NOW.getTime();
  const at = new Date(entry.iso).getTime();
  if (time === "today") {
    const dayStart = new Date("2026-09-10T00:00:00.000Z").getTime();
    const dayEnd = new Date("2026-09-11T00:00:00.000Z").getTime();
    return at >= dayStart && at < dayEnd;
  }
  // last-7-days
  return at >= reference - 7 * 24 * 60 * 60 * 1000;
}

/** True when the entry matches the concept filter. */
function matchesConcept(entry: DataboxEntryView, concept: string): boolean {
  return concept === "all" || entry.conceptId === concept;
}

/** True when the entry matches the source filter. */
function matchesSource(entry: DataboxEntryView, source: string): boolean {
  return source === "all" || entry.sourceKind === (source as DataboxSourceKind);
}

/** True when the entry matches the quality-band filter. */
function matchesQuality(entry: DataboxEntryView, quality: string): boolean {
  return quality === "all" || entry.qualityBand === (quality as DataboxQualityBand);
}

/**
 * Applies the search text and the four filters (pure). Result order keeps
 * the corpus order (most recent first); empty results are honest.
 */
export function filterDataboxEntries(
  entries: readonly DataboxEntryView[],
  filters: DataboxFilters,
): readonly DataboxEntryView[] {
  const needle = searchNeedle(filters.search);
  return entries.filter((entry) => {
    if (needle !== "" && !haystackOf(entry).includes(needle)) {
      return false;
    }
    if (!matchesTime(entry, filters.time)) {
      return false;
    }
    if (!matchesConcept(entry, filters.concept)) {
      return false;
    }
    if (!matchesSource(entry, filters.source)) {
      return false;
    }
    if (!matchesQuality(entry, filters.quality)) {
      return false;
    }
    return true;
  });
}

/** Counts the active (non-default) filters — the summary line's number. */
export function countActiveFilters(filters: DataboxFilters): number {
  let count = 0;
  if (searchNeedle(filters.search) !== "") {
    count += 1;
  }
  if (filters.time !== "all") {
    count += 1;
  }
  if (filters.concept !== "all") {
    count += 1;
  }
  if (filters.source !== "all") {
    count += 1;
  }
  if (filters.quality !== "all") {
    count += 1;
  }
  return count;
}

/** Derives the concept-filter options from the corpus (stable order). */
export function databoxConceptOptions(
  entries: readonly DataboxEntryView[],
): readonly DataboxFilterOption[] {
  const byId = new Map<string, string>();
  for (const entry of entries) {
    if (!byId.has(entry.conceptId)) {
      byId.set(entry.conceptId, entry.conceptLabel);
    }
  }
  return [
    { value: "all", label: "All metrics" },
    ...[...byId.entries()].map(([value, label]) => ({ value, label })),
  ];
}

// ---------------------------------------------------------------------------
// Timeline + collections projections (pure).
// ---------------------------------------------------------------------------

/** Projects entries into the @orbb/ui Timeline shape (day-grouped). */
export function toTimelineEntries(
  entries: readonly DataboxEntryView[],
): readonly {
  at: string;
  title: string;
  subtitle: string;
  badge: string;
  group: string;
}[] {
  return entries.map((entry) => ({
    at: entry.atLabel,
    title: entry.title,
    subtitle: entry.subtitle,
    badge: statusBadgeLabel(entry),
    group: entry.dayLabel,
  }));
}

/** The status badge label (text is the state carrier). */
export function statusBadgeLabel(entry: DataboxEntryView): string {
  if (entry.status === "validated") {
    return "Validated";
  }
  if (entry.status === "pending") {
    return "Pending";
  }
  return "Superseded";
}

/** The collection definitions (concept-driven, human-readable labels). */
export const DATABOX_COLLECTIONS: readonly {
  readonly collectionId: string;
  readonly label: string;
  readonly description: string;
  readonly conceptIds: readonly string[];
}[] = [
  {
    collectionId: "SYNTH-COLL-VITALS",
    label: "Vital signs monitoring",
    description: "Heart rate, blood pressure, and temperature records.",
    conceptIds: ["concept-heart-rate", "concept-blood-pressure", "concept-temperature"],
  },
  {
    collectionId: "SYNTH-COLL-BODY",
    label: "Body composition",
    description: "Weight and body measurement records.",
    conceptIds: ["concept-body-weight"],
  },
  {
    collectionId: "SYNTH-COLL-ACTIVITY-SLEEP",
    label: "Activity & sleep",
    description: "Movement and sleep records (device-derived series).",
    conceptIds: ["concept-activity-sleep"],
  },
  {
    collectionId: "SYNTH-COLL-DOCUMENTS",
    label: "Documents & notes",
    description: "Scans, letters, voice notes, and log pages.",
    conceptIds: ["concept-documents"],
  },
];

/** Builds the collection views over the (filtered) entries (pure). */
export function buildCollections(
  entries: readonly DataboxEntryView[],
): readonly DataboxCollectionView[] {
  return DATABOX_COLLECTIONS.map((collection) => ({
    collectionId: collection.collectionId,
    label: collection.label,
    description: collection.description,
    entryIds: entries
      .filter((entry) => collection.conceptIds.includes(entry.conceptId))
      .map((entry) => entry.id),
  }));
}
