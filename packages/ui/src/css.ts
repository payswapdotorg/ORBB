import {
  color,
  elevation,
  focusRing,
  motion,
  radius,
  spacing,
  touchTarget,
  typography,
} from "./tokens";

/**
 * Converts ORBB design tokens into a `:root { ... }` CSS custom-property
 * declaration block. Pure string building — no framework, no side effects.
 *
 * The web shell injects the returned string into a `<style>` element in its
 * root layout, which is how `apps/web` consumes `@orbb/ui` tokens at build
 * time. All values are static token strings (never user input), so the
 * output is safe to inject as-is.
 *
 * Naming convention: `--orbb-<category>-<name>` with kebab-case names.
 */
export function tokensToCssCustomProperties(): string {
  const declarations: string[] = [];

  for (const [key, value] of Object.entries(color)) {
    declarations.push(`--orbb-color-${kebab(key)}: ${value}`);
  }

  for (const [key, value] of Object.entries(typography.family)) {
    declarations.push(`--orbb-typography-family-${kebab(key)}: ${value}`);
  }
  for (const [key, value] of Object.entries(typography.size)) {
    declarations.push(`--orbb-typography-size-${kebab(key)}: ${px(value)}`);
  }
  for (const [key, value] of Object.entries(typography.weight)) {
    declarations.push(`--orbb-typography-weight-${kebab(key)}: ${value}`);
  }
  for (const [key, value] of Object.entries(typography.lineHeight)) {
    // Unitless line-height is valid CSS and scales with the font size.
    declarations.push(`--orbb-typography-line-height-${kebab(key)}: ${value}`);
  }

  for (const [key, value] of Object.entries(spacing)) {
    declarations.push(`--orbb-spacing-${kebab(key)}: ${px(value)}`);
  }

  for (const [key, value] of Object.entries(radius)) {
    declarations.push(`--orbb-radius-${kebab(key)}: ${px(value)}`);
  }

  for (const [key, value] of Object.entries(elevation)) {
    declarations.push(`--orbb-elevation-${kebab(key)}: ${value}`);
  }

  for (const [key, value] of Object.entries(motion.duration)) {
    declarations.push(`--orbb-motion-duration-${kebab(key)}: ${ms(value)}`);
  }
  for (const [key, value] of Object.entries(motion.easing)) {
    declarations.push(`--orbb-motion-easing-${kebab(key)}: ${value}`);
  }

  declarations.push(`--orbb-touch-target-minimum: ${px(touchTarget.minimum)}`);
  declarations.push(`--orbb-touch-target-comfortable: ${px(touchTarget.comfortable)}`);

  declarations.push(`--orbb-focus-ring-width: ${px(focusRing.width)}`);
  declarations.push(`--orbb-focus-ring-offset: ${px(focusRing.offset)}`);
  declarations.push(`--orbb-focus-ring-color: ${focusRing.color}`);
  declarations.push(`--orbb-focus-ring-style: ${focusRing.style}`);

  return `:root {\n  ${declarations.join(";\n  ")};\n}`;
}

const kebab = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const px = (value: number): string => `${value}px`;

const ms = (value: number): string => `${value}ms`;
