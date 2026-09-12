import { useMemo, useState } from "react";
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
  GOAL_METRIC_OPTIONS,
  INTENT_CADENCE_OPTIONS,
  INTENT_DIRECTION_OPTIONS,
  INTENT_METHOD_PREFERENCE_OPTIONS,
  SYNTHETIC_PACK_CONTENT_HASH,
  buildSyntheticEvidencePack,
  findGoalMetricOption,
  findIntentMethodOption,
  intentDirectionLabel,
  packEntriesForMetric,
  type IntentGoalView,
  type IntentMethodPreference,
} from "../lib/intents/model";

/**
 * Intent composer screen (M6-A, Lane B — mobile): the guided "Create a
 * health intent" journey on the Health tab — the same three steps as web
 * (goal -> constraints + evidence pack summary -> review + create),
 * running the local model's compile mirror (no route stubs in the RN
 * shell at this milestone — the integration station wires the engine /
 * API seam, handoff recorded).
 *
 * Accessibility contract (packet B4): every option row and button keeps
 * the 44px touch target; option rows expose radio semantics with
 * accessibilityState (never color alone); the target/note inputs carry
 * explicit accessibilityLabels (Maestro drives them); the layout is
 * keyboard-aware (KeyboardAvoidingView + persisting scroll taps).
 */

type ComposerStep = 1 | 2 | 3;

const STEP_LABELS: Readonly<Record<ComposerStep, string>> = {
  1: "choose your goal",
  2: "constraints and evidence",
  3: "review and create",
};

export interface IntentComposerProps {
  /** Delivers the created session (candidate plan received). */
  readonly onCreate: (payload: {
    goal: IntentGoalView;
    cadencePerDay: number;
    methodPreference: IntentMethodPreference;
    draftId: string;
  }) => void;
}

export function IntentComposer({ onCreate }: IntentComposerProps) {
  const [step, setStep] = useState<ComposerStep>(1);
  const [metricId, setMetricId] = useState<string | undefined>(undefined);
  const [direction, setDirection] = useState<string | undefined>(undefined);
  const [targetText, setTargetText] = useState("");
  const [cadenceId, setCadenceId] = useState<string | undefined>(undefined);
  const [preference, setPreference] = useState<IntentMethodPreference | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  const metricOption = useMemo(
    () => (metricId !== undefined ? findGoalMetricOption(metricId) : undefined),
    [metricId],
  );

  function continueFromStep1(): void {
    if (metricId === undefined) {
      setError("Choose a metric to continue.");
      return;
    }
    if (direction === undefined) {
      setError("Choose a direction to continue.");
      return;
    }
    const trimmed = targetText.trim();
    if (trimmed === "" || !Number.isFinite(Number(trimmed))) {
      setError("Enter a target value before continuing.");
      return;
    }
    setError(undefined);
    setStep(2);
  }

  function continueFromStep2(): void {
    if (cadenceId === undefined) {
      setError("Choose a cadence window to continue.");
      return;
    }
    if (preference === undefined) {
      setError("Choose a method preference to continue.");
      return;
    }
    setError(undefined);
    setStep(3);
  }

  function create(): void {
    const cadenceOption =
      cadenceId !== undefined
        ? INTENT_CADENCE_OPTIONS.find((option) => option.id === cadenceId)
        : undefined;
    const target = Number(targetText.trim());
    if (
      metricId === undefined ||
      direction === undefined ||
      cadenceOption === undefined ||
      preference === undefined ||
      !Number.isFinite(target)
    ) {
      setStep(1);
      return;
    }
    onCreate({
      goal: {
        metricId,
        direction: direction as IntentGoalView["direction"],
        target,
      },
      cadencePerDay: cadenceOption.cadencePerDay,
      methodPreference: preference,
      draftId: `SYNTH-DRAFT-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`,
    });
  }

  const pack = useMemo(() => buildSyntheticEvidencePack(new Date()), []);
  const cadenceOption =
    cadenceId !== undefined
      ? INTENT_CADENCE_OPTIONS.find((option) => option.id === cadenceId)
      : undefined;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboard}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Create a health intent
        </Text>
        <Text style={styles.muted}>
          State what you want to accomplish. ORBB compiles your goal against
          your evidence pack and proposes a candidate plan for your review.
        </Text>
        <Text accessibilityLiveRegion="polite" style={styles.stepAnnouncement}>
          {`Step ${step} of 3 — ${STEP_LABELS[step]}`}
        </Text>
        <View style={styles.errorLive} accessibilityLiveRegion="polite">
          {error !== undefined ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {step === 1 ? (
          <>
            <View
              accessibilityLabel="Which metric is this intent about"
              accessibilityRole="radiogroup"
              style={styles.optionGroup}
            >
              {GOAL_METRIC_OPTIONS.map((option) => (
                <RadioRow
                  key={option.metricId}
                  label={option.metricLabel}
                  description={option.summary}
                  checked={metricId === option.metricId}
                  onPress={() => {
                    setMetricId(option.metricId);
                    setTargetText("");
                    setError(undefined);
                  }}
                />
              ))}
            </View>
            <View
              accessibilityLabel="Which direction should the metric move"
              accessibilityRole="radiogroup"
              style={styles.optionGroup}
            >
              {INTENT_DIRECTION_OPTIONS.map((option) => (
                <RadioRow
                  key={option.value}
                  label={option.label}
                  checked={direction === option.value}
                  onPress={() => {
                    setDirection(option.value);
                    setError(undefined);
                  }}
                />
              ))}
            </View>
            {metricOption !== undefined ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  {`Target (${metricOption.metricLabel}, ${metricOption.unit})`}
                </Text>
                <TextInput
                  accessibilityLabel={`${metricOption.metricLabel} target value`}
                  keyboardType="numeric"
                  style={styles.input}
                  value={targetText}
                  onChangeText={(text) => {
                    setTargetText(text);
                    setError(undefined);
                  }}
                />
                <Text style={styles.fieldHint}>
                  {`In ${metricOption.unit}. Enter a number between ${metricOption.targetMin} and ${metricOption.targetMax}.`}
                </Text>
              </View>
            ) : null}
            <View style={styles.actions}>
              <ActionButton kind="primary" label="Continue" onPress={continueFromStep1} />
            </View>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <View
              accessibilityLabel="How often should the plan measure"
              accessibilityRole="radiogroup"
              style={styles.optionGroup}
            >
              {INTENT_CADENCE_OPTIONS.map((option) => (
                <RadioRow
                  key={option.id}
                  label={option.label}
                  description={option.description}
                  checked={cadenceId === option.id}
                  onPress={() => {
                    setCadenceId(option.id);
                    setError(undefined);
                  }}
                />
              ))}
            </View>
            <View
              accessibilityLabel="Method preference"
              accessibilityRole="radiogroup"
              style={styles.optionGroup}
            >
              {INTENT_METHOD_PREFERENCE_OPTIONS.map((option) => (
                <RadioRow
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  checked={preference === option.value}
                  onPress={() => {
                    setPreference(option.value);
                    setError(undefined);
                  }}
                />
              ))}
            </View>

            <View
              accessibilityLabel="Your evidence pack"
              style={styles.packCard}
            >
              <Text accessibilityRole="header" style={styles.packTitle}>
                Your evidence pack
              </Text>
              <Text style={styles.fieldHint}>
                {`Synthetic summary (SYNTH) — v1, content ${SYNTHETIC_PACK_CONTENT_HASH}. Coverage per metric and method; no values, only counts, windows, and provenance classes.`}
              </Text>
              {GOAL_METRIC_OPTIONS.map((metric) => {
                const entries = packEntriesForMetric(pack, metric.metricId);
                return (
                  <View key={metric.metricId} style={styles.packMetric}>
                    <Text style={styles.optionLabel}>{metric.metricLabel}</Text>
                    {entries.map((entry) => {
                      const method = findIntentMethodOption(entry.methodId);
                      return (
                        <Text
                          key={entry.entryId}
                          accessibilityLabel={`${method?.label ?? entry.methodId}, ${entry.count} observations, ${
                            entry.qualityMix.byEvidenceLabel.MEASURED > 0
                              ? "measured"
                              : "estimated"
                          }, actor ${entry.provenanceActorClass}`}
                          style={styles.packEntry}
                        >
                          {`${method?.label ?? entry.methodId}: ${entry.count} obs · ${
                            entry.qualityMix.byEvidenceLabel.MEASURED > 0
                              ? "MEASURED"
                              : "ESTIMATED"
                          } · last 30 days · actor: ${entry.provenanceActorClass}`}
                        </Text>
                      );
                    })}
                  </View>
                );
              })}
            </View>

            <View style={styles.actions}>
              <ActionButton
                kind="secondary"
                label="Back"
                onPress={() => {
                  setStep(1);
                }}
              />
              <ActionButton kind="primary" label="Continue" onPress={continueFromStep2} />
            </View>
          </>
        ) : null}

        {step === 3 && metricOption !== undefined && cadenceOption !== undefined ? (
          <>
            <View style={styles.reviewBlock} accessibilityLabel="Intent review summary">
              <Text style={styles.summaryLine}>
                {`Objective: ${intentDirectionLabel(
                  (direction ?? "decrease") as IntentGoalView["direction"],
                )} ${metricOption.metricLabel} toward ${targetText} ${metricOption.unit}.`}
              </Text>
              <Text style={styles.summaryLine}>
                {`Goal metric: ${metricOption.metricLabel} (${metricOption.conceptCode})`}
              </Text>
              <Text style={styles.summaryLine}>{`Cadence window: ${cadenceOption.label}`}</Text>
              <Text style={styles.summaryLine}>
                {`Method preference: ${
                  INTENT_METHOD_PREFERENCE_OPTIONS.find(
                    (option) => option.value === preference,
                  )?.label ?? "—"
                }`}
              </Text>
              <Text style={styles.summaryLine}>
                {`Evidence pack: v1 · ${SYNTHETIC_PACK_CONTENT_HASH} · ${pack.entries.length} capability entries`}
              </Text>
            </View>
            <Text style={styles.fieldHint}>
              Creating compiles a candidate plan proposal for your review — a
              draft, never an activated plan.
            </Text>
            <View style={styles.actions}>
              <ActionButton
                kind="secondary"
                label="Back"
                onPress={() => {
                  setStep(2);
                }}
              />
              <ActionButton kind="primary" label="Create intent" onPress={create} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives (the capture-form discipline: 44px targets, radio
// semantics with accessibilityState, keyboard-aware layout).
// ---------------------------------------------------------------------------

function RadioRow({
  label,
  description,
  checked,
  onPress,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.optionRow, checked ? styles.optionRowChecked : null]}
    >
      <Text accessible={false} style={styles.optionGlyph}>
        {checked ? "●" : "○"}
      </Text>
      <View style={styles.optionTexts}>
        <Text style={styles.optionLabel}>{label}</Text>
        {description !== undefined ? (
          <Text style={styles.optionDescription}>{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
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
      style={[styles.actionButton, kind === "primary" ? styles.actionPrimary : styles.actionSecondary]}
    >
      <Text style={kind === "primary" ? styles.actionPrimaryText : styles.actionSecondaryText}>
        {label}
      </Text>
    </Pressable>
  );
}

export const INTENT_COMPOSER_STYLES = StyleSheet.create({
  keyboard: { flex: 1 },
  content: { gap: spacing[3], padding: spacing[4], paddingBottom: spacing[6] },
  cardTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    lineHeight: typography.size.lg * typography.lineHeight.tight,
  },
  muted: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  stepAnnouncement: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  errorLive: { minHeight: typography.size.sm },
  errorText: {
    color: color.danger,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  optionGroup: { gap: spacing[2] },
  optionRow: {
    alignItems: "center",
    backgroundColor: color.canvas,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing[3],
    minHeight: touchTarget.minimum,
    padding: spacing[3],
  },
  optionRowChecked: {
    backgroundColor: color.accentSubtle,
    borderColor: color.accent,
  },
  optionGlyph: { color: color.accent, fontSize: typography.size.md },
  optionTexts: { flex: 1, gap: spacing[1] },
  optionLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  optionDescription: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
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
  },
  packCard: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[2],
    padding: spacing[3],
  },
  packTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    lineHeight: typography.size.md * typography.lineHeight.tight,
  },
  packMetric: { gap: spacing[1] },
  packEntry: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  reviewBlock: {
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
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[2] },
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

const styles = INTENT_COMPOSER_STYLES;
