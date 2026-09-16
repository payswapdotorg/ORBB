"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  DisclosurePanel,
  DueWindow,
  FieldWrapper,
  Heading,
  Select,
  Text,
  TextField,
  type DueWindowTone,
} from "@orbb/ui";
import {
  DATABOX_QUALITY_FILTER_LABELS,
  DATABOX_TIME_FILTER_LABELS,
  EMPTY_DATABOX_FILTERS,
  conceptOptions,
  deriveCollections,
  filterObservations,
  isEmptyDataboxFilters,
  sourceOptions,
  type DataboxFilters,
} from "@/lib/databox/search";
import { formatDayLabel, formatTimeLabel } from "@/lib/capture/format";
import {
  OBSERVATION_REFERENCE_NOW_ISO,
} from "@/lib/observations/fixtures";
import {
  isDeviceImportResponse,
  isObservationErrorEnvelope,
  isObservationListResponse,
  OBSERVATION_SOURCE_KIND_LABELS,
  type CanonicalObservationDetailView,
  type ObservationDetailView,
} from "@/lib/observations/types";

/**
 * DataBox journey (M6-B B6): the §DataBox UX model on the observation
 * plane — TIMELINE PLUS COLLECTIONS as the default human-readable
 * presentation, with SEARCH and the four filters (time, concept, source,
 * confidence/quality).
 *
 * Advanced inspection: every entry is a `DisclosurePanel` (the M3-B
 * disclosure pattern, extended) revealing raw-evidence links, metadata,
 * provenance summary and MODEL VERSIONS (estimates name their model).
 *
 * The import affordance (golden journey #2) runs the SYNTH device-adapter
 * fixture: a second blood-pressure source for this morning's window,
 * reconciled with the manual original into ONE canonical view with
 * per-source provenance (nothing discarded — the M4 invariant).
 *
 * Honesty rules: the full provenance chain lives on /measurements (B5);
 * these entries link to it (`?observation=<id>`), never duplicating it.
 * Sharing entries (export / access history) that have no real behavior
 * yet live in the Data controls card, labeled forthcoming — never faked.
 */

const EVIDENCE_TONES: Readonly<Record<string, DueWindowTone>> = {
  MEASURED: "success",
  ESTIMATED: "warning",
  IMPORTED: "accent",
  DERIVED: "neutral",
};

const VALIDATION_LABELS: Readonly<Record<string, string>> = {
  pending: "Pending",
  validated: "Validated",
  superseded: "Superseded",
};

interface BoardState {
  readonly observations: readonly ObservationDetailView[];
  readonly canonical: CanonicalObservationDetailView | null;
  readonly deviceImportAvailable: boolean;
}

/** Day-group labels that never collide with the M3-B "Today" exact text. */
function dayGroupLabel(iso: string, referenceNow: Date): string {
  const base = formatDayLabel(new Date(iso), referenceNow);
  if (base === "Today") {
    return `Today — ${shortDayLabel(iso)}`;
  }
  if (base === "Yesterday") {
    return `Yesterday — ${shortDayLabel(iso)}`;
  }
  return base;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function shortDayLabel(iso: string): string {
  const date = new Date(iso);
  const month = MONTHS[date.getUTCMonth()] ?? "";
  return `${month} ${date.getUTCDate()}`;
}

export function DataboxJourney() {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [filters, setFilters] = useState<DataboxFilters>(EMPTY_DATABOX_FILTERS);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const refreshBoard = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/observations");
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isObservationListResponse(payload)) {
        setBoard({
          observations: payload.observations,
          canonical: payload.canonical,
          deviceImportAvailable: payload.deviceImportAvailable,
        });
        setError(null);
        return;
      }
      setError("Could not load your DataBox observations: unexpected response.");
    } catch {
      setError("Could not load your DataBox observations: network error.");
    }
  }, []);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  const referenceNow = useMemo(
    () => new Date(OBSERVATION_REFERENCE_NOW_ISO),
    [],
  );

  const filtered = useMemo(
    () =>
      board === null
        ? []
        : filterObservations(board.observations, filters, OBSERVATION_REFERENCE_NOW_ISO),
    [board, filters],
  );

  const collections = useMemo(() => deriveCollections(filtered), [filtered]);
  const concepts = useMemo(
    () => (board === null ? [] : conceptOptions(board.observations)),
    [board],
  );
  const sources = useMemo(
    () => (board === null ? [] : sourceOptions(board.observations)),
    [board],
  );

  // Day-grouped entries (most recent first; the store's order).
  const grouped = useMemo(() => {
    const groups: { label: string; entries: ObservationDetailView[] }[] = [];
    for (const observation of filtered) {
      const label = dayGroupLabel(observation.capturedAtIso, referenceNow);
      const last = groups[groups.length - 1];
      if (last !== undefined && last.label === label) {
        last.entries.push(observation);
        continue;
      }
      groups.push({ label, entries: [observation] });
    }
    return groups;
  }, [filtered, referenceNow]);

  const runImport = useCallback(async (): Promise<void> => {
    if (importing) {
      return;
    }
    setImporting(true);
    try {
      const response = await fetch("/api/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import-device" }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isDeviceImportResponse(payload)) {
        setBoard({
          observations: payload.observations,
          canonical: payload.canonical,
          deviceImportAvailable: false,
        });
        setAnnouncement(
          `Device observation imported: ${payload.imported.valueLabel} via ${payload.imported.method.label}. Two sources reconciled — verdict ${payload.canonical.verdict}. The current value is ${payload.canonical.valueLabel}; the ${payload.superseded.method.label} source was superseded with its provenance kept.`,
        );
      } else if (
        !response.ok &&
        isObservationErrorEnvelope(payload) &&
        payload.error.code === "import-already-completed"
      ) {
        await refreshBoard();
        setAnnouncement("That device batch was already imported — nothing new happened.");
      } else {
        setAnnouncement("The import did not complete — unexpected response. Nothing changed.");
      }
    } catch {
      setAnnouncement("The import did not complete — network error. Nothing changed.");
    } finally {
      setImporting(false);
    }
  }, [importing, refreshBoard]);

  const updateFilters = (patch: Partial<DataboxFilters>): void => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const shown =
      board === null
        ? 0
        : filterObservations(
            board.observations,
            next,
            OBSERVATION_REFERENCE_NOW_ISO,
          ).length;
    setAnnouncement(
      `Filters applied — now showing ${shown} of ${board?.observations.length ?? 0} observations.`,
    );
  };

  if (error !== null && board === null) {
    return (
      <div data-databox-journey="observations">
      <Card>
        <Heading level={2}>Your data</Heading>
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void refreshBoard()}>
            Try again
          </Button>
        </div>
      </Card>
      </div>
    );
  }

  if (board === null) {
    return (
      <p aria-live="polite" className="m-0 text-sm text-fg-muted">
        Loading your DataBox…
      </p>
    );
  }

  return (
    <div data-databox-journey="observations">
      <Card>
      <Heading level={2}>Your data</Heading>
      <Text variant="muted">
        A human-readable timeline of your observations, grouped into
        collections by metric. Search it, filter it, and inspect any entry&apos;s
        raw evidence, metadata, provenance and model versions.
      </Text>

      {/* Search + the four §DataBox UX filters. */}
      <div className="mt-4 flex flex-col gap-3">
        <FieldWrapper
          label="Search your DataBox"
          hint="Matches metrics, methods, values, sources and evidence ids."
        >
          {(field) => (
            <TextField
              {...field}
              type="search"
              value={filters.search}
              placeholder="e.g. blood pressure, wearable, SYNTH-EV-0001"
              onChange={(event) => {
                updateFilters({ search: event.target.value });
              }}
            />
          )}
        </FieldWrapper>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FieldWrapper label="Time">
            {(field) => (
              <Select
                {...field}
                value={filters.time}
                onChange={(event) => {
                  updateFilters({
                    time: event.target.value as DataboxFilters["time"],
                  });
                }}
                options={Object.entries(DATABOX_TIME_FILTER_LABELS).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            )}
          </FieldWrapper>
          <FieldWrapper label="Concept (metric)">
            {(field) => (
              <Select
                {...field}
                value={filters.concept}
                onChange={(event) => {
                  updateFilters({ concept: event.target.value });
                }}
                options={[
                  { value: "all", label: "All concepts" },
                  ...concepts.map((concept) => ({
                    value: concept.id,
                    label: concept.label,
                  })),
                ]}
              />
            )}
          </FieldWrapper>
          <FieldWrapper label="Source">
            {(field) => (
              <Select
                {...field}
                value={filters.source}
                onChange={(event) => {
                  updateFilters({ source: event.target.value });
                }}
                options={[
                  { value: "all", label: "All sources" },
                  ...sources.map((source) => ({
                    value: source.id,
                    label: source.label,
                  })),
                ]}
              />
            )}
          </FieldWrapper>
          <FieldWrapper label="Confidence / quality">
            {(field) => (
              <Select
                {...field}
                value={filters.quality}
                onChange={(event) => {
                  updateFilters({
                    quality: event.target.value as DataboxFilters["quality"],
                  });
                }}
                options={Object.entries(DATABOX_QUALITY_FILTER_LABELS).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            )}
          </FieldWrapper>
        </div>
      </div>

      <p aria-live="polite" className="m-0 mt-2 text-sm text-fg-muted">
        {announcement ?? ""}
      </p>
      <p className="m-0 mt-1 text-sm text-fg-muted" data-results-count={filtered.length}>
        {`Showing ${filtered.length} of ${board.observations.length} observations.`}
      </p>

      {/* Collections (concept groupings of the filtered set). */}
      <div className="mt-4">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Collections
        </h3>
        <div role="group" aria-label="Collections by metric" className="mt-2 flex flex-wrap gap-2">
          {collections.map((collection) => {
            const active = filters.concept === collection.metricId;
            return (
              <Button
                key={collection.metricId}
                variant={active ? "primary" : "secondary"}
                aria-pressed={active}
                onClick={() => {
                  updateFilters({
                    concept: active ? "all" : collection.metricId,
                  });
                }}
              >
                {`${collection.metricLabel} (${collection.count})`}
              </Button>
            );
          })}
          {collections.length === 0 ? (
            <Text variant="small">No collections match the current filters.</Text>
          ) : null}
        </div>
      </div>

      {/* The import affordance (golden journey #2 — the SYNTH device adapter). */}
      {board.deviceImportAvailable ? (
        <div className="mt-4 rounded-card border border-border-subtle bg-canvas p-3">
          <Heading level={3}>Import a device observation</Heading>
          <Text variant="small">
            Runs the SYNTH device-adapter fixture: imports a second
            blood-pressure source (SYNTH-BP-Monitor-1) for this morning&apos;s
            window and reconciles the two sources into one current value —
            per-source provenance kept, nothing discarded.
          </Text>
          <div className="mt-2">
            <Button onClick={() => void runImport()} disabled={importing}>
              {importing ? "Importing…" : "Import device observation"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* The timeline: day-grouped observation entries (disclosure pattern). */}
      <div className="mt-4 flex flex-col gap-5">
        {grouped.map((group) => (
          <section key={group.label}>
            <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {group.label}
            </h4>
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {group.entries.map((observation) => (
                <li key={observation.id}>
                  <ObservationEntry
                    observation={observation}
                    {...(board.canonical !== null &&
                    board.canonical.id === observation.id
                      ? { canonical: board.canonical }
                      : {})}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <Text variant="muted">
              No observations match your search or filters.
            </Text>
            {!isEmptyDataboxFilters(filters) ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setFilters(EMPTY_DATABOX_FILTERS);
                  setAnnouncement("Filters cleared.");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Text variant="small">
        {`Synthetic session (SYNTH) — reference date ${shortDayLabel(OBSERVATION_REFERENCE_NOW_ISO)}. Nothing real is stored; every identity is SYNTH-marked.`}
      </Text>
      </Card>
    </div>
  );
}

/** One timeline entry: the always-visible headline + advanced inspection. */
function ObservationEntry({
  observation,
  canonical,
}: {
  observation: ObservationDetailView;
  canonical?: CanonicalObservationDetailView;
}) {
  return (
    <DisclosurePanel
      id={`databox-observation-${observation.id}`}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{`${observation.metricLabel}: ${observation.valueLabel}`}</span>
          <DueWindow tone={EVIDENCE_TONES[observation.evidenceLabel] ?? "neutral"}>
            {observation.evidenceLabel}
          </DueWindow>
          <span className="text-sm text-fg-muted">
            {`${formatTimeLabel(new Date(observation.capturedAtIso))} · ${observation.method.label}`}
          </span>
        </span>
      }
    >
      <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold">Captured</dt>
          <dd className="m-0">{`${observation.time.capturedAtLabel} (recorded ${observation.time.recordedAtLabel})`}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Source</dt>
          <dd className="m-0">{`${OBSERVATION_SOURCE_KIND_LABELS[observation.sourceKind]} — ${observation.capturedBy}`}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Method actually used</dt>
          <dd className="m-0">{`${observation.method.label} (${observation.method.id})`}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Device / person</dt>
          <dd className="m-0">{observation.deviceOrPerson}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Quality / confidence</dt>
          <dd className="m-0">{`${observation.quality.state} (score ${observation.quality.score})`}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Validation</dt>
          <dd className="m-0">{VALIDATION_LABELS[observation.validationState] ?? observation.validationState}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Transformations</dt>
          <dd className="m-0">
            {observation.transformations.length === 0
              ? "None — the value is exactly as captured."
              : observation.transformations
                  .map((transformation) => transformation.label)
                  .join(" → ")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Model version</dt>
          <dd className="m-0">
            {observation.modelVersion ?? "None — not produced by a model."}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold">Raw evidence record</dt>
          <dd className="m-0">
            {observation.evidence !== undefined
              ? `${observation.evidence.id} — ${observation.evidence.summary} (${observation.evidence.mediaTypeLabel})`
              : "No evidence record yet — the evidence wiring for manual captures lands at integration."}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold">Full provenance chain</dt>
          <dd className="m-0">
            <Link
              href={`/measurements?observation=${observation.id}`}
              className="inline-flex min-h-[44px] items-center underline decoration-accent decoration-2 underline-offset-4"
            >
              {`View full provenance (${observation.id}) on the Measurements surface`}
            </Link>
          </dd>
        </div>
      </dl>

      {canonical !== undefined ? (
        <div className="mt-3 rounded-card border border-border-subtle bg-canvas p-3">
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
            <span>Reconciled view — verdict:</span>
            <DueWindow tone={canonical.verdict === "concordant" ? "success" : "warning"}>
              {canonical.verdict}
            </DueWindow>
            <span className="text-fg-muted">
              {`window ${canonical.windowLabel} · ${canonical.sources.length} sources`}
            </span>
          </p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {canonical.sources.map((source) => (
              <li key={source.observationId} className="text-sm">
                {`${source.role === "canonical-source" ? "Canonical" : "Superseded"}: ${source.methodLabel} · ${source.evidenceLabel} · quality ${source.qualityScore} · ${source.valueLabel} (${source.observationId})`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </DisclosurePanel>
  );
}
