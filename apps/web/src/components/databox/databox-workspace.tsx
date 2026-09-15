"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DisclosurePanel,
  DueWindow,
  FieldWrapper,
  Heading,
  Select,
  TextField,
  Text,
  Timeline,
  type DueWindowTone,
} from "@orbb/ui";
import { EvidenceTable } from "./evidence-table";
import { ConsentSection } from "./consent-section";
import { buildDataboxEntries, DATABOX_ACCESS_EVENT_FIXTURES } from "@/lib/databox/fixtures";
import {
  DATABOX_QUALITY_OPTIONS,
  DATABOX_SOURCE_OPTIONS,
  DATABOX_TIME_OPTIONS,
  buildCollections,
  countActiveFilters,
  databoxConceptOptions,
  filterDataboxEntries,
  toTimelineEntries,
} from "@/lib/databox/search";
import {
  initialDataboxFilters,
  type DataboxEntryView,
  type DataboxFilters,
} from "@/lib/databox/types";

/**
 * DataBox workspace (M6-B B6) — the §DataBox UX model:
 *
 * - TIMELINE plus COLLECTIONS as the DEFAULT presentation (human-readable),
 *   with the evidence list (the M3-B sortable table) as the advanced view;
 * - SEARCH over titles/subtitles/concepts/sources;
 * - the FOUR FILTERS: time, concept (metric), source, confidence/quality;
 * - the ADVANCED INSPECTION affordance per entry (the M3-B disclosure
 *   pattern, extended): raw evidence, metadata, provenance, and MODEL
 *   VERSIONS for estimated values;
 * - the observation entries link into the B5 provenance detail
 *   (/measurements?observation=<id>);
 * - the ENTRY POINTS for export (honestly forthcoming — disabled, labeled,
 *   never fake success), share with clinician + revoke (wired to the
 *   EXISTING ConsentSheet flow — the reviewable contract, never a one-click
 *   toggle), and access history (fixture events + live session events,
 *   honestly labeled by origin).
 *
 * The corpus stays pinned to the SYNTH reference world (see lib/databox).
 */

type EvidenceView = "timeline" | "collections" | "list";

const VIEW_LABEL: Readonly<Record<EvidenceView, string>> = {
  timeline: "Timeline",
  collections: "Collections",
  list: "Evidence list",
};

const VIEW_ANNOUNCEMENT: Readonly<Record<EvidenceView, string>> = {
  timeline: "Showing the evidence timeline.",
  collections: "Showing the evidence collections.",
  list: "Showing the evidence list.",
};

const STATUS_TONE: Readonly<Record<string, DueWindowTone>> = {
  validated: "success",
  pending: "warning",
  superseded: "neutral",
};

const QUALITY_BAND_LABEL: Readonly<Record<string, string>> = {
  high: "High quality (0.8+)",
  moderate: "Moderate quality (0.5–0.79)",
  low: "Low quality (below 0.5)",
  "not-scored": "Quality not scored",
};

export function DataboxWorkspace() {
  const [filters, setFilters] = useState<DataboxFilters>(initialDataboxFilters());
  const [view, setView] = useState<EvidenceView>("timeline");

  const entries = useMemo(() => buildDataboxEntries(), []);
  const conceptOptions = useMemo(() => databoxConceptOptions(entries), [entries]);
  const filtered = useMemo(() => filterDataboxEntries(entries, filters), [entries, filters]);
  const collections = useMemo(() => buildCollections(filtered), [filtered]);

  // -- Consent wiring (the actions card drives the SAME reviewable share) --
  const [grantPhase, setGrantPhase] = useState<"pending" | "active" | "revoked">("pending");
  const [openRequest, setOpenRequest] = useState(0);
  const [sessionEvents, setSessionEvents] = useState<
    readonly { action: string; actor: string; atLabel: string }[]
  >([]);

  const accessEvents = useMemo(
    () => [
      ...sessionEvents.map((event, index) => ({
        eventId: `SYNTH-ACCESS-SESSION-${String(index + 1).padStart(4, "0")}`,
        action: event.action,
        actor: event.actor,
        atLabel: event.atLabel,
        origin: "session" as const,
      })),
      ...DATABOX_ACCESS_EVENT_FIXTURES,
    ],
    [sessionEvents],
  );

  const requestSheet = (reason: "share" | "revoke"): void => {
    setOpenRequest((current) => current + 1);
    if (reason === "revoke") {
      // The revoke path opens the sheet on the ACTIVE grant — the contract
      // itself owns the revoke action (never a one-click toggle).
      setGrantPhase((current) => (current === "pending" ? "pending" : current));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card padding="none" data-databox-workspace="true">
        <div className="flex flex-col gap-3 p-4">
          <Heading level={2}>Evidence</Heading>
          <Text variant="muted">
            Your DataBox as a timeline plus collections — search it, filter it
            by time, metric, source, or quality, and inspect anything down to
            the raw evidence and model versions.
          </Text>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldWrapper
              id="databox-search"
              label="Search your DataBox"
              hint="Matches titles, provenance lines, metrics, and sources."
            >
              {(fieldProps) => (
                <TextField
                  {...fieldProps}
                  type="search"
                  value={filters.search}
                  placeholder="e.g. heart rate, clinic letter, wearable"
                  onChange={(event) => {
                    setFilters((current) => ({ ...current, search: event.target.value }));
                  }}
                />
              )}
            </FieldWrapper>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldWrapper id="databox-filter-time" label="Filter by time">
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    options={DATABOX_TIME_OPTIONS}
                    value={filters.time}
                    onChange={(event) => {
                      setFilters((current) => ({
                        ...current,
                        time: event.target.value as DataboxFilters["time"],
                      }));
                    }}
                  />
                )}
              </FieldWrapper>
              <FieldWrapper id="databox-filter-concept" label="Filter by metric">
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    options={conceptOptions}
                    value={filters.concept}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, concept: event.target.value }));
                    }}
                  />
                )}
              </FieldWrapper>
              <FieldWrapper id="databox-filter-source" label="Filter by source">
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    options={DATABOX_SOURCE_OPTIONS}
                    value={filters.source}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, source: event.target.value }));
                    }}
                  />
                )}
              </FieldWrapper>
              <FieldWrapper id="databox-filter-quality" label="Filter by quality">
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    options={DATABOX_QUALITY_OPTIONS}
                    value={filters.quality}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, quality: event.target.value }));
                    }}
                  />
                )}
              </FieldWrapper>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFilters(initialDataboxFilters());
              }}
            >
              Clear search and filters
            </Button>
          </div>

          <p className="m-0 text-sm text-fg-muted" aria-live="polite">
            {`${filtered.length} of ${entries.length} entries${
              countActiveFilters(filters) > 0
                ? ` — ${countActiveFilters(filters)} filter${countActiveFilters(filters) === 1 ? "" : "s"} active`
                : ""
            }.`}
          </p>

          <div role="group" aria-label="Evidence view" className="flex flex-wrap gap-2">
            {(["timeline", "collections", "list"] as const).map((candidate) => (
              <Button
                key={candidate}
                variant="secondary"
                aria-pressed={view === candidate}
                onClick={() => {
                  setView(candidate);
                }}
              >
                {VIEW_LABEL[candidate]}
              </Button>
            ))}
          </div>
          <p aria-live="polite" className="m-0 text-sm text-fg-muted">
            {VIEW_ANNOUNCEMENT[view]}
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 pb-4">
            <p className="m-0 text-sm text-fg-muted">
              No entries match the current search and filters — clearing them
              brings the whole corpus back.
            </p>
          </div>
        ) : view === "timeline" ? (
          <div className="px-4 pb-4">
            <Timeline entries={toTimelineEntries(filtered)} />
            <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <EntryInspectionPanel entry={entry} />
                </li>
              ))}
            </ul>
          </div>
        ) : view === "collections" ? (
          <div className="flex flex-col gap-4 px-4 pb-4">
            {collections.map((collection) => (
              <div
                key={collection.collectionId}
                data-collection-id={collection.collectionId}
                className="rounded-card border border-border-subtle bg-surface p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-lead font-semibold">{collection.label}</p>
                  <DueWindow tone="neutral">
                    {`${collection.entryIds.length} entr${collection.entryIds.length === 1 ? "y" : "ies"}`}
                  </DueWindow>
                </div>
                <p className="m-0 mt-1 text-sm text-fg-muted">{collection.description}</p>
                <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                  {collection.entryIds.map((entryId) => {
                    const entry = filtered.find((candidate) => candidate.id === entryId);
                    return entry === undefined ? null : (
                      <li key={entry.id} className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{`${entry.title} — ${entry.atLabel}`}</span>
                        <span className="text-xs text-fg-muted">{entry.subtitle}</span>
                        <EntryInspectionPanel entry={entry} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <EvidenceTable />
        )}
      </Card>

      <Card data-databox-actions="true">
        <Heading level={2}>DataBox actions</Heading>
        <Text variant="muted">
          Entry points for the things the DataBox contract promises. What has
          real behavior now is wired; what does not is labeled forthcoming —
          never a fake success.
        </Text>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled
              aria-label="Export — forthcoming (dataset export arrives with the export pipeline)"
            >
              Export — forthcoming
            </Button>
            <span className="text-xs text-fg-muted">
              Dataset export with provenance arrives with the export pipeline
              (B-wave work); nothing is exported yet.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                requestSheet("share");
              }}
            >
              Share data with clinician
            </Button>
            <span className="text-xs text-fg-muted">
              Opens the existing reviewable share (recipient → purpose → exact
              data → expiry → revoke) below.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                requestSheet("revoke");
              }}
            >
              Revoke access
            </Button>
            <span className="text-xs text-fg-muted">
              Ends a live share through the same contract — the revoke
              itself happens inside the reviewed share.
            </span>
          </div>
          <DisclosurePanel id="databox-access-history" title="View access history">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {accessEvents.map((event) => (
                <li
                  key={event.eventId}
                  data-access-origin={event.origin}
                  className="flex flex-col gap-0.5 border-b border-border-subtle pb-2"
                >
                  <span className="text-sm font-medium">{event.action}</span>
                  <span className="text-xs text-fg-muted">
                    {`${event.actor} · ${event.atLabel} · ${
                      event.origin === "fixture" ? "synthetic fixture event" : "this session"
                    } (${event.eventId})`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-2 text-xs text-fg-muted">
              Share and revoke events of THIS session appear here the moment
              they happen (below in the Sharing section); older events are
              SYNTH fixture history, honestly labeled.
            </p>
          </DisclosurePanel>
        </div>
      </Card>

      <ConsentSection
        phase={grantPhase}
        onPhaseChange={(next) => {
          setGrantPhase(next);
          if (next === "active") {
            setSessionEvents((current) => [
              {
                action: "Share granted (scoped read, heart rate + BP log)",
                actor: "SYNTH-Clinic-A",
                atLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
              ...current,
            ]);
          }
          if (next === "revoked") {
            setSessionEvents((current) => [
              {
                action: "Access revoked",
                actor: "SYNTH-Clinic-A",
                atLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
              ...current,
            ]);
          }
        }}
        openRequest={openRequest}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced inspection (the extended M3-B disclosure pattern).
// ---------------------------------------------------------------------------

function EntryInspectionPanel({ entry }: { entry: DataboxEntryView }) {
  return (
    <DisclosurePanel id={`databox-inspect-${entry.id}`} title={`Inspect: ${entry.id}`}>
      <dl className="m-0 grid grid-cols-1 gap-2">
        <div>
          <dt className="text-xs font-semibold">Raw evidence</dt>
          <dd className="m-0 text-sm">
            {entry.kind === "evidence"
              ? `${entry.mediaType ?? "unknown"} · ${entry.checksumPrefix ?? "no checksum"} · retained as the original object`
              : "Observation record — the linked evidence object holds the raw capture."}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Metadata</dt>
          <dd className="m-0 text-sm">
            {`captured ${entry.atLabel} · ${entry.conceptLabel} · retention ${entry.retentionClass ?? "SYNTH-RT-default"}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Provenance</dt>
          <dd className="m-0 text-sm">
            <span className="flex flex-col gap-0.5">
              <span>{entry.provenanceActor}</span>
              <span className="text-xs text-fg-muted">{`source: ${entry.sourceLabel} (${entry.sourceKind})`}</span>
              <span>
                <DueWindow tone={STATUS_TONE[entry.status] ?? "neutral"}>
                  {entry.status === "validated" ? "Validated" : entry.status === "pending" ? "Pending" : "Superseded"}
                </DueWindow>
                {entry.evidenceState !== undefined ? (
                  <>
                    {" "}
                    <DueWindow tone="accent">{entry.evidenceState}</DueWindow>
                  </>
                ) : null}
              </span>
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Quality</dt>
          <dd className="m-0 text-sm">
            {entry.qualityScore !== undefined
              ? `${QUALITY_BAND_LABEL[entry.qualityBand] ?? entry.qualityBand} — score ${entry.qualityScore} of 1.0`
              : QUALITY_BAND_LABEL[entry.qualityBand] ?? entry.qualityBand}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Model version</dt>
          <dd className="m-0 text-sm">
            {entry.modelVersion ?? "No model involved — direct capture or raw document."}
          </dd>
        </div>
        {entry.transformations !== undefined && entry.transformations.length > 0 ? (
          <div>
            <dt className="text-xs font-semibold">Transformations</dt>
            <dd className="m-0">
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
                {entry.transformations.map((transformation) => (
                  <li key={transformation} className="text-sm">
                    {transformation}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {entry.observationId !== undefined ? (
          <div>
            <dt className="text-xs font-semibold">Full provenance chain</dt>
            <dd className="m-0 text-sm">
              <a
                className="font-medium text-accent underline"
                href={`/measurements?observation=${encodeURIComponent(entry.observationId)}`}
              >
                {`Open the provenance detail of ${entry.observationId}`}
              </a>
              <span className="text-fg-muted">
                {" "}
                — captured by → method → quality → validation → transformations → original evidence.
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
    </DisclosurePanel>
  );
}
