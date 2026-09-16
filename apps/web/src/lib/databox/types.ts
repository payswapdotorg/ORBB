/**
 * DataBox view model (M6-B B6, Lane B) — types only.
 *
 * The §DataBox UX model: a TIMELINE plus COLLECTIONS as the default
 * (human-readable) presentation, with SEARCH and the four filters —
 * time, concept (metric), source, confidence/quality — plus the advanced
 * inspection affordance (raw evidence, metadata, provenance, model
 * versions) and the entry points for export, share, revoke access, and
 * access history.
 *
 * The DataBox corpus stays in the PINNED SYNTH reference world
 * (2026-09-10 "Today") of the M3-B fixtures so tables, timelines and
 * journeys stay byte-stable (the same design decision M3-B made). Live
 * session records (manual captures, device imports) remain on the
 * Measurements surface; their ingestion into the DataBox timeline is the
 * engine-wiring handoff (M2 upload/finalize flow) — recorded, never
 * faked.
 */

import type { TimelineEntry } from "@orbb/ui";

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

/** One option row for the filter selects (value + human label). */
export interface DataboxFilterOption {
  readonly value: string;
  readonly label: string;
}

/** A timeline entry projection (the @orbb/ui Timeline shape). */
export type DataboxTimelineEntry = TimelineEntry;

// ---------------------------------------------------------------------------
// Access history (the "view access history" entry point's data).
// ---------------------------------------------------------------------------

/** One access-history event (fixture or session; honestly labeled). */
export interface DataboxAccessEventView {
  readonly eventId: string;
  /** What happened ("Share granted", "Access revoked", "Data accessed"). */
  readonly action: string;
  /** Who (SYNTH-marked recipient/actor). */
  readonly actor: string;
  /** Pre-formatted time label (pinned world for fixtures). */
  readonly atLabel: string;
  /** Fixture vs live-session event (never conflated). */
  readonly origin: "fixture" | "session";
}
