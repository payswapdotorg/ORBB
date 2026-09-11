// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RadioGroup } from "./RadioGroup";
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
  { value: "email", label: "Email", description: "Once per day" },
  { value: "push", label: "Push", description: "Immediate" },
  { value: "none", label: "No updates" },
] as const;

describe("RadioGroup", () => {
  it("exposes a radiogroup named by its visible label", () => {
    render(<RadioGroup label="Preferred channel" options={options} />);
    const group = screen.getByRole("radiogroup", { name: "Preferred channel" });
    expect(group).toBeInstanceOf(HTMLDivElement);
  });

  it("names the group via aria-label when no visible label is rendered", () => {
    render(<RadioGroup aria-label="Channel" options={options} />);
    expect(screen.getByRole("radiogroup", { name: "Channel" })).toBeTruthy();
  });

  it("renders one focusable radio per option sharing a single name", () => {
    render(<RadioGroup label="Preferred channel" options={options} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(options.length);
    const names = new Set(radios.map((radio) => (radio as HTMLInputElement).name));
    expect(names.size).toBe(1);
    expect(radios.every((radio) => radio.getAttribute("tabindex") !== "-1")).toBe(
      true,
    );
  });

  it("selects an option (uncontrolled) and reports the value", () => {
    const onChange = vi.fn();
    render(<RadioGroup label="Preferred channel" options={options} onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const push = radios[1] as HTMLInputElement;
    fireEvent.click(push);
    expect(onChange).toHaveBeenCalledWith("push");
    expect(push.checked).toBe(true);
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
  });

  it("reflects the controlled value prop", () => {
    const { rerender } = render(
      <RadioGroup label="Preferred channel" options={options} value="email" />,
    );
    let radios = screen.getAllByRole("radio");
    expect((radios[1] as HTMLInputElement).checked).toBe(false);
    rerender(
      <RadioGroup label="Preferred channel" options={options} value="push" />,
    );
    radios = screen.getAllByRole("radio");
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
  });

  it("marks the selected radio as checked (native radio semantics)", () => {
    render(
      <RadioGroup label="Preferred channel" options={options} defaultValue="push" />,
    );
    const radios = screen.getAllByRole("radio");
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
  });

  it("links hint and error through aria-describedby and aria-invalid", () => {
    render(
      <RadioGroup
        label="Preferred channel"
        options={options}
        hint="Applies to synthetic notifications"
        error="Pick a channel to continue"
        id="synthetic-radios"
      />,
    );
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-describedby")).toBe(
      "synthetic-radios-hint synthetic-radios-error",
    );
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Pick a channel to continue")).toBeTruthy();
  });

  it("marks required semantics on the group", () => {
    render(<RadioGroup label="Preferred channel" options={options} required />);
    expect(
      screen.getByRole("radiogroup").getAttribute("aria-required"),
    ).toBe("true");
  });

  it("guarantees the 44px minimum touch target per option", () => {
    const { container } = render(
      <RadioGroup label="Preferred channel" options={options} />,
    );
    const optionLabels = container.querySelectorAll("label");
    for (const label of optionLabels) {
      if (label instanceof HTMLElement) {
        expect(Number.parseInt(label.style.minHeight, 10)).toBeGreaterThanOrEqual(
          touchTarget.minimum,
        );
      }
    }
  });

  it("draws the focus ring on the option circle when its radio is focused", () => {
    const { container } = render(
      <RadioGroup label="Preferred channel" options={options} />,
    );
    const push = radioAt(1);
    const circles = container.querySelectorAll('label > span[aria-hidden="true"]');
    const circle = circles[1];
    expect(circle instanceof HTMLElement ? circle.style.outline : "").toBe("none");
    fireEvent.focus(push);
    expect(circle instanceof HTMLElement ? circle.style.outline : "").toContain(
      "2px",
    );
    fireEvent.blur(push);
    expect(circle instanceof HTMLElement ? circle.style.outline : "").toBe("none");
  });

  it("disables a single option and the whole group", () => {
    const disabledOptions = [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B", disabled: true },
    ] as const;
    const { rerender } = render(
      <RadioGroup label="Pick" options={disabledOptions} />,
    );
    const radios = screen.getAllByRole("radio");
    expect((radios[1] as HTMLInputElement).disabled).toBe(true);
    expect((radios[0] as HTMLInputElement).disabled).toBe(false);

    rerender(<RadioGroup label="Pick" options={disabledOptions} disabled />);
    const rerenderedRadios = screen.getAllByRole("radio");
    expect((rerenderedRadios[0] as HTMLInputElement).disabled).toBe(true);
  });
});
