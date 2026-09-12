"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  DisclosurePanel,
  DueWindow,
  Heading,
  Table,
  Text,
  Timeline,
  type TableColumn,
  type TableRow,
} from "@orbb/ui";
import { captureValueLabel } from "@/lib/capture/store";
import { CAPTURE_QUALITY_LABELS, CAPTURE_QUALITY_TONES } from "@/lib/capture/quality";
import type { CaptureRecordDto } from "@/lib/capture/types";
import { isCaptureErrorEnvelope } from "@/lib/capture/types";
import { formatCapturedLabel, formatDayLabel, formatTimeLabel } from "@/lib/capture/format";
import { SYNTHETIC_PERSON_LABEL } from "@/lib/capture/catalog";

/**
 * Capture history (M4-B): recent manual observations from the same
 * in-memory store the capture flow writes to, read through the API route.
 *
 * Two views behind a real button group (`aria-pressed`, 44px targets,
 * polite announcements — the DataBox evidence-card pattern):
 * - LIST — `Table` rows with method/quality/provenance badges and a
 *   per-row `DisclosurePanel` revealing the provenance drawer contract
 *   (actor → method → quality → validation state → capture metadata);
 * - TIMELINE — day-grouped `Timeline` entries.
 *
 * Person-scoped by construction (the store is single-person; the route
 * returns only that person's captures).
 */

type HistoryView = "list" | "timeline";

const VIEW_LABELS: Readonly<Record<HistoryView, string>> = {
  list: "History list",
  timeline: "Timeline",
};

const COLUMNS: readonly TableColumn[] = [
  { id: "measurement", header: "Measurement" },
  { id: "captured", header: "Captured", sortable: true },
  { id: "method", header: "Method" },
  { id: "quality", header: "Quality" },
  { id: "provenance", header: "Provenance" },
  { id: "details", header: "Details" },
];

export interface CaptureHistoryProps {
  /**
   * Refresh signal: increments after every successful capture submit so
   * the history re-reads the store through the route.
   */
  readonly refreshToken: number;
}

export function CaptureHistory({ refreshToken }: CaptureHistoryProps) {
  const [view, setView] = useState<HistoryView>("list");
  const [captures, setCaptures] = useState<readonly CaptureRecordDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch("/api/capture")
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (response.ok) {
          const records = (payload as { captures?: unknown }).captures;
          if (Array.isArray(records)) {
            setCaptures(records as readonly CaptureRecordDto[]);
          } else {
            setError("Could not load the capture history: unexpected response.");
          }
        } else if (isCaptureErrorEnvelope(payload)) {
          setError(`Could not load the capture history: ${payload.error.message}`);
        } else {
          setError("Could not load the capture history: unexpected response.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load the capture history: network error.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const now = new Date();
  const rows: TableRow[] =
    captures === null
      ? []
      : captures.map((record) => ({
          id: record.captureId,
          cells: {
            measurement: (
              <span className="flex flex-col gap-0.5">
                <span>{`${record.shapeLabel} ${captureValueLabel(record)}`}</span>
                <span className="font-mono text-xs text-fg-muted">{record.captureId}</span>
              </span>
            ),
            captured: formatCapturedLabel(new Date(record.capturedAt), now),
            method: (
              <span className="flex flex-wrap items-center gap-1">
                <DueWindow tone="neutral">Manual</DueWindow>
              </span>
            ),
            quality: (
              <DueWindow tone={CAPTURE_QUALITY_TONES[record.qualityState]}>
                {CAPTURE_QUALITY_LABELS[record.qualityState]}
              </DueWindow>
            ),
            provenance: (
              <DueWindow tone="accent">You (self-tracking)</DueWindow>
            ),
            details: <CaptureDetailsPanel record={record} />,
          },
        }));

  const timelineEntries =
    captures === null
      ? []
      : captures.map((record) => ({
          at: formatTimeLabel(new Date(record.capturedAt)),
          title: `${record.shapeLabel} ${captureValueLabel(record)}`,
          subtitle: `Method: manual · quality: ${CAPTURE_QUALITY_LABELS[record.qualityState]} · recorded by you (self-tracking)`,
          badge: CAPTURE_QUALITY_LABELS[record.qualityState],
          group: formatDayLabel(new Date(record.capturedAt), now),
        }));

  return (
    <Card padding="none">
      <div className="flex flex-col gap-3 p-4">
        <Heading level={2}>Recent manual observations</Heading>
        <Text variant="muted">
          Everything you recorded manually, with the method actually used,
          the quality you self-assessed, and full provenance — read from the
          same synthetic store (SYNTH) through the capture route.
        </Text>
        <div role="group" aria-label="Capture history view" className="flex flex-wrap gap-2">
          {(["list", "timeline"] as const).map((candidate) => (
            <Button
              key={candidate}
              variant="secondary"
              aria-pressed={view === candidate}
              onClick={() => {
                setView(candidate);
              }}
            >
              {VIEW_LABELS[candidate]}
            </Button>
          ))}
        </div>
        <p aria-live="polite" className="m-0 text-sm text-fg-muted">
          {view === "list"
            ? "Showing the capture history list."
            : "Showing the capture history timeline."}
        </p>
      </div>

      <div role="status" aria-live="polite" className="px-4 pb-2">
        {error !== null ? (
          <p className="m-0 text-xs text-danger">{error}</p>
        ) : captures === null ? (
          <p className="m-0 text-sm text-fg-muted">
            Loading your recent manual observations…
          </p>
        ) : captures.length === 0 ? (
          <p className="m-0 text-sm text-fg-muted">
            No manual observations yet — record your first measurement above.
          </p>
        ) : null}
      </div>

      {captures !== null && captures.length > 0 ? (
        view === "list" ? (
          <Table
            caption="Synthetic manual capture history — no real records."
            columns={COLUMNS}
            rows={rows}
          />
        ) : (
          <div className="px-4 pb-4">
            <Timeline entries={timelineEntries} />
          </div>
        )
      ) : null}
    </Card>
  );
}

/**
 * Per-row provenance drawer (the architecture's Provenance UX contract:
 * captured by → method → quality → validation → capture metadata).
 */
function CaptureDetailsPanel({ record }: { record: CaptureRecordDto }) {
  return (
    <DisclosurePanel id={`capture-details-${record.captureId}`} title={`Details: ${record.captureId}`}>
      <dl className="m-0 grid grid-cols-1 gap-2">
        <div>
          <dt className="text-xs font-semibold">Provenance actor</dt>
          <dd className="m-0 font-mono text-xs">{SYNTHETIC_PERSON_LABEL}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Method actually used</dt>
          <dd className="m-0">
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
              {record.observations.map((observation) => (
                <li key={observation.id}>
                  <span className="font-mono text-xs">{observation.methodId}</span>
                  {" — "}
                  {observation.methodLabel}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Quality (recorded as-is)</dt>
          <dd className="m-0">
            {`${CAPTURE_QUALITY_LABELS[record.qualityState]} — self-assessed; never upgraded.`}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Quality score per observation</dt>
          <dd className="m-0">
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
              {record.observations.map((observation) => (
                <li key={observation.id} className="font-mono text-xs">
                  {`${observation.metricLabel}: ${observation.quality}`}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Evidence label</dt>
          <dd className="m-0">{record.observations.map((observation) => observation.evidenceLabel).join(", ")}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Validation state</dt>
          <dd className="m-0">pending</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold">Captured / recorded</dt>
          <dd className="m-0 font-mono text-xs">
            {`${record.capturedAt} → ${record.recordedAt}`}
          </dd>
        </div>
        {record.notes !== undefined ? (
          <div>
            <dt className="text-xs font-semibold">Notes</dt>
            <dd className="m-0">{record.notes}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs font-semibold">Observation ids</dt>
          <dd className="m-0">
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
              {record.observations.map((observation) => (
                <li key={observation.id} className="font-mono text-xs">
                  {`${observation.id} (${observation.conceptCode})`}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </DisclosurePanel>
  );
}
