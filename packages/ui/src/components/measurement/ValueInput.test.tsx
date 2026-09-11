// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ValueInput, guardNumericValue } from "./ValueInput";
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

describe("guardNumericValue (pure)", () => {
  it("keeps empty input empty", () => {
    expect(guardNumericValue("", { min: 0, max: 10 })).toBe("");
    expect(guardNumericValue("   ", { min: 0 })).toBe("");
  });

  it("returns non-numeric input unchanged (validity stays with the caller)", () => {
    expect(guardNumericValue("abc", { min: 0, max: 10 })).toBe("abc");
    expect(guardNumericValue("12abc", { min: 0, max: 10 })).toBe("12abc");
  });

  it("passes in-range values through unchanged", () => {
    expect(guardNumericValue("5", { min: 0, max: 10 })).toBe("5");
    expect(guardNumericValue("5.5", { min: 0, max: 10 })).toBe("5.5");
    expect(guardNumericValue("-3", {})).toBe("-3");
  });

  it("clamps out-of-range values to the bounds", () => {
    expect(guardNumericValue("150", { min: 0, max: 100 })).toBe("100");
    expect(guardNumericValue("-40", { min: 0, max: 100 })).toBe("0");
    expect(guardNumericValue("37.5", { min: 40 })).toBe("40");
  });

  it("snaps values to the nearest step multiple", () => {
    expect(guardNumericValue("3.14", { step: 0.5 })).toBe("3");
    expect(guardNumericValue("2.6", { step: 0.5 })).toBe("2.5");
    expect(guardNumericValue("7", { step: 5 })).toBe("5");
  });

  it("re-clamps after step snapping so snapping never escapes the bounds", () => {
    expect(guardNumericValue("10", { min: 0, max: 10, step: 3 })).toBe("9");
    expect(guardNumericValue("0.4", { min: 1, max: 10, step: 0.5 })).toBe("1");
  });

  it("trims float dust introduced by step rounding", () => {
    expect(guardNumericValue("0.3", { step: 0.1 })).toBe("0.3");
  });

  it("ignores non-positive steps", () => {
    expect(guardNumericValue("7", { step: 0 })).toBe("7");
    expect(guardNumericValue("7", { step: -2 })).toBe("7");
  });
});

describe("ValueInput", () => {
  it("renders a text input with a decimal input mode and unit suffix", () => {
    render(<ValueInput value="" onChange={vi.fn()} unit="kg" />);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(screen.getByText("kg")).toBeTruthy();
  });

  it("guarantees the 44px minimum touch target", () => {
    const { container } = render(<ValueInput value="" onChange={vi.fn()} unit="kg" />);
    const wrapper = container.firstElementChild;
    expect(wrapper instanceof HTMLElement).toBe(true);
    const input = wrapper?.querySelector("input");
    expect(input instanceof HTMLElement ? input.style.minHeight : "").toBe(
      `${touchTarget.minimum}px`,
    );
  });

  it("streams raw keystrokes through onChange", () => {
    const onChange = vi.fn();
    render(<ValueInput value="" onChange={onChange} unit="kg" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith("42");
  });

  it("clamps out-of-range commits on blur", () => {
    const onChange = vi.fn();
    render(<ValueInput value="150" onChange={onChange} unit="kg" min={0} max={100} />);
    const input = screen.getByRole("textbox");
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("100");
  });

  it("snaps commits to the configured step on blur", () => {
    const onChange = vi.fn();
    render(<ValueInput value="2.6" onChange={onChange} unit="kg" step={0.5} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onChange).toHaveBeenCalledWith("2.5");
  });

  it("does not emit a guarded change when the value already matches", () => {
    const onChange = vi.fn();
    render(<ValueInput value="5" onChange={onChange} unit="kg" min={0} max={10} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switches to the danger border when invalid", () => {
    const { container, rerender } = render(
      <ValueInput value="" onChange={vi.fn()} unit="kg" />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper instanceof HTMLElement ? wrapper.style.borderColor : "").toBe(
      rgb(color.borderStrong),
    );
    rerender(<ValueInput value="" onChange={vi.fn()} unit="kg" invalid />);
    expect(wrapper instanceof HTMLElement ? wrapper.style.borderColor : "").toBe(
      rgb(color.danger),
    );
  });

  it("draws the focus ring on the wrapper when the input is focused", () => {
    const { container } = render(<ValueInput value="" onChange={vi.fn()} unit="kg" />);
    const wrapper = container.firstElementChild;
    expect(wrapper instanceof HTMLElement ? wrapper.style.outline : "").toBe("none");
    fireEvent.focus(screen.getByRole("textbox"));
    expect(wrapper instanceof HTMLElement ? wrapper.style.outline : "").toContain(
      color.focusRing,
    );
    fireEvent.blur(screen.getByRole("textbox"));
    expect(wrapper instanceof HTMLElement ? wrapper.style.outline : "").toBe("none");
  });
});
