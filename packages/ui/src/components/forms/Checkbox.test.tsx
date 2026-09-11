// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "./Checkbox";
import { color, touchTarget } from "../../tokens";

afterEach(cleanup);

/** jsdom normalizes hex colors to `rgb(...)` in computed inline styles. */
const rgb = (hex: string): string => {
  const channels = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(channels.slice(offset, offset + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

describe("Checkbox", () => {
  it("exposes an accessible checkbox named by its label", () => {
    render(<Checkbox label="Enable weekly digest" />);
    const checkbox = screen.getByRole("checkbox", { name: "Enable weekly digest" });
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("toggles through the wrapping label (the >= 44px touch target)", () => {
    render(<Checkbox label="Enable weekly digest" />);
    const label = screen.getByText("Enable weekly digest").closest("label");
    expect(label).not.toBeNull();
    if (label instanceof HTMLElement) {
      expect(Number.parseInt(label.style.minHeight, 10)).toBeGreaterThanOrEqual(
        touchTarget.minimum,
      );
    }
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("reflects the controlled checked prop", () => {
    const { rerender } = render(<Checkbox label="Sync" checked={false} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    rerender(<Checkbox label="Sync" checked />);
    expect(checkbox.checked).toBe(true);
  });

  it("emits change events with the new checked state", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Sync" onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    const event = onChange.mock.calls[0]?.[0];
    expect(event?.target.checked).toBe(true);
  });

  it("links hint and error through aria-describedby and aria-invalid", () => {
    render(
      <Checkbox
        label="Accept terms"
        hint="You can change this anytime"
        error="Acceptance is required to continue"
        id="synthetic-check"
      />,
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-describedby")).toBe(
      "synthetic-check-hint synthetic-check-error",
    );
    expect(checkbox.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("You can change this anytime").id).toBe(
      "synthetic-check-hint",
    );
    expect(screen.getByText("Acceptance is required to continue").id).toBe(
      "synthetic-check-error",
    );
  });

  it("marks required semantics on the input (native required)", () => {
    render(<Checkbox label="Accept terms" required />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.required).toBe(true);
  });

  it("shows the checked glyph in the accent color when checked", () => {
    const { container } = render(<Checkbox label="Sync" defaultChecked />);
    const box = container.querySelector("label > span");
    expect(box).not.toBeNull();
    if (box instanceof HTMLElement) {
      expect(box.style.backgroundColor).toBe(rgb(color.accent));
    }
    // The check glyph is an inline SVG inside the box.
    expect(box?.querySelector("svg")).not.toBeNull();
  });

  it("draws the focus ring on the visual box when the input is focused", () => {
    const { container } = render(<Checkbox label="Sync" />);
    const checkbox = screen.getByRole("checkbox");
    const box = container.querySelector("label > span");
    expect(box instanceof HTMLElement ? box.style.outline : "").toBe("none");
    fireEvent.focus(checkbox);
    expect(box instanceof HTMLElement ? box.style.outline : "").toContain(
      color.focusRing,
    );
    fireEvent.blur(checkbox);
    expect(box instanceof HTMLElement ? box.style.outline : "").toBe("none");
  });
});
