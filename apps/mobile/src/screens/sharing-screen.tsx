import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  SEED_SHARES,
  accessEvents,
  shareStateLabel,
  type ShareContract,
} from "../lib/sharing/model";

/**
 * Sharing surface (M6-C B7, mobile): the DataBox tab's share entry —
 * the active-shares list with revoke-with-confirm, the access-audit
 * trail, and the answer-only preview note. The full step-wise composer
 * is the web journey's primary surface; on mobile the contract model is
 * read + revoke (the packet's compact scope), honestly labeled.
 *
 * State is component-scoped over the pure seed model (the M6-B mobile
 * discipline): revocation updates the visible state and the audit list
 * gains the event — nothing persists (recorded handoff).
 */
export function SharingScreen({ onBack }: { onBack: () => void }) {
  const [shares, setShares] = useState<readonly ShareContract[]>(SEED_SHARES);
  const [extraEvents, setExtraEvents] = useState<readonly { id: string; label: string }[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const revoke = (share: ShareContract) => {
    setShares((current) =>
      current.map((s) =>
        s.id === share.id
          ? { ...s, state: "revoked" as const, revokedOnLabel: "2026-09-16" }
          : s,
      ),
    );
    setExtraEvents((current) => [
      { id: `acs_session-${current.length + 1}`, label: `Access revoked — ${share.recipientLabel}` },
      ...current,
    ]);
    setConfirmingId(null);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      accessibilityLabel="Sharing screen"
    >
      <View style={styles.headerRow}>
        <Pressable
          accessibilityLabel="Back to DataBox"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>← DataBox</Text>
        </Pressable>
      </View>
      <Text style={styles.heading}>Sharing</Text>
      <Text style={styles.note}>
        A share is a reviewable contract: recipient, purpose, exact data, terms, expiry — and
        revocation.
      </Text>

      <View
        accessibilityLabel="Active data shares"
        style={styles.sectionCard}
      >
        <Text style={styles.sectionTitle}>Your data shares</Text>
        {shares.map((share) => (
          <View key={share.id} style={styles.shareCard} accessibilityLabel={`${share.recipientLabel} contract`}>
            <Text style={styles.shareRecipient}>{share.recipientLabel}</Text>
            <Text style={styles.shareMeta}>
              {share.purposeLabel} · expires {share.expiresLabel}
            </Text>
            <Text style={styles.shareMeta}>{share.scopeSummary}</Text>
            <Text style={styles.shareState}>{shareStateLabel(share)}</Text>
            {share.state === "active" &&
              (confirmingId === share.id ? (
                <View style={styles.confirmBox} accessibilityLabel="Revoke confirmation">
                  <Text style={styles.confirmText}>
                    Revoke access for {share.recipientLabel}? They immediately stop being able to
                    view or export the scoped records. Past accesses stay in the audit trail.
                  </Text>
                  <View style={styles.confirmActions}>
                    <Pressable
                      accessibilityLabel="Keep share active"
                      accessibilityRole="button"
                      onPress={() => setConfirmingId(null)}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryLabel}>Keep active</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Confirm revoke share with ${share.recipientLabel}`}
                      accessibilityRole="button"
                      onPress={() => revoke(share)}
                      style={styles.primaryButton}
                    >
                      <Text style={styles.primaryLabel}>Revoke access</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityLabel={`Revoke share with ${share.recipientLabel}`}
                  accessibilityRole="button"
                  onPress={() => setConfirmingId(share.id)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryLabel}>Revoke</Text>
                </Pressable>
              ))}
          </View>
        ))}
      </View>

      <View accessibilityLabel="Access history" style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Access history</Text>
        {extraEvents.map((event) => (
          <Text key={event.id} style={styles.eventLine}>
            {event.label}
          </Text>
        ))}
        {accessEvents().map((event) => (
          <Text key={event.id} style={styles.eventLine}>
            {event.kind === "revoked" ? "Access revoked" : event.kind === "exported" ? "Exported" : "Viewed"} · {event.actorLabel} · {event.atLabel}
          </Text>
        ))}
      </View>

      <View accessibilityLabel="Answer only sharing preview" style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Answer-only sharing (preview)</Text>
        <Text style={styles.note}>
          Some questions can be answered without sharing records — e.g. “Does this person have at
          least 90 days of qualifying observations?” Requires protocol support not yet enabled;
          nothing is computed or sent.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[6] },
  headerRow: { flexDirection: "row" },
  backButton: { minHeight: touchTarget.minimum, justifyContent: "center" },
  backLabel: { color: color.accent, fontSize: typography.size.sm },
  heading: { fontSize: typography.size.xl, fontWeight: "600" as const, color: color.fgPrimary },
  note: { color: color.fgMuted, fontSize: typography.size.sm },
  sectionCard: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing[4],
    gap: spacing[2],
  },
  sectionTitle: { fontSize: typography.size.md, fontWeight: "600" as const, color: color.fgPrimary },
  shareCard: {
    borderColor: color.borderSubtle,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing[2],
    gap: spacing[1],
  },
  shareRecipient: { fontSize: typography.size.sm, fontWeight: "600" as const, color: color.fgPrimary },
  shareMeta: { fontSize: typography.size.xs, color: color.fgMuted },
  shareState: { fontSize: typography.size.xs, fontWeight: "600" as const, color: color.fgPrimary },
  confirmBox: { gap: spacing[2], marginTop: spacing[1] },
  confirmText: { fontSize: typography.size.xs, color: color.fgMuted },
  confirmActions: { flexDirection: "row", gap: spacing[2] },
  primaryButton: {
    backgroundColor: color.accent,
    borderRadius: radius.sm,
    minHeight: touchTarget.minimum,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
  },
  primaryLabel: { color: color.surface, fontSize: typography.size.sm, fontWeight: "600" as const },
  secondaryButton: {
    borderColor: color.borderSubtle,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: touchTarget.minimum,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    alignSelf: "flex-start",
  },
  secondaryLabel: { color: color.fgPrimary, fontSize: typography.size.sm },
  eventLine: { fontSize: typography.size.xs, color: color.fgMuted },
});
