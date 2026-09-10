// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./Button";
import { color, touchTarget } from "../tokens";

afterEach(cleanup);

/** jsdom normalizes hex colors to `rgb(...)` in computed inline styles. */
const rgb = (hex: string): string => {
  const channels = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(channels.slice(offset, offset + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

describe("Button", () => {
  it("renders a native button with its label", () => {
    render(<Button>Synthetic action</Button>);
    const button = screen.getByRole("button", { name: "Synthetic action" });
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button.getAttribute("type")).toBe("button");
  });

  it("guarantees the 44px minimum touch target", () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.style.minHeight).toBe(`${touchTarget.minimum}px`);
    expect(Number.parseInt(button.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it("grows to the comfortable touch target at large size", () => {
    render(<Button size="large">Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.style.minHeight).toBe(`${touchTarget.comfortable}px`);
  });

  it("uses the accent pair for the primary variant", () => {
    render(<Button>Primary</Button>);
    const button = screen.getByRole("button", { name: "Primary" });
    expect(button.style.backgroundColor).toBe(rgb(color.accent));
    expect(button.style.color).toBe(rgb(color.fgOnAccent));
  });

  it("invokes onClick when enabled and not when disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button onClick={onClick} disabled>Click</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("draws a visible focus ring from tokens on focus", () => {
    render(<Button>Focus me</Button>);
    const button = screen.getByRole("button", { name: "Focus me" });
    expect(button.style.outline).toBe("none");
    fireEvent.focus(button);
    expect(button.style.outline).toContain("2px");
    expect(button.style.outline).toContain(color.focusRing);
    fireEvent.blur(button);
    expect(button.style.outline).toBe("none");
  });

  it("forwards extra attributes such as aria-label", () => {
    render(<Button aria-label="Dismiss notice">×</Button>);
    expect(screen.getByRole("button", { name: "Dismiss notice" })).toBeTruthy();
  });
});
