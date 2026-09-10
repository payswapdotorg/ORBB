import { describe, expect, it } from "vitest";
import {
  color,
  contrastPairs,
  focusRing,
  motion,
  radius,
  spacing,
  tokens,
  touchTarget,
  typography,
} from "./tokens";

/** WCAG 2.x relative luminance of a hex color. */
function relativeLuminance(hex: string): number {
  const channels = hex.replace("#", "");
  if (channels.length !== 6) {
    throw new Error(`unexpected non-6-digit hex color: ${hex}`);
  }
  const channel = (index: number): number => {
    const value =
      Number.parseInt(channels.slice(index * 2, index * 2 + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG 2.x contrast ratio between two hex colors. */
function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("contrast pairs", () => {
  it("defines a non-empty contract set", () => {
    expect(contrastPairs.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = contrastPairs.map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references colors that exist in the color tokens", () => {
    const knownColors = new Set<string>(Object.values(color));
    for (const pair of contrastPairs) {
      expect(knownColors.has(pair.foreground)).toBe(true);
      expect(knownColors.has(pair.background)).toBe(true);
    }
  });

  it("meets every declared WCAG minimum ratio", () => {
    for (const pair of contrastPairs) {
      const ratio = contrastRatio(pair.foreground, pair.background);
      expect(ratio, `${pair.id} must be >= ${pair.minimumRatio}`).toBeGreaterThanOrEqual(
        pair.minimumRatio,
      );
    }
  });

  it("covers the essential text pairs (primary, muted, on-accent)", () => {
    const ids = new Set(contrastPairs.map((pair) => pair.id));
    expect(ids.has("fgPrimary-on-canvas")).toBe(true);
    expect(ids.has("fgMuted-on-canvas")).toBe(true);
    expect(ids.has("fgOnAccent-on-accent")).toBe(true);
    expect(ids.has("accent-on-surface")).toBe(true);
  });
});

/** Asserts that a readonly numeric scale ascends (helper: avoids unchecked indexed access). */
function expectAscending(scaleName: string, values: readonly number[]): void {
  let previous: number | undefined;
  for (const value of values) {
    if (previous !== undefined) {
      expect(value, `${scaleName} must ascend`).toBeGreaterThan(previous);
    }
    previous = value;
  }
}

describe("spacing scale", () => {
  it("is monotonically increasing", () => {
    expectAscending("spacing", Object.values(spacing));
  });

  it("starts at zero and only contains multiples of the 4px base unit", () => {
    const values = Object.values(spacing);
    expect(values[0]).toBe(0);
    for (const value of values) {
      expect(value % 4).toBe(0);
    }
  });
});

describe("touch targets", () => {
  it("minimum is at least 44px (WCAG target-size comfortable floor)", () => {
    expect(touchTarget.minimum).toBeGreaterThanOrEqual(44);
  });

  it("comfortable is at least the minimum", () => {
    expect(touchTarget.comfortable).toBeGreaterThanOrEqual(touchTarget.minimum);
  });
});

describe("typography", () => {
  it("sizes ascend", () => {
    expectAscending("typography.size", Object.values(typography.size));
  });

  it("never drops below 12px", () => {
    for (const size of Object.values(typography.size)) {
      expect(size).toBeGreaterThanOrEqual(12);
    }
  });

  it("line heights stay in readable bounds (1.0–2.0)", () => {
    for (const lineHeight of Object.values(typography.lineHeight)) {
      expect(lineHeight).toBeGreaterThanOrEqual(1.0);
      expect(lineHeight).toBeLessThanOrEqual(2.0);
    }
  });
});

describe("radius scale", () => {
  it("ascends with pill last", () => {
    expectAscending("radius", Object.values(radius));
    expect(radius.pill).toBeGreaterThan(radius.xl);
  });
});

describe("motion tokens", () => {
  it("durations ascend from zero", () => {
    const durations = Object.values(motion.duration);
    expect(durations.at(0)).toBe(0);
    expectAscending("motion.duration", durations);
  });
});

describe("focus ring", () => {
  it("is at least 2px wide", () => {
    expect(focusRing.width).toBeGreaterThanOrEqual(2);
  });
});

describe("aggregate tokens export", () => {
  it("exposes every token category", () => {
    expect(tokens.color).toBe(color);
    expect(tokens.typography).toBe(typography);
    expect(tokens.spacing).toBe(spacing);
    expect(tokens.radius).toBe(radius);
    expect(tokens.touchTarget).toBe(touchTarget);
    expect(tokens.contrastPairs).toBe(contrastPairs);
  });
});
