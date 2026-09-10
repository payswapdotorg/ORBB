import { StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";

import { PLACEHOLDER_NOTICE } from "./placeholder-notice";

export interface PlaceholderScreenProps {
  /** Screen title (rendered as the header text of the placeholder). */
  title: string;
  /** One-line synthetic description of the future surface. */
  note: string;
}

/**
 * Token-styled M0 placeholder screen for every mobile destination.
 *
 * All colors, spacing, radii, and type sizes come from `@orbb/ui` tokens —
 * the mobile shell consumes the same token source of truth as web. Content
 * is a synthetic "Coming in M6+" notice: no real medical data, no fake
 * domain features.
 *
 * Accessibility: the title exposes `accessibilityRole="header"`; the shell's
 * interactive geometry (tab bar height) is built from `touchTarget` sizes
 * (>= 44px).
 */
export function PlaceholderScreen({ title, note }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.card} accessibilityLabel={`${title} placeholder card`}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.note}>{note}</Text>
        <Text style={styles.notice}>{PLACEHOLDER_NOTICE}</Text>
        <Text style={styles.footnote}>
          Synthetic placeholder screen — no real medical data, no real
          credentials.
        </Text>
      </View>
    </View>
  );
}

/**
 * Tab bar height for the shell so its interactive geometry comes from
 * touch-target tokens (>= 44px per WCAG 2.2 / platform HIG guidance).
 */
export const TAB_BAR_HEIGHT = touchTarget.comfortable;

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: color.canvas,
    flex: 1,
    justifyContent: "center",
    padding: spacing[4],
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
    width: "100%",
    maxWidth: 480,
  },
  title: {
    color: color.fgPrimary,
    fontSize: typography.size.xxl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xxl * typography.lineHeight.tight,
    marginBottom: spacing[2],
  },
  note: {
    color: color.fgMuted,
    fontSize: typography.size.md,
    lineHeight: typography.size.md * typography.lineHeight.normal,
    marginBottom: spacing[4],
  },
  notice: {
    color: color.accent,
    fontSize: typography.size.lg,
    fontWeight: "600" as const,
    lineHeight: typography.size.lg * typography.lineHeight.tight,
    marginBottom: spacing[2],
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
});
