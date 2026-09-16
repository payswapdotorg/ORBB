// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TaskCard } from "./task-card";
import type { TodayTaskView } from "@/lib/today/types";

/**
 * Measurement task card tests (M6-B B4): the frozen §Measurement task UX
 * contract — every field explicit, every state text-carried (never color
 * alone), the completion affordance announcing the easiest valid route.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
        methodId: "SYNTH-method-cuff-bp-panel",
        label: "Automatic cuff sync",
        kind: "device",
        relativeBurden: 1,
        estimatedEffortLabel: "automatic — ~0 min",
        privacyImpactLabel: "Private — syncs from the cuff to your DataBox only.",
        availability: "not-connected",
        availabilityNote: "Device seam — not connected yet.",
      },
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
    methodCountLabel: "2 methods available",
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

describe("TaskCard (§Measurement task UX contract)", () => {
  it("renders every card field: metric, due window, reason, methods, effort, privacy, fallback", () => {
    render(
      <ul>
        <TaskCard task={task()} />
      </ul>,
    );
    expect(screen.getByText("Blood Pressure Systolic")).toBeTruthy();
    expect(screen.getByText("Due by end of today")).toBeTruthy();
    expect(screen.getByText(/Supports "Lower blood pressure/)).toBeTruthy();
    expect(screen.getByText("2 methods available — least burden first:")).toBeTruthy();
    expect(screen.getByText(/Automatic cuff sync · automatic — ~0 min · not connected yet/)).toBeTruthy();
    expect(screen.getByText(/Manual entry — home BP cuff reading · ~2 min · available/)).toBeTruthy();
    expect(screen.getByText("Estimated effort")).toBeTruthy();
    expect(screen.getByText("Privacy impact")).toBeTruthy();
    expect(screen.getByText("Clinic/CHW fallback")).toBeTruthy();
    expect(screen.getByText("Providers: SYNTH-Clinic-A · SYNTH-CHW-2")).toBeTruthy();
    expect(screen.getByText("A provider can capture this for you.")).toBeTruthy();
  });

  it("carries the due state as TEXT, never color alone", () => {
    render(
      <ul>
        <TaskCard task={task()} />
      </ul>,
    );
    expect(screen.getByText("Due", { exact: true })).toBeTruthy();
  });

  it("marks missed windows explicitly and suggests the fallback", () => {
    render(
      <ul>
        <TaskCard
          task={task({
            taskId: "task_SYNTH-today-wt-000003",
            metricLabel: "Body Weight",
            missedWindow: true,
            dueWindowLabel: "Window missed — was due yesterday at 09:00",
            methods: [
              {
                methodId: "SYNTH-method-manual-body-weight",
                label: "Manual entry — scale reading",
                kind: "manual",
                relativeBurden: 3,
                estimatedEffortLabel: "~1 min",
                privacyImpactLabel: "Private.",
                availability: "available",
                availabilityNote: "Available now.",
              },
            ],
            methodCountLabel: "1 method available",
          })}
        />
      </ul>,
    );
    expect(screen.getByText("Window missed", { exact: true })).toBeTruthy();
    expect(screen.getByText("Window missed — was due yesterday at 09:00")).toBeTruthy();
    expect(screen.getByText("Clinic/CHW fallback — suggested for missed windows")).toBeTruthy();
  });

  it("announces the easiest valid route in the completion affordance's label", () => {
    const onComplete = vi.fn();
    render(
      <ul>
        <TaskCard task={task()} onComplete={onComplete} />
      </ul>,
    );
    const button = screen.getByRole("button", {
      name: /Complete Blood Pressure Systolic now — Manual entry — home BP cuff reading, ~2 min/,
    });
    fireEvent.click(button);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]?.taskId).toBe("task_SYNTH-today-bp-000001");
  });

  it("shows the completed state with the capture link and no completion button", () => {
    render(
      <ul>
        <TaskCard
          task={task({
            state: "completed",
            completion: {
              captureId: "SYNTH-CAP-000001",
              observationIds: ["obs_SYNTH-obs-000001", "obs_SYNTH-obs-000002"],
              completedAt: "2025-09-15T07:12:00.000Z",
            },
          })}
        />
      </ul>,
    );
    expect(screen.getByText("Completed", { exact: true })).toBeTruthy();
    expect(screen.getByText(/Completed through capture SYNTH-CAP-000001/)).toBeTruthy();
    expect(screen.getByText(/2 observations with full provenance/)).toBeTruthy();
    expect(screen.getByText(/Nothing more due for this task right now/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Complete now/ })).toBeNull();
  });
});
