// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DueWindow } from "./DueWindow";
import { color } from "../../tokens";

afterEach(cleanup);

/** jsdom normalizes hex colors to `rgb(...)` in computed inline styles. */
const rgb = (hex: string): string => {
  const channels = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(channels.slice(offset, offset + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

describe("DueWindow", () => {
  it("renders its text content", () => {
    render(<DueWindow>Due by 09:00</DueWindow>);
    expect(screen.getByText("Due by 09:00")).toBeTruthy();
  });

  it("defaults to the neutral tone", () => {
    render(<DueWindow>Due by 09:00</DueWindow>);
    const badge = screen.getByText("Due by 09:00");
    expect(badge.style.backgroundColor).toBe(rgb(color.surface));
    expect(badge.style.color).toBe(rgb(color.fgMuted));
  });

  it.each([
    ["accent", color.accent, color.accentSubtle],
    ["success", color.success, color.successSubtle],
    ["warning", color.warning, color.warningSubtle],
    ["danger", color.danger, color.dangerSubtle],
  ] as const)(
    "maps the %s tone onto its verified semantic token pair",
    (tone, foreground, background) => {
      const { unmount } = render(<DueWindow tone={tone}>Due by 09:00</DueWindow>);
      const badge = screen.getByText("Due by 09:00");
      expect(badge.style.color).toBe(rgb(foreground));
      expect(badge.style.backgroundColor).toBe(rgb(background));
      unmount();
    },
  );

  it("renders as a pill (fully-rounded badge)", () => {
    render(<DueWindow>Due by 09:00</DueWindow>);
    expect(screen.getByText("Due by 09:00").style.borderRadius).toBe("999px");
  });
});
