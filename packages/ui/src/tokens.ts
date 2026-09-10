/**
 * ORBB design tokens (M0-B foundation).
 *
 * Pure, framework-neutral TypeScript values — no imports, no DOM types, no
 * CSS pipeline. Numbers are used for dimensions so React Native can consume
 * them directly; the web shell converts them to CSS custom properties via
 * {@link ./css.ts} (`tokensToCssCustomProperties`).
 *
 * Invariants enforced by `src/tokens.test.ts`:
 * - every pair in `contrastPairs` meets its WCAG minimum (AA text 4.5:1,
 *   non-text 3:1) and references colors that exist in `color`;
 * - the spacing scale is a monotonically increasing multiple-of-4 scale
 *   containing 0;
 * - touch targets are at least 44px (WCAG 2.2 AA target size, minimum);
 * - typography sizes ascend and never drop below 12px.
 */

/** Semantic color tokens. Conservative, clinical-safe palette; status is never communicated by color alone in UI built on these tokens. */
export const color = {
  /** Page canvas (app background). */
  canvas: "#F7F5F1",
  /** Flat card/surface background. */
  surface: "#FFFFFF",
  /** Elevated surface background (pairs with `elevation`). */
  surfaceRaised: "#FFFFFF",

  /** Primary text on canvas/surface. */
  fgPrimary: "#20241F",
  /** Secondary text on canvas/surface. */
  fgMuted: "#565B57",
  /** Tertiary text (surface only). */
  fgSubtle: "#6B706C",
  /** Text on accent-colored fills. */
  fgOnAccent: "#FFFFFF",

  /** Primary action / link color (deep green-teal). */
  accent: "#0E6E5F",
  /** Accent hover/pressed state fill. */
  accentHover: "#0A584C",
  /** Tinted accent background for chips/highlights. */
  accentSubtle: "#E2EFEA",

  /** Destructive/error text and fills. */
  danger: "#B3261E",
  /** Tinted danger background. */
  dangerSubtle: "#FCEBE9",
  /** Success text on light surfaces. */
  success: "#256F43",
  /** Tinted success background. */
  successSubtle: "#E5F2EA",
  /** Caution text on light surfaces. */
  warning: "#8A5A0B",
  /** Tinted caution background. */
  warningSubtle: "#FBF3E2",

  /** Decorative hairline borders (non-semantic). */
  borderSubtle: "#E3E1DC",
  /** Input/component boundaries (WCAG 1.4.11 non-text >= 3:1). */
  borderStrong: "#8A8D88",
  /** Focus indicator color (non-text >= 3:1 on canvas and surface). */
  focusRing: "#0E6E5F",
} as const;

/** Typography tokens. `size` is in px; `lineHeight` is unitless. */
export const typography = {
  family: {
    sans:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    mono:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  },
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.65,
  },
} as const;

/** Spacing scale (px). Base unit 4; monotonically increasing; starts at 0. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 48,
  8: 64,
} as const;

/** Corner radii (px). `pill` is a large value intended for fully-rounded shapes. */
export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Elevation levels as CSS `box-shadow` strings (web-oriented; RN maps levels to its own shadow props). */
export const elevation = {
  0: "none",
  1: "0 1px 2px rgba(28, 34, 31, 0.10)",
  2: "0 2px 6px rgba(28, 34, 31, 0.12), 0 1px 2px rgba(28, 34, 31, 0.08)",
  3: "0 8px 24px rgba(28, 34, 31, 0.16), 0 2px 6px rgba(28, 34, 31, 0.10)",
} as const;

/** Motion tokens. Durations in ms; easing as CSS cubic-bezier strings. Consumers MUST respect `prefers-reduced-motion: reduce` by disabling non-essential motion. */
export const motion = {
  duration: {
    instant: 0,
    fast: 150,
    base: 250,
    slow: 400,
    slower: 600,
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.3, 0, 0, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;

/**
 * Touch-target sizes (px). WCAG 2.2 AA target size (minimum) is 24px, but
 * ORBB holds itself to the 44px comfortable-target guidance (WCAG AAA /
 * platform HIG guidance); `minimum` is the floor for every interactive
 * control built from these tokens.
 */
export const touchTarget = {
  minimum: 44,
  comfortable: 56,
} as const;

/** Focus-ring tokens. Width/offset in px. */
export const focusRing = {
  width: 2,
  offset: 2,
  color: color.accent,
  style: "solid",
} as const;

/** A WCAG contrast requirement that the token system promises to uphold for a foreground/background pair. */
export interface ContrastPair {
  /** Stable machine-readable identifier. */
  readonly id: string;
  /** Foreground token value (must exist in `color`). */
  readonly foreground: string;
  /** Background token value (must exist in `color`). */
  readonly background: string;
  /** Minimum WCAG contrast ratio (4.5 text AA, 3.0 non-text AA). */
  readonly minimumRatio: number;
  /** Human-readable usage note. */
  readonly usage: string;
}

/**
 * Contractually accessible color pairs. Every pair is verified in
 * `tokens.test.ts` against a WCAG 2.x contrast-ratio implementation, so the
 * token system cannot drift below its accessibility floor unnoticed.
 */
export const contrastPairs: readonly ContrastPair[] = [
  { id: "fgPrimary-on-canvas", foreground: color.fgPrimary, background: color.canvas, minimumRatio: 4.5, usage: "primary text on page canvas" },
  { id: "fgPrimary-on-surface", foreground: color.fgPrimary, background: color.surface, minimumRatio: 4.5, usage: "primary text on cards" },
  { id: "fgMuted-on-canvas", foreground: color.fgMuted, background: color.canvas, minimumRatio: 4.5, usage: "secondary text on page canvas" },
  { id: "fgMuted-on-surface", foreground: color.fgMuted, background: color.surface, minimumRatio: 4.5, usage: "secondary text on cards" },
  { id: "fgSubtle-on-surface", foreground: color.fgSubtle, background: color.surface, minimumRatio: 4.5, usage: "tertiary text on cards" },
  { id: "accent-on-surface", foreground: color.accent, background: color.surface, minimumRatio: 4.5, usage: "accent text/links on cards" },
  { id: "accent-on-canvas", foreground: color.accent, background: color.canvas, minimumRatio: 4.5, usage: "accent text/links on page canvas" },
  { id: "accent-on-accentSubtle", foreground: color.accent, background: color.accentSubtle, minimumRatio: 4.5, usage: "accent text on tinted accent chips" },
  { id: "fgOnAccent-on-accent", foreground: color.fgOnAccent, background: color.accent, minimumRatio: 4.5, usage: "text on primary action fills" },
  { id: "fgOnAccent-on-accentHover", foreground: color.fgOnAccent, background: color.accentHover, minimumRatio: 4.5, usage: "text on primary action hover fills" },
  { id: "danger-on-surface", foreground: color.danger, background: color.surface, minimumRatio: 4.5, usage: "error text on cards" },
  { id: "danger-on-dangerSubtle", foreground: color.danger, background: color.dangerSubtle, minimumRatio: 4.5, usage: "error text on tinted error surfaces" },
  { id: "success-on-surface", foreground: color.success, background: color.surface, minimumRatio: 4.5, usage: "success text on cards" },
  { id: "success-on-successSubtle", foreground: color.success, background: color.successSubtle, minimumRatio: 4.5, usage: "success text on tinted success surfaces" },
  { id: "warning-on-surface", foreground: color.warning, background: color.surface, minimumRatio: 4.5, usage: "caution text on cards" },
  { id: "warning-on-warningSubtle", foreground: color.warning, background: color.warningSubtle, minimumRatio: 4.5, usage: "caution text on tinted caution surfaces" },
  { id: "focusRing-on-surface", foreground: color.focusRing, background: color.surface, minimumRatio: 3.0, usage: "focus indicator on cards (non-text)" },
  { id: "focusRing-on-canvas", foreground: color.focusRing, background: color.canvas, minimumRatio: 3.0, usage: "focus indicator on page canvas (non-text)" },
  { id: "borderStrong-on-surface", foreground: color.borderStrong, background: color.surface, minimumRatio: 3.0, usage: "component boundaries on cards (non-text)" },
  { id: "borderStrong-on-canvas", foreground: color.borderStrong, background: color.canvas, minimumRatio: 3.0, usage: "component boundaries on page canvas (non-text)" },
];

/** Aggregate token export for convenience. */
export const tokens = {
  color,
  typography,
  spacing,
  radius,
  elevation,
  motion,
  touchTarget,
  focusRing,
  contrastPairs,
} as const;

export type ColorTokens = typeof color;
export type TypographyTokens = typeof typography;
export type SpacingTokens = typeof spacing;
export type RadiusTokens = typeof radius;
export type ElevationTokens = typeof elevation;
export type MotionTokens = typeof motion;
export type TouchTargetTokens = typeof touchTarget;
export type FocusRingTokens = typeof focusRing;
