// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CaptureHistory } from "./capture-history";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The fetch signature the history reads through. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

function listResponse(records: Record<string, unknown>[]): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      personId: "prsn_SYNTH-person-0001",
      captures: records,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetchWith(responses: Response[]) {
  let call = 0;
  const fetchMock = vi.fn<FetchLike>(async () => {
    const response = responses[Math.min(call, responses.length - 1)] ?? responses[0]!;
    call += 1;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CaptureHistory", () => {
  it("loads and renders table rows with method/quality/provenance badges", async () => {
    stubFetchWith([listResponse([record()])]);
    render(<CaptureHistory refreshToken={0} />);

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeTruthy();
    });
    expect(screen.getByText("Blood pressure 118/76 mmHg")).toBeTruthy();
    expect(screen.getByText("SYNTH-CAP-000001")).toBeTruthy();
    expect(screen.getByText("Manual", { exact: true })).toBeTruthy();
    expect(screen.getByText("Partial", { exact: true })).toBeTruthy();
    expect(screen.getByText("You (self-tracking)", { exact: true })).toBeTruthy();
  });

  it("reveals the provenance drawer (method actually used, quality, actor) per row", async () => {
    stubFetchWith([listResponse([record()])]);
    render(<CaptureHistory refreshToken={0} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details: SYNTH-CAP-000001" })).toBeTruthy();
    });
    const toggle = screen.getByRole("button", { name: "Details: SYNTH-CAP-000001" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    expect(screen.getByText("Provenance actor")).toBeTruthy();
    expect(screen.getByText(/You \(SYNTH-Person-1, self-tracking\)/)).toBeTruthy();
    expect(screen.getByText("Method actually used")).toBeTruthy();
    expect(screen.getByText(/SYNTH-method-bpsys-manual/)).toBeTruthy();
    expect(screen.getByText(/self-assessed; never upgraded/)).toBeTruthy();
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.getByText("morning reading")).toBeTruthy();
  });

  it("reflects the recorded quality state in badges without upgrading", async () => {
    stubFetchWith([
      listResponse([record({ qualityState: "low-quality", captureId: "SYNTH-CAP-000002" })]),
    ]);
    render(<CaptureHistory refreshToken={0} />);
    await waitFor(() => {
      expect(screen.getByText("Low quality", { exact: true })).toBeTruthy();
    });
  });

  it("toggles to the day-grouped timeline view with polite announcements", async () => {
    stubFetchWith([listResponse([record()])]);
    render(<CaptureHistory refreshToken={0} />);
    await waitFor(() => {
      expect(screen.getByRole("table")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Showing the capture history timeline.")).toBeTruthy();
    expect(screen.getByText(/Blood pressure 118\/76 mmHg/)).toBeTruthy();
    expect(screen.getByText(/quality: Partial · recorded by you/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "History list" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Showing the capture history list.")).toBeTruthy();
  });

  it("renders the empty state before any capture", async () => {
    stubFetchWith([listResponse([])]);
    render(<CaptureHistory refreshToken={0} />);
    await waitFor(() => {
      expect(
        screen.getByText(/No manual observations yet — record your first measurement above./),
      ).toBeTruthy();
    });
  });

  it("surfaces load failures from the error envelope", async () => {
    stubFetchWith([
      new Response(
        JSON.stringify({
          error: { code: "internal-error", message: "An internal error occurred.", requestId: "SYNTH-REQ-000002" },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    ]);
    render(<CaptureHistory refreshToken={0} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load the capture history/)).toBeTruthy();
    });
  });

  it("re-reads the store when the refresh signal advances", async () => {
    const fetchMock = stubFetchWith([listResponse([]), listResponse([record()])]);
    const { rerender } = render(<CaptureHistory refreshToken={0} />);
    await waitFor(() => {
      expect(
        screen.getByText(/No manual observations yet/),
      ).toBeTruthy();
    });

    rerender(<CaptureHistory refreshToken={1} />);
    await waitFor(() => {
      expect(screen.getByText("Blood pressure 118/76 mmHg")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
