"use client";

import { useEffect, useState } from "react";
import { Button, Card, DueWindow, Heading, type DueWindowTone } from "@orbb/ui";
import {
  OBSERVATION_EVIDENCE_STATE_LABELS,
} from "@/lib/observations/catalog";
import {
  isObservationDetailResponse,
  isObservationErrorEnvelope,
  type ObservationDetailView,
  type ObservationSourceProvenanceView,
  type ReconciledObservationView,
} from "@/lib/observations/types";

/**
 * Observation/provenance detail (M6-B B5) — the frozen §Provenance UX
 * chain, field by field:
 * `Captured by → Method → Device/Person → Time → Quality → Validation →
 * Transformations → Original evidence`.
 *
 * Teaching contract: the measured-vs-estimated distinction is EXPLICIT —
 * the evidence state renders as a text label (Measured | Estimated |
 * Imported | Derived) with teaching copy; never color alone (WCAG 1.4.1).
 *
 * The RECONCILED case (journey #2): the canonical view + PER-SOURCE
 * provenance records for every original (roles: canonical-source /
 * superseded-source — text labels), each source linking to its own full
 * provenance detail.
 *
 * Loading is polite-status; failures surface the error envelope's message.
 */

const VALIDATION_TONE: Readonly<Record<string, DueWindowTone>> = {
  validated: "success",
  pending: "warning",
  superseded: "neutral",
};

const VALIDATION_LABEL: Readonly<Record<string, string>> = {
  validated: "Validated",
  pending: "Pending validation",
  superseded: "Superseded",
};

export interface ObservationDetailProps {
  /** The observation whose provenance chain to render. */
  readonly observationId: string;
  /** Optional back/close affordance (the hosting surface's decision). */
  readonly onClose?: () => void;
}

export function ObservationDetail({ observationId, onClose }: ObservationDetailProps) {
  const [detail, setDetail] = useState<ObservationDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetch(`/api/observations?id=${encodeURIComponent(observationId)}`)
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (response.ok && isObservationDetailResponse(payload)) {
          setDetail(payload.observation);
        } else if (!response.ok && isObservationErrorEnvelope(payload)) {
          setError(`Could not load the observation: ${payload.error.message}`);
        } else {
          setError("Could not load the observation: unexpected response.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load the observation: network error.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [observationId]);

  return (
    <div data-observation-detail={observationId}>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Heading level={2}>Provenance detail</Heading>
          {onClose !== undefined ? (
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
              }}
            >
              Close detail
            </Button>
          ) : null}
        </div>
        <div aria-live="polite" role="status">
          {error !== null ? <p className="m-0 text-sm text-danger">{error}</p> : null}
          {detail === null && error === null ? (
            <p className="m-0 text-sm text-fg-muted">Loading the provenance chain…</p>
          ) : null}
        </div>

      {detail !== null ? (
        <div className="mt-2 flex flex-col gap-4" data-observation-loaded={detail.observationId}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-lead font-semibold">
              {`${detail.metricLabel} ${detail.valueLabel}`}
            </p>
            <DueWindow tone="accent">
              {`${OBSERVATION_EVIDENCE_STATE_LABELS[detail.evidenceState] ?? detail.evidenceState} — ${detail.evidenceLabel}`}
            </DueWindow>
            <DueWindow tone={VALIDATION_TONE[detail.validation.state] ?? "neutral"}>
              {VALIDATION_LABEL[detail.validation.state] ?? detail.validation.state}
            </DueWindow>
          </div>

          <p className="m-0 text-sm text-fg-muted" data-evidence-state={detail.evidenceState}>
            {detail.evidenceStateNote}
          </p>

          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold">Captured by</dt>
              <dd className="m-0 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span>{detail.capturedBy.actorLabel}</span>
                  <span className="font-mono text-xs text-fg-muted">
                    {`source: ${detail.capturedBy.sourceId} (${detail.capturedBy.kind})`}
                  </span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">Method</dt>
              <dd className="m-0 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span>{detail.method.methodLabel}</span>
                  <span className="font-mono text-xs text-fg-muted">
                    {detail.method.methodId}
                  </span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">Device / Person</dt>
              <dd className="m-0 text-sm">{detail.deviceOrPerson}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">Time</dt>
              <dd className="m-0 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span>{`Clinically relevant: ${detail.time.effectiveLabel}`}</span>
                  <span className="text-fg-muted">{`Recorded: ${detail.time.observedLabel}`}</span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">Quality</dt>
              <dd className="m-0 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span>{`${detail.quality.stateLabel} — score ${detail.quality.score} of 1.0`}</span>
                  <span className="text-fg-muted">{detail.quality.note}</span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">Validation</dt>
              <dd className="m-0 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span>{VALIDATION_LABEL[detail.validation.state] ?? detail.validation.state}</span>
                  <span className="text-fg-muted">{detail.validation.note}</span>
                </span>
              </dd>
            </div>
          </dl>

          <div>
            <p className="m-0 text-xs font-semibold">Transformations</p>
            {detail.transformations.length === 0 ? (
              <p className="m-0 text-sm text-fg-muted">
                None — recorded exactly as captured.
              </p>
            ) : (
              <ol className="m-0 mt-1 flex list-decimal flex-col gap-2 pl-5">
                {detail.transformations.map((transformation) => (
                  <li key={transformation.id} className="text-sm">
                    <span className="font-medium">{transformation.label}</span>
                    <span className="text-fg-muted">{` · ${transformation.seam}`}</span>
                    <p className="m-0 text-xs text-fg-muted">{transformation.description}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <p className="m-0 text-xs font-semibold">Model version</p>
            <p className="m-0 text-sm">{detail.modelVersion ?? "No model involved — direct capture."}</p>
          </div>

          <div>
            <p className="m-0 text-xs font-semibold">Original evidence (DataBox)</p>
            {detail.evidence === null ? (
              <p className="m-0 text-sm text-fg-muted">
                No raw evidence object — the values were typed directly (manual entry).
              </p>
            ) : detail.evidence.location === "databox-corpus" ? (
              <p className="m-0 text-sm">
                <a
                  className="font-medium text-accent underline"
                  href="/databox"
                >
                  {`${detail.evidence.evidenceId} — ${detail.evidence.summary}`}
                </a>
                <span className="text-fg-muted">
                  {` · ${detail.evidence.mediaType} · ${detail.evidence.checksumPrefix} · retention ${detail.evidence.retentionClass} — open in DataBox.`}
                </span>
              </p>
            ) : (
              <p className="m-0 text-sm">
                <span className="font-medium">{`${detail.evidence.evidenceId} — ${detail.evidence.summary}`}</span>
                <span className="text-fg-muted">
                  {` · ${detail.evidence.mediaType} · ${detail.evidence.checksumPrefix} · retention ${detail.evidence.retentionClass} — retained by the source this session; DataBox ingestion arrives with the engine wiring (honestly labeled, not faked).`}
                </span>
              </p>
            )}
          </div>

          {detail.reconciliation !== undefined ? (
            <div className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-3">
              <p className="m-0 text-sm font-semibold">
                {`Reconciliation: ${detail.reconciliation.role} · verdict ${detail.reconciliation.verdict}`}
              </p>
              <p className="m-0 text-sm text-fg-muted">{detail.reconciliation.note}</p>
              <p className="m-0 text-sm">
                <a
                  className="font-medium text-accent underline"
                  href={`/measurements?observation=${encodeURIComponent(detail.reconciliation.canonicalObservationId)}`}
                >
                  Open the canonical view of this window
                </a>
              </p>
            </div>
          ) : null}

          <p className="m-0 font-mono text-xs text-fg-muted">
            {`${detail.observationId} · ${detail.conceptCode} · provenance recorded for every observation (SYNTH)`}
          </p>
        </div>
      ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The reconciled canonical view (the M4 mirror's presentation).
// ---------------------------------------------------------------------------

/** Renders the reconciled canonical view with PER-SOURCE provenance. */
export function ReconciledViewCard({
  view,
  onOpenSource,
}: {
  readonly view: ReconciledObservationView;
  readonly onOpenSource?: (observationId: string) => void;
}) {
  return (
    <div data-reconciled-view={view.canonicalObservationId}>
      <Card>
        <Heading level={2}>Reconciled — one canonical value</Heading>
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 text-lead font-semibold">
          {`${view.metricLabel} ${view.valueLabel}`}
        </p>
        <DueWindow tone={view.verdict === "concordant" ? "success" : "warning"}>
          {view.verdict === "concordant" ? "Concordant sources" : "Discordant sources"}
        </DueWindow>
      </div>
      <p className="m-0 mt-2 text-sm text-fg-muted">{view.verdictNote}</p>
      <p className="m-0 mt-1 text-sm text-fg-muted">
        {`Window: today · canonical observation ${view.canonicalObservationId} · reconciliation provenance ${view.reconciliationProvenanceId}`}
      </p>

      <p className="m-0 mt-4 text-xs font-semibold">Per-source provenance (nothing discarded)</p>
      <ul className="m-0 mt-1 flex list-none flex-col gap-2 p-0">
        {view.sources.map((source: ObservationSourceProvenanceView) => (
          <li
            key={source.observationId}
            data-source-role={source.role}
            className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <DueWindow tone={source.role === "canonical-source" ? "success" : "neutral"}>
                {source.roleLabel}
              </DueWindow>
              <span className="text-sm font-medium">{source.sourceLabel}</span>
            </div>
            <p className="m-0 text-sm">
              {`${source.methodLabel} · ${OBSERVATION_EVIDENCE_STATE_LABELS[source.evidenceState] ?? source.evidenceState} (${source.evidenceLabel}) · quality ${source.quality ?? "not scored"}`}
            </p>
            <p className="m-0 font-mono text-xs text-fg-muted">
              {`${source.observationId} · ${source.methodId} · ${source.sourceId}`}
            </p>
            <div>
              <Button
                variant="secondary"
                aria-label={`Inspect provenance of ${source.sourceLabel} observation`}
                onClick={() => {
                  onOpenSource?.(source.observationId);
                }}
              >
                Inspect this source&apos;s provenance
              </Button>
            </div>
          </li>
        ))}
        </ul>
      </Card>
    </div>
  );
}
