/**
 * DataBox corpus fixtures (M6-B B6, Lane B): the M3-B synthetic corpus
 * (8 evidence items + 4 observation events, PINNED to the 2026-09-10
 * reference world) enriched with the B6 filter/inspection vocabulary —
 * concept (metric) ids, source kinds, quality bands, model versions, and
 * transformation summaries.
 *
 * The enrichment NEVER alters the M3-B fields the existing journeys
 * assert (ids, summaries, day labels, captured labels, statuses) — the
 * evidence table and its tests stay byte-identical; only NEW fields are
 * layered on. Pure data, SYNTH-marked, zero PHI.
 */

import {
  SYNTHETIC_EVIDENCE_ITEMS,
  SYNTHETIC_OBSERVATION_EVENTS,
} from "../synthetic-data";
import type { DataboxAccessEventView, DataboxEntryView } from "./types";

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
// Entry enrichment (per M3-B fixture id — stable by construction).
// ---------------------------------------------------------------------------

interface EntryEnrichment {
  readonly conceptId: string;
  readonly sourceKind: DataboxEntryView["sourceKind"];
  readonly sourceLabel: string;
  readonly qualityBand: DataboxEntryView["qualityBand"];
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

// ---------------------------------------------------------------------------
// Access-history fixtures (the "view access history" entry point's data).
// ---------------------------------------------------------------------------

/** SYNTH access-history fixture events (pinned world; honestly labeled). */
export const DATABOX_ACCESS_EVENT_FIXTURES: readonly DataboxAccessEventView[] = [
  {
    eventId: "SYNTH-ACCESS-EVT-0001",
    action: "Share granted (scoped read, heart rate + BP log)",
    actor: "SYNTH-Clinic-A",
    atLabel: "Sep 9 (reference), 14:05",
    origin: "fixture",
  },
  {
    eventId: "SYNTH-ACCESS-EVT-0002",
    action: "Data accessed (scoped read)",
    actor: "SYNTH-Clinic-A",
    atLabel: "Sep 9 (reference), 16:41",
    origin: "fixture",
  },
];
