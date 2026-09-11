import type { ReactNode } from "react";
import { color, elevation, radius, spacing } from "../tokens";

/** Card padding densities mapped onto the spacing scale. */
export type CardPadding = "none" | "compact" | "default" | "spacious";

export interface CardProps {
  children: ReactNode;
  /** Level 2 elevation when true, level 1 otherwise. Defaults to `false`. */
  elevated?: boolean;
  /**
   * Padding density (M1-B extension): `none` for edge-to-edge content such as
   * tables, `compact` for dense lists, `default` matching the original Card,
   * `spacious` for feature panels. Defaults to `default`.
   */
  padding?: CardPadding;
}

const paddingValues: Record<CardPadding, number> = {
  none: spacing[0],
  compact: spacing[3],
  default: spacing[4],
  spacious: spacing[6],
};

/**
 * Card primitive: surface-colored container with a subtle border and an
 * elevation level from the token system. Server-component-safe (no hooks).
 *
 * The `elevated` variant maps to elevation token level 2 (floating panels,
 * dialogs, sheets); the resting variant uses level 1 (inline content cards).
 */
export function Card({
  children,
  elevated = false,
  padding = "default",
}: CardProps) {
  return (
    <div
      style={{
        backgroundColor: color.surface,
        borderRadius: `${radius.md}px`,
        border: `1px solid ${color.borderSubtle}`,
        boxShadow: elevated ? elevation[2] : elevation[1],
        padding: `${paddingValues[padding]}px`,
      }}
    >
      {children}
    </div>
  );
}
