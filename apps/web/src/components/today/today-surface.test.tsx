// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** A rung-2 (missed) reminder fixture for the weight task. */
function weightReminder() {
  return {
    reminderId: "remd_SYNTH-today-wt-000003-fallback-offer",
    rung: "REMIND_WITH_FALLBACK_OFFER" as const,
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
    deliveryState: "delivered" as const,
    reminderLabel: "Reminder sent — fallback options offered",
    detailLabel: "Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00",
    quietHoursLabel: "22:00–07:00",
    fallbackOffer: {
      enforcementAuthority: "none" as const,
      methods: [
        {
          methodId: "SYNTH-method-manual-body-weight",
          methodLabel: "Manual entry — scale reading",
          role: "preferred" as const,
        },
      ],
    },
  };
}

/** A rung-1 (due) reminder fixture with the honest quiet-hours deferral. */
function bpReminder() {
  return {
    reminderId: "remd_SYNTH-today-bp-000001-remind",
    rung: "REMIND" as const,
    taskId: "task_SYNTH-today-bp-000001",
    planId: "plan_SYNTH-today-bp-daily-0001",
    metricId: "SYNTH-metric-bp-systolic",
    metricLabel: "Blood Pressure Systolic",
    window: {
      sequence: 0,
      startsAt: "2025-09-15T00:00:00.000Z",
      endsAt: "2025-09-15T23:59:59.999Z",
    },
    scheduledAt: "2025-09-16T07:00:00.000Z",
    deliveryState: "scheduled" as const,
    reminderLabel: "Reminder scheduled",
    detailLabel: "Rung REMIND · quiet hours 22:00–07:00 — deferred to 07:00",
    defer: {
      from: "2025-09-15T22:59:59.999Z",
      reason: "quiet-hours" as const,
      label: "deferred to 07:00",
    },
    quietHoursLabel: "22:00–07:00",
  };
}

/** The default observe-only posture fixture. */
function defaultPosturePayload() {
  return {
    variant: "observe-only" as const,
    variantLabel: "Restriction posture: observe-only (the default)",
    defaultLine:
      "No restrictions are configured — nothing happens when you miss a measurement.",
    summaryLine:
      "Missing a measurement records adherence state and nothing else.",
    decision: {
      kind: "no-enforcement" as const,
      reason: "no-policy",
      decisionLabel: "Observe-only — nothing restrictive happens",
      evaluation: {
        taskId: "task_SYNTH-today-wt-000003",
        state: "missed",
        reason: "window-elapsed",
        evaluatedAtIso: "2025-09-14T10:00:00.000Z",
        auditSteps: [
          { step: "task-state", detail: "open" },
          { step: "window-elapsed-check", detail: "endsAt<=now" },
        ],
      },
      auditSteps: [{ step: "policy-resolution", detail: "absent:policy" }],
    },
  };
}

/** The configured-policy fixture variant payload. */
function configuredVariantPayload() {
  return {
    variant: "configured-policy" as const,
    variantLabel: "Restriction posture: configured policy (SYNTH fixture variant)",
    defaultLine:
      "SYNTH fixture variant — demonstrates the vocabulary only. No policy is configured for you.",
    summaryLine: "What the posture looks like when every gate passes.",
    decision: {
      kind: "restriction-authorized" as const,
      decisionLabel:
        "Restriction authorized — under an explicit, authorized, configured policy only",
      evaluation: {
        taskId: "task_SYNTH-today-wt-000003",
        state: "missed",
        reason: "window-elapsed",
        evaluatedAtIso: "2025-09-14T10:00:00.000Z",
        auditSteps: [{ step: "task-state", detail: "open" }],
      },
      restriction: {
        kind: "orbb/adherence/restriction-decision/v1",
        decisionId: "SYNTH-DECISION-evening-focus-wt-0001",
        policyId: "SYNTH-policy-evening-focus-0001",
        policyVersion: 1,
        capability: "ios-focus",
        authorization: {
          permission: "adherence:restrict:ios-focus",
          verifiedAtIso: "2025-09-14T10:00:00.000Z",
        },
        scope: {
          personId: "prsn_SYNTH-person-0001",
          planId: "plan_SYNTH-today-wt-mornings-0003",
          metricId: "SYNTH-metric-body-weight",
        },
        detection: { state: "available" },
        decidedAtIso: "2025-09-14T10:00:00.000Z",
        expiresAtIso: "2025-09-14T12:00:00.000Z",
      },
      auditSteps: [
        { step: "policy-resolution", detail: "SYNTH-policy-evening-focus-0001:v1:ios-focus" },
        { step: "trigger-evaluation", detail: "state=missed" },
        { step: "scope-check", detail: "in-scope" },
        { step: "authorization-gate", detail: "authorized" },
        { step: "capability-detection", detail: "state=available" },
        { step: "restriction-authorized", detail: "ios-focus" },
      ],
    },
    policy: {
      policyId: "SYNTH-policy-evening-focus-0001",
      version: 1,
      capability: "ios-focus",
      capabilityLabel: "iOS Focus (SYNTH OS seam)",
      triggerOn: "missed" as const,
      authorization: {
        permissions: ["adherence:restrict:ios-focus"],
        grantId: "grant_SYNTH-adherence-demo-0001",
      },
      scope: {
        personIds: ["prsn_SYNTH-person-0001"],
        planIds: ["plan_SYNTH-today-wt-mornings-0003"],
        metricIds: ["SYNTH-metric-body-weight"],
      },
      restriction: { durationMs: 7_200_000 },
      durationLabel: "2 hours (bounded — restrictions are at most 24 hours)",
    },
  };
}

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

/**
 * URL-aware fetch stub: the journey-#7 chain routes (`/api/today/reminders`,
 * `/api/today/adherence`) serve their fixture payloads; every other URL
 * consumes the sequenced responses exactly like the original stub (the
 * today board GET + the capture/complete POSTs).
 */
function stubFetchWith(
  responses: Response[],
  chain: {
    reminders?: Response;
    adherence?: Response;
  } = {},
): ReturnType<typeof vi.fn<FetchLike>> {
  let call = 0;
  const fetchMock = vi.fn<FetchLike>(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === "/api/today/reminders") {
      return (
        chain.reminders ??
        new Response(
          JSON.stringify({
            synthetic: true,
            personId: "prsn_SYNTH-person-0001",
            reminders: [],
            quietHoursLabel: "22:00–07:00",
            generatedAt: "2025-09-15T14:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      );
    }
    if (url === "/api/today/adherence") {
      return (
        chain.adherence ??
        new Response(
          JSON.stringify({
            synthetic: true,
            personId: "prsn_SYNTH-person-0001",
            posture: defaultPosturePayload(),
            fixtureVariant: configuredVariantPayload(),
            generatedAt: "2025-09-15T14:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      );
    }
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

  it("degrades gracefully when the reminder chain read fails (task board unaffected)", async () => {
    stubFetchWith([listResponse([task()], [intent()])], {
      reminders: new Response(JSON.stringify({ synthetic: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });
    render(<TodaySurface />);
    await waitFor(() => {
      expect(screen.getByText("Blood Pressure Systolic")).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByText(/Reminder state could not be loaded — the task list is unaffected/),
      ).toBeTruthy();
    });
    // The task board still renders its cards.
    expect(screen.getByText("Due by end of today")).toBeTruthy();
  });

  it("renders the journey-#7 chain: reminders, fallback offer, and the posture surface", async () => {
    const missed = task({
      taskId: "task_SYNTH-today-wt-000003",
      planId: "plan_SYNTH-today-wt-mornings-0003",
      metricLabel: "Body Weight",
      missedWindow: true,
      dueWindowLabel: "Window missed — was due yesterday at 09:00",
    });
    stubFetchWith([listResponse([task(), missed], [intent()])], {
      reminders: new Response(
        JSON.stringify({
          synthetic: true,
          personId: "prsn_SYNTH-person-0001",
          reminders: [weightReminder(), bpReminder()],
          quietHoursLabel: "22:00–07:00",
          generatedAt: "2025-09-15T14:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });
    render(<TodaySurface />);
    await waitFor(() => {
      expect(screen.getByText("What you are working toward")).toBeTruthy();
    });

    // The missed card carries the rung-2 reminder line + offer affordance.
    const missedCard = screen
      .getByText("Window missed", { exact: true })
      .closest("li");
    expect(missedCard).toBeTruthy();
    expect(
      within(missedCard as HTMLElement).getByText(
        "Reminder sent — fallback options offered",
      ),
    ).toBeTruthy();
    expect(
      within(missedCard as HTMLElement).getByText(
        "Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00",
      ),
    ).toBeTruthy();

    // The due card carries the rung-1 reminder with the honest deferral.
    expect(screen.getByText("Reminder scheduled")).toBeTruthy();
    expect(
      screen.getByText(/Rung REMIND · quiet hours 22:00–07:00 — deferred to 07:00/),
    ).toBeTruthy();

    // The restriction-posture surface mounts with the loudest default truth.
    expect(
      screen.getByText(
        "No restrictions are configured — nothing happens when you miss a measurement.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Restriction posture: observe-only (the default)")).toBeTruthy();

    // The configured-policy fixture variant sits behind its disclosure.
    const variantToggle = screen.getByRole("button", {
      name: "View the configured-policy fixture variant (SYNTH)",
    });
    expect(variantToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(variantToggle);
    expect(screen.getByText("The configured policy (every field)")).toBeTruthy();
    expect(
      screen.getByText(/Decision: restriction-authorized — Restriction authorized/),
    ).toBeTruthy();
  });
});
