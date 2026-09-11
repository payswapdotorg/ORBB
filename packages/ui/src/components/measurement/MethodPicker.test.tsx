// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MethodPicker } from "./MethodPicker";
import { touchTarget } from "../../tokens";

afterEach(cleanup);

/** Type-safe indexed access to the rendered radios. */
const radioAt = (index: number): HTMLInputElement => {
  const radio = screen.getAllByRole("radio")[index];
  if (!(radio instanceof HTMLInputElement)) {
    throw new Error(`Expected a radio input at index ${index}`);
  }
  return radio;
};

const options = [
  { id: "cup", label: "Manual entry", meta: "~1 min, no device" },
  { id: "scale", label: "Connected scale", meta: "~30 sec, device" },
  { id: "clinic", label: "Clinic visit", meta: "Scheduled" },
] as const;

describe("MethodPicker", () => {
  it("exposes a radiogroup named by its visible label", () => {
    render(<MethodPicker label="Capture method" options={options} />);
    const group = screen.getByRole("radiogroup", { name: "Capture method" });
    expect(group).toBeInstanceOf(HTMLDivElement);
  });

  it("names the group via aria-label when no visible label is rendered", () => {
    render(<MethodPicker aria-label="Capture method" options={options} />);
    expect(screen.getByRole("radiogroup", { name: "Capture method" })).toBeTruthy();
  });

  it("renders each option with its label and metadata line", () => {
    render(<MethodPicker label="Capture method" options={options} />);
    expect(screen.getByText("Manual entry")).toBeTruthy();
    expect(screen.getByText("~1 min, no device")).toBeTruthy();
    expect(screen.getByText("Connected scale")).toBeTruthy();
    expect(screen.getByText("Clinic visit")).toBeTruthy();
  });

  it("renders one radio per option sharing a single group name", () => {
    render(<MethodPicker label="Capture method" options={options} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(options.length);
    const names = new Set(radios.map((radio) => (radio as HTMLInputElement).name));
    expect(names.size).toBe(1);
  });

  it("marks the selected option as checked (native radio semantics)", () => {
    const onChange = vi.fn();
    render(<MethodPicker label="Capture method" options={options} onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const scale = radios[1] as HTMLInputElement;
    fireEvent.click(scale);
    expect(onChange).toHaveBeenCalledWith("scale");
    expect(scale.checked).toBe(true);
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
  });

  it("reflects the controlled value prop", () => {
    const { rerender } = render(
      <MethodPicker label="Capture method" options={options} value="cup" />,
    );
    expect((screen.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
    rerender(<MethodPicker label="Capture method" options={options} value="clinic" />);
    const radios = screen.getAllByRole("radio");
    expect((radios[2] as HTMLInputElement).checked).toBe(true);
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
  });

  it("guarantees the 44px minimum touch target per option row", () => {
    const { container } = render(
      <MethodPicker label="Capture method" options={options} />,
    );
    const rows = container.querySelectorAll("label");
    for (const row of rows) {
      if (row instanceof HTMLElement) {
        expect(Number.parseInt(row.style.minHeight, 10)).toBeGreaterThanOrEqual(
          touchTarget.minimum,
        );
      }
    }
  });

  it("highlights the selected row with the accent tokens", () => {
    const { container } = render(
      <MethodPicker label="Capture method" options={options} defaultValue="scale" />,
    );
    const rows = container.querySelectorAll("label");
    const selectedRow = rows[1];
    expect(selectedRow instanceof HTMLElement).toBe(true);
    if (selectedRow instanceof HTMLElement) {
      expect(selectedRow.style.backgroundColor).toBe("rgb(226, 239, 234)");
    }
  });

  it("draws the focus ring on the option circle when its radio is focused", () => {
    const { container } = render(
      <MethodPicker label="Capture method" options={options} />,
    );
    const circle = container.querySelectorAll("label > span")[0];
    expect(circle instanceof HTMLElement ? circle.style.outline : "").toBe("none");
    fireEvent.focus(radioAt(0));
    expect(circle instanceof HTMLElement ? circle.style.outline : "").toContain("2px");
    fireEvent.blur(radioAt(0));
    expect(circle instanceof HTMLElement ? circle.style.outline : "").toBe("none");
  });

  it("disables individual options and the whole list", () => {
    const disabledOptions = [
      { id: "a", label: "Option A" },
      { id: "b", label: "Option B", disabled: true },
    ] as const;
    const { rerender } = render(
      <MethodPicker label="Pick one" options={disabledOptions} />,
    );
    const radios = screen.getAllByRole("radio");
    expect((radios[1] as HTMLInputElement).disabled).toBe(true);

    rerender(<MethodPicker label="Pick one" options={disabledOptions} disabled />);
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
    }
  });
});
