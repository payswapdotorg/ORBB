"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, DueWindow, Heading, Text } from "@orbb/ui";
import { TaskCard } from "./task-card";
import { AdherencePostureCard } from "./adherence-posture";
import { ManualCaptureFlow } from "@/components/measurements/manual-capture-flow";
import {
  isTodayAdherenceResponse,
  type TodayAdherencePostureWire,
} from "@/lib/adherence/types";
import {
  isTodayRemindersResponse,
  type TodayReminderWire,
} from "@/lib/reminders/types";
import {
  isTodayCompleteResponse,
  isTodayErrorEnvelope,
  isTodayListResponse,
  type TodayIntentSummary,
  type TodayTaskView,
} from "@/lib/today/types";

/**
 * Today surface (M6-B B4 + the M6-EXIT journey-#7 chain) — the
 * intent-driven Overview content: what the person is trying to
 * accomplish, what matters today, which measurement is due, why, and
 * the easiest valid way to complete it. NOT a dashboard of charts.
 *
 * Composition:
 * - the intent focus list (objective + plan + conservative per-intent
 *   progress — completed/due counts only, never gamified);
 * - the task cards (§Measurement task UX, see `task-card.tsx`) now
 *   carrying the journey-#7 reminder badge line (the @orbb/notifications
 *   ladder mirror) and the missed-window fallback-offer affordance;
 * - the restriction-posture card (the @orbb/adherence mirror): the
 *   observe-only default is the loudest truth; the configured-policy
 *   SYNTH fixture variant sits behind an explicit disclosure;
 * - the completion route REUSES the existing M4-B manual-capture flow
 *   (`ManualCaptureFlow`, preselected metric via `initialShapeId`); on
 *   submit the task transitions open -> completed through `/api/today`
 *   and the surface re-reads progress;
 * - the completion result carries a provenance affordance (B5 link into
 *   the Measurements observation detail).
 *
 * GRACEFUL DEGRADE (recorded): the reminder and adherence-posture reads
 * are ADDITIVE chain legs — a failure there never breaks the task board;
 * a polite note states what is missing (never silent).
 *
 * Accessibility: view state changes and completions are announced through
 * a polite live region; the loading and error states are polite-status,
 * never assertive. Every task state is text-carried (badges reinforce).
 */

type LoadPhase = "loading" | "ready" | "error";

export function TodaySurface() {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [intents, setIntents] = useState<readonly TodayIntentSummary[]>([]);
  const [tasks, setTasks] = useState<readonly TodayTaskView[]>([]);
  const [reminders, setReminders] = useState<readonly TodayReminderWire[]>([]);
  const [posture, setPosture] = useState<TodayAdherencePostureWire | null>(null);
  const [fixtureVariant, setFixtureVariant] = useState<TodayAdherencePostureWire | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [completedProvenance, setCompletedProvenance] = useState<{
    metricLabel: string;
    captureId: string;
    observationId: string;
  } | null>(null);
  const completingRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setPhase((current) => (current === "ready" ? "ready" : "loading"));
    setErrorMessage(null);
    // EACH chain read that degrades states its own polite note (never
    // silent, never collapsing two failures into one message).
    const chainNotes: string[] = [];
    try {
      // The task board read and the two journey-#7 chain reads run
      // together; each chain read degrades gracefully on its own.
      const [todayRequest, remindersRequest, adherenceRequest] = await Promise.all([
        fetch("/api/today").then((response) =>
          response.json().then((payload: unknown) => ({ response, payload })),
        ),
        fetch("/api/today/reminders").then(
          (response) => response.json().catch(() => null),
        ).catch(() => null),
        fetch("/api/today/adherence").then(
          (response) => response.json().catch(() => null),
        ).catch(() => null),
      ]);
      const { response, payload } = todayRequest;
      if (response.ok && isTodayListResponse(payload)) {
        setIntents(payload.intents);
        setTasks(payload.tasks);
        setPhase("ready");
      } else if (!response.ok && isTodayErrorEnvelope(payload)) {
        setErrorMessage(`Could not load today's plan: ${payload.error.message}`);
        setPhase("error");
        return;
      } else {
        setErrorMessage("Could not load today's plan: unexpected response.");
        setPhase("error");
        return;
      }
      if (isTodayRemindersResponse(remindersRequest)) {
        setReminders(remindersRequest.reminders);
      } else {
        setReminders([]);
        chainNotes.push(
          "Reminder state could not be loaded — the task list is unaffected.",
        );
      }
      if (
        isTodayAdherenceResponse(adherenceRequest) &&
        isPostureWire(adherenceRequest.posture) &&
        isPostureWire(adherenceRequest.fixtureVariant)
      ) {
        setPosture(adherenceRequest.posture);
        setFixtureVariant(adherenceRequest.fixtureVariant);
      } else {
        setPosture(null);
        setFixtureVariant(null);
        chainNotes.push(
          "The restriction-posture summary could not be loaded — the task list is unaffected.",
        );
      }
      if (chainNotes.length > 0) {
        setAnnouncement(chainNotes.join(" "));
      }
    } catch {
      setErrorMessage("Could not load today's plan: network error.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTask = tasks.find((task) => task.taskId === activeTaskId) ?? null;
  const reminderByTask = new Map(reminders.map((reminder) => [reminder.taskId, reminder]));

  /** Fires when the mounted capture flow stored a capture for the task. */
  async function handleCaptured(result: {
    captureId: string;
    shapeId: string;
  }): Promise<void> {
    const taskId = completingRef.current;
    if (taskId === null) {
      return;
    }
    try {
      const response = await fetch("/api/today", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, captureId: result.captureId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isTodayCompleteResponse(payload)) {
        setTasks((current) =>
          current.map((task) => (task.taskId === payload.task.taskId ? payload.task : task)),
        );
        setIntents(payload.intents);
        const completed = payload.task;
        const firstObservationId = completed.completion?.observationIds[0] ?? "";
        setCompletedProvenance({
          metricLabel: completed.metricLabel,
          captureId: result.captureId,
          observationId: firstObservationId,
        });
        setAnnouncement(
          `Measurement saved and task completed: ${completed.metricLabel}. Per-intent progress updated.`,
        );
        setActiveTaskId(null);
        completingRef.current = null;
        // Completing silences the reminder ladder (the B8 rule): the
        // surface re-reads the chain so the card's reminder line clears.
        try {
          const refreshed = await fetch("/api/today/reminders");
          const payload2: unknown = await refreshed.json().catch(() => null);
          if (refreshed.ok && isTodayRemindersResponse(payload2)) {
            setReminders(payload2.reminders);
          }
        } catch {
          // The board already updated; a stale reminder line is cosmetic.
        }
      } else if (!response.ok && isTodayErrorEnvelope(payload)) {
        setAnnouncement(
          `The capture was saved, but the task could not be completed: ${payload.error.message}`,
        );
      } else {
        setAnnouncement(
          "The capture was saved, but the task could not be completed: unexpected response.",
        );
      }
    } catch {
      setAnnouncement(
        "The capture was saved, but the task could not be completed: network error.",
      );
    }
  }

  const openTasks = tasks.filter((task) => task.state === "open");

  return (
    <div className="flex flex-col gap-6" data-today-surface="true">
      <div aria-live="polite" role="status">
        {phase === "loading" ? (
          <p className="m-0 text-sm text-fg-muted">Loading today&apos;s plan…</p>
        ) : null}
        {announcement !== null ? (
          <p className="m-0 text-sm text-accent">{announcement}</p>
        ) : null}
        {errorMessage !== null ? (
          <p className="m-0 text-sm text-danger">{errorMessage}</p>
        ) : null}
      </div>

      {phase === "ready" ? (
        <>
          <Card>
            <Heading level={2}>What you are working toward</Heading>
            <Text variant="muted">
              Your active intents and their measurement plans — the &quot;why&quot;
              behind everything due today.
            </Text>
            <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
              {intents.map((intent) => (
                <li
                  key={intent.intentId}
                  data-intent-id={intent.intentId}
                  className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-sm font-semibold">{intent.objective}</p>
                    <DueWindow tone="success">Active plan</DueWindow>
                  </div>
                  <p className="m-0 text-sm text-fg-muted">
                    {`${intent.planLabel} · ${intent.planId}`}
                  </p>
                  <p className="m-0 text-sm" data-intent-progress={intent.intentId}>
                    <span className="font-medium">{intent.progress.label}</span>
                    <span className="text-fg-muted">
                      {` (${intent.progress.completedToday} completed · ${intent.progress.dueNow} due now)`}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <section aria-labelledby="today-tasks-heading">
            <div className="flex flex-col gap-1">
              <Heading level={2}>What matters today</Heading>
              <Text variant="muted">
                {openTasks.length === 0
                  ? "No open measurement tasks right now."
                  : `${openTasks.length} measurement task${openTasks.length === 1 ? "" : "s"} due — the easiest valid way to complete each is first.`}
              </Text>
            </div>
            <ul className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
              {tasks.map((task) => (
                <TaskCard
                  key={task.taskId}
                  task={task}
                  reminder={reminderByTask.get(task.taskId)}
                  completing={task.taskId === activeTaskId}
                  onComplete={(selected) => {
                    completingRef.current = selected.taskId;
                    setActiveTaskId(selected.taskId);
                    setAnnouncement(
                      `Capture flow opened for ${selected.metricLabel} — ${selected.primaryRouteLabel}.`,
                    );
                  }}
                />
              ))}
            </ul>
          </section>

          {posture !== null && fixtureVariant !== null ? (
            <section aria-label="What happens when you miss a measurement">
              <AdherencePostureCard posture={posture} fixtureVariant={fixtureVariant} />
            </section>
          ) : null}

          {activeTask !== null ? (
            <section aria-label="Complete your measurement" data-today-capture={activeTask.taskId}>
              <Heading level={2}>Complete your measurement</Heading>
              <Text variant="muted">
                {`Recording ${activeTask.metricLabel} through the manual capture journey — it is preselected below (${activeTask.primaryRouteLabel}).`}
              </Text>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setActiveTaskId(null);
                    completingRef.current = null;
                    setAnnouncement("Capture flow closed — the task stays open.");
                  }}
                >
                  Close without completing
                </Button>
              </div>
              <div className="mt-4">
                <ManualCaptureFlow
                  initialShapeId={activeTask.captureShapeId}
                  onCaptured={(result) => {
                    void handleCaptured(result);
                  }}
                />
              </div>
            </section>
          ) : null}

          {completedProvenance !== null ? (
            <div data-today-completed="true">
              <Card>
                <Heading level={2}>Completed today</Heading>
                <p className="m-0 text-sm">
                  {`${completedProvenance.metricLabel} — capture ${completedProvenance.captureId} recorded with full provenance.`}
                </p>
                {completedProvenance.observationId !== "" ? (
                  <p className="m-0 mt-2 text-sm">
                    <a
                      className="font-medium text-accent underline"
                      href={`/measurements?observation=${encodeURIComponent(completedProvenance.observationId)}`}
                    >
                      View the provenance of this result
                    </a>
                    <span className="text-fg-muted">
                      {" "}
                      — captured by, method, quality, validation, and the original evidence.
                    </span>
                  </p>
                ) : null}
              </Card>
            </div>
          ) : null}

          <p className="m-0 text-xs text-fg-muted">
            Everything on this screen is synthetic (SYNTH) — deterministic
            fixture tasks, no real medical data, nothing is persisted beyond
            this session.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Structural check for a posture wire view (defense in depth). */
function isPostureWire(value: unknown): value is TodayAdherencePostureWire {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const posture = value as Record<string, unknown>;
  return (
    (posture.variant === "observe-only" || posture.variant === "configured-policy") &&
    typeof posture.defaultLine === "string" &&
    typeof posture.summaryLine === "string" &&
    typeof posture.decision === "object" &&
    posture.decision !== null
  );
}
