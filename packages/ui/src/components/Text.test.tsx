// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Card } from "./Card";
import { Heading, Text } from "./Text";
import { color, radius, typography } from "../tokens";

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
  it("renders its children on a token-styled surface", () => {
    const { container } = render(<Card>Synthetic content</Card>);
    const card = container.firstElementChild;
    expect(card).toBeInstanceOf(HTMLDivElement);
    if (card instanceof HTMLElement) {
      expect(card.textContent).toBe("Synthetic content");
      expect(card.style.backgroundColor).toBe(rgb(color.surface));
      expect(card.style.borderRadius).toBe(`${radius.md}px`);
    }
  });
});

describe("Text", () => {
  it("renders a paragraph with muted styling for the muted variant", () => {
    const { container } = render(<Text variant="muted">Synthetic note</Text>);
    const paragraph = container.querySelector("p");
    expect(paragraph).not.toBeNull();
    if (paragraph instanceof HTMLElement) {
      expect(paragraph.textContent).toBe("Synthetic note");
      expect(paragraph.style.color).toBe(rgb(color.fgMuted));
    }
  });
});

describe("Heading", () => {
  it.each([1, 2, 3] as const)("renders an h%d with the mapped type scale", (level) => {
    const { container } = render(<Heading level={level}>Title {level}</Heading>);
    const heading = container.querySelector(`h${level}`);
    expect(heading).not.toBeNull();
    if (heading instanceof HTMLElement) {
      const expectedSize =
        level === 1 ? typography.size.xxl : level === 2 ? typography.size.xl : typography.size.lg;
      expect(heading.style.fontSize).toBe(`${expectedSize}px`);
      expect(heading.style.color).toBe(rgb(color.fgPrimary));
    }
  });

  it("defaults to level 2", () => {
    const { container } = render(<Heading>Default</Heading>);
    expect(container.querySelector("h2")).not.toBeNull();
  });
});
