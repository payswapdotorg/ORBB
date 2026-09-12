import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import { CAPTURE_SHAPES } from "../lib/capture/model";

/**
 * The emphasis-model role vocabulary, mirrored from the web shell's
 * `lib/roles.ts` (the mobile shell has no role switcher; the onboarding
 * persona choice is recorded with the session for the emphasis model to
 * consume — integration seam, recorded handoff).
 */
export type Role = "person" | "clinician" | "researcher" | "developer";

/**
 * Onboarding screen (M6-A, Lane B — mobile): the first-run journey on the
 * Today surface — welcome, persona (the existing emphasis-model role
 * vocabulary), metric interests (M4-B SYNTH catalog), source registration
 * summary (manual + the M4-C device seam vocabulary, display only), and
 * completion.
 *
 * Completion state (recorded handoff): web persists to localStorage; RN
 * has no built-in storage and adding AsyncStorage would change
 * pnpm-lock.yaml (prohibited), so completion is SESSION-SCOPED here — the
 * shell keeps the flag in App state. The integration station wires
 * AsyncStorage (or the engine's session store) at the seam.
 *
 * Accessibility contract (packet B1/B4):
 * - every interactive row keeps the 44px minimum touch target
 *   (`touchTarget.minimum`; primary buttons comfortable);
 * - option rows expose `accessibilityRole="radio"|"checkbox"` with
 *   `accessibilityState` inside labeled groups (never color alone);
 * - step changes are announced through `accessibilityLiveRegion="polite"`;
 * - skipped steps resumable via Back navigation (draft state in the
 *   component; the journey is linear and short).
 */

/** Persona options = the EXISTING emphasis-model roles (`../lib/roles`). */
const PERSONA_OPTIONS: readonly {
  readonly role: Role;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    role: "person",
    label: "Person — tracking my own health",
    description:
      "Emphasizes the consumer core: overview, intents, measurements, and your DataBox.",
  },
  {
    role: "clinician",
    label: "Clinician — care and measurement focus",
    description: "Emphasizes care surfaces, measurements, and shared data.",
  },
  {
    role: "researcher",
    label: "Researcher — research and data focus",
    description:
      "Emphasizes research surfaces, measurement data, and your DataBox.",
  },
  {
    role: "developer",
    label: "Developer — marketplace and extensions focus",
    description: "Emphasizes the marketplace, settings, and DataBox surfaces.",
  },
];

/** Metric-interest options: one per M4-B SYNTH capture shape. */
const METRIC_OPTIONS: readonly { shapeId: string; label: string; summary: string }[] =
  CAPTURE_SHAPES.map((shape) => ({
    shapeId: shape.id,
    label: shape.displayName,
    summary: shape.summary,
  }));

/** Source summary options (manual registered; seams display-only). */
const SOURCE_OPTIONS: readonly {
  kind: "manual" | "device" | "app";
  label: string;
  detail: string;
  connected: boolean;
}[] = [
  {
    kind: "manual",
    label: "Manual entry",
    detail:
      "Registered and active (src_SYNTH-source-manual). Provenance recorded with you as the actor.",
    connected: true,
  },
  ...CAPTURE_SHAPES.flatMap((shape) =>
    shape.futureMethodOptions.map((option) => ({
      kind: (option.id.includes("app-") ? "app" : "device") as "app" | "device",
      label: option.label,
      detail: `${option.meta} — display only at this milestone.`,
      connected: false,
    })),
  ),
];

export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

export const ONBOARDING_STEP_COUNT = 5;

const STEP_TITLES: Readonly<Record<OnboardingStep, string>> = {
  1: "Welcome to ORBB",
  2: "How will you use ORBB?",
  3: "Which metrics matter to you?",
  4: "Your measurement sources",
  5: "You are set up",
};

const STEP_LABELS: Readonly<Record<OnboardingStep, string>> = {
  1: "welcome",
  2: "choose how you will use ORBB",
  3: "pick metrics you care about",
  4: "review your measurement sources",
  5: "finish setup",
};

export interface OnboardingScreenProps {
  /** Fired when the journey completes (the shell swaps to the placeholder). */
  readonly onComplete: (persona: Role | undefined) => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>(1);
  const [persona, setPersona] = useState<Role | undefined>(undefined);
  const [interests, setInterests] = useState<string[]>([]);

  function toggleInterest(shapeId: string): void {
    setInterests((current) =>
      current.includes(shapeId)
        ? current.filter((id) => id !== shapeId)
        : [...current, shapeId],
    );
  }

  function advance(): void {
    if (step < ONBOARDING_STEP_COUNT) {
      setStep((step + 1) as OnboardingStep);
    }
  }

  function goBack(): void {
    if (step > 1) {
      setStep((step - 1) as OnboardingStep);
    }
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
      <Text accessibilityLiveRegion="polite" style={styles.stepAnnouncement}>
        {`Onboarding — step ${step} of ${ONBOARDING_STEP_COUNT}: ${STEP_LABELS[step]}`}
      </Text>
      <View
        accessibilityLabel={`Onboarding step ${step}: ${STEP_TITLES[step]}`}
        style={styles.card}
      >
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {STEP_TITLES[step]}
        </Text>

        {step === 1 ? (
          <>
            <Text style={styles.body}>
              ORBB is a Personal Health Operating System: you state health
              intents, ORBB proposes measurement plans, and you stay in
              control of every decision.
            </Text>
            <Text style={styles.muted}>
              This session is synthetic (SYNTH) — a single-person sandbox
              with no real medical data and no real credentials.
            </Text>
            <Text style={styles.footnote}>
              Five short steps: a persona, the metrics you care about, your
              measurement sources, and you are done.
            </Text>
            <ActionButton kind="primary" label="Get started" onPress={advance} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text style={styles.muted}>
              Your choice drives which surfaces are emphasized on web (the
              mobile shell records it with your profile for now).
            </Text>
            <View
              accessibilityLabel="Persona"
              accessibilityRole="radiogroup"
              style={styles.optionGroup}
            >
              {PERSONA_OPTIONS.map((option) => (
                <SelectableRow
                  key={option.role}
                  accessibilityRole="radio"
                  label={option.label}
                  description={option.description}
                  checked={persona === option.role}
                  onPress={() => {
                    setPersona(option.role);
                  }}
                />
              ))}
            </View>
            <StepActions
              onBack={goBack}
              onContinue={advance}
              onSkip={advance}
              skipLabel="Skip this step"
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text style={styles.muted}>
              Pick the metrics you want ORBB to work with first — the same
              synthetic vocabulary the capture journey records.
            </Text>
            <View
              accessibilityLabel="Metric interests"
              accessibilityRole="group"
              style={styles.optionGroup}
            >
              {METRIC_OPTIONS.map((option) => (
                <SelectableRow
                  key={option.shapeId}
                  accessibilityRole="checkbox"
                  label={option.label}
                  description={option.summary}
                  checked={interests.includes(option.shapeId)}
                  onPress={() => {
                    toggleInterest(option.shapeId);
                  }}
                />
              ))}
            </View>
            <Text style={styles.footnote}>
              {interests.length === 0
                ? "Nothing selected yet — this step is optional."
                : `${interests.length} metric${interests.length === 1 ? "" : "s"} selected.`}
            </Text>
            <StepActions
              onBack={goBack}
              onContinue={advance}
              onSkip={advance}
              skipLabel="Skip this step"
            />
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Text style={styles.muted}>
              Manual entry is registered and active; device and app seams are
              visible but not connected yet (display only).
            </Text>
            <View style={styles.optionGroup} accessibilityLabel="Sources">
              {SOURCE_OPTIONS.map((option) => (
                <View
                  key={option.label}
                  accessibilityLabel={`${option.label}, ${
                    option.connected ? "registered and active" : "not connected yet"
                  }`}
                  style={styles.sourceRow}
                >
                  <Text style={styles.sourceLabel}>{option.label}</Text>
                  <Text
                    accessibilityLabel={option.connected ? "Registered" : "Not connected"}
                    style={option.connected ? styles.badgeOn : styles.badgeOff}
                  >
                    {option.connected ? "Registered · active" : "Not connected yet"}
                  </Text>
                  <Text style={styles.sourceDetail}>{option.detail}</Text>
                </View>
              ))}
            </View>
            <StepActions
              onBack={goBack}
              onContinue={advance}
              onSkip={advance}
              skipLabel="Skip this step"
            />
          </>
        ) : null}

        {step === 5 ? (
          <>
            <Text style={styles.body}>Your first-run setup is complete:</Text>
            <Text style={styles.summaryLine}>
              {`Persona: ${
                persona !== undefined
                  ? PERSONA_OPTIONS.find((option) => option.role === persona)?.label
                  : "Person (default — persona step skipped)"
              }`}
            </Text>
            <Text style={styles.summaryLine}>
              {`Metric interests: ${
                interests.length === 0
                  ? "none selected (skipped)"
                  : METRIC_OPTIONS.filter((option) => interests.includes(option.shapeId))
                      .map((option) => option.label)
                      .join(", ")
              }`}
            </Text>
            <Text style={styles.summaryLine}>
              Sources: manual entry registered; device and app seams display-only.
            </Text>
            <Text style={styles.footnote}>
              Completion is kept for this session; the next golden journey step
              is creating your first health intent on the Health tab.
            </Text>
            <StepActions
              onBack={goBack}
              onContinue={() => {
                onComplete(persona);
              }}
              continueLabel="Finish setup"
            />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Shared row + action primitives (the capture-form discipline: 44px
// targets, radio/checkbox states never color-alone).
// ---------------------------------------------------------------------------

function SelectableRow({
  accessibilityRole,
  label,
  description,
  checked,
  onPress,
}: {
  accessibilityRole: "radio" | "checkbox";
  label: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
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

function StepActions({
  onBack,
  onContinue,
  onSkip,
  continueLabel = "Continue",
  skipLabel,
}: {
  onBack: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  skipLabel?: string;
}) {
  return (
    <View style={styles.stepActions}>
      <ActionButton kind="secondary" label="Back" onPress={onBack} />
      {onSkip !== undefined && skipLabel !== undefined ? (
        <ActionButton kind="secondary" label={skipLabel} onPress={onSkip} />
      ) : null}
      <ActionButton kind="primary" label={continueLabel} onPress={onContinue} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.canvas, flex: 1 },
  content: { gap: spacing[4], padding: spacing[4], paddingBottom: spacing[6] },
  title: {
    color: color.fgPrimary,
    fontSize: typography.size.xxl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xxl * typography.lineHeight.tight,
  },
  stepAnnouncement: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  card: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[3],
    padding: spacing[4],
  },
  cardTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    lineHeight: typography.size.lg * typography.lineHeight.tight,
  },
  body: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  muted: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  summaryLine: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
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
  optionGlyph: {
    color: color.accent,
    fontSize: typography.size.md,
  },
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
  sourceRow: {
    backgroundColor: color.canvas,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[3],
  },
  sourceLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  badgeOn: {
    alignSelf: "flex-start",
    backgroundColor: color.successSubtle,
    borderRadius: radius.pill,
    color: color.success,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  badgeOff: {
    alignSelf: "flex-start",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  sourceDetail: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  stepActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[2],
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
