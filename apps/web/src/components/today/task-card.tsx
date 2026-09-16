"use client";

import { useState } from "react";
import { Button, Card, DueWindow, type DueWindowTone } from "@orbb/ui";
import type { TodayReminderWire } from "@/lib/reminders/types";
import type { TodayTaskView } from "@/lib/today/types";

/**
 * Measurement task card (M6-B B4 + the M6-EXIT journey-#7 chain) — the
 * frozen §Measurement task UX contract, every field explicit:
 * `metric | due window | reason | acceptable methods | estimated effort |
 * privacy impact | fallback`, PLUS the journey-#7 additions:
 *
 * - the REMINDER BADGE LINE (mirrored @orbb/notifications ladder): rung
 *   `REMIND` while a window is upcoming (scheduled, with quiet-hours
 *   deferral shown honestly — "deferred to 07:00"), rung
 *   `REMIND_WITH_FALLBACK_OFFER` once missed (sent, with the offer);
 * - the FALLBACK-OFFER AFFORDANCE ("View options") on missed windows:
 *   the OFFER framing — the acceptable-methods/fallback vocabulary from
 *   the task + the reminder's fallback-offer payload, with
 *   `enforcementAuthority: "none"` shown explicitly. The offer is DATA,
 *   never an order; an explicit user action routes to the existing
 *   capture flow or the fallback path.
 *
 * Accessibility contract:
 * - the card is a semantic list item (`li` wrapping a Card — the surface's
 *   list owns the `ul`);
 * - every state is carried by TEXT labels, never color alone (WCAG 1.4.1):
 *   due-window badges, method-availability notes, reminder rungs,
 *   completion state, authorization states;
 * - the options disclosure is a WAI-ARIA disclosure (`aria-expanded`);
 * - interactive targets keep the 44px minimum from the `Button` primitive;
 * - the completion affordance's accessible name includes the primary route
 *   and its effort (screen readers hear the easiest valid way to complete).
 *
 * Conservative clinical framing (§Design system): no streaks, no scores,
 * no punitive language — a missed window is a fact with a fallback path,
 * not a failure state. Reminders nudge, never punish.
 */

const STATE_TONE: Readonly<Record<string, DueWindowTone>> = {
  open: "warning",
  completed: "success",
};

const STATE_LABEL: Readonly<Record<string, string>> = {
  open: "Due",
  completed: "Completed",
};

export interface TaskCardProps {
  readonly task: TodayTaskView;
  /** The journey-#7 reminder state for this task (ladder mirror). */
  readonly reminder?: TodayReminderWire | undefined;
  /** True while this task's capture flow is mounted (route-in-progress). */
  readonly completing?: boolean;
  /** Fired when the person starts the completion route (capture flow). */
  readonly onComplete?: (task: TodayTaskView) => void;
}

export function TaskCard({ task, reminder, completing = false, onComplete }: TaskCardProps) {
  const completed = task.state === "completed";
  const stateLabel = STATE_LABEL[task.state] ?? task.state;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const offer = reminder?.fallbackOffer;

  return (
    <li data-task-id={task.taskId} data-task-state={task.state} data-task-missed={task.missedWindow}>
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-lead font-semibold">{task.metricLabel}</p>
            <DueWindow
              tone={task.missedWindow ? "danger" : STATE_TONE[task.state] ?? "neutral"}
            >
              {task.missedWindow ? "Window missed" : stateLabel}
            </DueWindow>
            <DueWindow tone="neutral">{task.dueWindowLabel}</DueWindow>
            {reminder !== undefined ? (
              <DueWindow tone="neutral">{reminder.reminderLabel}</DueWindow>
            ) : null}
          </div>

          {reminder !== undefined ? (
            <p
              className="m-0 text-sm text-fg-muted"
              data-reminder-rung={reminder.rung}
              data-reminder-delivery={reminder.deliveryState}
            >
              {reminder.detailLabel}
              {reminder.defer !== undefined ? (
                <span className="block text-xs">
                  {`Quiet hours ${reminder.quietHoursLabel} — ${reminder.defer.label} (the reminder is deferred, never dropped).`}
                </span>
              ) : null}
            </p>
          ) : null}

          <p className="m-0 text-sm text-fg-muted">{task.reason}</p>

          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold">Acceptable methods</dt>
              <dd className="m-0 text-sm">
                <span className="flex flex-col gap-1">
                  <span>{task.methodCountLabel} — least burden first:</span>
                  {task.methods.map((method) => (
                    <span key={method.methodId} className="flex flex-col gap-0.5">
                      <span>
                        {`${method.label} · ${method.estimatedEffortLabel} · ${
                          method.availability === "available" ? "available" : "not connected yet"
                        }`}
                      </span>
                      <span className="text-xs text-fg-muted">{method.availabilityNote}</span>
                    </span>
                  ))}
                </span>
              </dd>
            </div>
            <div className="flex flex-col gap-2">
              <div>
                <dt className="text-xs font-semibold">Estimated effort</dt>
                <dd className="m-0 text-sm">{task.estimatedEffortLabel}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Privacy impact</dt>
                <dd className="m-0 text-sm">{task.privacyImpactLabel}</dd>
              </div>
            </div>
          </dl>

          <div
            className={`flex flex-col gap-1 rounded-card border p-3 ${
              task.missedWindow
                ? "border-warning/40 bg-surface"
                : "border-border-subtle bg-surface"
            }`}
          >
            <p className="m-0 text-sm font-semibold">
              {`${task.fallback.label}${task.missedWindow ? " — suggested for missed windows" : ""}`}
            </p>
            <p className="m-0 text-sm text-fg-muted">
              {`Providers: ${task.fallback.providers.join(" · ")}`}
            </p>
            <p className="m-0 text-sm text-fg-muted">{task.fallback.detail}</p>
          </div>

          {offer !== undefined ? (
            <div className="flex flex-col gap-2" data-fallback-offer="true">
              <Button
                variant="secondary"
                aria-expanded={optionsOpen}
                aria-controls={`${task.taskId}-fallback-options`}
                onClick={() => {
                  setOptionsOpen((open) => !open);
                }}
                aria-label={`View fallback options for ${task.metricLabel}`}
              >
                {optionsOpen ? "Hide options" : "View options"}
              </Button>
              {optionsOpen ? (
                <div
                  id={`${task.taskId}-fallback-options`}
                  className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-3"
                >
                  <p className="m-0 text-sm font-semibold">
                    Fallback options — offered, never ordered.
                  </p>
                  <p className="m-0 text-sm text-fg-muted">
                    {`The reminder's offer is the method vocabulary recorded on your task (preferred first): ${
                      offer.methods
                        .map(
                          (method) =>
                            `${method.methodLabel} (${method.role}, ${method.methodId})`,
                        )
                        .join(" · ")
                    }.`}
                  </p>
                  <p className="m-0 text-sm text-fg-muted">
                    {`Enforcement authority: ${offer.enforcementAuthority} — a reminder never orders a provider and never applies a restriction.`}
                  </p>
                  <p className="m-0 text-sm text-fg-muted">
                    {`Provider path: ${task.fallback.providers.join(" · ")} — ${task.fallback.detail} Arranging a provider capture arrives with the Services marketplace; this offer is data only.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => {
                        onComplete?.(task);
                      }}
                      aria-label={`Capture ${task.metricLabel} now — ${task.primaryRouteLabel}, ${task.estimatedEffortLabel}`}
                    >
                      {`Capture now — ${task.primaryRouteLabel}`}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {completed && task.completion !== undefined ? (
            <p className="m-0 text-sm">
              {`Completed through capture ${task.completion.captureId} — `}
              <span className="text-fg-muted">
                {`${task.completion.observationIds.length} observation${
                  task.completion.observationIds.length === 1 ? "" : "s"
                } with full provenance.`}
              </span>
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {completed ? (
              <p className="m-0 text-sm text-fg-muted">
                Nothing more due for this task right now.
              </p>
            ) : (
              <Button
                onClick={() => {
                  onComplete?.(task);
                }}
                aria-label={`Complete ${task.metricLabel} now — ${task.primaryRouteLabel}, ${task.estimatedEffortLabel}`}
              >
                {completing
                  ? "Completing — flow open below"
                  : `Complete now — ${task.primaryRouteLabel}`}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}
