// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Card } from "./Card";
import { color, elevation, radius, spacing } from "../tokens";

afterEach(cleanup);

/** jsdom normalizes hex colors to `rgb(...)` in computed inline styles. */
const rgb = (hex: string): string => {
  const channels = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(channels.slice(offset, offset + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

describe("Card", () => {
  it("renders its children on a token-styled surface (back-compat defaults)", () => {
    const { container } = render(<Card>Synthetic content</Card>);
    const card = container.firstElementChild;
    expect(card).toBeInstanceOf(HTMLDivElement);
    if (card instanceof HTMLElement) {
      expect(card.textContent).toBe("Synthetic content");
      expect(card.style.backgroundColor).toBe(rgb(color.surface));
      expect(card.style.borderRadius).toBe(`${radius.md}px`);
      expect(card.style.padding).toBe(`${spacing[4]}px`);
      expect(card.style.boxShadow).toBe(elevation[1]);
    }
  });

  it("maps the elevated variant onto elevation token level 2", () => {
    const { container } = render(<Card elevated>Synthetic content</Card>);
    const card = container.firstElementChild;
    if (card instanceof HTMLElement) {
      expect(card.style.boxShadow).toBe(elevation[2]);
    }
  });

  it.each([
    ["none", spacing[0]],
    ["compact", spacing[3]],
    ["default", spacing[4]],
    ["spacious", spacing[6]],
  ] as const)("maps the %s padding density onto the spacing scale", (padding, expected) => {
    const { container } = render(<Card padding={padding}>Synthetic content</Card>);
    const card = container.firstElementChild;
    if (card instanceof HTMLElement) {
      expect(card.style.padding).toBe(`${expected}px`);
    }
  });
});
