// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodaySurface } from "./today-surface";
import type { TodayIntentSummary, TodayTaskView } from "@/lib/today/types";

/**
 * Today surface tests (M6-B B4): the intent-driven board — intents with
 * progress, task cards, the completion route into the EXISTING M4-B
 * capture flow (preselected metric), the task transition through the API,
 * and the provenance affordance on the result (B5 link).
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The fetch signature the surface reads/writes through. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function intent(overrides: Partial<TodayIntentSummary> = {}): TodayIntentSummary {
  return {
    intentId: "intent_SYNTH-today-bp-000001",
    objective: "Lower blood pressure (systolic) toward 120 mmHg",
    metricLabel: "Blood Pressure Systolic",
    planLabel: "Daily blood pressure monitoring",
    planId: "plan_SYNTH-today-bp-daily-0001",
    planState: "active",
    progress: { completedToday: 0, dueNow: 1, label: "0 of 1 due measurements completed." },
    ...overrides,
  };
}

function task(overrides: Partial<TodayTaskView> = {}): TodayTaskView {
  return {
    taskId: "task_SYNTH-today-bp-000001",
    planId: "plan_SYNTH-today-bp-daily-0001",
    intentId: "intent_SYNTH-today-bp-000001",
    metricId: "SYNTH-metric-bp-systolic",
    metricLabel: "Blood Pressure Systolic",
    conceptCode: "SYNTH-8480-5",
    captureShapeId: "SYNTH-shape-bp-panel",
    state: "open",
    window: {
      sequence: 0,
      startsAt: "2025-09-15T00:00:00.000Z",
      endsAt: "2025-09-15T23:59:59.999Z",
    },
    dueWindowLabel: "Due by end of today",
    reason: 'Supports "Lower blood pressure (systolic) toward 120 mmHg"',
    missedWindow: false,
    rollCount: 0,
    methods: [
      {
        methodId: "SYNTH-method-manual-bp-panel",
        label: "Manual entry — home BP cuff reading",
        kind: "manual",
        relativeBurden: 3,
        estimatedEffortLabel: "~2 min",
        privacyImpactLabel: "Private — typed on this device into your DataBox.",
        availability: "available",
        availabilityNote: "Available now — the manual capture journey.",
      },
    ],
    methodCountLabel: "1 method available",
    primaryRouteLabel: "Manual entry — home BP cuff reading",
    estimatedEffortLabel: "~2 min",
    privacyImpactLabel: "Private — typed on this device into your DataBox.",
    fallback: {
      providers: ["SYNTH-Clinic-A", "SYNTH-CHW-2"],
      label: "Clinic/CHW fallback",
      detail: "A provider can capture this for you.",
    },
    ...overrides,
  };
}

function listResponse(
  tasks: readonly TodayTaskView[],
  intents: readonly TodayIntentSummary[],
): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      personId: "prsn_SYNTH-person-0001",
      intents,
      tasks,
      generatedAt: "2025-09-15T14:00:00.000Z",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function completeResponse(
  completed: TodayTaskView,
  intents: readonly TodayIntentSummary[],
): Response {
  return new Response(
    JSON.stringify({ synthetic: true, task: completed, intents }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function captureSubmitResponse(): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      capture: {
        captureId: "SYNTH-CAP-000001",
        personId: "prsn_SYNTH-person-0001",
        shapeId: "SYNTH-shape-bp-panel",
        shapeLabel: "Blood pressure",
        methodOptionId: "SYNTH-method-manual-bp-panel",
        qualityState: "complete",
        capturedAt: "2025-09-15T14:02:00.000Z",
        recordedAt: "2025-09-15T14:02:01.000Z",
        observations: [
          {
            id: "obs_SYNTH-obs-000001",
            personId: "prsn_SYNTH-person-0001",
            conceptCode: "SYNTH-8480-5",
            metricId: "SYNTH-metric-bp-systolic",
            metricLabel: "Blood Pressure Systolic",
            value: 118,
            unit: "mmHg",
            effectiveAt: "2025-09-15T14:02:00.000Z",
            observedAt: "2025-09-15T14:02:01.000Z",
            sourceId: "src_SYNTH-source-manual",
            methodId: "SYNTH-method-bpsys-manual",
            methodLabel: "Manual entry — home BP cuff reading · Systolic",
            evidenceLabel: "MEASURED",
            quality: 0.9,
            validationState: "pending",
            provenance: {
              provenanceId: "prov_SYNTH-prov-000001",
              actor: "prsn_SYNTH-person-0001",
              subject: "prsn_SYNTH-person-0001",
              occurredAt: "2025-09-15T14:02:01.000Z",
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
            effectiveAt: "2025-09-15T14:02:00.000Z",
            observedAt: "2025-09-15T14:02:01.000Z",
            sourceId: "src_SYNTH-source-manual",
            methodId: "SYNTH-method-bpdia-manual",
            methodLabel: "Manual entry — home BP cuff reading · Diastolic",
            evidenceLabel: "MEASURED",
            quality: 0.9,
            validationState: "pending",
            provenance: {
              provenanceId: "prov_SYNTH-prov-000002",
              actor: "prsn_SYNTH-person-0001",
              subject: "prsn_SYNTH-person-0001",
              occurredAt: "2025-09-15T14:02:01.000Z",
              correlationId: "SYNTH-CAP-000001",
            },
          },
        ],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetchWith(responses: Response[]): ReturnType<typeof vi.fn<FetchLike>> {
  let call = 0;
  const fetchMock = vi.fn<FetchLike>(async () => {
    const response = responses[Math.min(call, responses.length - 1)] ?? responses[0]!;
    call += 1;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TodaySurface (the intent-driven board)", () => {
  it("renders the intent focus with conservative progress and the task cards", async () => {
    stubFetchWith([listResponse([task()], [intent()])]);
    render(<TodaySurface />);

    await waitFor(() => {
      expect(screen.getByText("What you are working toward")).toBeTruthy();
    });
    expect(screen.getByText("Lower blood pressure (systolic) toward 120 mmHg")).toBeTruthy();
    expect(screen.getByText("Active plan")).toBeTruthy();
    expect(screen.getByText("0 of 1 due measurements completed.")).toBeTruthy();
    expect(screen.getByText("1 measurement task due — the easiest valid way to complete each is first.")).toBeTruthy();
    expect(screen.getByText("Blood Pressure Systolic")).toBeTruthy();
    expect(screen.getByText("Due by end of today")).toBeTruthy();
    // Conservative clinical framing: no streaks or punitive language.
    expect(screen.queryByText(/streak/i)).toBeNull();
    expect(screen.queryByText(/missed it again/i)).toBeNull();
  });

  it("opens the EXISTING M4-B capture flow with the metric preselected (step 2)", async () => {
    stubFetchWith([listResponse([task()], [intent()])]);
    render(<TodaySurface />);
    await waitFor(() => {
      expect(screen.getByText("Blood Pressure Systolic")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Complete Blood Pressure Systolic now — Manual entry/,
      }),
    );
    // The capture flow mounts (the existing component) with the preselected
    // shape — step 2 (method + values), skipping the metric picker.
    expect(screen.getByText("Complete your measurement")).toBeTruthy();
    expect(screen.getByText("Step 2 of 3 — method, values, and context")).toBeTruthy();
    expect(screen.getByText(/it is preselected below/)).toBeTruthy();
  });

  it("completes the task through the capture flow, announces it, and links the provenance", async () => {
    const fetchMock = stubFetchWith([
      listResponse([task()], [intent()]),
      captureSubmitResponse(),
      completeResponse(
        task({
          state: "completed",
          completion: {
            captureId: "SYNTH-CAP-000001",
            observationIds: ["obs_SYNTH-obs-000001", "obs_SYNTH-obs-000002"],
            completedAt: "2025-09-15T14:02:01.000Z",
          },
        }),
        [intent({ progress: { completedToday: 1, dueNow: 0, label: "1 completed — nothing due right now." } })],
      ),
    ]);
    render(<TodaySurface />);
    await waitFor(() => {
      expect(screen.getByText("Blood Pressure Systolic")).toBeTruthy();
    });

    // Open the capture flow.
    fireEvent.click(
      screen.getByRole("button", { name: /Complete Blood Pressure Systolic now/ }),
    );

    // Drive the existing flow: choose method, enter values, continue, submit.
    fireEvent.click(screen.getByText("Manual entry — home BP cuff reading", { exact: true }));
    const systolic = screen.getByLabelText(/systolic \(blood pressure systolic\)/i);
    fireEvent.change(systolic, { target: { value: "118" } });
    const diastolic = screen.getByLabelText(/diastolic \(blood pressure diastolic\)/i);
    fireEvent.change(diastolic, { target: { value: "76" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText("Step 3 of 3 — review and save")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Complete", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save measurement" }));

    // The task transition + announcement + provenance affordance land.
    await waitFor(() => {
      expect(
        screen.getByText(/Measurement saved and task completed: Blood Pressure Systolic/),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/1 completed — nothing due right now/)).toBeTruthy();
    });
    const provenanceLink = screen.getByRole("link", {
      name: "View the provenance of this result",
    });
    expect(provenanceLink.getAttribute("href")).toBe(
      "/measurements?observation=obs_SYNTH-obs-000001",
    );
    // The completion POST carried the task id and the capture id.
    const completionCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0] === "/api/today" && call[1]?.method === "POST",
    );
    expect(completionCall).toBeDefined();
    expect((completionCall?.[1]?.body as string | undefined) ?? "").toContain(
      '"taskId":"task_SYNTH-today-bp-000001"',
    );
    expect((completionCall?.[1]?.body as string | undefined) ?? "").toContain(
      '"captureId":"SYNTH-CAP-000001"',
    );
  });

  it("surfaces load failures politely (never assertive)", async () => {
    stubFetchWith([
      new Response(
        JSON.stringify({
          error: { code: "internal-error", message: "An internal error occurred.", requestId: "SYNTH-REQ-000001" },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    ]);
    render(<TodaySurface />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load today's plan/)).toBeTruthy();
    });
  });
});
