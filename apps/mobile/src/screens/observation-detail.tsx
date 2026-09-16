import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  EVIDENCE_LABEL_SENTENCES,
  SOURCE_KIND_LABELS,
  type CanonicalObservationView,
  type ObservationView,
} from "../lib/databox/model";

/**
 * Observation detail screen (M6-B B5, mobile): the §Provenance UX drawer
 * rendered full-screen inside a native Modal — reachable from the capture
 * history (Health tab) and from the DataBox timeline.
 *
 * The chain, in the frozen order:
 *   `Captured by → Method → Device/Person → Time → Quality → Validation
 *    → Transformations → Original evidence`
 *
 * Teaching contract: "measured" and "estimated from an image" are
 * DIFFERENT STATES — explicit text labels + sentences, never color alone;
 * estimates carry their uncertainty sentence and the model version
 * behind the estimate. The reconciled case shows per-source provenance
 * for BOTH originals (roles + verdict — the M4 mirror).
 *
 * Accessibility: one combined label per chain field is unnecessary — the
 * screen is a readable flow; the close control keeps the 44px target.
 */

const VALIDATION_LABELS: Readonly<Record<string, string>> = {
  pending: "Pending — awaiting the validation layer",
  validated: "Validated",
  superseded: "Superseded — replaced by the canonical view, provenance kept",
};

function ChainField({ label, children }: { label: string; children: string }) {
  return (
    <View style={styles.chainField}>
      <Text style={styles.chainLabel}>{label}</Text>
      <Text style={styles.chainValue}>{children}</Text>
    </View>
  );
}

export interface ObservationDetailProps {
  readonly observation: ObservationView;
  readonly canonical?: CanonicalObservationView;
  readonly onClose: () => void;
}

export function ObservationDetailScreen({
  observation,
  canonical,
  onClose,
}: ObservationDetailProps) {
  const reconciled = canonical !== undefined && canonical.id === observation.id;
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={false}
      transparent={false}
      visible
    >
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Observation provenance
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close observation provenance"
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
        >
          <Text style={styles.headline}>
            {`${observation.metricLabel}: ${observation.valueLabel}`}
          </Text>
          <Text style={styles.badges}>
            {`${observation.evidenceLabel} · ${VALIDATION_LABELS[observation.validationState] ?? observation.validationState}`}
          </Text>
          <Text style={styles.observationId}>
            {`Observation ${observation.id} · concept ${observation.conceptCode}`}
          </Text>

          {/* The teaching block (§Provenance UX). */}
          <View style={styles.teachingCard}>
            <Text style={styles.teachingTitle}>
              {`This value is ${observation.evidenceLabel}.`}
            </Text>
            <Text style={styles.teachingBody}>
              {EVIDENCE_LABEL_SENTENCES[observation.evidenceLabel]}
            </Text>
            {observation.uncertainty !== undefined ? (
              <Text style={styles.teachingUncertainty}>{observation.uncertainty}</Text>
            ) : null}
            {observation.modelVersion !== undefined ? (
              <Text style={styles.teachingModel}>
                {`Estimate model: ${observation.modelVersion}`}
              </Text>
            ) : null}
          </View>

          {/* The chain, in order. */}
          <View style={styles.chainCard}>
            <ChainField label="Captured by">
              {`${observation.capturedBy} · ${SOURCE_KIND_LABELS[observation.sourceKind]}`}
            </ChainField>
            <ChainField label="Method">
              {`${observation.method.label} (${observation.method.id})`}
            </ChainField>
            <ChainField label="Device / person">
              {observation.deviceOrPerson}
            </ChainField>
            <ChainField label="Time">
              {`Captured ${observation.time.capturedAtLabel} · recorded ${observation.time.recordedAtLabel}`}
            </ChainField>
            <ChainField label="Quality">
              {`${observation.quality.state} (domain quality score ${observation.quality.score})`}
            </ChainField>
            <ChainField label="Validation">
              {VALIDATION_LABELS[observation.validationState] ?? observation.validationState}
            </ChainField>
            <ChainField label="Transformations">
              {observation.transformations.length === 0
                ? "None — the value is exactly as captured."
                : observation.transformations
                    .map(
                      (transformation) =>
                        `${transformation.label}: ${transformation.detail}`,
                    )
                    .join("\n")}
            </ChainField>
            <ChainField label="Original evidence">
              {observation.evidenceId !== undefined
                ? `${observation.evidenceId} — ${observation.evidenceSummary ?? "record"} · in your DataBox`
                : "No evidence record yet — the DataBox evidence wiring for manual captures lands at integration. Nothing is faked here."}
            </ChainField>
          </View>

          {/* The reconciled case: per-source provenance of BOTH originals. */}
          {reconciled && canonical !== undefined ? (
            <View style={styles.reconciledCard}>
              <Text accessibilityRole="header" style={styles.reconciledTitle}>
                Two sources, one current value
              </Text>
              <Text style={styles.reconciledMeta}>
                {`Window ${canonical.windowLabel} · reconciled ${canonical.reconciledAtLabel}`}
              </Text>
              <Text style={styles.reconciledVerdict}>
                {`Verdict: ${canonical.verdict} — ${canonical.verdict === "concordant" ? "the two sources agreed." : "the two sources disagreed; the divergence is flagged, never hidden."}`}
              </Text>
              {canonical.sources.map((source) => (
                <View
                  key={source.observationId}
                  style={styles.sourceRow}
                  accessibilityLabel={`Source ${source.observationId}: ${source.role === "canonical-source" ? "canonical" : "superseded"}, ${source.methodLabel}, ${source.evidenceLabel}, quality ${source.qualityScore}, ${source.valueLabel}, captured ${source.capturedAtLabel}`}
                >
                  <Text style={styles.sourceRole}>
                    {`${source.role === "canonical-source" ? "Canonical" : "Superseded"}: ${source.methodLabel}`}
                  </Text>
                  <Text style={styles.sourceDetail}>
                    {`${source.evidenceLabel} · quality ${source.qualityScore} · ${source.valueLabel} · captured ${source.capturedAtLabel} (${source.observationId})`}
                  </Text>
                </View>
              ))}
              <Text style={styles.reconciledNote}>
                Nothing is discarded: the superseded source keeps its full
                provenance, and the current value is the higher-quality
                source&apos;s reading.
              </Text>
            </View>
          ) : null}

          <Text style={styles.footnote}>
            Synthetic session (SYNTH) — full provenance on every
            observation; no real medical data.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: color.canvas,
    flex: 1,
  },
  header: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderBottomColor: color.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing[3],
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  title: {
    color: color.fgPrimary,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    lineHeight: typography.size.lg * typography.lineHeight.tight,
  },
  closeButton: {
    alignItems: "center",
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
  },
  closeButtonText: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing[3],
    padding: spacing[4],
    paddingBottom: spacing[6],
  },
  headline: {
    color: color.fgPrimary,
    fontSize: typography.size.xl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xl * typography.lineHeight.tight,
  },
  badges: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  observationId: {
    color: color.fgMuted,
    fontFamily: undefined,
    fontSize: typography.size.xs,
  },
  teachingCard: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[4],
  },
  teachingTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  teachingBody: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  teachingUncertainty: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  teachingModel: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
  },
  chainCard: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[2],
    padding: spacing[4],
  },
  chainField: {
    gap: spacing[1],
  },
  chainLabel: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    textTransform: "uppercase",
  },
  chainValue: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  reconciledCard: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[2],
    padding: spacing[4],
  },
  reconciledTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
  },
  reconciledMeta: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
  },
  reconciledVerdict: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  sourceRow: {
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[3],
  },
  sourceRole: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  sourceDetail: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  reconciledNote: {
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
