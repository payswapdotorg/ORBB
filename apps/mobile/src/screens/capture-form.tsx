import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  CAPTURE_FUTURE_TOLERANCE_MS,
  CAPTURE_NOTES_MAX_LENGTH,
  CAPTURE_QUALITY_DESCRIPTIONS,
  CAPTURE_QUALITY_LABELS,
  CAPTURE_QUALITY_STATES,
  CAPTURE_SHAPES,
  parseCaptureFieldText,
  parseTimestampText,
  toTimestampInputValue,
  type CaptureQualityState,
  type CaptureShape,
  type MobileCaptureSubmission,
} from "../lib/capture/model";

/**
 * Manual capture form (M4-B, mobile): the same three-step journey as the
 * web flow, adapted to React Native.
 *
 *   step 1 — WHAT: pick the metric from the synthetic catalog;
 *   step 2 — HOW + VALUES: the manual method (future routes shown
 *            disabled), per-shape value fields, the capture timestamp
 *            (defaults to now, editable) and optional notes;
 *   step 3 — REVIEW: summary + quality self-assessment, then submit.
 *
 * Accessibility contract:
 * - every interactive row/control keeps the 44px minimum touch target
 *   (`touchTarget.minimum`, comfortable 56 for primary buttons);
 * - option rows expose `accessibilityRole="radio"` +
 *   `accessibilityState={{ checked }}` inside a `radiogroup` container
 *   (selection is never communicated by color alone — the dot glyph and
 *   the checked state carry it);
 * - inputs carry explicit `accessibilityLabel`s (Maestro drives them);
 * - the layout is keyboard-aware (KeyboardAvoidingView + persisting
 *   scroll taps).
 */

export interface CaptureFormProps {
  /**
   * Deliver the validated submission. Returns "recorded" (landed) or
   * "queued" (offline-tolerant path — the caller owns the queue).
   */
  readonly onSubmit: (submission: MobileCaptureSubmission) => "recorded" | "queued";
}

type CaptureStep = 1 | 2 | 3;

const STEP_LABELS: Readonly<Record<CaptureStep, string>> = {
  1: "choose what you measured",
  2: "method, values, and context",
  3: "review and save",
};

interface RadioRowProps {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

function RadioRow({ label, description, checked, disabled = false, onPress }: RadioRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked, ...(disabled ? { disabled: true } : {}) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.radioRow,
        checked ? styles.radioRowChecked : null,
        disabled ? styles.radioRowDisabled : null,
      ]}
    >
      <Text accessible={false} style={styles.radioDot}>
        {checked ? "●" : "○"}
      </Text>
      <View style={styles.radioTexts}>
        <Text style={styles.radioLabel}>{label}</Text>
        {description !== undefined ? (
          <Text style={styles.radioDescription}>{description}</Text>
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
  readonly label: string;
  readonly kind: "primary" | "secondary";
  readonly onPress: () => void;
  readonly disabled?: boolean;
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

function ErrorText({ message }: { readonly message: string }) {
  return <Text style={styles.errorText}>{message}</Text>;
}

export function CaptureForm({ onSubmit }: CaptureFormProps) {
  const [step, setStep] = useState<CaptureStep>(1);
  const [shapeId, setShapeId] = useState<string | undefined>(undefined);
  const [metricError, setMetricError] = useState<string | undefined>(undefined);
  const [methodChosen, setMethodChosen] = useState(false);
  const [methodError, setMethodError] = useState<string | undefined>(undefined);
  const [fieldTexts, setFieldTexts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [capturedAtText, setCapturedAtText] = useState(toTimestampInputValue(new Date()));
  const [timeError, setTimeError] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [qualityState, setQualityState] = useState<CaptureQualityState | undefined>(undefined);
  const [qualityError, setQualityError] = useState<string | undefined>(undefined);

  const shape: CaptureShape | undefined =
    shapeId !== undefined ? CAPTURE_SHAPES.find((candidate) => candidate.id === shapeId) : undefined;

  function chooseShape(nextShapeId: string): void {
    if (nextShapeId !== shapeId) {
      setFieldTexts({});
      setFieldErrors({});
      setMethodChosen(false);
      setMethodError(undefined);
      setQualityState(undefined);
      setQualityError(undefined);
    }
    setShapeId(nextShapeId);
    setMetricError(undefined);
  }

  function resetDraft(): void {
    setStep(1);
    setShapeId(undefined);
    setMetricError(undefined);
    setMethodChosen(false);
    setMethodError(undefined);
    setFieldTexts({});
    setFieldErrors({});
    setCapturedAtText(toTimestampInputValue(new Date()));
    setTimeError(undefined);
    setNotes("");
    setQualityState(undefined);
    setQualityError(undefined);
  }

  function continueFromStep1(): void {
    if (shapeId === undefined) {
      setMetricError("Choose what you measured to continue.");
      return;
    }
    setMetricError(undefined);
    setStep(2);
  }

  function continueFromStep2(): void {
    if (shape === undefined) {
      setStep(1);
      return;
    }
    const nextMethodError = methodChosen ? undefined : "Choose a capture method to continue.";
    setMethodError(nextMethodError);

    const nextFieldErrors: Record<string, string> = {};
    for (const field of shape.fields) {
      const raw = fieldTexts[field.id] ?? "";
      const parsed = parseCaptureFieldText(raw, field);
      if (!parsed.ok) {
        nextFieldErrors[field.id] =
          parsed.reason === "value-missing" ? "Enter a value." : "Enter a number.";
      } else if (parsed.guardedText !== raw) {
        setFieldTexts((current) => ({ ...current, [field.id]: parsed.guardedText }));
      }
    }
    setFieldErrors(nextFieldErrors);

    let nextTimeError: string | undefined;
    const capturedAt = parseTimestampText(capturedAtText);
    if (capturedAt === null) {
      nextTimeError = "Enter a valid date and time (YYYY-MM-DD HH:MM).";
    } else if (capturedAt.getTime() > Date.now() + CAPTURE_FUTURE_TOLERANCE_MS) {
      nextTimeError = "Capture time cannot be in the future.";
    }
    setTimeError(nextTimeError);

    if (
      nextMethodError !== undefined ||
      Object.keys(nextFieldErrors).length > 0 ||
      nextTimeError !== undefined
    ) {
      return;
    }
    setStep(3);
  }

  function submitFromReview(): void {
    if (shape === undefined) {
      setStep(1);
      return;
    }
    if (qualityState === undefined) {
      setQualityError("Choose a quality self-assessment before saving.");
      return;
    }
    setQualityError(undefined);

    const fieldValues: Record<string, number> = {};
    for (const field of shape.fields) {
      const parsed = parseCaptureFieldText(fieldTexts[field.id] ?? "", field);
      if (!parsed.ok) {
        setStep(2);
        continueFromStep2();
        return;
      }
      fieldValues[field.id] = parsed.value;
    }
    const capturedAt = parseTimestampText(capturedAtText);
    if (
      capturedAt === null ||
      capturedAt.getTime() > Date.now() + CAPTURE_FUTURE_TOLERANCE_MS
    ) {
      setStep(2);
      continueFromStep2();
      return;
    }

    const trimmedNotes = notes.trim();
    onSubmit({
      shapeId: shape.id,
      methodOptionId: shape.manualMethodOption.id,
      fieldValues,
      qualityState,
      capturedAtIso: capturedAt.toISOString(),
      ...(trimmedNotes !== "" ? { notes: trimmedNotes } : {}),
    });
    resetDraft();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={spacing[4]}
    >
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Record a measurement
        </Text>
        <Text style={styles.cardNote}>
          A first-class manual capture: what you measured, how, and how
          complete the reading was — recorded with full provenance.
        </Text>
        <Text style={styles.stepLabel}>{`Step ${step} of 3 — ${STEP_LABELS[step]}`}</Text>

        {step === 1 ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="What did you measure?">
            {CAPTURE_SHAPES.map((candidate) => (
              <RadioRow
                key={candidate.id}
                label={candidate.displayName}
                description={candidate.summary}
                checked={shapeId === candidate.id}
                onPress={() => {
                  chooseShape(candidate.id);
                }}
              />
            ))}
            {metricError !== undefined ? <ErrorText message={metricError} /> : null}
            <ActionButton label="Continue" kind="primary" onPress={continueFromStep1} />
          </View>
        ) : null}

        {step === 2 && shape !== undefined ? (
          <View>
            <Text style={styles.shapeContext}>{shape.displayName}</Text>

            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="How did you capture it?"
              style={styles.methodGroup}
            >
              <RadioRow
                label={shape.manualMethodOption.label}
                description={shape.manualMethodOption.meta}
                checked={methodChosen}
                onPress={() => {
                  setMethodChosen(true);
                  setMethodError(undefined);
                }}
              />
              {shape.futureMethodOptions.map((option) => (
                <RadioRow
                  key={option.id}
                  label={option.label}
                  description={option.meta}
                  checked={false}
                  disabled
                  onPress={() => undefined}
                />
              ))}
            </View>
            {methodError !== undefined ? <ErrorText message={methodError} /> : null}

            {shape.fields.map((field) => (
              <View key={field.id} style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>
                  {`${field.label} (${field.metric.displayName})`}
                </Text>
                <TextInput
                  accessibilityLabel={`${field.label} value`}
                  keyboardType={field.step < 1 ? "decimal-pad" : "number-pad"}
                  placeholder={`e.g. ${field.min + 1}`}
                  placeholderTextColor={color.fgSubtle}
                  value={fieldTexts[field.id] ?? ""}
                  onChangeText={(next) => {
                    setFieldTexts((current) => ({ ...current, [field.id]: next }));
                    setFieldErrors((current) => {
                      const nextErrors = { ...current };
                      delete nextErrors[field.id];
                      return nextErrors;
                    });
                  }}
                  style={[styles.textInput, fieldErrors[field.id] !== undefined ? styles.textInputInvalid : null]}
                />
                <Text style={styles.fieldHint}>
                  {`In ${field.metric.unitDomain[0] ?? ""}. Out-of-range entries are clamped to ${field.min}–${field.max}.`}
                </Text>
                {fieldErrors[field.id] !== undefined ? (
                  <ErrorText message={fieldErrors[field.id] ?? ""} />
                ) : null}
              </View>
            ))}

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Capture time</Text>
              <View style={styles.timeRow}>
                <TextInput
                  accessibilityLabel="Capture time"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="YYYY-MM-DD HH:MM"
                  placeholderTextColor={color.fgSubtle}
                  value={capturedAtText}
                  onChangeText={(next) => {
                    setCapturedAtText(next);
                    setTimeError(undefined);
                  }}
                  style={[styles.textInput, styles.timeInput, timeError !== undefined ? styles.textInputInvalid : null]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Use current time"
                  onPress={() => {
                    setCapturedAtText(toTimestampInputValue(new Date()));
                    setTimeError(undefined);
                  }}
                  style={styles.nowButton}
                >
                  <Text style={styles.nowButtonText}>Now</Text>
                </Pressable>
              </View>
              <Text style={styles.fieldHint}>
                When you took the reading — defaults to now, and stays editable.
              </Text>
              {timeError !== undefined ? <ErrorText message={timeError} /> : null}
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Notes (optional)</Text>
              <TextInput
                accessibilityLabel="Notes"
                maxLength={CAPTURE_NOTES_MAX_LENGTH}
                placeholder="Anything worth remembering"
                placeholderTextColor={color.fgSubtle}
                value={notes}
                onChangeText={(next) => {
                  setNotes(next);
                }}
                style={styles.textInput}
              />
            </View>

            {shape.evidenceNote !== undefined ? (
              <Text style={styles.evidenceNote}>{shape.evidenceNote}</Text>
            ) : null}

            <View style={styles.buttonRow}>
              <ActionButton
                label="Back"
                kind="secondary"
                onPress={() => {
                  setStep(1);
                }}
              />
              <ActionButton label="Continue" kind="primary" onPress={continueFromStep2} />
            </View>
          </View>
        ) : null}

        {step === 3 && shape !== undefined ? (
          <View>
            <Text accessibilityRole="header" style={styles.reviewTitle}>
              Review
            </Text>
            <Text style={styles.reviewLine}>{`What: ${shape.displayName}`}</Text>
            <Text style={styles.reviewLine}>
              {`Values: ${shape.fields
                .map(
                  (field) =>
                    `${field.label}: ${fieldTexts[field.id] ?? ""} ${field.metric.unitDomain[0] ?? ""}`,
                )
                .join(" · ")}`}
            </Text>
            <Text style={styles.reviewLine}>
              {`Method (recorded as actually used): ${shape.manualMethodOption.label} — per-observation methods: ${shape.fields
                .map((field) => field.method.id)
                .join(", ")}`}
            </Text>
            <Text style={styles.reviewLine}>{`Capture time: ${capturedAtText}`}</Text>
            <Text style={styles.reviewLine}>{`Notes: ${notes.trim() === "" ? "None" : notes.trim()}`}</Text>
            {shape.evidenceNote !== undefined ? (
              <Text style={styles.evidenceNote}>{shape.evidenceNote}</Text>
            ) : null}

            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Quality self-assessment"
              style={styles.methodGroup}
            >
              {CAPTURE_QUALITY_STATES.map((state) => (
                <RadioRow
                  key={state}
                  label={CAPTURE_QUALITY_LABELS[state]}
                  description={CAPTURE_QUALITY_DESCRIPTIONS[state]}
                  checked={qualityState === state}
                  onPress={() => {
                    setQualityState(state);
                    setQualityError(undefined);
                  }}
                />
              ))}
            </View>
            {qualityError !== undefined ? <ErrorText message={qualityError} /> : null}
            <Text style={styles.qualityHint}>
              Your answer is recorded as-is — partial and low-quality readings
              are saved with that quality, never upgraded.
            </Text>

            <View style={styles.buttonRow}>
              <ActionButton
                label="Back"
                kind="secondary"
                onPress={() => {
                  setStep(2);
                }}
              />
              <ActionButton label="Save measurement" kind="primary" onPress={submitFromReview} />
            </View>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
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
    marginBottom: spacing[1],
  },
  cardNote: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
    marginBottom: spacing[2],
  },
  stepLabel: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    fontWeight: "500" as const,
    marginBottom: spacing[4],
  },
  shapeContext: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    marginBottom: spacing[2],
  },
  radioRow: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    marginBottom: spacing[2],
    minHeight: touchTarget.minimum,
    padding: spacing[3],
  },
  radioRowChecked: {
    backgroundColor: color.accentSubtle,
    borderColor: color.accent,
  },
  radioRowDisabled: {
    opacity: 0.6,
  },
  radioDot: {
    color: color.accent,
    fontSize: typography.size.md,
  },
  radioTexts: {
    flex: 1,
  },
  radioLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "500" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  radioDescription: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginTop: 1,
  },
  actionButton: {
    alignItems: "center",
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[5],
  },
  actionPrimary: {
    backgroundColor: color.accent,
    borderColor: color.accent,
    borderWidth: 1,
  },
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
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[3],
  },
  methodGroup: {
    marginBottom: spacing[2],
  },
  fieldBlock: {
    marginBottom: spacing[4],
  },
  fieldLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "500" as const,
    marginBottom: spacing[1],
  },
  fieldHint: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginTop: spacing[1],
  },
  errorText: {
    color: color.danger,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginTop: spacing[1],
  },
  textInput: {
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: color.fgPrimary,
    fontFamily: typography.family.sans,
    fontSize: typography.size.md,
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  textInputInvalid: {
    borderColor: color.danger,
  },
  timeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing[2],
  },
  timeInput: {
    flex: 1,
  },
  nowButton: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[4],
  },
  nowButtonText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  evidenceNote: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontStyle: "italic" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginBottom: spacing[2],
  },
  reviewTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    marginBottom: spacing[2],
  },
  reviewLine: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.relaxed,
    marginBottom: spacing[1],
  },
  qualityHint: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontStyle: "italic" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginBottom: spacing[2],
  },
});
