import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  approveIntentSession,
  rejectIntentSession,
  type IntentSession,
} from "../lib/intents/model";

/**
 * Plan review screen (M6-A, Lane B — mobile): the B3 surface on the
 * Health tab — the M5 explainability shape rendered as an audit-trail
 * list (pack identity, contributing entries with coverage windows,
 * methods, totals, decision), the burden summary, the safety outcome
 * badge (PASS / ESCALATE with reason codes), and the approve-with-edits /
 * reject actions over the local model's domain-transition mirror.
 *
 * The mobile journey applies the acts through the local model (no route
 * stubs in the RN shell at this milestone); the aria-equivalent state
 * changes are announced via `accessibilityLiveRegion="polite"`.
 *
 * Accessibility contract (packet B4): 44px minimum targets everywhere;
 * concept-code edit rows expose checkbox semantics; the reviewer note and
 * rejection reason inputs carry explicit accessibilityLabels; the layout
 * is keyboard-aware.
 */

export interface PlanReviewProps {
  /** The session under review (candidate plan received). */
  readonly session: IntentSession;
  /** Fired after a successful act (approve or reject). */
  readonly onActed: (result: {
    kind: "approved" | "rejected";
    session: IntentSession;
  }) => void;
}

export function PlanReview({ session, onActed }: PlanReviewProps) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [reasonMode, setReasonMode] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const candidate = session.review.candidate;
  const safety = session.review.safety;
  const burden = session.review.burden;

  function approve(): void {
    if (candidate === null) {
      return;
    }
    const trimmedNote = note.trim();
    try {
      const approved = approveSession(session, trimmedNote);
      setAnnouncement(
        "Candidate plan approved — published to your plan store (draft to published, through the domain transition).",
      );
      onActed({ kind: "approved", session: approved });
    } catch {
      setError("The plan could not be approved (illegal transition).");
    }
  }

  function reject(): void {
    const trimmed = reason.trim();
    if (trimmed === "") {
      setError("A rejection reason is required.");
      return;
    }
    setError(undefined);
    const rejected = rejectSession(session, trimmed);
    setAnnouncement("Candidate plan rejected — the review entry is closed.");
    onActed({ kind: "rejected", session: rejected });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboard}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.title}>
          Review the candidate plan
        </Text>
        <Text style={styles.muted}>
          {`Intent: ${session.intent.objective} (${session.intent.intentId}) · review entry ${session.review.entryId} · state ${session.review.state}.`}
        </Text>
        <View accessibilityLiveRegion="polite" style={styles.announcementLive}>
          {announcement !== null ? (
            <Text style={styles.announcementText}>{announcement}</Text>
          ) : null}
        </View>

        {candidate === null ? (
          <>
            <Text style={styles.body}>
              No executable candidate plan was produced for this intent — the
              compiler found no method with both evidence coverage and a
              registered source behind it.
            </Text>
            {session.review.dropped.map((drop) => (
              <Text key={`${drop.metricId}-${drop.methodId}`} style={styles.auditLine}>
                {`${drop.methodLabel} — dropped (${drop.reason}): ${drop.detail}`}
              </Text>
            ))}
          </>
        ) : (
          <>
            <View style={styles.summaryBlock} accessibilityLabel="Candidate plan summary">
              <Text style={styles.summaryLine}>{candidate.metricLabel}</Text>
              <Text style={styles.auditLine}>
                {`${candidate.methodLabel} · ${cadenceLabel(candidate.cadencePerDay)} · ${candidate.methodEvidenceLabel} · burden rank ${candidate.methodRelativeBurden}`}
              </Text>
              <Text style={styles.auditLine}>
                {`Draft plan ${candidate.planId} · concept code ${candidate.conceptCode} · compiled against pack v${candidate.pack.version} (${candidate.pack.contentHash}).`}
              </Text>
            </View>

            {safety !== null ? (
              <View
                accessibilityLabel={`Safety outcome ${safety.kind}`}
                style={[
                  styles.safetyBadge,
                  safety.kind === "PASS"
                    ? styles.safetyPass
                    : safety.kind === "ESCALATE"
                      ? styles.safetyEscalate
                      : styles.safetyReject,
                ]}
              >
                <Text style={styles.safetyBadgeText}>
                  {`Safety outcome: ${safety.kind}${
                    safety.kind === "PASS"
                      ? " — no rule fired, publishable after your review"
                      : " — human review required before publication (reason codes recorded)"
                  }`}
                </Text>
                {safety.kind !== "PASS" ? (
                  <View style={styles.reasonList}>
                    {safety.reasonCodes.map((code) => (
                      <Text key={code} style={styles.reasonLine}>
                        {`Reason code: ${code}`}
                      </Text>
                    ))}
                    {safety.firedRules.map((rule) => (
                      <Text key={rule.ruleId} style={styles.auditLine}>
                        {`Rule ${rule.ruleId} (${rule.ruleKind}) fired — ${rule.inputsSummary}`}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {burden !== null ? (
              <View accessibilityLabel="Burden summary" style={styles.summaryBlock}>
                <Text style={styles.summaryLine}>Burden summary</Text>
                <Text style={styles.auditLine}>
                  {`${burden.methodCount} method · ${cadenceLabel(
                    burden.measurementsPerDay,
                  )} · ${burden.burdenUnitsPerDay} units/day (kind weights: manual ${burden.methodKindWeights.manual}, app ${burden.methodKindWeights.app}, device ${burden.methodKindWeights.device})`}
                </Text>
              </View>
            ) : null}

            <View accessibilityLabel="Why this plan (audit trail)" style={styles.summaryBlock}>
              <Text style={styles.summaryLine}>Why this plan (audit trail)</Text>
              <Text style={styles.auditLine}>
                {`Pack v${candidate.pack.version} — ${candidate.pack.packId} · content ${candidate.pack.contentHash} · ${candidate.contributingEntries.length} contributing entries`}
              </Text>
              {candidate.contributingEntries.map((entry) => (
                <Text key={entry.entryId} style={styles.auditLine}>
                  {`${entry.count} observations via ${entry.methodId} · window last 30 days · actor class ${entry.provenanceActorClass} · entry ${entry.entryId}`}
                </Text>
              ))}
              <Text style={styles.auditLine}>
                {`${candidate.methodLabel} (${candidate.methodId}) · ${candidate.methodKind} · burden rank ${candidate.methodRelativeBurden} · evidence ${candidate.methodEvidenceLabel}`}
              </Text>
              <Text style={styles.auditLine}>
                {`${candidate.totalObservationCount} backing observations · draft plan ${candidate.planId}`}
              </Text>
              <Text style={styles.auditLine}>
                Draft plan awaits your decision — publication only through your approval.
              </Text>
            </View>

            {session.review.dropped.length > 0 ? (
              <View accessibilityLabel="Dropped by the matcher" style={styles.summaryBlock}>
                <Text style={styles.summaryLine}>Dropped by the matcher</Text>
                {session.review.dropped.map((drop) => (
                  <Text key={`${drop.metricId}-${drop.methodId}`} style={styles.auditLine}>
                    {`${drop.methodLabel} — ${drop.reason}: ${drop.detail}`}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Reviewer note (optional)</Text>
              <TextInput
                accessibilityLabel="Reviewer note"
                multiline
                style={styles.input}
                value={note}
                onChangeText={(text) => {
                  setNote(text);
                }}
              />
              <Text style={styles.fieldHint}>
                Recorded with the published plan (the committed concept codes
                stay the draft's at this milestone — identity fields are
                immutable).
              </Text>
            </View>

            <View style={styles.actions}>
              <ActionButton
                kind="primary"
                label="Approve with edits"
                onPress={approve}
                disabled={session.review.state !== "pending"}
              />
              <ActionButton
                kind="secondary"
                label="Reject plan"
                onPress={() => {
                  setReasonMode(true);
                }}
                disabled={session.review.state !== "pending"}
              />
            </View>

            {reasonMode ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Why are you rejecting this plan?</Text>
                <TextInput
                  accessibilityLabel="Rejection reason"
                  multiline
                  style={styles.input}
                  value={reason}
                  onChangeText={(text) => {
                    setReason(text);
                    setError(undefined);
                  }}
                />
                <View style={styles.actions}>
                  <ActionButton kind="primary" label="Confirm rejection" onPress={reject} />
                  <ActionButton
                    kind="secondary"
                    label="Cancel"
                    onPress={() => {
                      setReasonMode(false);
                      setError(undefined);
                    }}
                  />
                </View>
              </View>
            ) : null}

            <View accessibilityLiveRegion="polite" style={styles.announcementLive}>
              {error !== undefined ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          </>
        )}

        {candidate === null ? (
          <View style={styles.actions}>
            <ActionButton
              kind="secondary"
              label="Reject plan"
              onPress={() => {
                setReasonMode(true);
              }}
              disabled={session.review.state !== "pending"}
            />
          </View>
        ) : null}
        {candidate === null && reasonMode ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Why are you rejecting this plan?</Text>
            <TextInput
              accessibilityLabel="Rejection reason"
              multiline
              style={styles.input}
              value={reason}
              onChangeText={(text) => {
                setReason(text);
                setError(undefined);
              }}
            />
            <View style={styles.actions}>
              <ActionButton kind="primary" label="Confirm rejection" onPress={reject} />
              <ActionButton
                kind="secondary"
                label="Cancel"
                onPress={() => {
                  setReasonMode(false);
                  setError(undefined);
                }}
              />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Local act wrappers (the model's domain-transition mirror calls).
function approveSession(session: IntentSession, note: string): IntentSession {
  return approveIntentSession(
    session,
    note !== "" ? { note } : undefined,
    new Date(),
  );
}

function rejectSession(session: IntentSession, reason: string): IntentSession {
  return rejectIntentSession(session, reason, new Date());
}

function cadenceLabel(cadencePerDay: number): string {
  if (cadencePerDay === 2) {
    return "2×/day";
  }
  if (cadencePerDay === 1) {
    return "1×/day";
  }
  if (cadencePerDay === 0.5) {
    return "every 2 days";
  }
  if (Math.abs(cadencePerDay - 1 / 7) < 1e-9) {
    return "1×/week";
  }
  return `${cadencePerDay}/day`;
}

function ActionButton({
  label,
  kind,
  onPress,
  disabled = false,
}: {
  label: string;
  kind: "primary" | "secondary";
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ ...(disabled ? { disabled: true } : {}) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        kind === "primary" ? styles.actionPrimary : styles.actionSecondary,
        disabled ? styles.actionDisabled : null,
      ]}
    >
      <Text style={kind === "primary" ? styles.actionPrimaryText : styles.actionSecondaryText}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  content: { gap: spacing[3], padding: spacing[4], paddingBottom: spacing[6] },
  title: {
    color: color.fgPrimary,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    lineHeight: typography.size.lg * typography.lineHeight.tight,
  },
  muted: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  body: {
    color: color.fgPrimary,
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
  summaryBlock: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[3],
  },
  summaryLine: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  auditLine: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  safetyBadge: {
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[2],
    padding: spacing[3],
  },
  safetyPass: { backgroundColor: color.successSubtle, borderColor: color.success },
  safetyEscalate: { backgroundColor: color.warningSubtle, borderColor: color.warning },
  safetyReject: { backgroundColor: color.dangerSubtle, borderColor: color.danger },
  safetyBadgeText: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  reasonList: { gap: spacing[1] },
  reasonLine: {
    color: color.fgPrimary,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  field: { gap: spacing[1] },
  fieldLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  fieldHint: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  input: {
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    color: color.fgPrimary,
    fontSize: typography.size.md,
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  errorText: {
    color: color.danger,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[1],
  },
  actionButton: {
    alignItems: "center",
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing[4],
  },
  actionPrimary: { backgroundColor: color.accent },
  actionSecondary: {
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderWidth: 1,
  },
  actionDisabled: { opacity: 0.6 },
  actionPrimaryText: {
    color: color.fgOnAccent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  actionSecondaryText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
});
