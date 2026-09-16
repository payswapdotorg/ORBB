"use client";

import { Button, Card, DueWindow, Heading, Text, type DueWindowTone } from "@orbb/ui";
import {
  OBSERVATION_EVIDENCE_LABEL_SENTENCES,
  OBSERVATION_SOURCE_KIND_LABELS,
  type CanonicalObservationDetailView,
  type ObservationDetailView,
} from "@/lib/observations/types";

/**
 * Observation detail (M6-B B5): the §Provenance UX drawer rendered as a
 * first-class surface — the full chain, in the frozen order:
 *
 *   `Captured by → Method → Device/Person → Time → Quality → Validation
 *    → Transformations → Original evidence`
 *
 * Teaching contract (§Provenance UX): the surface teaches that
 * "measured" and "estimated from an image" are DIFFERENT STATES — the
 * evidence label renders as explicit text (a sentence, not a color), an
 * ESTIMATED observation carries its uncertainty sentence and the model
 * version behind the estimate (the AI boundary: estimates name their
 * model). When the observation is the canonical view of a RECONCILED
 * pair, the per-source provenance of BOTH originals renders (M4 mirror:
 * one current value, nothing discarded).
 *
 * Never color alone: every state is carried by its label text (WCAG 1.4.1).
 */

const VALIDATION_LABELS: Readonly<Record<string, string>> = {
  pending: "Pending — awaiting the validation layer",
  validated: "Validated",
  superseded: "Superseded — replaced by the canonical view, provenance kept",
};

const VALIDATION_TONES: Readonly<Record<string, DueWindowTone>> = {
  pending: "warning",
  validated: "success",
  superseded: "neutral",
};

const EVIDENCE_TONES: Readonly<Record<string, DueWindowTone>> = {
  MEASURED: "success",
  ESTIMATED: "warning",
  IMPORTED: "accent",
  DERIVED: "neutral",
};

const QUALITY_TONES: Readonly<Record<string, DueWindowTone>> = {
  complete: "success",
  partial: "warning",
  "low-quality": "danger",
};

function ChainField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {label}
      </dt>
      <dd className="m-0 text-body">{children}</dd>
    </div>
  );
}

export interface ObservationDetailProps {
  readonly view: ObservationDetailView;
  /** The canonical reconciled view, when THIS observation is its subject. */
  readonly canonical?: CanonicalObservationDetailView;
  /** Fired when a per-source observation link is activated (both stay inspectable). */
  readonly onOpenSource?: (observationId: string) => void;
  /** Fired when the detail surface closes. */
  readonly onClose?: () => void;
}

export function ObservationDetail({
  view,
  canonical,
  onOpenSource,
  onClose,
}: ObservationDetailProps) {
  const reconciled = canonical !== undefined && canonical.id === view.id;

  return (
    <div data-observation-detail={view.id}>
      <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading level={3}>Observation provenance</Heading>
        {onClose !== undefined ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>

      <p className="m-0 flex flex-wrap items-center gap-2">
        <span className="text-lead font-semibold text-fg">{`${view.metricLabel}: ${view.valueLabel}`}</span>
        <DueWindow tone={EVIDENCE_TONES[view.evidenceLabel] ?? "neutral"}>
          {view.evidenceLabel}
        </DueWindow>
        <DueWindow tone={VALIDATION_TONES[view.validationState] ?? "neutral"}>
          {VALIDATION_LABELS[view.validationState] ?? view.validationState}
        </DueWindow>
      </p>
      <Text variant="muted">{`Observation ${view.id} · concept ${view.conceptCode}`}</Text>

      {/* The teaching block: measured vs estimated are different states. */}
      <div
        className="mt-3 rounded-card border border-border-subtle bg-canvas p-3"
        data-evidence-teaching={view.evidenceLabel}
      >
        <p className="m-0 text-sm font-medium">
          {`This value is ${view.evidenceLabel}.`}
        </p>
        <p className="m-0 mt-1 text-sm text-fg-muted">
          {OBSERVATION_EVIDENCE_LABEL_SENTENCES[view.evidenceLabel]}
        </p>
        {view.uncertainty !== undefined ? (
          <p className="m-0 mt-1 text-sm font-medium text-fg">{view.uncertainty}</p>
        ) : null}
        {view.modelVersion !== undefined ? (
          <p className="m-0 mt-1 font-mono text-xs text-fg-muted">
            {`Estimate model: ${view.modelVersion}`}
          </p>
        ) : null}
      </div>

      {/* The chain, in the frozen order. */}
      <dl className="mt-3 flex flex-col">
        <ChainField label="Captured by">
          {`${view.capturedBy} · ${OBSERVATION_SOURCE_KIND_LABELS[view.sourceKind]}`}
        </ChainField>
        <ChainField label="Method">
          {`${view.method.label} (${view.method.id})`}
        </ChainField>
        <ChainField label="Device / Person">{view.deviceOrPerson}</ChainField>
        <ChainField label="Time">
          {`Captured ${view.time.capturedAtLabel} · recorded ${view.time.recordedAtLabel}`}
        </ChainField>
        <ChainField label="Quality">
          <span className="flex flex-wrap items-center gap-2">
            <DueWindow tone={QUALITY_TONES[view.quality.state] ?? "neutral"}>
              {view.quality.state}
            </DueWindow>
            <span>{`domain quality score ${view.quality.score}`}</span>
          </span>
        </ChainField>
        <ChainField label="Validation">
          {VALIDATION_LABELS[view.validationState] ?? view.validationState}
        </ChainField>
        <ChainField label="Transformations">
          {view.transformations.length === 0 ? (
            <span>None — the value is exactly as captured.</span>
          ) : (
            <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
              {view.transformations.map((transformation) => (
                <li key={transformation.id}>
                  <span className="font-medium">{transformation.label}:</span>{" "}
                  <span className="text-fg-muted">{transformation.detail}</span>
                </li>
              ))}
            </ol>
          )}
        </ChainField>
        <ChainField label="Original evidence">
          {view.evidence !== undefined ? (
            <a
              href="/databox"
              className="min-h-[44px] underline decoration-accent decoration-2 underline-offset-4"
            >
              {`${view.evidence.id} — ${view.evidence.summary} (${view.evidence.mediaTypeLabel}) · view in your DataBox`}
            </a>
          ) : (
            <span>
              No evidence record yet — the DataBox evidence wiring for manual
              captures lands at integration (recorded handoff). Nothing is
              faked here.
            </span>
          )}
        </ChainField>
      </dl>

      {/* The reconciled case: per-source provenance of BOTH originals. */}
      {reconciled && canonical !== undefined ? (
        <div
          className="mt-4 rounded-card border border-border-subtle bg-canvas p-3"
          data-reconciled-view={canonical.id}
        >
          <Heading level={3}>Two sources, one current value</Heading>
          <p className="m-0 text-sm text-fg-muted">
            {`Window ${canonical.windowLabel} · reconciled ${canonical.reconciledAtLabel} · reconciliation provenance ${canonical.reconciliationProvenanceId}`}
          </p>
          <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>Verdict:</span>
            <DueWindow tone={canonical.verdict === "concordant" ? "success" : "warning"}>
              {canonical.verdict}
            </DueWindow>
            <span className="text-fg-muted">
              {canonical.verdict === "concordant"
                ? "The two sources agreed."
                : "The two sources disagreed — the divergence is flagged, never hidden."}
            </span>
          </p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {canonical.sources.map((source) => (
              <li
                key={source.observationId}
                data-source-role={source.role}
                className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <DueWindow
                    tone={source.role === "canonical-source" ? "success" : "neutral"}
                  >
                    {source.role === "canonical-source" ? "Canonical source" : "Superseded"}
                  </DueWindow>
                  <span className="font-mono text-xs text-fg-muted">
                    {source.observationId}
                  </span>
                </span>
                <span className="text-sm">
                  {`${source.methodLabel} · ${source.evidenceLabel} · quality ${source.qualityScore} · ${source.valueLabel} · captured ${source.capturedAtLabel}`}
                </span>
                <span className="text-sm text-fg-muted">{source.roleLabel}</span>
                {onOpenSource !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSource(source.detailId);
                    }}
                    className="self-start text-sm underline decoration-accent decoration-2 underline-offset-4"
                  >
                    {`Inspect this source (${source.sourceKindLabel})`}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-3 text-sm text-fg-muted">
            Nothing is discarded: the superseded source keeps its full
            provenance, and the current value is the higher-quality source&apos;s
            reading.
          </p>
        </div>
      ) : null}
      </Card>
    </div>
  );
}
