import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  createMobileCaptureRecord,
  formatCapturedLabel,
  formatValueLabel,
  findCaptureShape,
  initialCaptureIdCounters,
  type CaptureIdCounters,
  type MobileCaptureRecord,
  type MobileCaptureSubmission,
} from "../lib/capture/model";
import {
  enqueueCaptureDraft,
  flushConfirmation,
  offlineQueueSummary,
  takeAllCaptureDrafts,
  type QueuedCaptureDraft,
} from "../lib/capture/offline-queue";
import { CaptureForm } from "./capture-form";
import { CaptureHistory } from "./capture-history";
import { IntentJourney } from "./intent-journey";

/**
 * Health surface (M4-B): the manual capture journey lands on the Health
 * tab ("Your intents, measurement plans, and observations" — the natural
 * home for person-mode measurement capture on the five-destination
 * mobile shell).
 *
 * Offline-tolerant submit (packet: "queue-in-state + flush on focus —
 * pure client behavior, no native modules"):
 * - a synthetic "Simulate offline" switch (a development affordance of
 *   the synthetic journey — there is no real backend in M0/M4-B) routes
 *   submits into an in-state queue instead of recording them;
 * - when the app returns to the foreground (AppState "active") or the
 *   switch turns off, the queued drafts flush in FIFO order;
 * - a failed deliverability is impossible in this synthetic journey, so
 *   the queue is bounded only by the session.
 *
 * The local record builder is the same domain-shaped model as the web
 * store (one observation per captured field, provenance actor = the
 * person, method actually used, pending validation) — the engine/API
 * wiring arrives at integration (recorded handoff).
 */

type Feedback =
  | { readonly kind: "saved"; readonly text: string }
  | { readonly kind: "queued"; readonly text: string }
  | { readonly kind: "flushed"; readonly text: string }
  | { readonly kind: "offline-hint"; readonly text: string };

export function HealthScreen() {
  const [offlineMode, setOfflineMode] = useState(false);
  const [queue, setQueue] = useState<readonly QueuedCaptureDraft[]>([]);
  const [records, setRecords] = useState<readonly MobileCaptureRecord[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const counters = useRef<CaptureIdCounters>(initialCaptureIdCounters());
  const nextQueueId = useRef(0);

  /** Drains a queue snapshot into records (shared by flush paths). */
  function drainQueue(currentQueue: readonly QueuedCaptureDraft[]): void {
    if (currentQueue.length === 0) {
      setFeedback({ kind: "offline-hint", text: offlineQueueSummary(0) });
      return;
    }
    const { drafts } = takeAllCaptureDrafts(currentQueue);
    let running = counters.current;
    const flushed: MobileCaptureRecord[] = [];
    for (const draft of drafts) {
      const result = createMobileCaptureRecord(draft.submission, new Date(), running);
      running = result.counters;
      flushed.push(result.record);
    }
    counters.current = running;
    setRecords((current) => [...flushed, ...current]);
    setQueue([]);
    setFeedback({ kind: "flushed", text: flushConfirmation(drafts.length) });
  }

  /** Flush-on-focus wrapper: respects the offline switch and emptiness. */
  function flushQueue(): void {
    if (offlineMode || queue.length === 0) {
      return;
    }
    drainQueue(queue);
  }

  // Flush on focus: pure client behavior via the RN AppState core API
  // (no native modules added). The subscription re-subscribes when the
  // offline mode or queue changes so the closure always sees fresh state.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") {
        flushQueue();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [offlineMode, queue]);

  function handleSubmit(submission: MobileCaptureSubmission): "recorded" | "queued" {
    if (offlineMode) {
      nextQueueId.current += 1;
      setQueue((current) =>
        enqueueCaptureDraft(current, submission, new Date(), nextQueueId.current),
      );
      setFeedback({
        kind: "queued",
        text:
          "Measurement queued — it will submit automatically when you are back online. Nothing is lost.",
      });
      return "queued";
    }
    const result = createMobileCaptureRecord(submission, new Date(), counters.current);
    counters.current = result.counters;
    const record = result.record;
    setRecords((current) => [record, ...current]);
    const shape = findCaptureShape(record.shapeId);
    const values: Record<string, number> = {};
    for (const observation of record.observations) {
      const field = shape?.fields.find(
        (candidate) => candidate.metric.id === observation.metricId,
      );
      if (field !== undefined) {
        values[field.id] = observation.value;
      }
    }
    setFeedback({
      kind: "saved",
      text:
        `Measurement saved: ${shape?.displayName ?? record.shapeLabel} ` +
        `${shape !== undefined ? formatValueLabel(shape, values) : ""} — recorded by you ` +
        `(self-tracking) via ${shape?.manualMethodOption.label ?? "manual entry"}. ` +
        `Quality recorded as ${record.qualityState} (never upgraded). ` +
        `Captured ${formatCapturedLabel(new Date(record.capturedAt), new Date())}.`,
    });
    return "recorded";
  }

  const now = new Date();

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Health
      </Text>
      <Text style={styles.intro}>
        Your intents, measurement plans, and observations — now with a real
        manual capture journey.
      </Text>

      <View style={styles.offlineCard}>
        <View style={styles.offlineTexts}>
          <Text style={styles.offlineTitle}>Simulate offline</Text>
          <Text style={styles.offlineNote}>
            A synthetic development affordance: while on, submits queue on
            this device and flush when you return online or refocus the app.
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Simulate offline"
          accessibilityState={{ checked: offlineMode }}
          onPress={() => {
            const next = !offlineMode;
            setOfflineMode(next);
            if (!next) {
              // Turning offline mode off flushes immediately.
              drainQueue(queue);
            } else {
              setFeedback({ kind: "offline-hint", text: "Offline mode on — submits will queue." });
            }
          }}
          style={[styles.switchTrack, offlineMode ? styles.switchTrackOn : null]}
        >
          <Text
            accessible={false}
            style={[styles.switchThumb, offlineMode ? styles.switchThumbOn : null]}
          >
            {offlineMode ? "ON" : "OFF"}
          </Text>
        </Pressable>
      </View>

      {queue.length > 0 ? (
        <Text style={styles.queueBanner} accessibilityLiveRegion="polite">
          {offlineQueueSummary(queue.length)}
        </Text>
      ) : null}

      <View accessibilityLiveRegion="polite">
        {feedback !== null ? (
          <Text
            style={
              feedback.kind === "saved"
                ? styles.feedbackSaved
                : feedback.kind === "queued"
                  ? styles.feedbackQueued
                  : styles.feedbackNeutral
            }
          >
            {feedback.text}
          </Text>
        ) : null}
      </View>

      <CaptureForm onSubmit={handleSubmit} />

      <CaptureHistory records={records} now={now} />

      {/* M6-A: the intent journey (create -> review candidate plan ->
          approve/reject) lands below the capture journey on the Health
          tab — the same surface "Your intents, measurement plans, and
          observations". */}
      <IntentJourney />

      <Text style={styles.footnote}>
        Synthetic journey — no real medical data, no real credentials, no
        network calls. Provenance is recorded for every observation.
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
  offlineCard: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing[3],
    padding: spacing[4],
  },
  offlineTexts: {
    flex: 1,
  },
  offlineTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    marginBottom: spacing[1],
  },
  offlineNote: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  switchTrack: {
    alignItems: "center",
    backgroundColor: color.canvas,
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    minWidth: 84,
    paddingHorizontal: spacing[3],
  },
  switchTrackOn: {
    backgroundColor: color.accentSubtle,
    borderColor: color.accent,
  },
  switchThumb: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "700" as const,
  },
  switchThumbOn: {
    color: color.accent,
  },
  queueBanner: {
    backgroundColor: color.accentSubtle,
    borderRadius: radius.md,
    color: color.accent,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
    padding: spacing[3],
  },
  feedbackSaved: {
    color: color.success,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  feedbackQueued: {
    color: "#7A4F0B" as const,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  feedbackNeutral: {
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
