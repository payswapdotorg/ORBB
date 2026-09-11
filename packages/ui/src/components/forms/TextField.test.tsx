// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TextField } from "./TextField";
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

describe("TextField", () => {
  it("renders a native text input", () => {
    render(<TextField defaultValue="Synthetic value" />);
    const input = screen.getByRole("textbox");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).value).toBe("Synthetic value");
  });

  it("guarantees the 44px minimum touch target", () => {
    render(<TextField />);
    const input = screen.getByRole("textbox");
    expect(input.style.minHeight).toBe(`${touchTarget.minimum}px`);
    expect(Number.parseInt(input.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it("uses the strong border at rest and the danger border when invalid", () => {
    const { rerender } = render(<TextField />);
    let input = screen.getByRole("textbox");
    expect(input.style.borderColor).toBe(rgb(color.borderStrong));

    rerender(<TextField invalid />);
    input = screen.getByRole("textbox");
    expect(input.style.borderColor).toBe(rgb(color.danger));
  });

  it("honours aria-invalid passed from FieldWrapper for danger styling", () => {
    render(<TextField aria-invalid />);
    expect(screen.getByRole("textbox").style.borderColor).toBe(rgb(color.danger));
  });

  it("draws a visible focus ring from tokens on focus", () => {
    render(<TextField />);
    const input = screen.getByRole("textbox");
    expect(input.style.outline).toBe("none");
    fireEvent.focus(input);
    expect(input.style.outline).toContain(`${2}px`);
    expect(input.style.outline).toContain(color.focusRing);
    fireEvent.blur(input);
    expect(input.style.outline).toBe("none");
  });

  it("signals the disabled state", () => {
    render(<TextField disabled />);
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  });

  it("emits change events for consumer wiring", () => {
    const onChange = vi.fn();
    render(<TextField value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
