"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Heading, Text } from "@orbb/ui";
import { ManualCaptureFlow } from "@/components/measurements/manual-capture-flow";
import { TodayTaskCard } from "@/components/today/today-task-card";
import {
  isTodayTaskCompleteResponse,
  isTodayTaskErrorEnvelope,
  isTodayTaskListResponse,
  type TodayIntentProgress,
  type TodayTaskView,
} from "@/lib/today/types";

/**
 * Today surface (M6-B B4): the intent-driven consumer home per the frozen
 * navigation model. It answers, in order:
 *   1. What am I trying to accomplish?   (per-intent progress summaries)
 *   2. What matters today?                (the due-today task cards)
 *   3. What measurement is due?           (the due window on every card)
 *   4. Why is it due?                     (the card's reason field)
 *   5. What is the easiest valid way?     (least-burden valid method first)
 *
 * NOT a dashboard of charts — no sparklines, no trends, no risk coloring.
 *
 * Completing a task routes into the EXISTING M4-B manual-capture flow
 * (inlined with the task's capture shape pre-selected); on submit the
 * task transitions to completed through the /api/tasks route stub and the
 * progress summaries update (counts only — conservative clinical states,
 * never gamified: no streaks, no punitive framing).
 */

interface BoardState {
  readonly tasks: readonly TodayTaskView[];
  readonly progress: readonly TodayIntentProgress[];
  readonly referenceDateLabel: string;
}

export function TodaySurface() {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<TodayTaskView | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const refreshBoard = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/tasks");
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isTodayTaskListResponse(payload)) {
        setBoard({
          tasks: payload.tasks.map((view) => ({
            ...view,
            task: {
              ...view.task,
              window: {
                ...view.task.window,
                startsAt: new Date(view.task.window.startsAt),
                endsAt: new Date(view.task.window.endsAt),
              },
              createdAt: new Date(view.task.createdAt),
            },
          })),
          progress: payload.progress,
          referenceDateLabel: payload.referenceDateLabel,
        });
        setLoadError(null);
        return;
      }
      setLoadError("Could not load today's tasks: unexpected response.");
    } catch {
      setLoadError("Could not load today's tasks: network error.");
    }
  }, []);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  /** The capture landed — transition the task to completed. */
  const handleCaptured = useCallback(async (): Promise<void> => {
    const task = completing;
    if (task === null) {
      return;
    }
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.task.id }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isTodayTaskCompleteResponse(payload)) {
        setBoard((current) =>
          current === null
            ? current
            : {
                ...current,
                tasks: current.tasks.map((view) =>
                  view.task.id === payload.task.task.id ? payload.task : view,
                ),
                progress: payload.progress,
              },
        );
        const progressSummary =
          payload.progress.find((entry) => entry.intentLabel === task.intentLabel)
            ?.summary ?? "progress updated.";
        setAnnouncement(
          `${task.metricLabel} task completed — ${task.intentLabel}: ${progressSummary}`,
        );
        return;
      }
      if (
        !response.ok &&
        isTodayTaskErrorEnvelope(payload) &&
        payload.error.code === "task-already-completed"
      ) {
        // The capture landed; the task was already completed by a prior
        // submit — idempotent outcome, just refresh the board.
        await refreshBoard();
        return;
      }
      setAnnouncement(
        "Measurement saved, but the task board could not be updated — reloading it.",
      );
      await refreshBoard();
    } catch {
      setAnnouncement(
        "Measurement saved, but the task board could not be updated — reloading it.",
      );
      await refreshBoard();
    }
  }, [completing, refreshBoard]);

  if (loadError !== null && board === null) {
    return (
      <Card>
        <Heading level={2}>Today</Heading>
        <p role="alert" className="m-0 text-sm text-danger">
          {loadError}
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void refreshBoard()}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  if (board === null) {
    return (
      <p aria-live="polite" className="m-0 text-sm text-fg-muted">
        Loading today&apos;s measurements…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="m-0 text-sm text-fg-muted">
        {announcement ?? ""}
      </p>

      {/* 1. What am I trying to accomplish? */}
      <section>
        <Heading level={2}>What you&apos;re working on</Heading>
        <Text variant="muted">
          Your active intents and today&apos;s measurement progress — counts
          only, kept honest.
        </Text>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {board.progress.map((entry) => (
            <li
              key={entry.intentLabel}
              data-intent-progress={entry.intentLabel}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-card border border-border-subtle bg-surface px-4 py-3"
            >
              <span className="text-body font-medium text-fg">{entry.intentLabel}</span>
              <span className="text-sm text-fg-muted">{entry.summary}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 2–5. What matters today: the task cards. */}
      <section>
        <Heading level={2}>What&apos;s due today</Heading>
        <Text variant="muted">
          Every task shows the metric, its due window, why it&apos;s due, the
          acceptable methods (easiest valid one first), the estimated effort,
          the privacy impact, and the fallback if you cannot complete it.
        </Text>
        <div className="mt-3 flex flex-col gap-4">
          {board.tasks.map((view) => (
            <TodayTaskCard
              key={view.task.id}
              view={view}
              onComplete={(candidate) => {
                setCompleting(candidate);
                setAnnouncement(
                  `Opening the capture flow for ${candidate.metricLabel}.`,
                );
              }}
            />
          ))}
        </div>
      </section>

      {completing !== null ? (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Heading level={2}>Complete a task</Heading>
            <Button
              variant="secondary"
              onClick={() => {
                setCompleting(null);
                setAnnouncement("Back to today's tasks.");
              }}
            >
              Back to today
            </Button>
          </div>
          <ManualCaptureFlow
            {...(completing.captureShapeId !== undefined
              ? { initialShapeId: completing.captureShapeId }
              : {})}
            contextNote={`Completing: ${completing.metricLabel} — ${completing.dueLabel} · task ${completing.task.id}. The observation will be recorded with full provenance.`}
            onCaptured={() => {
              void handleCaptured();
            }}
          />
        </section>
      ) : null}

      <Text variant="small">
        {`Synthetic session (SYNTH) — reference date ${board.referenceDateLabel}. No real medical data, nothing persisted outside this session.`}
      </Text>
    </div>
  );
}
