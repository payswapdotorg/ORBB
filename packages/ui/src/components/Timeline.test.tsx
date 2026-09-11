// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";
import { color, radius } from "../tokens";

afterEach(cleanup);

/** jsdom normalizes hex colors to `rgb(...)` in computed inline styles. */
const rgb = (hex: string): string => {
  const channels = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(channels.slice(offset, offset + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

const entries = [
  { at: "Sep 10, 08:00", title: "Synthetic entry one", subtitle: "First synthetic note", badge: "Auto" },
  { at: "Sep 10, 12:30", title: "Synthetic entry two" },
  { at: "Sep 09, 18:10", title: "Synthetic entry three", subtitle: "Older synthetic note" },
] as const;

describe("Timeline", () => {
  it("renders every entry with its timestamp, title and subtitle", () => {
    render(<Timeline entries={entries} />);
    expect(screen.getByText("Sep 10, 08:00")).toBeTruthy();
    expect(screen.getByText("Synthetic entry one")).toBeTruthy();
    expect(screen.getByText("First synthetic note")).toBeTruthy();
    expect(screen.getByText("Synthetic entry three")).toBeTruthy();
  });

  it("renders optional badges as neutral pills", () => {
    render(<Timeline entries={entries} />);
    const badge = screen.getByText("Auto");
    expect(badge.style.borderRadius).toBe(`${radius.pill}px`);
    expect(badge.style.backgroundColor).toBe(rgb(color.accentSubtle));
    expect(badge.style.color).toBe(rgb(color.accent));
  });

  it("uses list semantics (one list item per entry)", () => {
    const { container } = render(<Timeline entries={entries} />);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(entries.length);
    expect(container.querySelectorAll("ul")).toHaveLength(1);
  });

  it("renders a group header whenever the group value changes", () => {
    const grouped = [
      { at: "Sep 10, 08:00", title: "Entry A", group: "Today" },
      { at: "Sep 10, 09:00", title: "Entry B", group: "Today" },
      { at: "Sep 09, 08:00", title: "Entry C", group: "Yesterday" },
      { at: "Sep 09, 09:00", title: "Entry D" },
    ] as const;
    render(<Timeline entries={grouped} />);
    const headers = screen.getAllByRole("heading", { level: 4 });
    expect(headers.map((header) => header.textContent)).toEqual([
      "Today",
      "Yesterday",
    ]);
    // A header is only rendered when the value changes, not per entry.
    expect(screen.getAllByText("Today")).toHaveLength(1);
  });

  it("renders a section per group with a list per group", () => {
    const grouped = [
      { at: "Sep 10, 08:00", title: "Entry A", group: "Today" },
      { at: "Sep 09, 08:00", title: "Entry B", group: "Yesterday" },
    ] as const;
    const { container } = render(<Timeline entries={grouped} />);
    expect(container.querySelectorAll("section")).toHaveLength(2);
    expect(container.querySelectorAll("ul")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders nothing for an empty timeline", () => {
    const { container } = render(<Timeline entries={[]} />);
    expect(container.firstElementChild).toBeNull();
  });

  it("hides the connecting line and dots from assistive tech", () => {
    const { container } = render(<Timeline entries={entries} />);
    const decorative = container.querySelectorAll('span[aria-hidden="true"]');
    expect(decorative.length).toBeGreaterThan(0);
  });
});
