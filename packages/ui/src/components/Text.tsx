import type { ReactNode } from "react";
import { color, spacing, typography } from "../tokens";

export type TextVariant = "body" | "muted" | "small";

export interface TextProps {
  children: ReactNode;
  /** Defaults to `body`. */
  variant?: TextVariant;
}

const variantStyles: Record<TextVariant, {
  color: string;
  fontSize: number;
  lineHeight: number;
}> = {
  body: { color: color.fgPrimary, fontSize: typography.size.md, lineHeight: typography.lineHeight.normal },
  muted: { color: color.fgMuted, fontSize: typography.size.md, lineHeight: typography.lineHeight.normal },
  small: { color: color.fgMuted, fontSize: typography.size.sm, lineHeight: typography.lineHeight.normal },
};

/** Text primitive (paragraph). Server-component-safe. */
export function Text({ children, variant = "body" }: TextProps) {
  const styles = variantStyles[variant];
  return (
    <p
      style={{
        margin: 0,
        color: styles.color,
        fontFamily: typography.family.sans,
        fontSize: `${styles.fontSize}px`,
        lineHeight: styles.lineHeight,
      }}
    >
      {children}
    </p>
  );
}

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingProps {
  children: ReactNode;
  /** Heading level 1–3. Defaults to `2`. */
  level?: HeadingLevel;
}

const headingSizes: Record<HeadingLevel, { fontSize: number; marginTop: number }> = {
  1: { fontSize: typography.size.xxl, marginTop: 0 },
  2: { fontSize: typography.size.xl, marginTop: spacing[4] },
  3: { fontSize: typography.size.lg, marginTop: spacing[3] },
};

/**
 * Heading primitive mapping levels 1–3 onto the typography scale.
 * Server-component-safe. Renders real `h1`/`h2`/`h3` elements so document
 * outline semantics are preserved.
 */
export function Heading({ children, level = 2 }: HeadingProps) {
  const { fontSize, marginTop } = headingSizes[level];
  const Tag = `h${level}` as const;
  return (
    <Tag
      style={{
        margin: 0,
        marginTop: `${marginTop}px`,
        marginBottom: `${spacing[2]}px`,
        color: color.fgPrimary,
        fontFamily: typography.family.sans,
        fontSize: `${fontSize}px`,
        fontWeight: typography.weight.semibold,
        lineHeight: typography.lineHeight.tight,
      }}
    >
      {children}
    </Tag>
  );
}
