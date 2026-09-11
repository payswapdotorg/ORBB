import type { ReactNode } from "react";
import { color, radius, spacing, typography } from "../../tokens";

/**
 * Badge tones mapped directly onto semantic color tokens. Tone names are
 * deliberately token-aligned (not domain words): the CALLER decides what a
 * due-window tone means; the component only renders text in a tone.
 */
export type DueWindowTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface DueWindowProps {
  /** Badge text (carries the actual status — tone only reinforces it). */
  children: ReactNode;
  /** Visual tone. Defaults to `neutral`. */
  tone?: DueWindowTone;
}

interface ToneStyles {
  backgroundColor: string;
  color: string;
  border: string;
}

const toneStyles: Record<DueWindowTone, ToneStyles> = {
  neutral: {
    backgroundColor: color.surface,
    color: color.fgMuted,
    border: `1px solid ${color.borderStrong}`,
  },
  accent: {
    backgroundColor: color.accentSubtle,
    color: color.accent,
    border: `1px solid transparent`,
  },
  success: {
    backgroundColor: color.successSubtle,
    color: color.success,
    border: `1px solid transparent`,
  },
  warning: {
    backgroundColor: color.warningSubtle,
    color: color.warning,
    border: `1px solid transparent`,
  },
  danger: {
    backgroundColor: color.dangerSubtle,
    color: color.danger,
    border: `1px solid transparent`,
  },
};

/**
 * DueWindow badge (M1-B): a small pill that renders a due-window label
 * (e.g. "Due by 09:00") in a semantic tone.
 *
 * The text is the status carrier — tone is reinforcement only, so the badge
 * never communicates state by color alone (WCAG 1.4.1). All tone pairs are
 * covered by the token system's contract-checked `contrastPairs`
 * (4.5:1 text minimum on every subtle background).
 *
 * Server-component-safe (no hooks).
 */
export function DueWindow({ children, tone = "neutral" }: DueWindowProps) {
  const styles = toneStyles[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: `${spacing[1]}px ${spacing[3]}px`,
        borderRadius: `${radius.pill}px`,
        fontFamily: typography.family.sans,
        fontSize: `${typography.size.xs}px`,
        fontWeight: typography.weight.medium,
        lineHeight: `${typography.size.xs + 8}px`,
        whiteSpace: "nowrap",
        ...styles,
      }}
    >
      {children}
    </span>
  );
}
