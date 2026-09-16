// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TaskCard } from "./task-card";
import type { TodayReminderWire } from "@/lib/reminders/types";
import type { TodayTaskView } from "@/lib/today/types";

/**
 * Measurement task card tests (M6-B B4 + the M6-EXIT journey-#7 chain):
 * the frozen §Measurement task UX contract — every field explicit, every
 * state text-carried (never color alone), the completion affordance
 * announcing the easiest valid route — PLUS the journey-#7 additions:
 * the reminder badge line (the B8 ladder mirror with honest quiet-hours
 * deferral) and the missed-window fallback-offer affordance (the offer
 * as DATA, never an order; "View options" routing to the capture flow).
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

/** A missed-window rung-2 reminder fixture (the wire shape). */
function missedReminder(): TodayReminderWire {
  return {
    reminderId: "remd_SYNTH-today-wt-000003-fallback-offer",
    rung: "REMIND_WITH_FALLBACK_OFFER",
    taskId: "task_SYNTH-today-wt-000003",
    planId: "plan_SYNTH-today-wt-mornings-0003",
    metricId: "SYNTH-metric-body-weight",
    metricLabel: "Body Weight",
    window: {
      sequence: 0,
      startsAt: "2025-09-14T07:00:00.000Z",
      endsAt: "2025-09-14T09:00:00.000Z",
    },
    scheduledAt: "2025-09-14T10:00:00.000Z",
    deliveryState: "delivered",
    reminderLabel: "Reminder sent — fallback options offered",
    detailLabel: "Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00",
    quietHoursLabel: "22:00–07:00",
    fallbackOffer: {
      enforcementAuthority: "none",
      methods: [
        {
          methodId: "SYNTH-method-manual-body-weight",
          methodLabel: "Manual entry — scale reading",
          role: "preferred",
        },
      ],
    },
  };
}

/** A due-window rung-1 reminder fixture with quiet-hours deferral. */
function deferredReminder(): TodayReminderWire {
  return {
    reminderId: "remd_SYNTH-today-hr-000002-remind",
    rung: "REMIND",
    taskId: "task_SYNTH-today-hr-000002",
    planId: "plan_SYNTH-today-hr-daily-0002",
    metricId: "SYNTH-metric-heart-rate",
    metricLabel: "Heart Rate",
    window: {
      sequence: 0,
      startsAt: "2025-09-15T00:00:00.000Z",
      endsAt: "2025-09-15T23:59:59.999Z",
    },
    scheduledAt: "2025-09-16T07:00:00.000Z",
    deliveryState: "scheduled",
    reminderLabel: "Reminder scheduled",
    detailLabel: "Rung REMIND · quiet hours 22:00–07:00 — deferred to 07:00",
    defer: {
      from: "2025-09-15T22:59:59.999Z",
      reason: "quiet-hours",
      label: "deferred to 07:00",
    },
    quietHoursLabel: "22:00–07:00",
  };
}

describe("TaskCard (journey #7: the reminder badge line)", () => {
  it("shows the rung-2 reminder line as TEXT on the missed card", () => {
    render(
      <ul>
        <TaskCard
          task={task({
            taskId: "task_SYNTH-today-wt-000003",
            metricLabel: "Body Weight",
            missedWindow: true,
            dueWindowLabel: "Window missed — was due yesterday at 09:00",
          })}
          reminder={missedReminder()}
        />
      </ul>,
    );
    expect(screen.getByText("Reminder sent — fallback options offered")).toBeTruthy();
    expect(
      screen.getByText("Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00"),
    ).toBeTruthy();
    const line = screen.getByText(/Rung REMIND_WITH_FALLBACK_OFFER/);
    expect(line.getAttribute("data-reminder-rung")).toBe("REMIND_WITH_FALLBACK_OFFER");
  });

  it("shows the rung-1 reminder with the honest quiet-hours deferral", () => {
    render(
      <ul>
        <TaskCard
          task={task({
            taskId: "task_SYNTH-today-hr-000002",
            metricLabel: "Heart Rate",
          })}
          reminder={deferredReminder()}
        />
      </ul>,
    );
    expect(screen.getByText("Reminder scheduled")).toBeTruthy();
    expect(screen.getByText(/Rung REMIND · quiet hours 22:00–07:00 — deferred to 07:00/)).toBeTruthy();
    expect(
      screen.getByText(/deferred to 07:00 \(the reminder is deferred, never dropped\)/),
    ).toBeTruthy();
  });

  it("renders no reminder line when no reminder state is fed", () => {
    render(
      <ul>
        <TaskCard task={task()} />
      </ul>,
    );
    expect(screen.queryByText(/Rung REMIND/)).toBeNull();
    expect(screen.queryByTestId("reminder-line")).toBeNull();
  });
});

describe("TaskCard (journey #7: the fallback offer — DATA, never an order)", () => {
  function missedTask(): TodayTaskView {
    return task({
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
      primaryRouteLabel: "Manual entry — scale reading",
    });
  }

  it("offers 'View options' as an explicit user action (aria-expanded)", () => {
    render(
      <ul>
        <TaskCard task={missedTask()} reminder={missedReminder()} />
      </ul>,
    );
    const toggle = screen.getByRole("button", {
      name: "View fallback options for Body Weight",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("presents the offer framing: methods with roles, authority none, providers", () => {
    render(
      <ul>
        <TaskCard task={missedTask()} reminder={missedReminder()} />
      </ul>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View fallback options for Body Weight" }),
    );
    expect(screen.getByText("Fallback options — offered, never ordered.")).toBeTruthy();
    expect(
      screen.getByText(/Manual entry — scale reading \(preferred, SYNTH-method-manual-body-weight\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Enforcement authority: none — a reminder never orders a provider/),
    ).toBeTruthy();
    expect(screen.getByText(/Provider path: SYNTH-Clinic-A · SYNTH-CHW-2/)).toBeTruthy();
  });

  it("routes the offer to the EXISTING capture flow through 'Capture now'", () => {
    const onComplete = vi.fn();
    render(
      <ul>
        <TaskCard task={missedTask()} reminder={missedReminder()} onComplete={onComplete} />
      </ul>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View fallback options for Body Weight" }),
    );
    const capture = screen.getByRole("button", {
      name: /Capture Body Weight now — Manual entry — scale reading/,
    });
    fireEvent.click(capture);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]?.taskId).toBe("task_SYNTH-today-wt-000003");
  });

  it("shows no offer affordance without a fallback-offer reminder", () => {
    render(
      <ul>
        <TaskCard task={missedTask()} />
      </ul>,
    );
    expect(
      screen.queryByRole("button", { name: /View fallback options/ }),
    ).toBeNull();
  });
});
