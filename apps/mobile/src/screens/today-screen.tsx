import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  findCaptureShape,
  type MobileCaptureSubmission,
} from "../lib/capture/model";
import {
  completeTodayTask,
  initialTodaySession,
  listTodayIntents,
  listTodayTasks,
  type TodaySession,
  type TodayTaskView,
} from "../lib/today/model";
import { CaptureForm } from "./capture-form";

/**
 * Today surface (M6-B B4, mobile): the intent-driven Today-tab content that
 * replaces the placeholder after the first-run onboarding completes — what
 * the person is trying to accomplish, what matters today, which measurement
 * is due, why, and the easiest valid way to complete it. NOT a dashboard of
 * charts.
 *
 * Composition (the web TodaySurface mirrored for RN):
 * - the intent focus list (objective + active plan + conservative
 *   per-intent progress — completed/due counts only, never gamified);
 * - the task cards (every frozen §Measurement task UX field: metric, due
 *   window, reason, acceptable methods with availability, estimated
 *   effort, privacy impact, fallback — text carries every state);
 * - the completion route REUSES the existing M4-B CaptureForm inline (a
 *   keyboard-aware section; step 1 metric picker); on submit the task
 *   transitions open -> completed through the pure session model and the
 *   surface re-renders tasks + progress with a polite announcement
 *   carrying the provenance summary.
 *
 * Accessibility contract: every interactive control keeps the 44px minimum
 * touch target; task states are carried by TEXT ("Due" / "Window missed" /
 * "Completed"), never color alone; each card exposes one accessibility
 * label summarizing the whole card; announcements are polite live region.
 *
 * The session is CLIENT-LOCAL (the same discipline as the intent journey):
 * `initialTodaySession` seeds the deterministic SYNTH fixtures; completions
 * return a NEW session (immutable transitions). Completion links are the
 * synthetic capture ids of the today model (engine wiring = recorded
 * handoff, see lib/today/model.ts).
 */

/** The state text of a task (never color alone — the card carries it). */
function stateTextOf(task: TodayTaskView): string {
  if (task.state === "completed") {
    return "Completed";
  }
  return task.missedWindow ? "Window missed" : "Due";
}

/** One accessibility label summarizing the WHOLE card (screen readers). */
function taskAccessibilityLabel(task: TodayTaskView): string {
  const methods = task.methods
    .map(
      (method) =>
        `${method.label}, ${method.estimatedEffortLabel}, ${
          method.availability === "available" ? "available" : "not connected yet"
        }`,
    )
    .join("; ");
  const completion =
    task.completion !== undefined
      ? ` Completed through capture ${task.completion.captureId} — ${task.completion.observationIds.length} observation${
          task.completion.observationIds.length === 1 ? "" : "s"
        } with full provenance.`
      : "";
  return (
    `${task.metricLabel}, ${stateTextOf(task)}, ${task.dueWindowLabel}, ${task.reason}, ` +
    `${task.methodCountLabel} — least burden first: ${methods}, ` +
    `estimated effort ${task.estimatedEffortLabel}, privacy impact: ${task.privacyImpactLabel}, ` +
    `fallback ${task.fallback.label}, providers ${task.fallback.providers.join(", ")}.` +
    completion
  );
}

export function TodayScreen() {
  const [session, setSession] = useState<TodaySession>(() => initialTodaySession(new Date()));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const now = new Date();
  const intents = listTodayIntents(session, now);
  const tasks = listTodayTasks(session, now);
  const openTasks = tasks.filter((task) => task.state === "open");
  const activeTask = tasks.find((task) => task.taskId === activeTaskId) ?? null;

  function handleCompletePress(task: TodayTaskView): void {
    setActiveTaskId(task.taskId);
    setAnnouncement(
      `Capture flow opened for ${task.metricLabel} — ${task.primaryRouteLabel}.`,
    );
  }

  function handleCloseWithoutCompleting(): void {
    if (activeTask !== null) {
      setAnnouncement(
        `Capture flow closed without completing — ${activeTask.metricLabel} is still due.`,
      );
    }
    setActiveTaskId(null);
  }

  /**
   * The inline capture flow's submit seam: the validated submission
   * completes the task through the pure session model (the ONLY
   * open -> completed transition) and the surface re-reads progress.
   */
  function handleSubmit(submission: MobileCaptureSubmission): "recorded" | "queued" {
    const taskId = activeTaskId;
    if (taskId === null) {
      // No task in flight (defensive): the capture itself is still valid.
      setAnnouncement("The capture was saved.");
      return "recorded";
    }
    const submittedAt = new Date();
    const outcome = completeTodayTask(session, taskId, submittedAt);
    const shape = findCaptureShape(submission.shapeId);
    const methodLabel = shape?.manualMethodOption.label ?? "manual entry";
    if (!outcome.ok) {
      // The task is no longer open (e.g. completed elsewhere): the capture
      // was still recorded — honest phrasing, never silent.
      setActiveTaskId(null);
      setAnnouncement(
        "The capture was saved, but the task could not be completed — it is no longer open.",
      );
      return "recorded";
    }
    setSession(outcome.session);
    setActiveTaskId(null);
    setAnnouncement(
      `Measurement saved and task completed: ${outcome.task.metricLabel}. ` +
        `Recorded by you (self-tracking) via ${methodLabel}. ` +
        `Quality recorded as ${submission.qualityState} (never upgraded). ` +
        `Provenance: full chain on the observation.`,
    );
    return "recorded";
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Today
      </Text>
      <Text style={styles.intro}>
        What you are trying to accomplish, what is due, and the easiest valid
        way to complete it.
      </Text>

      <View accessibilityLiveRegion="polite">
        {announcement !== null ? <Text style={styles.announcement}>{announcement}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          What you are working toward
        </Text>
        <Text style={styles.cardNote}>
          Your active intents and their measurement plans — the &quot;why&quot;
          behind everything due today.
        </Text>
        <View style={styles.intentList}>
          {intents.map((intent) => (
            <View
              key={intent.intentId}
              accessibilityLabel={
                `${intent.objective}. Active plan: ${intent.planLabel} (${intent.planId}). ` +
                `${intent.progress.label} (${intent.progress.completedToday} completed · ${intent.progress.dueNow} due now)`
              }
              style={styles.intentRow}
            >
              <View style={styles.intentHeader}>
                <Text style={styles.intentObjective}>{intent.objective}</Text>
                <Text style={styles.activePlanBadge}>Active plan</Text>
              </View>
              <Text style={styles.intentPlan}>{`${intent.planLabel} · ${intent.planId}`}</Text>
              <Text style={styles.intentProgress}>
                {`${intent.progress.label} (${intent.progress.completedToday} completed · ${intent.progress.dueNow} due now)`}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.tasksSection}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          What matters today
        </Text>
        <Text style={styles.cardNote}>
          {openTasks.length === 0
            ? "No open measurement tasks right now."
            : `${openTasks.length} measurement task${openTasks.length === 1 ? "" : "s"} due — the easiest valid way to complete each is first.`}
        </Text>
        <View style={styles.taskList}>
          {tasks.map((task) => (
            <TaskCard
              key={task.taskId}
              task={task}
              completing={task.taskId === activeTaskId}
              onComplete={handleCompletePress}
            />
          ))}
        </View>
      </View>

      {activeTask !== null ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={spacing[4]}
        >
          <View style={styles.flowSection}>
            <Text accessibilityRole="header" style={styles.flowTitle}>
              {`Completing: ${activeTask.metricLabel}`}
            </Text>
            <Text style={styles.cardNote}>
              The manual capture journey — record the reading and the task
              completes with full provenance.
            </Text>
            <CaptureForm onSubmit={handleSubmit} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close without completing"
              onPress={handleCloseWithoutCompleting}
              style={styles.closeWithoutButton}
            >
              <Text style={styles.closeWithoutButtonText}>Close without completing</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      <Text style={styles.footnote}>
        Synthetic journey — no real medical data, no real credentials, no
        network calls. Provenance is recorded for every observation.
      </Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// The task card (every §Measurement task UX field, text-carried states).
// ---------------------------------------------------------------------------

function TaskCard({
  task,
  completing,
  onComplete,
}: {
  readonly task: TodayTaskView;
  /** True while this task's capture flow is mounted below. */
  readonly completing: boolean;
  readonly onComplete: (task: TodayTaskView) => void;
}) {
  const completed = task.state === "completed";
  return (
    <View
      accessibilityLabel={taskAccessibilityLabel(task)}
      style={[styles.card, completing ? styles.cardActive : null]}
    >
      <View style={styles.taskHeader}>
        <Text style={styles.taskMetric}>{task.metricLabel}</Text>
        <Text style={task.missedWindow ? styles.stateMissed : completed ? styles.stateCompleted : styles.stateOpen}>
          {stateTextOf(task)}
        </Text>
        <Text style={styles.dueWindowBadge}>{task.dueWindowLabel}</Text>
      </View>

      <Text style={styles.taskReason}>{task.reason}</Text>

      <Text style={styles.fieldLabel}>Acceptable methods</Text>
      <Text style={styles.fieldValue}>{`${task.methodCountLabel} — least burden first:`}</Text>
      {task.methods.map((method) => (
        <View key={method.methodId} style={styles.methodBlock}>
          <Text style={styles.fieldValue}>
            {`${method.label} · ${method.estimatedEffortLabel} · ${
              method.availability === "available" ? "available" : "not connected yet"
            }`}
          </Text>
          <Text style={styles.methodNote}>{method.availabilityNote}</Text>
        </View>
      ))}

      <Text style={styles.fieldLabel}>Estimated effort</Text>
      <Text style={styles.fieldValue}>{task.estimatedEffortLabel}</Text>
      <Text style={styles.fieldLabel}>Privacy impact</Text>
      <Text style={styles.fieldValue}>{task.privacyImpactLabel}</Text>

      <View style={[styles.fallbackBlock, task.missedWindow ? styles.fallbackMissed : null]}>
        <Text style={styles.fallbackTitle}>
          {`${task.fallback.label}${task.missedWindow ? " — suggested for missed windows" : ""}`}
        </Text>
        <Text style={styles.fallbackDetail}>{`Providers: ${task.fallback.providers.join(" · ")}`}</Text>
        <Text style={styles.fallbackDetail}>{task.fallback.detail}</Text>
      </View>

      {completed && task.completion !== undefined ? (
        <Text style={styles.completionLine}>
          {`Completed through capture ${task.completion.captureId} — ${task.completion.observationIds.length} observation${
            task.completion.observationIds.length === 1 ? "" : "s"
          } with full provenance.`}
        </Text>
      ) : null}

      {completed ? (
        <Text style={styles.nothingDue}>Nothing more due for this task right now.</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Complete ${task.metricLabel} now — ${task.primaryRouteLabel}, ${task.estimatedEffortLabel}`}
          onPress={() => {
            onComplete(task);
          }}
          style={styles.completeButton}
        >
          <Text style={styles.completeButtonText}>
            {completing ? "Completing — flow open below" : `Complete now — ${task.primaryRouteLabel}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: color.canvas,
    flex: 1,
  },
  content: {
    gap: spacing[4],
    padding: spacing[4],
    paddingBottom: spacing[6],
  },
  title: {
    color: color.fgPrimary,
    fontSize: typography.size.xxl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xxl * typography.lineHeight.tight,
  },
  intro: {
    color: color.fgMuted,
    fontSize: typography.size.md,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  announcement: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  card: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[3],
    padding: spacing[5],
    shadowColor: "#1C221F",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  cardActive: {
    borderColor: color.accent,
  },
  cardTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.xl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xl * typography.lineHeight.tight,
  },
  cardNote: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  intentList: {
    gap: spacing[3],
  },
  intentRow: {
    backgroundColor: color.canvas,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[3],
  },
  intentHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  intentObjective: {
    color: color.fgPrimary,
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  activePlanBadge: {
    backgroundColor: color.successSubtle,
    borderRadius: radius.pill,
    color: color.success,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  intentPlan: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  intentProgress: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "500" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  tasksSection: {
    gap: spacing[3],
  },
  taskList: {
    gap: spacing[4],
  },
  taskHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  taskMetric: {
    color: color.fgPrimary,
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  stateOpen: {
    backgroundColor: color.warningSubtle,
    borderRadius: radius.pill,
    color: color.warning,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  stateMissed: {
    backgroundColor: color.dangerSubtle,
    borderRadius: radius.pill,
    color: color.danger,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  stateCompleted: {
    backgroundColor: color.successSubtle,
    borderRadius: radius.pill,
    color: color.success,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  dueWindowBadge: {
    backgroundColor: color.canvas,
    borderColor: color.borderSubtle,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "500" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  taskReason: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  fieldLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
  },
  fieldValue: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
    marginTop: -spacing[1],
  },
  methodBlock: {
    gap: 1,
  },
  methodNote: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  fallbackBlock: {
    backgroundColor: color.canvas,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[3],
  },
  fallbackMissed: {
    borderColor: color.warning,
  },
  fallbackTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  fallbackDetail: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  completionLine: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  nothingDue: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  completeButton: {
    alignItems: "center",
    backgroundColor: color.accent,
    borderColor: color.accent,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[5],
  },
  completeButtonText: {
    color: color.fgOnAccent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  flowSection: {
    gap: spacing[3],
  },
  flowTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.xl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xl * typography.lineHeight.tight,
  },
  closeWithoutButton: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[5],
  },
  closeWithoutButtonText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
});
