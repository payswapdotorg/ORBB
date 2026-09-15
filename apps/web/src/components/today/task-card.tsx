"use client";

import { Button, Card, DueWindow, type DueWindowTone } from "@orbb/ui";
import type { TodayTaskView } from "@/lib/today/types";

/**
 * Measurement task card (M6-B B4) — the frozen §Measurement task UX
 * contract, every field explicit:
 * `metric | due window | reason | acceptable methods | estimated effort |
 * privacy impact | fallback`.
 *
 * Accessibility contract:
 * - the card is a semantic list item (`li` wrapping a Card — the surface's
 *   list owns the `ul`);
 * - every state is carried by TEXT labels, never color alone (WCAG 1.4.1):
 *   due-window badges, method-availability notes, completion state;
 * - interactive targets keep the 44px minimum from the `Button` primitive;
 * - the completion affordance's accessible name includes the primary route
 *   and its effort (screen readers hear the easiest valid way to complete).
 *
 * Conservative clinical framing (§Design system): no streaks, no scores,
 * no punitive language — a missed window is a fact with a fallback path,
 * not a failure state.
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
  /** True while this task's capture flow is mounted (route-in-progress). */
  readonly completing?: boolean;
  /** Fired when the person starts the completion route (capture flow). */
  readonly onComplete?: (task: TodayTaskView) => void;
}

export function TaskCard({ task, completing = false, onComplete }: TaskCardProps) {
  const completed = task.state === "completed";
  const stateLabel = STATE_LABEL[task.state] ?? task.state;
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
          </div>

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
