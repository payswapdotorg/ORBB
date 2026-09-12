import type { BarChartDatum, TimelineEntry } from "@orbb/ui";

/**
 * Synthetic fixtures for the M3-B DataBox journey (web shell).
 *
 * Agent-protocol test-data rules:
 *   - Nothing here is or resembles real PHI: every identity-like string
 *     (ids, actors, recipients, checksums, retention classes) carries the
 *     `SYNTH` marker so fixtures can never be confused with real records.
 *   - No wall-clock values: labels are pinned to a fixed synthetic
 *     reference date (2026-09-10, "Today") so tables, timelines and
 *     Playwright journeys stay byte-stable across runs.
 *   - The file is pure data + pure derivation functions (no hooks, no DOM
 *     types) so server components, client components and the API route
 *     handler can all import it.
 */

/** Day label used for the fixed "today" of the synthetic fixtures. */
export const SYNTHETIC_REFERENCE_TODAY = "Today";

export type EvidenceMediaType = "image" | "audio" | "document" | "waveform";

export type EvidenceValidationStatus = "validated" | "pending" | "superseded";

/** Human labels for the evidence validation states. */
export const EVIDENCE_STATUS_LABELS: Readonly<Record<EvidenceValidationStatus, string>> = {
  validated: "Validated",
  pending: "Pending",
  superseded: "Superseded",
};

export interface SyntheticEvidenceItem {
  /** Obviously fake evidence id (`SYNTH-EV-…`). */
  readonly id: string;
  /** Day group label for the timeline view ("Today", "Yesterday", "Sep 8"). */
  readonly dayLabel: string;
  /** Pre-formatted captured-time label for the table column. */
  readonly capturedAtLabel: string;
  /** Fixed ISO timestamp used only for ordering (sorting is the caller's job). */
  readonly capturedAtIso: string;
  readonly mediaType: EvidenceMediaType;
  readonly status: EvidenceValidationStatus;
  /** Short human description of the captured evidence. */
  readonly summary: string;
  /** Synthetic checksum prefix (hex-like, but marked `SYNTH`). */
  readonly checksumPrefix: string;
  /** Synthetic retention class id. */
  readonly retentionClass: string;
  /** Synthetic provenance actor description. */
  readonly provenanceActor: string;
}

/**
 * Synthetic evidence items, defined most-recent-first (this is also the
 * default, unsorted order of the DataBox evidence table).
 */
export const SYNTHETIC_EVIDENCE_ITEMS: readonly SyntheticEvidenceItem[] = [
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

/** A synthetic observation event for the DataBox timeline view. */
export interface SyntheticObservationEvent {
  /** Obviously fake event id (`SYNTH-OBS-EVT-…`). */
  readonly id: string;
  /** Day group label (matches the evidence day labels). */
  readonly dayLabel: string;
  /** Pre-formatted timestamp label. */
  readonly atLabel: string;
  /** Fixed ISO timestamp used only for ordering. */
  readonly iso: string;
  readonly title: string;
  readonly subtitle: string;
  /** Validation-state badge text. */
  readonly badge: string;
}

/**
 * Synthetic observation events, interleaved with evidence captures in the
 * timeline view. Provenance fields are folded into the subtitle line
 * (captured by → method → quality) per the Provenance UX contract.
 */
export const SYNTHETIC_OBSERVATION_EVENTS: readonly SyntheticObservationEvent[] = [
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

/**
 * Builds the merged evidence + observation timeline for the DataBox
 * timeline view: most recent first, grouped by day label (consecutive
 * entries sharing a `group` render under one day header — the `Timeline`
 * component's own grouping contract).
 */
export function buildSyntheticTimelineEntries(): readonly TimelineEntry[] {
  const merged: readonly { iso: string; entry: TimelineEntry }[] = [
    ...SYNTHETIC_EVIDENCE_ITEMS.map((item) => ({
      iso: item.capturedAtIso,
      entry: {
        at: item.capturedAtLabel,
        title: item.summary,
        subtitle: `Evidence · ${item.mediaType} · ${item.provenanceActor}`,
        badge: EVIDENCE_STATUS_LABELS[item.status],
        group: item.dayLabel,
      } satisfies TimelineEntry,
    })),
    ...SYNTHETIC_OBSERVATION_EVENTS.map((event) => ({
      iso: event.iso,
      entry: {
        at: event.atLabel,
        title: event.title,
        subtitle: event.subtitle,
        badge: event.badge,
        group: event.dayLabel,
      } satisfies TimelineEntry,
    })),
  ];
  return [...merged]
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .map((item) => item.entry);
}

/** The synthetic metric the measurement summary card charts (M3-B). */
export interface SyntheticMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const SYNTHETIC_METRIC: SyntheticMetric = {
  id: "SYNTH-metric-rhr",
  label: "Resting heart rate",
  unit: "beats/min",
  min: 30,
  max: 220,
  step: 1,
};

/**
 * Synthetic resting-heart-rate series for the measurement summary
 * sparkline (most recent last).
 */
export const SYNTHETIC_RESTING_HEART_RATE_SERIES: readonly number[] = [
  68, 67, 66, 64, 63, 64, 62, 61, 62, 60,
];

/** Latest synthetic resting-heart-rate reading (sparkline context line). */
export const SYNTHETIC_LATEST_HEART_RATE = SYNTHETIC_RESTING_HEART_RATE_SERIES.at(-1) ?? 0;

/** Synthetic capture counts by day for the measurement summary bar chart. */
export const SYNTHETIC_CAPTURE_COUNTS_BY_DAY: readonly BarChartDatum[] = [
  { label: "Mon", value: 2 },
  { label: "Tue", value: 3 },
  { label: "Wed", value: 5 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 3 },
  { label: "Sat", value: 2 },
  { label: "Sun", value: 1 },
];

/** The synthetic "share with clinician" consent grant under review. */
export interface SyntheticConsentShare {
  readonly grantId: string;
  readonly recipientName: string;
  /** Purpose block copy (the "why" of the request). */
  readonly purpose: string;
  /** Scope list items (the exact data covered). */
  readonly scope: readonly string[];
  /** Pre-formatted expiry label. */
  readonly expiryLabel: string;
}

export const SYNTHETIC_CLINIC_SHARE: SyntheticConsentShare = {
  grantId: "SYNTH-GRANT-CARE-001",
  recipientName: "SYNTH-Clinic-A",
  purpose:
    "Your care team at SYNTH-Clinic-A requested read access to review your " +
    "monitoring plan before the next visit. Nothing is shared until you " +
    "confirm, and you can revoke access at any time. Synthetic request — " +
    "no real clinic is involved.",
  scope: [
    "Resting heart rate observations (read-only)",
    "Manual blood pressure log entries (read-only)",
    "DataBox evidence metadata summaries (no raw files)",
  ],
  expiryLabel: "Dec 31, 2026",
};
