import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  CAPTURE_QUALITY_LABELS,
  buildRecordSummary,
  type MobileCaptureRecord,
} from "../lib/capture/model";
import { observationViewFromMobileCapture, type ObservationView } from "../lib/databox/model";
import { ObservationDetailScreen } from "./observation-detail";

/**
 * Capture history list (M4-B, mobile): the recent manual observations the
 * same journey recorded — each row carries the value, the captured label,
 * the method actually used (per observation), the recorded quality state
 * (never upgraded), and the provenance actor.
 *
 * Every row exposes ONE accessibility label combining all of it, so
 * screen readers (and Maestro) receive the full provenance summary.
 */

export interface CaptureHistoryProps {
  readonly records: readonly MobileCaptureRecord[];
  readonly now: Date;
}

const QUALITY_LABEL_STYLE: Readonly<
  Record<string, { color: string; backgroundColor: string }>
> = {
  complete: { color: color.success, backgroundColor: color.successSubtle },
  partial: { color: "#7A4F0B" as const, backgroundColor: "#FBEED7" as const },
  "low-quality": { color: color.danger, backgroundColor: color.dangerSubtle },
};

export function CaptureHistory({ records, now }: CaptureHistoryProps) {
  // M6-B B5: the observation provenance detail is reachable from this
  // history — one observation detail open at a time (Modal).
  const [selected, setSelected] = useState<ObservationView | null>(null);
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Recent manual observations
      </Text>
      <Text style={styles.subtitle}>
        Everything you recorded manually, with the method actually used, the
        quality you self-assessed, and full provenance. Synthetic (SYNTH) —
        nothing real is stored.
      </Text>
      {records.length === 0 ? (
        <Text style={styles.empty}>No manual observations yet — record your first measurement above.</Text>
      ) : (
        records.map((record) => {
          const summary = buildRecordSummary(record, now);
          const qualityLabel = CAPTURE_QUALITY_LABELS[record.qualityState];
          const qualityStyle = QUALITY_LABEL_STYLE[record.qualityState] ?? {
            color: color.fgMuted,
            backgroundColor: color.surface,
          };
          return (
            <View
              key={record.recordId}
              accessibilityLabel={summary.accessibilityLabel}
              style={styles.row}
            >
              <View style={styles.rowHeader}>
                <Text style={styles.rowTitle}>{summary.title}</Text>
                <View
                  accessibilityLabel={`Quality ${qualityLabel}`}
                  style={[styles.qualityBadge, { backgroundColor: qualityStyle.backgroundColor }]}
                >
                  <Text style={[styles.qualityBadgeText, { color: qualityStyle.color }]}>
                    {qualityLabel}
                  </Text>
                </View>
              </View>
              <Text style={styles.rowSubtitle}>{summary.subtitle}</Text>
              <Text style={styles.rowMethods}>
                {`Method actually used: ${record.observations
                  .map((observation) => observation.methodId)
                  .join(", ")}`}
              </Text>
              <Text style={styles.rowProvenance}>
                {`Recorded by you (self-tracking) · ${record.recordId} · validation: pending`}
              </Text>
              {record.notes !== undefined ? (
                <Text style={styles.rowNotes}>{`Notes: ${record.notes}`}</Text>
              ) : null}
              {record.observations.map((observation) => (
                <Pressable
                  key={observation.id}
                  accessibilityLabel={`Full provenance: ${observation.id}`}
                  accessibilityRole="button"
                  onPress={() => {
                    setSelected(
                      observationViewFromMobileCapture(observation, record, now),
                    );
                  }}
                  style={styles.provenanceButton}
                >
                  <Text style={styles.provenanceButtonText}>
                    {`Full provenance: ${observation.id}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          );
        })
      )}
      {selected !== null ? (
        <ObservationDetailScreen
          observation={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  provenanceButton: {
    alignItems: "flex-start" as const,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center" as const,
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
  },
  provenanceButtonText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
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
  title: {
    color: color.fgPrimary,
    fontSize: typography.size.xl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xl * typography.lineHeight.tight,
    marginBottom: spacing[1],
  },
  subtitle: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
    marginBottom: spacing[4],
  },
  empty: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    fontStyle: "italic" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  row: {
    borderTopColor: color.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[3],
  },
  rowHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  rowTitle: {
    color: color.fgPrimary,
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  qualityBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  qualityBadgeText: {
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs + 8,
  },
  rowSubtitle: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
    marginBottom: spacing[1],
  },
  rowMethods: {
    color: color.fgSubtle,
    fontFamily: typography.family.mono,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  rowProvenance: {
    color: color.fgSubtle,
    fontFamily: typography.family.mono,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginTop: 2,
  },
  rowNotes: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    marginTop: spacing[1],
  },
});
