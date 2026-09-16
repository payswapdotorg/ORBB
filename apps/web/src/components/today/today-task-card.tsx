"use client";

import { Button, DueWindow, Text, type DueWindowTone } from "@orbb/ui";
import type { TodayTaskView, TodayWindowPhase } from "@/lib/today/types";

/**
 * Today task card (M6-B B4): the frozen §Measurement task UX card contract —
 *
 *   `metric | due window | reason | acceptable methods | estimated effort
 *    | privacy impact | fallback`
 *
 * rendered with `@orbb/ui` primitives. Composition rules:
 * - the due window renders as a `DueWindow` badge whose TEXT carries the
 *   state (tone reinforces only — WCAG 1.4.1);
 * - acceptable methods are listed with the LEAST-BURDEN VALID option
 *   FIRST (§Measurement task UX); unavailable device/app seams render
 *   visibly with an honest "not available yet" state, never fake-enabled;
 * - the fallback renders on every card (the contract's seventh field),
 *   and on missed-window cards it is emphasized;
 * - the whole card carries a screen-reader label summarizing every field
 *   (§Accessibility: "Screen-reader labels for measurement tasks");
 * - clinical states stay conservative: no streaks, no urgency theatrics,
 *   no risk coloring beyond a warning tone on the missed window.
 */

const PHASE_TONE: Readonly<Record<TodayWindowPhase, DueWindowTone>> = {
  "due-now": "accent",
  "due-later-today": "neutral",
  missed: "warning",
  completed: "success",
};

const METHOD_KIND_LABEL: Readonly<Record<string, string>> = {
  manual: "manual",
  device: "device",
  app: "app",
  synthesized: "synthesized",
};

/** One acceptable-method row (text carries availability — never color alone). */
function MethodLine({
  label,
  kind,
  evidenceLabel,
  available,
  recommended,
}: {
  label: string;
  kind: string;
  evidenceLabel: string;
  available: boolean;
  recommended: boolean;
}) {
  const availability = available ? "available" : "not available yet";
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="text-body">{label}</span>
      {recommended ? (
        <DueWindow tone="success">easiest valid option</DueWindow>
      ) : null}
      <span className="text-sm text-fg-muted">
        {`${METHOD_KIND_LABEL[kind] ?? kind} · ${evidenceLabel} · ${availability}`}
      </span>
    </li>
  );
}

export interface TodayTaskCardProps {
  readonly view: TodayTaskView;
  /** Fired when the person starts completing this task (the capture route). */
  readonly onComplete: (view: TodayTaskView) => void;
}

export function TodayTaskCard({ view, onComplete }: TodayTaskCardProps) {
  const open = view.task.state === "open";
  const completeMethod = view.methods.find((method) => method.available);
  const recommendedMethod = open ? completeMethod : undefined;

  // The screen-reader summary: every field of the card contract, in order.
  const cardSummary =
    `${view.metricLabel}. ${view.dueLabel}. ${view.reason}. ` +
    `${view.methods.length} acceptable methods: ` +
    view.methods.map((method) => method.label).join(", ") +
    `. Estimated effort ${view.estimatedEffort}. Privacy: ${view.privacyImpact}. ` +
    `Fallback: ${view.fallback.label}.`;

  return (
    <article
      aria-label={`Measurement task: ${cardSummary}`}
      data-task-id={view.task.id}
      data-task-state={view.task.state}
      data-task-phase={view.windowPhase}
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-lead font-semibold text-fg">{view.metricLabel}</h3>
        <DueWindow tone={PHASE_TONE[view.windowPhase]}>{view.dueLabel}</DueWindow>
      </div>

      <p className="m-0 text-sm text-fg-muted">{view.reason}</p>
      <p className="m-0 text-sm text-fg-muted">
        {`Plan: ${view.planLabel} · intent: ${view.intentLabel}`}
      </p>

      <div>
        <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {`Acceptable methods (${view.methods.length})`}
        </h4>
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
          {view.methods.map((method) => (
            <MethodLine
              key={method.id}
              label={method.label}
              kind={method.kind}
              evidenceLabel={method.evidenceLabel}
              available={method.available}
              recommended={method.id === recommendedMethod?.id}
            />
          ))}
        </ul>
        <p className="m-0 mt-1 text-sm text-fg-muted">
          {`When several valid sources exist, the least-burden one is listed first.`}
        </p>
      </div>

      <p className="m-0 text-sm text-fg-muted">
        {`Estimated effort: ${view.estimatedEffort} · Privacy: ${view.privacyImpact}`}
      </p>

      <div
        className={
          view.windowPhase === "missed"
            ? "rounded-card border border-border-subtle bg-canvas p-3"
            : undefined
        }
      >
        <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Fallback
        </h4>
        {view.fallback.available ? (
          <>
            <p className="m-0 mt-1 text-sm">{view.fallback.label}</p>
            <p className="m-0 text-sm text-fg-muted">{view.fallback.description}</p>
            <p className="m-0 font-mono text-xs text-fg-muted">
              {view.fallback.providerIds.join(" · ")}
            </p>
          </>
        ) : (
          <p className="m-0 mt-1 text-sm text-fg-muted">{view.fallback.description}</p>
        )}
      </div>

      {open && completeMethod !== undefined && view.captureShapeId !== undefined ? (
        <div className="flex flex-wrap items-center gap-2" data-task-complete={view.task.id}>
          <Button
            onClick={() => {
              onComplete(view);
            }}
          >
            {`Complete now — ${completeMethod.label}`}
          </Button>
          <span className="sr-only">
            {`Opens the manual capture flow for ${view.metricLabel}.`}
          </span>
        </div>
      ) : null}

      {!open && view.completedLabel !== undefined ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
          <DueWindow tone="success">Done</DueWindow>
          <span>{view.completedLabel}</span>
        </p>
      ) : null}

      {open && completeMethod === undefined ? (
        <p className="m-0 text-sm text-fg-muted">
          No completable method yet — the fallback above is the available path.
        </p>
      ) : null}

      <Text variant="small">{`Task ${view.task.id} · window ${view.task.window.sequence}`}</Text>
    </article>
  );
}
