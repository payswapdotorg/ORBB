import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  buildTodayBoard,
  type TodayTaskView,
  type TaskWindowPhase,
} from "../lib/today/model";
import { CaptureForm } from "./capture-form";
import {
  createMobileCaptureRecord,
  initialCaptureIdCounters,
  type CaptureIdCounters,
  type MobileCaptureSubmission,
} from "../lib/capture/model";

/**
 * Today surface (M6-B B4, mobile): the intent-driven consumer home on the
 * Today tab — per-intent progress (counts only, conservative clinical
 * states — never gamified), the §Measurement task UX cards compactly
 * presented, and completion routed into the EXISTING M4-B manual-capture
 * form (inlined with the task's capture shape pre-selected at step 2).
 *
 * Accessibility contract (§Accessibility):
 * - every card exposes ONE accessibility label summarizing all card fields
 *   (metric | due window | reason | methods | effort | privacy | fallback);
 * - all interactive rows keep the 44px minimum touch target;
 * - health states are carried by text, never by color alone;
 * - the surface is keyboard-aware (the inlined capture form owns its own
 *   KeyboardAvoidingView + persisting scroll taps).
 */

const PHASE_LABELS: Readonly<Record<TaskWindowPhase, string>> = {
  "due-now": "Due now",
  "due-later-today": "Due later today",
  missed: "Missed window — rolled forward",
  completed: "Completed",
};

function taskAccessibilityLabel(view: TodayTaskView): string {
  return (
    `Measurement task: ${view.metricLabel}. ${view.dueLabel}. ${view.reason}. ` +
    `${view.methods.length} acceptable methods: ${view.methods.map((method) => method.label).join(", ")}. ` +
    `Estimated effort ${view.estimatedEffort}. Privacy: ${view.privacyImpact}. ` +
    `Fallback: ${view.fallback.label}.`
  );
}

export function TodayScreen() {
  const [completedIds, setCompletedIds] = useState<readonly string[]>([]);
  const [completing, setCompleting] = useState<TodayTaskView | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const board = buildTodayBoard(completedIds);
  const counters = useRef<CaptureIdCounters>(initialCaptureIdCounters());

  function handleSubmit(submission: MobileCaptureSubmission): "recorded" | "queued" {
    // The Today surface records through the same local model as the Health
    // tab (the engine/API wiring arrives at integration — handoff).
    const task = completing;
    const result = createMobileCaptureRecord(submission, new Date(), counters.current);
    counters.current = result.counters;
    if (task !== null) {
      setCompletedIds((current) =>
        current.includes(task.task.id) ? current : [...current, task.task.id],
      );
      setFeedback(
        `Measurement saved — ${result.record.shapeLabel} recorded by you (self-tracking) with full provenance. ${task.metricLabel} task completed.`,
      );
    }
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
        What you&apos;re trying to accomplish, what&apos;s due, why it&apos;s due, and the
        easiest valid way to complete it.
      </Text>

      <View accessibilityLiveRegion="polite">
        {feedback !== null ? <Text style={styles.feedback}>{feedback}</Text> : null}
      </View>

      {/* 1. What am I trying to accomplish — conservative progress counts. */}
      <View style={styles.card} accessibilityLabel="Today intent progress">
        <Text accessibilityRole="header" style={styles.cardTitle}>
          What you&apos;re working on
        </Text>
        {board.progress.map((entry) => (
          <View key={entry.intentLabel} style={styles.progressRow}>
            <Text style={styles.progressIntent}>{entry.intentLabel}</Text>
            <Text style={styles.progressSummary}>{entry.summary}</Text>
          </View>
        ))}
      </View>

      {/* 2. What matters today — the task cards. */}
      <View style={styles.card} accessibilityLabel="Today measurement tasks">
        <Text accessibilityRole="header" style={styles.cardTitle}>
          What&apos;s due today
        </Text>
        {board.tasks.map((view) => {
          const open = view.task.state === "open";
          const completeMethod = view.methods.find((method) => method.available);
          return (
            <View
              key={view.task.id}
              accessibilityLabel={taskAccessibilityLabel(view)}
              style={styles.taskCard}
            >
              <View style={styles.taskHeader}>
                <Text style={styles.taskMetric}>{view.metricLabel}</Text>
                <Text
                  accessibilityLabel={PHASE_LABELS[view.windowPhase]}
                  style={styles.taskDue}
                >
                  {view.dueLabel}
                </Text>
              </View>
              <Text style={styles.taskReason}>{view.reason}</Text>
              <Text style={styles.taskMeta}>
                {`Methods (${view.methods.length}), easiest valid first:`}
              </Text>
              {view.methods.map((method) => (
                <Text key={method.id} style={styles.taskMethod}>
                  {`${method.available ? "•" : "○"} ${method.label} — ${method.evidenceLabel} · ${method.available ? "available" : "not available yet"}`}
                </Text>
              ))}
              <Text style={styles.taskMeta}>
                {`Effort: ${view.estimatedEffort} · Privacy: ${view.privacyImpact}`}
              </Text>
              <Text style={styles.taskFallback}>
                {`Fallback: ${view.fallback.label}${view.fallback.available ? ` (${view.fallback.providerIds.join(" · ")})` : ""}`}
              </Text>
              {view.fallback.available ? (
                <Text style={styles.taskFallbackDetail}>{view.fallback.description}</Text>
              ) : null}
              {open && completeMethod !== undefined && view.captureShapeId !== undefined ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Complete now — ${completeMethod.label}`}
                  onPress={() => {
                    setCompleting(view);
                    setFeedback(`Opening the capture flow for ${view.metricLabel}.`);
                  }}
                  style={styles.completeButton}
                >
                  <Text style={styles.completeButtonText}>
                    {`Complete now — ${completeMethod.label}`}
                  </Text>
                </Pressable>
              ) : null}
              {!open && view.completedLabel !== undefined ? (
                <Text style={styles.completedLabel}>{view.completedLabel}</Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Completing a task: the EXISTING M4-B capture form, inlined with
          the task's shape pre-selected. */}
      {completing !== null ? (
        <View style={styles.card} accessibilityLabel="Complete a task">
          <View style={styles.taskHeader}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              Complete a task
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to today"
              onPress={() => {
                setCompleting(null);
                setFeedback("Back to today's tasks.");
              }}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>Back to today</Text>
            </Pressable>
          </View>
          <Text style={styles.contextNote}>
            {`Completing: ${completing.metricLabel} — ${completing.dueLabel} · task ${completing.task.id}. The observation will be recorded with full provenance.`}
          </Text>
          <CaptureForm
            {...(completing.captureShapeId !== undefined
              ? { initialShapeId: completing.captureShapeId }
              : {})}
            onSubmit={handleSubmit}
          />
        </View>
      ) : null}

      <Text style={styles.footnote}>
        Synthetic session (SYNTH) — reference date Sep 10, 2026. No real
        medical data, nothing persisted outside this session.
      </Text>
    </ScrollView>
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
  cardTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.xl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xl * typography.lineHeight.tight,
  },
  feedback: {
    color: color.success,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  progressRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  progressIntent: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  progressSummary: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  taskCard: {
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[2],
    padding: spacing[4],
  },
  taskHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing[2],
    justifyContent: "space-between",
  },
  taskMetric: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    flex: 1,
  },
  taskDue: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  taskReason: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  taskMeta: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  taskMethod: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  taskFallback: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  taskFallbackDetail: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  completeButton: {
    alignItems: "center",
    backgroundColor: color.accent,
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[4],
  },
  completeButtonText: {
    color: "#FFFFFF" as const,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  completedLabel: {
    color: color.success,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  backButton: {
    alignItems: "center",
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
  },
  backButtonText: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  contextNote: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
});
