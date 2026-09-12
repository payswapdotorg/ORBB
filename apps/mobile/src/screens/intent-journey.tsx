import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, typography } from "@orbb/ui/tokens";
import {
  createIntentSession,
  initialIntentIdCounters,
  type IntentIdCounters,
  type IntentSession,
} from "../lib/intents/model";
import { IntentComposer } from "./intent-composer";
import { PlanReview } from "./plan-review";

/**
 * Intent journey section (M6-A, Lane B — mobile): composes the guided
 * composer, the candidate plan review screen, and the outcome/published
 * views on the Health tab — the workspace pattern of the Measurements
 * surface (M4-B), now for intents.
 *
 * Owns the phase machine (compose -> review -> outcome) and the
 * creation-scoped id counters (the local model's session discipline).
 * Everything is synthetic (SYNTH) and session-local — no network calls,
 * no persistence (the engine/API wiring arrives at integration).
 */

type JourneyPhase = "compose" | "review" | "outcome";

export function IntentJourney() {
  const [phase, setPhase] = useState<JourneyPhase>("compose");
  const [session, setSession] = useState<IntentSession | null>(null);
  const [outcomeKind, setOutcomeKind] = useState<"approved" | "rejected" | null>(
    null,
  );
  const counters = useRef<IntentIdCounters>(initialIntentIdCounters());
  const composerRun = useRef(0);

  return (
    <View style={styles.section} accessibilityLabel="Health intents">
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Health intents
      </Text>
      <Text style={styles.intro}>
        Create a health intent, review the candidate plan ORBB proposes, and
        decide — nothing publishes without your approval.
      </Text>
      <View accessibilityLiveRegion="polite" style={styles.announcementLive}>
        {outcomeKind === "approved" ? (
          <Text style={styles.announcementText}>
            Candidate plan approved — published to your plan store.
          </Text>
        ) : null}
        {outcomeKind === "rejected" ? (
          <Text style={styles.announcementText}>
            Candidate plan rejected — the review entry is closed.
          </Text>
        ) : null}
      </View>

      {phase === "compose" ? (
        <IntentComposer
          key={composerRun.current}
          onCreate={({ goal, cadencePerDay, methodPreference, draftId }) => {
            const result = createIntentSession({
              draftId,
              goal,
              constraints: { cadencePerDay, methodPreference },
              now: new Date(),
              counters: counters.current,
            });
            counters.current = result.counters;
            setSession(result.session);
            setOutcomeKind(null);
            setPhase("review");
          }}
        />
      ) : null}

      {phase === "review" && session !== null ? (
        <PlanReview
          session={session}
          onActed={({ kind, session: acted }) => {
            setSession(acted);
            setOutcomeKind(kind);
            setPhase("outcome");
          }}
        />
      ) : null}

      {phase === "outcome" && session !== null ? (
        <View style={styles.outcomeCard} accessibilityLabel="Plan review outcome">
          {session.published !== undefined ? (
            <>
              <Text style={styles.outcomeTitle}>Plan published</Text>
              <Text style={styles.outcomeLine}>
                {`Plan ${session.published.planId} · ${session.published.metricLabel}`}
              </Text>
              <Text style={styles.outcomeLine}>
                {`${session.published.methodLabel} · state published (draft → published through the domain transition)`}
              </Text>
              {session.published.reviewerNote !== undefined ? (
                <Text style={styles.outcomeLine}>
                  {`Reviewer note: ${session.published.reviewerNote}`}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.outcomeTitle}>Plan rejected</Text>
              <Text style={styles.outcomeLine}>
                {`Reason: ${session.rejectionReason ?? "—"} · entry ${session.review.entryId} (state rejected, terminal).`}
              </Text>
            </>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create another intent"
            onPress={() => {
              composerRun.current += 1;
              setSession(null);
              setOutcomeKind(null);
              setPhase("compose");
            }}
            style={styles.resetLink}
          >
            <Text style={styles.resetLinkText}>Create another intent</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.footnote}>
        Synthetic journey (SYNTH) — the compile/review mirror runs locally in
        this session; the engine wiring arrives at integration.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[3], marginTop: spacing[6] },
  sectionTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    lineHeight: typography.size.lg * typography.lineHeight.tight,
  },
  intro: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  announcementLive: { minHeight: typography.size.sm },
  announcementText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  outcomeCard: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[4],
  },
  outcomeTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    lineHeight: typography.size.md * typography.lineHeight.tight,
  },
  outcomeLine: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  resetLink: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    alignSelf: "flex-start",
    justifyContent: "center",
    marginTop: spacing[2],
    minHeight: 44,
    paddingHorizontal: spacing[4],
  },
  resetLinkText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
});
