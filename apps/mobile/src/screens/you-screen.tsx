import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { color, radius, spacing, typography } from "@orbb/ui/tokens";
import { consentPostureSummary } from "../lib/sharing/model";

/**
 * You surface (M6-C B9, mobile): the consent-settings section of the
 * You tab — the consent posture aggregated (active shares,
 * deny-by-default sources, quiet hours), each control stating its
 * consequence, every change visibly recorded in the session audit list
 * (never silent). SYNTH stub semantics: component-scoped state over the
 * pure model; no persistence (recorded handoff).
 */
export function YouScreen() {
  const summary = consentPostureSummary();
  const [deviceSources, setDeviceSources] = useState(false);
  const [quietHours, setQuietHours] = useState(true);
  const [audit, setAudit] = useState<string[]>([]);

  const record = (line: string) => setAudit((current) => [line, ...current]);

  return (
    <ScrollView contentContainerStyle={styles.container} accessibilityLabel="You and consent settings">
      <Text style={styles.heading}>You</Text>
      <Text style={styles.note}>
        Your consent posture — what you share, which sources may record, how you are reminded.
      </Text>

      <View accessibilityLabel="Active shares summary" style={styles.card}>
        <Text style={styles.cardTitle}>Active shares</Text>
        <Text style={styles.note}>
          You have {summary.activeShareCount} active share{summary.activeShareCount === 1 ? "" : "s"}.
          Review and revoke them in the DataBox Sharing section.
        </Text>
      </View>

      <View accessibilityLabel="Measurement sources consent" style={styles.card}>
        <Text style={styles.cardTitle}>Measurement sources</Text>
        <View style={styles.controlRow}>
          <View style={styles.controlText}>
            <Text style={styles.controlLabel}>Device sources (SYNTH seams)</Text>
            <Text style={styles.note}>
              {deviceSources
                ? "Device sources may record measurements"
                : "Off — new sources start OFF; nothing records by default"}
            </Text>
          </View>
          <Switch
            value={deviceSources}
            onValueChange={(next) => {
              setDeviceSources(next);
              record(`Device sources: ${next ? "enabled" : "disabled"}`);
            }}
            accessibilityLabel="Toggle device measurement sources"
          />
        </View>
        <Text style={styles.note}>Manual entry is always available.</Text>
      </View>

      <View accessibilityLabel="Notification preferences" style={styles.card}>
        <Text style={styles.cardTitle}>Notifications</Text>
        <View style={styles.controlRow}>
          <View style={styles.controlText}>
            <Text style={styles.controlLabel}>Quiet hours ({summary.quietHoursLabel.split(" ")[0]})</Text>
            <Text style={styles.note}>
              {quietHours
                ? "Reminders inside the window are deferred to 07:00 — never dropped"
                : "Reminders may arrive at any hour"}
            </Text>
          </View>
          <Switch
            value={quietHours}
            onValueChange={(next) => {
              setQuietHours(next);
              record(`Quiet hours: ${next ? "enabled" : "disabled"}`);
            }}
            accessibilityLabel="Toggle quiet hours"
          />
        </View>
        <Text style={styles.note}>Reminders nudge — they never punish.</Text>
      </View>

      <View accessibilityLabel="Consent change history" style={styles.card}>
        <Text style={styles.cardTitle}>Change history</Text>
        {audit.length === 0 ? (
          <Text style={styles.note}>No changes yet in this session.</Text>
        ) : (
          audit.map((line, index) => (
            <Text key={`${line}-${index}`} style={styles.eventLine}>
              {line}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[6] },
  heading: { fontSize: typography.size.xl, fontWeight: "600" as const, color: color.fgPrimary },
  note: { color: color.fgMuted, fontSize: typography.size.sm },
  card: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing[4],
    gap: spacing[2],
  },
  cardTitle: { fontSize: typography.size.md, fontWeight: "600" as const, color: color.fgPrimary },
  controlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  controlText: { flex: 1, gap: 2 },
  controlLabel: { fontSize: typography.size.sm, fontWeight: "600" as const, color: color.fgPrimary },
  eventLine: { fontSize: typography.size.xs, color: color.fgMuted },
});
