import { describe, expect, it } from "vitest";
import { tokensToCssCustomProperties } from "./css";
import { color, touchTarget } from "./tokens";

describe("tokensToCssCustomProperties", () => {
  const css = tokensToCssCustomProperties();

  it("emits a :root rule", () => {
    expect(css.startsWith(":root {")).toBe(true);
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });

  it("emits the semantic color tokens in kebab-case", () => {
    expect(css).toContain(`--orbb-color-canvas: ${color.canvas}`);
    expect(css).toContain(`--orbb-color-fg-primary: ${color.fgPrimary}`);
    expect(css).toContain(`--orbb-color-accent: ${color.accent}`);
    expect(css).toContain("--orbb-color-border-subtle:");
    expect(css).not.toMatch(/--orbb-[a-z-]*[A-Z]/);
  });

  it("emits the touch-target tokens in px", () => {
    expect(css).toContain(`--orbb-touch-target-minimum: ${touchTarget.minimum}px`);
    expect(css).toContain(`--orbb-touch-target-comfortable: ${touchTarget.comfortable}px`);
  });

  it("emits typography, spacing, radius, elevation and motion categories", () => {
    expect(css).toContain("--orbb-typography-size-md: 16px");
    expect(css).toContain("--orbb-typography-line-height-normal: 1.5");
    expect(css).toContain("--orbb-spacing-4: 16px");
    expect(css).toContain("--orbb-radius-md: 10px");
    expect(css).toContain("--orbb-elevation-1:");
    expect(css).toContain("--orbb-motion-duration-fast: 150ms");
    expect(css).toContain("--orbb-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1)");
  });

  it("emits well-formed declarations only (no stray semicolons in values)", () => {
    const body = css.slice(":root {".length, -"}".length).trim();
    const declarations = body.split(";\n  ");
    expect(declarations.length).toBeGreaterThan(40);
    for (const declaration of declarations) {
      // Every declaration must look like `--name: value` with no interior `;`.
      expect(declaration).toMatch(/^--orbb-[a-z0-9-]+: .+$/);
    }
  });
});
