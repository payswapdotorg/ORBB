import type { ReactNode } from "react";
import { color, elevation, radius, spacing } from "../tokens";

export interface CardProps {
  children: ReactNode;
  /** Level 2 elevation when true, level 1 otherwise. Defaults to `false`. */
  elevated?: boolean;
}

/**
 * Card primitive: surface-colored container with a subtle border and an
 * elevation level from the token system. Server-component-safe (no hooks).
 */
export function Card({ children, elevated = false }: CardProps) {
  return (
    <div
      style={{
        backgroundColor: color.surface,
        borderRadius: `${radius.md}px`,
        border: `1px solid ${color.borderSubtle}`,
        boxShadow: elevated ? elevation[2] : elevation[1],
        padding: `${spacing[4]}px`,
      }}
    >
      {children}
    </div>
  );
}
