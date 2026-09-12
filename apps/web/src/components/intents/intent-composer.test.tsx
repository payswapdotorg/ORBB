// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IntentComposer } from "./intent-composer";
import {
  clearOnboardingDraft,
} from "@/lib/onboarding/model";
import type { IntentRecordView, IntentReviewEntryView } from "@/lib/intents/types";

/**
 * Intent composer component tests (M6-A): the guided three-step flow —
 * goal (metric/direction/target), constraints (cadence/preference) with
 * the EvidencePack coverage badges, review + submit to the /api/intents
 * stub (idempotent draft id rides every POST), error-envelope handling.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearOnboardingDraft();
});

/** The fetch signature the composer relies on. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function createSuccessfulResponse(): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      intent: {
        intentId: "intent_SYNTH-intent-000001",
        draftId: "SYNTH-DRAFT-unit-0001",
        personId: "prsn_SYNTH-person-0001",
        objective: "Lower Blood Pressure Systolic toward 120 mmHg.",
        goal: {
          metricId: "SYNTH-metric-bp-systolic",
          direction: "decrease",
          target: 120,
        },
        constraints: { cadencePerDay: 1, methodPreference: "any" },
        evidencePackVersion: 1,
        createdAt: "2026-09-12T10:00:00.000Z",
      },
      review: {
        entryId: "revq_SYNTH-000001",
        intentId: "intent_SYNTH-intent-000001",
        state: "pending",
        enqueuedAt: "2026-09-12T10:00:00.000Z",
        candidate: {
          planId: "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
          state: "draft",
          personId: "prsn_SYNTH-person-0001",
          intentId: "intent_SYNTH-intent-000001",
          metricId: "SYNTH-metric-bp-systolic",
          metricLabel: "Blood Pressure Systolic",
          metrics: ["SYNTH-8480-5"],
          conceptCode: "SYNTH-8480-5",
          methodId: "SYNTH-method-bpsys-manual",
          methodLabel: "Manual entry — home BP cuff reading · Systolic",
          methodKind: "manual",
          methodEvidenceLabel: "MEASURED",
          methodRelativeBurden: 3,
          cadencePerDay: 1,
          pack: {
            packId: "evpk_SYNTH-pack-0001",
            version: 1,
            contentHash: "sha256-SYNTH-pack-v1-4d1f0a2b",
          },
          contributingEntries: [
            {
              entryId: "evpe_SYNTH-bp-systolic-bpsys-v1",
              methodId: "SYNTH-method-bpsys-manual",
              windowStart: "2026-08-13T10:00:00.000Z",
              windowEnd: "2026-09-12T10:00:00.000Z",
              count: 12,
              provenanceActorClass: "person",
            },
          ],
          totalObservationCount: 12,
          compiledAt: "2026-09-12T10:00:00.000Z",
        },
        alternatives: [],
        dropped: [
          {
            metricId: "SYNTH-metric-bp-systolic",
            metricLabel: "Blood Pressure Systolic",
            methodId: "SYNTH-method-cuff-bp-panel",
            methodLabel: "Automatic cuff sync",
            methodKind: "device",
            reason: "no-source",
            detail:
              "No active registered source backs this method yet (the device/app seam is display-only at this milestone).",
          },
        ],
        safety: {
          kind: "PASS",
          requiresHumanReview: false,
          publishable: true,
          reasonCodes: [],
          firedRules: [],
        },
        burden: {
          methodCount: 1,
          measurementsPerDay: 1,
          burdenUnitsPerDay: 3,
          methodKindWeights: { manual: 3, app: 2, device: 1 },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function createErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "validation-failed",
        message: "The intent submission failed validation.",
        details: {
          issues: [{ field: "goal.target", problem: "Goal target must stay within the metric guards (in mmHg)." }],
        },
        requestId: "SYNTH-REQ-000001",
      },
    }),
    { status: 422, headers: { "content-type": "application/json" } },
  );
}

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function stubFetch(response: Response): CapturedCall[] {
  const captured: CapturedCall[] = [];
  const fetchMock = vi.fn<FetchLike>(async (input, init) => {
    captured.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return captured;
}

function driveToReviewStep(): void {
  fireEvent.click(
    screen.getByRole("radio", { name: /blood pressure systolic/i }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Lower" }));
  fireEvent.change(screen.getByLabelText(/target \(blood pressure systolic\)/i), {
    target: { value: "120" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(
    screen.getByRole("radio", { name: /daily/i }),
  );
  fireEvent.click(
    screen.getByRole("radio", { name: /any available method/i }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("intent composer", () => {
  it("renders step 1 with the goal pickers and step announcement", () => {
    render(<IntentComposer onCreated={vi.fn()} />);
    expect(screen.getByText("Create a health intent")).toBeTruthy();
    expect(screen.getByText("Step 1 of 3 — choose your goal")).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: /which metric is this intent about\?/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: /which direction should the metric move\?/i }),
    ).toBeTruthy();
  });

  it("blocks step-1 continuation without choices (metric + direction errors)", () => {
    render(<IntentComposer onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose a metric to continue.")).toBeTruthy();
    expect(screen.getByText("Choose a direction to continue.")).toBeTruthy();
    // No metric chosen -> no target field rendered -> no target error yet.
    expect(screen.queryByText("Enter a target value before continuing.")).toBeNull();
  });

  it("blocks step-1 continuation without a target once the metric is chosen", () => {
    render(<IntentComposer onCreated={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("radio", { name: /blood pressure systolic/i }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Lower" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByText("Enter a target value before continuing."),
    ).toBeTruthy();
  });

  it("renders the evidence pack coverage badges on the constraint step", async () => {
    render(<IntentComposer onCreated={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("radio", { name: /blood pressure systolic/i }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Lower" }));
    fireEvent.change(screen.getByLabelText(/target \(blood pressure systolic\)/i), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Your evidence pack")).toBeTruthy();
    });
    // Coverage badges per metric/method: counts + evidence label + actor class.
    expect(screen.getAllByText("12 obs · MEASURED").length).toBe(2); // systolic + diastolic manual
    expect(screen.getByText("20 obs · MEASURED")).toBeTruthy();
    expect(screen.getAllByText("actor: person").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("actor: device").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/sha256-SYNTH-pack-v1/)).toBeTruthy();
  });

  it("submits the validated draft with the idempotency key and hands the review to the parent", async () => {
    const onCreated = vi.fn();
    const captured = stubFetch(createSuccessfulResponse());
    render(<IntentComposer onCreated={onCreated} />);

    driveToReviewStep();
    expect(screen.getByText("Step 3 of 3 — review and submit")).toBeTruthy();
    expect(
      screen.getByText(/SYNTH-DRAFT-/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Submit intent" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("/api/intents");
    const body = captured[0]?.body;
    expect(body?.draftId).toMatch(/^SYNTH-DRAFT-/);
    expect(body?.goal).toEqual({
      metricId: "SYNTH-metric-bp-systolic",
      direction: "decrease",
      target: 120,
    });
    expect(body?.constraints).toEqual({ cadencePerDay: 1, methodPreference: "any" });
    const payload = onCreated.mock.calls[0]?.[0] as {
      intent: IntentRecordView;
      review: IntentReviewEntryView;
    };
    expect(payload.intent.intentId).toBe("intent_SYNTH-intent-000001");
    expect(payload.review.candidate?.planId).toBe(
      "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
    );
  });

  it("surfaces error-envelope rejections in the polite live region", async () => {
    stubFetch(createErrorResponse());
    render(<IntentComposer onCreated={vi.fn()} />);
    driveToReviewStep();
    fireEvent.click(screen.getByRole("button", { name: "Submit intent" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Could not create the intent: The intent submission failed validation.",
        ),
      ).toBeTruthy();
    });
  });

  it("reports network failures without crashing the journey", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<IntentComposer onCreated={vi.fn()} />);
    driveToReviewStep();
    fireEvent.click(screen.getByRole("button", { name: "Submit intent" }));
    await waitFor(() => {
      expect(
        screen.getByText("Could not create the intent: network error."),
      ).toBeTruthy();
    });
  });
});
