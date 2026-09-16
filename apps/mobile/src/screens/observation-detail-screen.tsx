import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  OBSERVATION_EVIDENCE_STATE_LABELS,
  type ObservationDetailView,
} from "../lib/observations/model";

/**
 * Observation/provenance detail overlay (M6-B B5, mobile): the frozen
 * §Provenance UX chain, field by field —
 * `Captured by → Method → Device/Person → Time → Quality → Validation →
 * Transformations → Model version → Original evidence`.
 *
 * Rendering choice (recorded): a FULL-SCREEN VIEW OVERLAY (not a Modal, not
 * a new navigator route — the mobile shell keeps its five-tab model frozen
 * and adds no navigation dependencies): the hosting surface (Health /
 * DataBox) renders this component on top of its content when a detail is
 * open, with an explicit "Close" button (44px target).
 *
 * Teaching contract: the measured-vs-estimated distinction is EXPLICIT —
 * the evidence state renders as text ("Measured — MEASURED",
 * "Estimated — ESTIMATED", …) with teaching copy; every state is carried
 * by TEXT, never color alone (WCAG 1.4.1). The reconciliation block
 * renders when the observation participated in one (role + verdict +
 * canonical id, all text).
 */

const VALIDATION_LABEL: Readonly<Record<string, string>> = {
  validated: "Validated",
  pending: "Pending validation",
  superseded: "Superseded",
};

function validationLabelOf(state: string): string {
  return VALIDATION_LABEL[state] ?? state;
}

export interface ObservationDetailScreenProps {
  /** The observation whose provenance chain to render. */
  readonly detail: ObservationDetailView;
  /** Fired when the person closes the overlay. */
  readonly onClose: () => void;
}

export function ObservationDetailScreen({ detail, onClose }: ObservationDetailScreenProps) {
  const evidenceStateLabel =
    OBSERVATION_EVIDENCE_STATE_LABELS[detail.evidenceState] ?? detail.evidenceState;

  return (
    <View
      accessibilityLabel={`Provenance detail for ${detail.metricLabel} — the full provenance chain of the observation, opened over the current screen.`}
      style={styles.overlay}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={styles.title}>
            Provenance detail
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close provenance detail"
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.valueLine}>{`${detail.metricLabel} ${detail.valueLabel}`}</Text>
          <Text style={styles.stateBadge}>{`${evidenceStateLabel} — ${detail.evidenceLabel}`}</Text>
          <Text style={styles.stateBadge}>{validationLabelOf(detail.validation.state)}</Text>
          <Text style={styles.teachingNote}>{detail.evidenceStateNote}</Text>

          <View style={styles.chain}>
            <Row label="Captured by">
              <Text style={styles.valueText}>{detail.capturedBy.actorLabel}</Text>
              <Text style={styles.monoText}>{`source: ${detail.capturedBy.sourceId} (${detail.capturedBy.kind})`}</Text>
            </Row>
            <Row label="Method">
              <Text style={styles.valueText}>{detail.method.methodLabel}</Text>
              <Text style={styles.monoText}>{detail.method.methodId}</Text>
            </Row>
            <Row label="Device / Person">
              <Text style={styles.valueText}>{detail.deviceOrPerson}</Text>
            </Row>
            <Row label="Time">
              <Text style={styles.valueText}>{`Clinically relevant: ${detail.time.effectiveLabel}`}</Text>
              <Text style={styles.mutedText}>{`Recorded: ${detail.time.observedLabel}`}</Text>
            </Row>
            <Row label="Quality">
              <Text style={styles.valueText}>{`${detail.quality.stateLabel} — score ${detail.quality.score} of 1.0`}</Text>
              <Text style={styles.mutedText}>{detail.quality.note}</Text>
            </Row>
            <Row label="Validation">
              <Text style={styles.valueText}>{validationLabelOf(detail.validation.state)}</Text>
              <Text style={styles.mutedText}>{detail.validation.note}</Text>
            </Row>

            <Row label="Transformations">
              {detail.transformations.length === 0 ? (
                <Text style={styles.mutedText}>None — recorded exactly as captured.</Text>
              ) : (
                detail.transformations.map((transformation) => (
                  <View key={transformation.id} style={styles.transformationBlock}>
                    <Text style={styles.valueText}>{`${transformation.label} · ${transformation.seam}`}</Text>
                    <Text style={styles.mutedText}>{transformation.description}</Text>
                  </View>
                ))
              )}
            </Row>

            <Row label="Model version">
              <Text style={styles.valueText}>
                {detail.modelVersion ?? "No model involved — direct capture."}
              </Text>
            </Row>

            <Row label="Original evidence">
              {detail.evidence === null ? (
                <Text style={styles.mutedText}>
                  No raw evidence object — the values were typed directly.
                </Text>
              ) : (
                <Text style={styles.valueText}>
                  {`${detail.evidence.evidenceId} — ${detail.evidence.summary}`}
                </Text>
              )}
              {detail.evidence !== null ? (
                <Text style={styles.mutedText}>
                  {`${detail.evidence.mediaType} · ${detail.evidence.checksumPrefix} · retention ${detail.evidence.retentionClass}` +
                    (detail.evidence.location === "databox-corpus"
                      ? " — open in the DataBox timeline."
                      : " — retained by the source this session; DataBox ingestion arrives with the engine wiring (honestly labeled, not faked).")}
                </Text>
              ) : null}
            </Row>
          </View>

          {detail.reconciliation !== undefined ? (
            <View style={styles.reconciliationBlock}>
              <Text style={styles.reconciliationTitle}>
                {`Reconciliation: ${detail.reconciliation.role} · verdict ${detail.reconciliation.verdict}`}
              </Text>
              <Text style={styles.mutedText}>{detail.reconciliation.note}</Text>
              <Text style={styles.monoText}>
                {`Canonical observation of this window: ${detail.reconciliation.canonicalObservationId}`}
              </Text>
            </View>
          ) : null}

          <Text style={styles.idLine}>
            {`${detail.observationId} · ${detail.conceptCode} · provenance recorded for every observation (SYNTH)`}
          </Text>
        </View>

        <Text style={styles.footnote}>
          Synthetic (SYNTH) — no real medical data. Provenance is recorded for
          every observation.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValues}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color.canvas,
    elevation: 8,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing[4],
    padding: spacing[4],
    paddingBottom: spacing[6],
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing[3],
    justifyContent: "space-between",
  },
  title: {
    color: color.fgPrimary,
    flex: 1,
    fontSize: typography.size.xxl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xxl * typography.lineHeight.tight,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[4],
  },
  closeButtonText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
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
  valueLine: {
    color: color.fgPrimary,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    lineHeight: typography.size.lg * typography.lineHeight.tight,
  },
  stateBadge: {
    alignSelf: "flex-start",
    backgroundColor: color.accentSubtle,
    borderRadius: radius.pill,
    color: color.accent,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  teachingNote: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    fontStyle: "italic" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  chain: {
    gap: spacing[3],
  },
  row: {
    borderTopColor: color.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    paddingTop: spacing[3],
  },
  rowLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
  },
  rowValues: {
    gap: spacing[1],
  },
  valueText: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  mutedText: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  monoText: {
    color: color.fgMuted,
    fontFamily: typography.family.mono,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  transformationBlock: {
    gap: spacing[1],
  },
  reconciliationBlock: {
    backgroundColor: color.canvas,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[3],
  },
  reconciliationTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  idLine: {
    color: color.fgMuted,
    fontFamily: typography.family.mono,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginTop: spacing[1],
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
});
