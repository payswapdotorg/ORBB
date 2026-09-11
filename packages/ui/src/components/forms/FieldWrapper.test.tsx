// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldWrapper } from "./FieldWrapper";
import { TextField } from "./TextField";

afterEach(cleanup);

describe("FieldWrapper", () => {
  it("wires the label to the control via htmlFor/id", () => {
    render(
      <FieldWrapper label="Display name">
        {(field) => <TextField {...field} />}
      </FieldWrapper>,
    );
    const input = screen.getByLabelText("Display name");
    expect(input).toBeInstanceOf(HTMLInputElement);
  });

  it("links hint and error through aria-describedby", () => {
    render(
      <FieldWrapper
        label="Display name"
        hint="Shown on your profile"
        error="Enter at least 2 characters"
        id="synthetic-field"
      >
        {(field) => <TextField {...field} />}
      </FieldWrapper>,
    );
    const input = screen.getByLabelText("Display name");
    expect(input.getAttribute("aria-describedby")).toBe(
      "synthetic-field-hint synthetic-field-error",
    );
    expect(screen.getByText("Shown on your profile").id).toBe(
      "synthetic-field-hint",
    );
    expect(screen.getByText("Enter at least 2 characters").id).toBe(
      "synthetic-field-error",
    );
  });

  it("marks invalid and required only when applicable", () => {
    const { rerender } = render(
      <FieldWrapper label="Display name">
        {(field) => <TextField {...field} />}
      </FieldWrapper>,
    );
    let input = screen.getByLabelText("Display name");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-required")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();

    // The required asterisk extends the label's accessible name, so match by
    // substring from here on.
    rerender(
      <FieldWrapper label="Display name" error="Required" required>
        {(field) => <TextField {...field} />}
      </FieldWrapper>,
    );
    input = screen.getByLabelText(/Display name/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(
      input.id + "-error",
    );
  });

  it("renders the required asterisk visually but hides it from assistive tech", () => {
    render(
      <FieldWrapper label="Display name" required>
        {(field) => <TextField {...field} />}
      </FieldWrapper>,
    );
    const asterisk = screen.getByText("*");
    expect(asterisk.getAttribute("aria-hidden")).toBe("true");
  });

  it("accepts an explicit id so error messages can target it", () => {
    render(
      <FieldWrapper label="Display name" id="fixed-id">
        {(field) => <TextField {...field} />}
      </FieldWrapper>,
    );
    expect(screen.getByLabelText("Display name").id).toBe("fixed-id");
  });
});
