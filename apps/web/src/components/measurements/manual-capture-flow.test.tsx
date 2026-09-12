// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ManualCaptureFlow } from "./manual-capture-flow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The fetch signature the capture flow relies on. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetchWith(response: Response) {
  const fetchMock = vi.fn<FetchLike>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const CONTINUE = "Continue";

function pickMetric(name: RegExp): void {
  fireEvent.click(screen.getByRole("radio", { name }));
}

function pickMethod(name: RegExp): void {
  fireEvent.click(screen.getByRole("radio", { name }));
}

function fillField(label: RegExp, raw: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value: raw } });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Save measurement" }));
}

function successfulCaptureResponse(): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      capture: {
        captureId: "SYNTH-CAP-000001",
        personId: "prsn_SYNTH-person-0001",
        shapeId: "SYNTH-shape-bp-panel",
        shapeLabel: "Blood pressure",
        methodOptionId: "SYNTH-method-manual-bp-panel",
        qualityState: "partial",
        capturedAt: "2026-09-10T08:30:00.000Z",
        recordedAt: "2026-09-10T08:31:00.000Z",
        notes: "morning reading",
        observations: [
          {
            id: "obs_SYNTH-obs-000001",
            personId: "prsn_SYNTH-person-0001",
            conceptCode: "SYNTH-8480-5",
            metricId: "SYNTH-metric-bp-systolic",
            metricLabel: "Blood Pressure Systolic",
            value: 118,
            unit: "mmHg",
            effectiveAt: "2026-09-10T08:30:00.000Z",
            observedAt: "2026-09-10T08:31:00.000Z",
            sourceId: "src_SYNTH-source-manual",
            methodId: "SYNTH-method-bpsys-manual",
            methodLabel: "Manual entry — home BP cuff reading · Systolic",
            evidenceLabel: "MEASURED",
            quality: 0.525,
            validationState: "pending",
            provenance: {
              provenanceId: "prov_SYNTH-prov-000001",
              actor: "prsn_SYNTH-person-0001",
              subject: "prsn_SYNTH-person-0001",
              occurredAt: "2026-09-10T08:31:00.000Z",
              correlationId: "SYNTH-CAP-000001",
            },
          },
          {
            id: "obs_SYNTH-obs-000002",
            personId: "prsn_SYNTH-person-0001",
            conceptCode: "SYNTH-8462-4",
            metricId: "SYNTH-metric-bp-diastolic",
            metricLabel: "Blood Pressure Diastolic",
            value: 76,
            unit: "mmHg",
            effectiveAt: "2026-09-10T08:30:00.000Z",
            observedAt: "2026-09-10T08:31:00.000Z",
            sourceId: "src_SYNTH-source-manual",
            methodId: "SYNTH-method-bpdia-manual",
            methodLabel: "Manual entry — home BP cuff reading · Diastolic",
            evidenceLabel: "MEASURED",
            quality: 0.525,
            validationState: "pending",
            provenance: {
              provenanceId: "prov_SYNTH-prov-000002",
              actor: "prsn_SYNTH-person-0001",
              subject: "prsn_SYNTH-person-0001",
              occurredAt: "2026-09-10T08:31:00.000Z",
              correlationId: "SYNTH-CAP-000001",
            },
          },
        ],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function driveToReview(): void {
  pickMetric(/blood pressure/i);
  fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
  pickMethod(/manual entry — home bp cuff reading/i);
  fillField(/systolic \(blood pressure systolic\)/i, "118");
  fillField(/diastolic \(blood pressure diastolic\)/i, "76");
  fireEvent.change(screen.getByLabelText(/capture time/i), {
    target: { value: "2026-09-10T08:30" },
  });
  fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
}

describe("ManualCaptureFlow — step 1 (what)", () => {
  it("renders the metric picker with the synthetic catalog", () => {
    render(<ManualCaptureFlow />);
    expect(screen.getByText("Step 1 of 3 — choose what you measured")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: /what did you measure\?/i })).toBeTruthy();
    for (const name of [/blood pressure/i, /heart rate/i, /body weight/i, /step count/i, /sleep duration/i]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    }
  });

  it("blocks continuing without a metric choice", () => {
    render(<ManualCaptureFlow />);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    expect(
      screen.getByText("Choose what you measured to continue."),
    ).toBeTruthy();
  });

  it("resets per-shape state when the metric changes", () => {
    render(<ManualCaptureFlow />);
    pickMetric(/heart rate/i);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    fillField(/heart rate \(heart rate\)/i, "64");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    pickMetric(/blood pressure/i);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    // No systolic/diastolic texts carried over: submit-blocked step shows
    // fresh method state (not chosen) and empty value fields.
    expect(screen.getByLabelText(/systolic/i)).toHaveProperty("value", "");
    expect(screen.queryByRole("radio", { name: /manual pulse check/i })).toBeNull();
  });
});

describe("ManualCaptureFlow — step 2 (method, values, context)", () => {
  it("shows the manual method plus disabled future routes", () => {
    render(<ManualCaptureFlow />);
    pickMetric(/blood pressure/i);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    expect(screen.getByRole("radiogroup", { name: /how did you capture it\?/i })).toBeTruthy();
    const manual = screen.getByRole("radio", {
      name: /manual entry — home bp cuff reading/i,
    }) as HTMLInputElement;
    expect(manual.disabled).toBe(false);
    const future = screen.getByRole("radio", {
      name: /automatic cuff sync/i,
    }) as HTMLInputElement;
    expect(future.disabled).toBe(true);
  });

  it("validates method and values with per-field errors and focus", () => {
    render(<ManualCaptureFlow />);
    pickMetric(/blood pressure/i);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));

    expect(screen.getByText("Choose a capture method to continue.")).toBeTruthy();
    expect(screen.getAllByText("Enter a value before continuing.")).toHaveLength(2);
    const systolic = screen.getByLabelText(/systolic \(blood pressure systolic\)/i);
    expect(systolic.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(systolic);
  });

  it("clamps out-of-range commits on blur (library guard semantics) and advances", () => {
    render(<ManualCaptureFlow />);
    pickMetric(/blood pressure/i);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    pickMethod(/manual entry — home bp cuff reading/i);
    const systolic = screen.getByLabelText(/systolic \(blood pressure systolic\)/i);
    fireEvent.change(systolic, { target: { value: "350" } });
    fireEvent.blur(systolic);
    expect(systolic).toHaveProperty("value", "300");
    fillField(/diastolic \(blood pressure diastolic\)/i, "76");
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));

    expect(screen.getByText("Step 3 of 3 — review and save")).toBeTruthy();
    expect(screen.getByText(/Systolic: 300 mmHg · Diastolic: 76 mmHg/)).toBeTruthy();
  });

  it("defaults the capture time to now after mount and keeps it editable", () => {
    render(<ManualCaptureFlow />);
    pickMetric(/heart rate/i);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    const timeInput = screen.getByLabelText(/capture time/i);
    const beforeMount = new Date();
    expect((timeInput as HTMLInputElement).value).not.toBe("");
    const parsed = new Date((timeInput as HTMLInputElement).value);
    expect(Math.abs(parsed.getTime() - beforeMount.getTime())).toBeLessThan(60_000);
    fireEvent.change(timeInput, { target: { value: "2026-09-10T08:30" } });
    expect((timeInput as HTMLInputElement).value).toBe("2026-09-10T08:30");
  });

  it("blocks a future capture time", () => {
    render(<ManualCaptureFlow />);
    pickMetric(/heart rate/i);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    pickMethod(/manual pulse check/i);
    fillField(/heart rate \(heart rate\)/i, "64");
    const timeInput = screen.getByLabelText(/capture time/i);
    fireEvent.change(timeInput, { target: { value: "2999-01-01T08:30" } });
    fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
    expect(screen.getByText("Capture time cannot be in the future.")).toBeTruthy();
  });
});

describe("ManualCaptureFlow — step 3 (review + submit)", () => {
  it("reviews the full summary including the method actually used", () => {
    render(<ManualCaptureFlow />);
    driveToReview();
    expect(screen.getByText("Step 3 of 3 — review and save")).toBeTruthy();
    expect(screen.getByText(/Systolic: 118 mmHg · Diastolic: 76 mmHg/)).toBeTruthy();
    expect(
      screen.getByText(/per-observation methods: SYNTH-method-bpsys-manual, SYNTH-method-bpdia-manual/),
    ).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: /quality self-assessment/i })).toBeTruthy();
  });

  it("blocks submitting without a quality self-assessment", () => {
    render(<ManualCaptureFlow />);
    driveToReview();
    submit();
    expect(
      screen.getByText("Choose a quality self-assessment before saving."),
    ).toBeTruthy();
  });

  it("submits the validated payload and shows the recorded observation with provenance + method", async () => {
    const fetchMock = stubFetchWith(successfulCaptureResponse());
    render(<ManualCaptureFlow />);
    driveToReview();
    fireEvent.click(screen.getByRole("radio", { name: /^partial/i }));
    submit();

    await waitFor(() => {
      expect(screen.getByText("Measurement saved.")).toBeTruthy();
    });
    expect(screen.getByText(/Blood pressure 118\/76 mmHg — via Manual entry/)).toBeTruthy();
    expect(
      screen.getByText(/method actually used: SYNTH-method-bpsys-manual · provenance actor: prsn_SYNTH-person-0001/i),
    ).toBeTruthy();
    expect(screen.getByText("Partial", { exact: true })).toBeTruthy();
    expect(screen.getByText(/saved as-is — never silently upgraded/i)).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/capture");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.shapeId).toBe("SYNTH-shape-bp-panel");
    expect(body.methodOptionId).toBe("SYNTH-method-manual-bp-panel");
    expect(body.fieldValues).toEqual({ systolic: 118, diastolic: 76 });
    expect(body.qualityState).toBe("partial");
    expect(body.notes).toBeUndefined();
    const expectedIso = new Date("2026-09-10T08:30").toISOString();
    expect(body.capturedAt).toBe(expectedIso);
  });

  it("surfaces error-envelope rejections as actionable feedback", async () => {
    stubFetchWith(
      new Response(
        JSON.stringify({
          error: {
            code: "validation-failed",
            message: "The capture submission failed validation.",
            details: {
              issues: [{ field: "fieldValues.systolic", problem: "'systolic' must be between 60 and 300." }],
            },
            requestId: "SYNTH-REQ-000001",
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    render(<ManualCaptureFlow />);
    driveToReview();
    fireEvent.click(screen.getByRole("radio", { name: /^complete/i }));
    submit();

    await waitFor(() => {
      expect(
        screen.getByText(/Could not save the measurement: The capture submission failed validation./),
      ).toBeTruthy();
    });
  });

  it("surfaces network failures as actionable feedback", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ManualCaptureFlow />);
    driveToReview();
    fireEvent.click(screen.getByRole("radio", { name: /^low quality/i }));
    submit();
    await waitFor(() => {
      expect(screen.getByText(/network error/)).toBeTruthy();
    });
  });

  it("resets the flow for another capture", async () => {
    stubFetchWith(successfulCaptureResponse());
    render(<ManualCaptureFlow />);
    driveToReview();
    fireEvent.click(screen.getByRole("radio", { name: /^complete/i }));
    submit();
    await waitFor(() => {
      expect(screen.getByText("Measurement saved.")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Record another measurement" }));
    expect(screen.getByText("Step 1 of 3 — choose what you measured")).toBeTruthy();
    expect(screen.queryByText("Measurement saved.")).toBeNull();
  });
});
