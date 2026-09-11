// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MeasurementCaptureForm } from "./measurement-capture-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const VALUE_INPUT_LABEL = /measured value/i;
const SAVE_BUTTON = "Save measurement";

function fillValue(raw: string): void {
  const input = screen.getByLabelText(VALUE_INPUT_LABEL);
  fireEvent.change(input, { target: { value: raw } });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
}

/** The fetch signature the capture form relies on. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetchWith(response: Response) {
  const fetchMock = vi.fn<FetchLike>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("MeasurementCaptureForm", () => {
  it("renders the task context with a due-window badge", () => {
    render(<MeasurementCaptureForm />);
    expect(screen.getByText("Due by 09:00")).toBeTruthy();
    expect(screen.getByText("Resting heart rate")).toBeTruthy();
    expect(screen.getByRole("button", { name: SAVE_BUTTON })).toBeTruthy();
  });

  it("wires the value field through FieldWrapper (label, hint, required)", () => {
    render(<MeasurementCaptureForm />);
    const input = screen.getByLabelText(VALUE_INPUT_LABEL);
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(/Enter the value in beats\/min\./)).toBeTruthy();
    expect(screen.getByText(/clamped to 30–220\./)).toBeTruthy();
  });

  it("rejects an empty submission with a value error and focuses the field", () => {
    render(<MeasurementCaptureForm />);
    submit();
    expect(screen.getByText("Enter a value before saving.")).toBeTruthy();
    const input = screen.getByLabelText(VALUE_INPUT_LABEL);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
  });

  it("rejects non-numeric input", () => {
    render(<MeasurementCaptureForm />);
    fillValue("seventy");
    submit();
    expect(screen.getByText("Enter a number, e.g. 62.")).toBeTruthy();
  });

  it("clamps out-of-range commits on blur (library guard semantics)", () => {
    render(<MeasurementCaptureForm />);
    const input = screen.getByLabelText(VALUE_INPUT_LABEL);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("220");

    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("30");
  });

  it("requires a capture method once the value is valid", () => {
    render(<MeasurementCaptureForm />);
    fillValue("72");
    submit();
    expect(screen.getByText("Choose a capture method before saving.")).toBeTruthy();
  });

  it("clears the method error when a method is chosen", () => {
    render(<MeasurementCaptureForm />);
    fillValue("72");
    submit();
    expect(screen.getByText("Choose a capture method before saving.")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("radio", { name: /manual pulse check/i }),
    );
    expect(
      screen.queryByText("Choose a capture method before saving."),
    ).toBeNull();
  });

  it("submits a guarded payload and shows the synthetic echo", async () => {
    const fetchMock = stubFetchWith(
      new Response(
        JSON.stringify({
          status: "recorded",
          synthetic: true,
          echo: {
            echoId: "SYNTH-OBS-0001",
            value: 72,
            unit: "beats/min",
            methodId: "SYNTH-method-pulse",
            capturedAt: "2026-09-10T08:00:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(<MeasurementCaptureForm />);
    fillValue("72");
    fireEvent.click(screen.getByRole("radio", { name: /manual pulse check/i }));
    submit();

    await waitFor(() => {
      expect(screen.getByText(/SYNTH-OBS-0001/)).toBeTruthy();
    });
    expect(
      screen.getByText(/Measurement saved: 72 beats\/min via Manual pulse check/),
    ).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/measurements");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      value: 72,
      methodId: "SYNTH-method-pulse",
    });
  });

  it("normalizes an out-of-range value to the guard bounds before submitting", async () => {
    const fetchMock = stubFetchWith(
      new Response(
        JSON.stringify({
          status: "recorded",
          synthetic: true,
          echo: {
            echoId: "SYNTH-OBS-0002",
            value: 220,
            unit: "beats/min",
            methodId: "SYNTH-method-pulse",
            capturedAt: "2026-09-10T08:00:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(<MeasurementCaptureForm />);
    // 250 submitted without blurring: the form applies the guard itself.
    fillValue("250");
    fireEvent.click(screen.getByRole("radio", { name: /manual pulse check/i }));
    submit();

    await waitFor(() => {
      expect(screen.getByText(/Measurement saved: 220 beats\/min/)).toBeTruthy();
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      value: 220,
      methodId: "SYNTH-method-pulse",
    });
  });

  it("surfaces route rejections as actionable feedback", async () => {
    stubFetchWith(
      new Response(
        JSON.stringify({
          status: "rejected",
          synthetic: true,
          reason: "value-out-of-range",
          message: "'value' must be between 30 and 220.",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    render(<MeasurementCaptureForm />);
    fillValue("72");
    fireEvent.click(screen.getByRole("radio", { name: /manual pulse check/i }));
    submit();

    await waitFor(() => {
      expect(screen.getByText(/'value' must be between 30 and 220\./)).toBeTruthy();
    });
  });

  it("surfaces network failures as actionable feedback", async () => {
    stubFetchWith(new Response("not json", { status: 500 }));
    render(<MeasurementCaptureForm />);
    fillValue("72");
    fireEvent.click(screen.getByRole("radio", { name: /manual pulse check/i }));
    submit();
    await waitFor(() => {
      expect(
        screen.getByText(/unexpected response from the stub route/),
      ).toBeTruthy();
    });
  });
});
