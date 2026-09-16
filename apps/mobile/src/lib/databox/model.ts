/**
 * Mobile DataBox model (M6-B B6, Lane B) — pure data + pure functions.
 *
 * The MIRROR of the web `apps/web/src/lib/databox/{types,fixtures,search}.ts`
 * over the same enriched M3-B corpus (12 entries: 8 evidence items + 4
 * observation events, PINNED to the 2026-09-10 reference world), the same
 * concept/source/quality filter vocabularies, the same collections, and
 * the same search/filter composition. The corpus fixture data is
 * DUPLICATED LOCALLY (byte-identical ids/titles/dayLabels/atLabels/isos/
 * statuses) because `apps/mobile` declares no web-lib dependency and adding
 * one would change `pnpm-lock.yaml`, which this packet must not touch —
 * the web `apps/web/src/lib/databox/fixtures.ts` + `lib/synthetic-data.ts`
 * remain the canonical source (recorded handoff: at engine wiring both
 * sides swap for the shared engine corpus).
 *
 * Differences from the web module (mobile-adapted, recorded):
 *   - NO `@orbb/ui` import: the timeline projection is `toTimelineGroups`
 *     (a day-grouped shape for React Native section rendering), not the
 *     web `toTimelineEntries` (`@orbb/ui`'s TimelineEntry);
 *   - live session records (manual captures, device imports) are NOT
 *     ingested into the mobile DataBox timeline at this milestone — they
 *     live on the Health tab; DataBox ingestion is the engine-wiring
 *     handoff (the same recorded decision as the web corpus pinning).
 *
 * The DataBox corpus stays in the PINNED SYNTH reference world
 * (2026-09-10 "Today") so timelines, tables and journeys stay
 * byte-stable. Zero PHI; every identity-like string SYNTH-marked. No
 * React Native imports — plain-node unit-testable.
 */

// ---------------------------------------------------------------------------
// Entry model (the merged evidence + observation corpus).
// ---------------------------------------------------------------------------

/** What kind of DataBox record an entry represents. */
export type DataboxEntryKind = "evidence" | "observation";

/** Source-kind filter vocabulary (from the provenance actors). */
export type DataboxSourceKind = "device" | "manual" | "chw" | "synthesized";

/** Confidence/quality band (derived; text-labeled, never color alone). */
export type DataboxQualityBand = "high" | "moderate" | "low" | "not-scored";

/** One entry of the DataBox corpus (evidence or observation). */
export interface DataboxEntryView {
  /** Stable entry id (the M3-B fixture ids, SYNTH-marked). */
  readonly id: string;
  readonly kind: DataboxEntryKind;
  /** Display title (e.g. "Resting heart rate 62 beats/min"). */
  readonly title: string;
  /** Human subtitle (provenance summary line). */
  readonly subtitle: string;
  /** Day group label (pinned reference world). */
  readonly dayLabel: string;
  /** Pre-formatted captured-time label. */
  readonly atLabel: string;
  /** Fixed ISO timestamp (ordering only). */
  readonly iso: string;
  /** Validation status (the M3-B vocabulary). */
  readonly status: "validated" | "pending" | "superseded";
  /** Concept (metric) filter vocabulary id. */
  readonly conceptId: string;
  /** Concept (metric) display label (e.g. "Heart rate"). */
  readonly conceptLabel: string;
  readonly sourceKind: DataboxSourceKind;
  readonly sourceLabel: string;
  readonly qualityBand: DataboxQualityBand;
  /** Quality score where one exists (observations; 0–1). */
  readonly qualityScore?: number;
  /** Evidence-label vocabulary for observation entries. */
  readonly evidenceLabel?: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  readonly evidenceState?: "measured" | "estimated" | "imported" | "derived";

  // -- Inspection (advanced) fields --------------------------------------
  /** Media type (evidence entries). */
  readonly mediaType?: "image" | "audio" | "document" | "waveform";
  /** Checksum prefix (evidence entries). */
  readonly checksumPrefix?: string;
  /** Retention class (evidence entries). */
  readonly retentionClass?: string;
  /** Provenance actor line (both kinds). */
  readonly provenanceActor: string;
  /** Model version for estimated observations (explicit; never silent). */
  readonly modelVersion?: string;
  /** Transformation summary for observations. */
  readonly transformations?: readonly string[];
  /** Observation id when this entry opens the B5 provenance detail. */
  readonly observationId?: string;
}

// ---------------------------------------------------------------------------
// Collections (the human-readable default grouping).
// ---------------------------------------------------------------------------

/** One collection (a human-named grouping of corpus entries). */
export interface DataboxCollectionView {
  /** SYNTH-marked collection id. */
  readonly collectionId: string;
  /** Human label (e.g. "Vital signs monitoring"). */
  readonly label: string;
  /** One-line description. */
  readonly description: string;
  /** The collection's entry ids (ordering follows the corpus order). */
  readonly entryIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Search + the four filters.
// ---------------------------------------------------------------------------

/** Time-filter vocabulary (the pinned reference world's span). */
export type DataboxTimeFilter = "all" | "today" | "last-7-days";

/** The full filter state (search + the four filters). */
export interface DataboxFilters {
  /** Free-text search over title/subtitle/concept/source labels. */
  readonly search: string;
  /** Filter 1 — time. */
  readonly time: DataboxTimeFilter;
  /** Filter 2 — concept (metric); "all" or a concept id. */
  readonly concept: string;
  /** Filter 3 — source; "all" or a source kind. */
  readonly source: string;
  /** Filter 4 — confidence/quality; "all" or a band. */
  readonly quality: string;
}

/** The initial filter state (no search, nothing filtered). */
export function initialDataboxFilters(): DataboxFilters {
  return { search: "", time: "all", concept: "all", source: "all", quality: "all" };
}

/** One option row for the filter controls (value + human label). */
export interface DataboxFilterOption {
  readonly value: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Concept (metric) vocabulary (the concept filter's domain).
// ---------------------------------------------------------------------------

/**
 * Concept ids group corpus entries for the concept filter + collections.
 * Documents/letters form their own concept (they are records, not metric
 * values); activity + sleep series share one concept (device-derived).
 */
export const DATABOX_CONCEPT_LABELS: Readonly<Record<string, string>> = {
  "concept-heart-rate": "Heart rate",
  "concept-blood-pressure": "Blood pressure",
  "concept-temperature": "Temperature",
  "concept-body-weight": "Body weight",
  "concept-activity-sleep": "Activity & sleep series",
  "concept-documents": "Documents & notes",
};

// ---------------------------------------------------------------------------
// The pinned M3-B corpus fixtures (duplicated byte-identically from the
// web `lib/synthetic-data.ts` — see the module header's recorded handoff).
// ---------------------------------------------------------------------------

/** The local duplicate of the M3-B evidence items (pure data). */
interface DataboxEvidenceFixture {
  readonly id: string;
  readonly dayLabel: string;
  readonly capturedAtLabel: string;
  readonly capturedAtIso: string;
  readonly mediaType: "image" | "audio" | "document" | "waveform";
  readonly status: "validated" | "pending" | "superseded";
  readonly summary: string;
  readonly checksumPrefix: string;
  readonly retentionClass: string;
  readonly provenanceActor: string;
}

/** The local duplicate of the M3-B observation events (pure data). */
interface DataboxObservationEventFixture {
  readonly id: string;
  readonly dayLabel: string;
  readonly atLabel: string;
  readonly iso: string;
  readonly title: string;
  readonly subtitle: string;
  readonly badge: string;
}

const SYNTHETIC_EVIDENCE_ITEMS: readonly DataboxEvidenceFixture[] = [
  {
    id: "SYNTH-EV-0001",
    dayLabel: "Today",
    capturedAtLabel: "Today, 08:05",
    capturedAtIso: "2026-09-10T08:05:00.000Z",
    mediaType: "waveform",
    status: "validated",
    summary: "Resting heart rate series",
    checksumPrefix: "sha256-SYNTH-7c4a8d09",
    retentionClass: "SYNTH-RT-2Y",
    provenanceActor: "SYNTH-Person-1 · wearable sync",
  },
  {
    id: "SYNTH-EV-0002",
    dayLabel: "Today",
    capturedAtLabel: "Today, 07:41",
    capturedAtIso: "2026-09-10T07:41:00.000Z",
    mediaType: "document",
    status: "pending",
    summary: "Manual blood pressure log page",
    checksumPrefix: "sha256-SYNTH-1f2e9b04",
    retentionClass: "SYNTH-RT-90D",
    provenanceActor: "SYNTH-Person-1 · manual upload",
  },
  {
    id: "SYNTH-EV-0003",
    dayLabel: "Yesterday",
    capturedAtLabel: "Yesterday, 20:30",
    capturedAtIso: "2026-09-09T20:30:00.000Z",
    mediaType: "image",
    status: "validated",
    summary: "Thermometer reading photo",
    checksumPrefix: "sha256-SYNTH-0aa3cd17",
    retentionClass: "SYNTH-RT-90D",
    provenanceActor: "SYNTH-Person-1 · manual upload",
  },
  {
    id: "SYNTH-EV-0004",
    dayLabel: "Yesterday",
    capturedAtLabel: "Yesterday, 09:12",
    capturedAtIso: "2026-09-09T09:12:00.000Z",
    mediaType: "waveform",
    status: "superseded",
    summary: "Resting heart rate series (earlier capture)",
    checksumPrefix: "sha256-SYNTH-5f8b23aa",
    retentionClass: "SYNTH-RT-2Y",
    provenanceActor: "SYNTH-Person-1 · wearable sync",
  },
  {
    id: "SYNTH-EV-0005",
    dayLabel: "Sep 8",
    capturedAtLabel: "Sep 8, 18:40",
    capturedAtIso: "2026-09-08T18:40:00.000Z",
    mediaType: "document",
    status: "validated",
    summary: "Weight scale note",
    checksumPrefix: "sha256-SYNTH-9d1f47be",
    retentionClass: "SYNTH-RT-7Y",
    provenanceActor: "SYNTH-Person-1 · manual entry",
  },
  {
    id: "SYNTH-EV-0006",
    dayLabel: "Sep 8",
    capturedAtLabel: "Sep 8, 08:02",
    capturedAtIso: "2026-09-08T08:02:00.000Z",
    mediaType: "image",
    status: "pending",
    summary: "Clinic letter scan",
    checksumPrefix: "sha256-SYNTH-3b7c51e0",
    retentionClass: "SYNTH-RT-7Y",
    provenanceActor: "SYNTH-CHW-2 · assisted capture",
  },
  {
    id: "SYNTH-EV-0007",
    dayLabel: "Sep 7",
    capturedAtLabel: "Sep 7, 12:15",
    capturedAtIso: "2026-09-07T12:15:00.000Z",
    mediaType: "audio",
    status: "validated",
    summary: "Symptom voice note",
    checksumPrefix: "sha256-SYNTH-8e2f60d3",
    retentionClass: "SYNTH-RT-90D",
    provenanceActor: "SYNTH-Person-1 · manual upload",
  },
  {
    id: "SYNTH-EV-0008",
    dayLabel: "Sep 6",
    capturedAtLabel: "Sep 6, 10:05",
    capturedAtIso: "2026-09-06T10:05:00.000Z",
    mediaType: "waveform",
    status: "validated",
    summary: "Overnight oximetry trace",
    checksumPrefix: "sha256-SYNTH-2a9d84f6",
    retentionClass: "SYNTH-RT-2Y",
    provenanceActor: "SYNTH-Device-A · automatic sync",
  },
];

const SYNTHETIC_OBSERVATION_EVENTS: readonly DataboxObservationEventFixture[] = [
  {
    id: "SYNTH-OBS-EVT-0001",
    dayLabel: "Today",
    atLabel: "Today, 08:06",
    iso: "2026-09-10T08:06:00.000Z",
    title: "Resting heart rate 62 beats/min",
    subtitle: "Method: wearable sync · quality 0.9 · estimated: no",
    badge: "Validated",
  },
  {
    id: "SYNTH-OBS-EVT-0002",
    dayLabel: "Today",
    atLabel: "Today, 07:42",
    iso: "2026-09-10T07:42:00.000Z",
    title: "Blood pressure logged manually",
    subtitle: "Method: manual entry · quality 0.8 · estimated: no",
    badge: "Pending",
  },
  {
    id: "SYNTH-OBS-EVT-0003",
    dayLabel: "Yesterday",
    atLabel: "Yesterday, 20:31",
    iso: "2026-09-09T20:31:00.000Z",
    title: "Temperature 36.8 °C",
    subtitle: "Method: photo estimate · quality 0.6 · estimated: yes",
    badge: "Validated",
  },
  {
    id: "SYNTH-OBS-EVT-0004",
    dayLabel: "Sep 8",
    atLabel: "Sep 8, 18:41",
    iso: "2026-09-08T18:41:00.000Z",
    title: "Weight 70.5 kg",
    subtitle: "Method: scale sync · quality 0.9 · estimated: no",
    badge: "Validated",
  },
];

// ---------------------------------------------------------------------------
// Entry enrichment (per M3-B fixture id — stable by construction; the same
// enrichment map as the web fixtures).
// ---------------------------------------------------------------------------

interface EntryEnrichment {
  readonly conceptId: string;
  readonly sourceKind: DataboxSourceKind;
  readonly sourceLabel: string;
  readonly qualityBand: DataboxQualityBand;
  readonly qualityScore?: number;
  readonly evidenceLabel?: DataboxEntryView["evidenceLabel"];
  readonly evidenceState?: DataboxEntryView["evidenceState"];
  readonly modelVersion?: string;
  readonly transformations?: readonly string[];
  readonly observationId?: string;
}

/** Per-id enrichment for the corpus (evidence + observation events). */
const EVIDENCE_ENRICHMENT: Readonly<Record<string, EntryEnrichment>> = {
  "SYNTH-EV-0001": {
    conceptId: "concept-heart-rate",
    sourceKind: "device",
    sourceLabel: "SYNTH-Device-A · wearable sync",
    qualityBand: "not-scored",
  },
  "SYNTH-EV-0002": {
    conceptId: "concept-blood-pressure",
    sourceKind: "manual",
    sourceLabel: "SYNTH-Person-1 · manual upload",
    qualityBand: "not-scored",
  },
  "SYNTH-EV-0003": {
    conceptId: "concept-temperature",
    sourceKind: "manual",
    sourceLabel: "SYNTH-Person-1 · manual upload",
    qualityBand: "not-scored",
  },
  "SYNTH-EV-0004": {
    conceptId: "concept-heart-rate",
    sourceKind: "device",
    sourceLabel: "SYNTH-Device-A · wearable sync",
    qualityBand: "not-scored",
  },
  "SYNTH-EV-0005": {
    conceptId: "concept-body-weight",
    sourceKind: "device",
    sourceLabel: "SYNTH-Scale-B · scale sync",
    qualityBand: "not-scored",
  },
  "SYNTH-EV-0006": {
    conceptId: "concept-documents",
    sourceKind: "chw",
    sourceLabel: "SYNTH-CHW-2 · assisted capture",
    qualityBand: "not-scored",
  },
  "SYNTH-EV-0007": {
    conceptId: "concept-documents",
    sourceKind: "manual",
    sourceLabel: "SYNTH-Person-1 · manual upload",
    qualityBand: "not-scored",
  },
  "SYNTH-EV-0008": {
    conceptId: "concept-activity-sleep",
    sourceKind: "device",
    sourceLabel: "SYNTH-Device-A · automatic sync",
    qualityBand: "not-scored",
  },
};

/** Observation-event enrichment (the B5 observation detail ids ride along). */
const OBSERVATION_ENRICHMENT: Readonly<Record<string, EntryEnrichment>> = {
  "SYNTH-OBS-EVT-0001": {
    conceptId: "concept-heart-rate",
    sourceKind: "device",
    sourceLabel: "SYNTH-Device-A · wearable sync",
    qualityBand: "high",
    qualityScore: 0.9,
    evidenceLabel: "DERIVED",
    evidenceState: "derived",
    modelVersion: "SYNTH-RestWindow v4 (device-side resting analysis)",
    transformations: ["Resting-window summary: 10-sample series → mean resting value (DERIVED)."],
    observationId: "obs_SYNTH-corpus-hr-0001",
  },
  "SYNTH-OBS-EVT-0002": {
    conceptId: "concept-blood-pressure",
    sourceKind: "manual",
    sourceLabel: "SYNTH-Person-1 · manual entry",
    qualityBand: "moderate",
    qualityScore: 0.7,
    evidenceLabel: "MEASURED",
    evidenceState: "measured",
    modelVersion: "No model involved — direct capture",
    transformations: [],
    observationId: "obs_SYNTH-corpus-bp-0002",
  },
  "SYNTH-OBS-EVT-0003": {
    conceptId: "concept-temperature",
    sourceKind: "manual",
    sourceLabel: "SYNTH-Person-1 · photo estimate",
    qualityBand: "moderate",
    qualityScore: 0.6,
    evidenceLabel: "ESTIMATED",
    evidenceState: "estimated",
    modelVersion: "SYNTH-ThermoVision v2.1 (thermometer-photo estimation)",
    transformations: [
      "Image estimation: thermometer reading estimated from the photo (ESTIMATED, never a measurement).",
    ],
    observationId: "obs_SYNTH-corpus-temp-0003",
  },
  "SYNTH-OBS-EVT-0004": {
    conceptId: "concept-body-weight",
    sourceKind: "device",
    sourceLabel: "SYNTH-Scale-B · scale sync",
    qualityBand: "high",
    qualityScore: 0.9,
    evidenceLabel: "MEASURED",
    evidenceState: "measured",
    modelVersion: "No model involved — direct capture",
    transformations: ["Unit normalization: 155.6 lb → 70.5 kg at the device-adapter seam."],
    observationId: "obs_SYNTH-corpus-wt-0004",
  },
};

function withConceptLabel(conceptId: string): string {
  return DATABOX_CONCEPT_LABELS[conceptId] ?? conceptId;
}

/** Maps the M3-B badge text onto the status vocabulary. */
function badgeToStatus(badge: string): DataboxEntryView["status"] {
  if (badge === "Validated") {
    return "validated";
  }
  if (badge === "Pending") {
    return "pending";
  }
  return "superseded";
}

/** Builds the enriched corpus (evidence + observations, recent-first). */
export function buildDataboxEntries(): readonly DataboxEntryView[] {
  const evidence: DataboxEntryView[] = SYNTHETIC_EVIDENCE_ITEMS.map((item) => {
    const enrichment = EVIDENCE_ENRICHMENT[item.id] ?? {
      conceptId: "concept-documents",
      sourceKind: "manual" as const,
      sourceLabel: item.provenanceActor,
      qualityBand: "not-scored" as const,
    };
    return {
      id: item.id,
      kind: "evidence",
      title: item.summary,
      subtitle: `Evidence · ${item.mediaType} · ${item.provenanceActor}`,
      dayLabel: item.dayLabel,
      atLabel: item.capturedAtLabel,
      iso: item.capturedAtIso,
      status: item.status,
      conceptId: enrichment.conceptId,
      conceptLabel: withConceptLabel(enrichment.conceptId),
      sourceKind: enrichment.sourceKind,
      sourceLabel: enrichment.sourceLabel,
      qualityBand: enrichment.qualityBand,
      ...(enrichment.qualityScore !== undefined
        ? { qualityScore: enrichment.qualityScore }
        : {}),
      ...(enrichment.evidenceLabel !== undefined
        ? { evidenceLabel: enrichment.evidenceLabel }
        : {}),
      ...(enrichment.evidenceState !== undefined
        ? { evidenceState: enrichment.evidenceState }
        : {}),
      mediaType: item.mediaType,
      checksumPrefix: item.checksumPrefix,
      retentionClass: item.retentionClass,
      provenanceActor: item.provenanceActor,
      ...(enrichment.modelVersion !== undefined
        ? { modelVersion: enrichment.modelVersion }
        : {}),
      ...(enrichment.transformations !== undefined
        ? { transformations: enrichment.transformations }
        : {}),
      ...(enrichment.observationId !== undefined
        ? { observationId: enrichment.observationId }
        : {}),
    };
  });

  const observations: DataboxEntryView[] = SYNTHETIC_OBSERVATION_EVENTS.map((event) => {
    const enrichment = OBSERVATION_ENRICHMENT[event.id] ?? {
      conceptId: "concept-documents",
      sourceKind: "synthesized" as const,
      sourceLabel: "SYNTH-Person-1 · synthesized fixture",
      qualityBand: "not-scored" as const,
    };
    return {
      id: event.id,
      kind: "observation",
      title: event.title,
      subtitle: event.subtitle,
      dayLabel: event.dayLabel,
      atLabel: event.atLabel,
      iso: event.iso,
      status: badgeToStatus(event.badge),
      conceptId: enrichment.conceptId,
      conceptLabel: withConceptLabel(enrichment.conceptId),
      sourceKind: enrichment.sourceKind,
      sourceLabel: enrichment.sourceLabel,
      qualityBand: enrichment.qualityBand,
      ...(enrichment.qualityScore !== undefined
        ? { qualityScore: enrichment.qualityScore }
        : {}),
      ...(enrichment.evidenceLabel !== undefined
        ? { evidenceLabel: enrichment.evidenceLabel }
        : {}),
      ...(enrichment.evidenceState !== undefined
        ? { evidenceState: enrichment.evidenceState }
        : {}),
      provenanceActor: event.subtitle,
      ...(enrichment.modelVersion !== undefined
        ? { modelVersion: enrichment.modelVersion }
        : {}),
      ...(enrichment.transformations !== undefined
        ? { transformations: enrichment.transformations }
        : {}),
      ...(enrichment.observationId !== undefined
        ? { observationId: enrichment.observationId }
        : {}),
    };
  });

  return [...evidence, ...observations].sort((a, b) => b.iso.localeCompare(a.iso));
}

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

/** Normalizes free-text search (case-insensitive, trimmed). */
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
// Timeline + collections projections (pure, RN-shaped).
// ---------------------------------------------------------------------------

/** One timeline row projection (the entry + its text status badge). */
export interface DataboxTimelineGroupEntry {
  /** The full corpus entry (the row renders from it). */
  readonly entry: DataboxEntryView;
  /** The status badge label (text is the state carrier). */
  readonly badge: string;
}

/** One day group of the timeline (consecutive same-day entries). */
export interface DataboxTimelineGroup {
  /** Day label ("Today", "Yesterday", "Sep 8" — pinned world). */
  readonly dayLabel: string;
  readonly entries: readonly DataboxTimelineGroupEntry[];
}

/**
 * Projects entries into day-grouped sections for React Native rendering
 * (the mobile adaptation of the web `toTimelineEntries` — no `@orbb/ui`
 * TimelineEntry dependency). Entries arrive recent-first; consecutive
 * entries sharing a `dayLabel` collapse under one group header.
 */
export function toTimelineGroups(
  entries: readonly DataboxEntryView[],
): readonly DataboxTimelineGroup[] {
  const groups: DataboxTimelineGroup[] = [];
  for (const entry of entries) {
    const badge = statusBadgeLabel(entry);
    const current = groups.length > 0 ? groups[groups.length - 1] : undefined;
    if (current !== undefined && current.dayLabel === entry.dayLabel) {
      groups[groups.length - 1] = {
        ...current,
        entries: [...current.entries, { entry, badge }],
      };
    } else {
      groups.push({ dayLabel: entry.dayLabel, entries: [{ entry, badge }] });
    }
  }
  return groups;
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
