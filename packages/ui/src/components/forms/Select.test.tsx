// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Select } from "./Select";
import { color, touchTarget } from "../../tokens";

afterEach(cleanup);

const options = [
  { value: "alpha", label: "Option Alpha" },
  { value: "beta", label: "Option Beta" },
  { value: "gamma", label: "Option Gamma", disabled: true },
] as const;

/** jsdom normalizes hex colors to `rgb(...)` in computed inline styles. */
const rgb = (hex: string): string => {
  const channels = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(channels.slice(offset, offset + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

describe("Select", () => {
  it("renders a native combobox with its options", () => {
    render(<Select options={options} />);
    const select = screen.getByRole("combobox");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    for (const option of options) {
      expect(screen.getByText(option.label)).toBeTruthy();
    }
    const gamma = screen.getByText("Option Gamma") as HTMLOptionElement;
    expect(gamma.disabled).toBe(true);
  });

  it("guarantees the 44px minimum touch target", () => {
    render(<Select options={options} />);
    expect(screen.getByRole("combobox").style.minHeight).toBe(
      `${touchTarget.minimum}px`,
    );
  });

  it("renders a leading placeholder option with an empty value", () => {
    render(<Select options={options} placeholder="Choose an option" />);
    const placeholder = screen.getByText("Choose an option") as HTMLOptionElement;
    expect(placeholder.value).toBe("");
    expect(placeholder.disabled).toBe(false);
  });

  it("reports selection through the native change event", () => {
    const onChange = vi.fn();
    render(<Select options={options} onChange={onChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "beta" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const event = onChange.mock.calls[0]?.[0];
    expect(event?.target.value).toBe("beta");
    expect(select.value).toBe("beta");
  });

  it("switches to the danger border when invalid", () => {
    const { rerender } = render(<Select options={options} />);
    expect(screen.getByRole("combobox").style.borderColor).toBe(
      rgb(color.borderStrong),
    );
    rerender(<Select options={options} invalid />);
    expect(screen.getByRole("combobox").style.borderColor).toBe(rgb(color.danger));
  });

  it("draws a visible focus ring from tokens on focus", () => {
    render(<Select options={options} />);
    const select = screen.getByRole("combobox");
    fireEvent.focus(select);
    expect(select.style.outline).toContain(color.focusRing);
    fireEvent.blur(select);
    expect(select.style.outline).toBe("none");
  });
});
