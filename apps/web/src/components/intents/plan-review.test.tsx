// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanReview } from "./plan-review";
import type {
  IntentRecordView,
  IntentReviewEntryView,
} from "@/lib/intents/types";

/**
 * Plan review component tests (M6-A): the B3 surface — explainability
 * audit trail, burden summary, safety badges (PASS / ESCALATE with reason
 * codes), dropped-candidate audit, approve-with-edits / reject actions
 * posting to the /api/plans stub, and the aria-live announcements.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const INTENT: IntentRecordView = {
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
};

const CANDIDATE = {
  planId: "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
  state: "draft" as const,
  personId: "prsn_SYNTH-person-0001",
  intentId: "intent_SYNTH-intent-000001",
  metricId: "SYNTH-metric-bp-systolic",
  metricLabel: "Blood Pressure Systolic",
  metrics: ["SYNTH-8480-5"],
  conceptCode: "SYNTH-8480-5",
  methodId: "SYNTH-method-bpsys-manual",
  methodLabel: "Manual entry — home BP cuff reading · Systolic",
  methodKind: "manual" as const,
  methodEvidenceLabel: "MEASURED" as const,
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
      provenanceActorClass: "person" as const,
    },
  ],
  totalObservationCount: 12,
  compiledAt: "2026-09-12T10:00:00.000Z",
};

function reviewWith(overrides: {
  safety?: IntentReviewEntryView["safety"];
  candidate?: IntentReviewEntryView["candidate"];
  dropped?: IntentReviewEntryView["dropped"];
}): IntentReviewEntryView {
  return {
    entryId: "revq_SYNTH-000001",
    intentId: "intent_SYNTH-intent-000001",
    state: "pending",
    enqueuedAt: "2026-09-12T10:00:00.000Z",
    candidate:
      overrides.candidate === undefined ? CANDIDATE : overrides.candidate,
    alternatives: [],
    dropped:
      overrides.dropped === undefined
        ? [
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
          ]
        : overrides.dropped,
    safety:
      overrides.safety === undefined
        ? {
            kind: "PASS",
            requiresHumanReview: false,
            publishable: true,
            reasonCodes: [],
            firedRules: [],
          }
        : overrides.safety,
    burden: {
      methodCount: 1,
      measurementsPerDay: 1,
      burdenUnitsPerDay: 3,
      methodKindWeights: { manual: 3, app: 2, device: 1 },
    },
  };
}

function approveResponse(): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      kind: "approved",
      plan: {
        planId: "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
        personId: "prsn_SYNTH-person-0001",
        intentId: "intent_SYNTH-intent-000001",
        metrics: ["SYNTH-8480-5"],
        metricLabel: "Blood Pressure Systolic",
        methodId: "SYNTH-method-bpsys-manual",
        methodLabel: "Manual entry — home BP cuff reading · Systolic",
        cadencePerDay: 1,
        state: "published",
        publishedAt: "2026-09-12T11:00:00.000Z",
        reviewerNote: "looks right",
      },
      review: { ...reviewWith({}), state: "approved" },
      audit: {
        kind: "approved",
        recordId: "rvar_SYNTH-000002",
        entryId: "revq_SYNTH-000001",
        intentId: "intent_SYNTH-intent-000001",
        at: "2026-09-12T11:00:00.000Z",
        planId: "plan_SYNTH-bp-systolic-bpsys-manual-1x-day",
        fromState: "draft",
        toState: "published",
        originalMetrics: ["SYNTH-8480-5"],
        publishedMetrics: ["SYNTH-8480-5"],
        reviewerNote: "looks right",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function rejectResponse(): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      kind: "rejected",
      review: { ...reviewWith({}), state: "rejected" },
      audit: {
        kind: "rejected",
        recordId: "rvar_SYNTH-000002",
        entryId: "revq_SYNTH-000001",
        intentId: "intent_SYNTH-intent-000001",
        at: "2026-09-12T11:00:00.000Z",
        reason: "not the right cadence for me",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetch(response: Response): { url: string; body: Record<string, unknown> }[] {
  const captured: { url: string; body: Record<string, unknown> }[] = [];
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

describe("plan review", () => {
  it("renders the proposal summary, safety PASS badge, burden, and the audit trail", () => {
    render(
      <PlanReview
        intent={INTENT}
        review={reviewWith({})}
        onActed={vi.fn()}
      />,
    );
    expect(screen.getByText("Review the candidate plan")).toBeTruthy();
    expect(screen.getByText("Safety outcome:")).toBeTruthy();
    expect(screen.getByText("PASS")).toBeTruthy();
    expect(
      screen.getByText(/No safety rule fired — publishable after your review/),
    ).toBeTruthy();
    expect(screen.getByText("Burden summary")).toBeTruthy();
    expect(screen.getByText(/3 units\/day/)).toBeTruthy();

    // Explainability audit trail (the M5 shape as Timeline entries).
    expect(screen.getByText("Why this plan (audit trail)")).toBeTruthy();
    expect(screen.getByText("Pack v1 — evpk_SYNTH-pack-0001")).toBeTruthy();
    expect(
      screen.getByText("12 observations via SYNTH-method-bpsys-manual"),
    ).toBeTruthy();
    expect(
      screen.getByText(/actor class person · entry evpe_SYNTH-bp-systolic-bpsys-v1/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Manual entry — home BP cuff reading · Systolic (SYNTH-method-bpsys-manual)",
      ),
    ).toBeTruthy();
    expect(screen.getByText("12 backing observations")).toBeTruthy();
    expect(
      screen.getByText("Draft plan awaits your decision"),
    ).toBeTruthy();

    // Dropped-candidate audit (the A40 no-source drop).
    expect(screen.getByText("Dropped by the matcher")).toBeTruthy();
    expect(screen.getByText(/Automatic cuff sync — no-source/)).toBeTruthy();
  });

  it("renders ESCALATE with reason codes and the human-review note", () => {
    render(
      <PlanReview
        intent={INTENT}
        review={reviewWith({
          safety: {
            kind: "ESCALATE",
            requiresHumanReview: true,
            publishable: false,
            reasonCodes: ["cadence-below-floor"],
            firedRules: [
              {
                ruleId: "safety/cadence-floor/vital-signs/v1",
                ruleKind: "cadence-floor",
                code: "cadence-below-floor",
                onViolation: "escalate",
                inputsSummary:
                  "Proposed cadence for SYNTH-metric-bp-systolic is below the vital-signs domain floor (measurements per day).",
              },
            ],
          },
        })}
        onActed={vi.fn()}
      />,
    );
    expect(screen.getByText("ESCALATE")).toBeTruthy();
    expect(screen.getByText("Reason code: cadence-below-floor")).toBeTruthy();
    expect(
      screen.getByText(/Rule safety\/cadence-floor\/vital-signs\/v1/),
    ).toBeTruthy();
    expect(
      screen.getByText(/An ESCALATE verdict requires human review/),
    ).toBeTruthy();
  });

  it("renders the honest empty state when no executable candidate exists", () => {
    render(
      <PlanReview
        intent={INTENT}
        review={reviewWith({
          candidate: null,
          safety: null,
          dropped: [
            {
              metricId: "SYNTH-metric-sleep-minutes",
              metricLabel: "Sleep Duration",
              methodId: "SYNTH-method-wearable-sleep-minutes",
              methodLabel: "Wearable derivation",
              methodKind: "device",
              reason: "no-source",
              detail: "No active registered source backs this method yet.",
            },
          ],
        })}
        onActed={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/No executable candidate plan was produced/),
    ).toBeTruthy();
    expect(screen.getByText(/Wearable derivation — dropped \(no-source\)/)).toBeTruthy();
    // Approve is impossible; reject stays available.
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Reject plan" })).toBeTruthy();
  });

  it("posts approve-with-edits with the note and fires onActed with the published plan", async () => {
    const onActed = vi.fn();
    const captured = stubFetch(approveResponse());
    render(
      <PlanReview intent={INTENT} review={reviewWith({})} onActed={onActed} />,
    );

    // Open the edit panel and add a reviewer note.
    fireEvent.click(
      screen.getByRole("button", { name: /adjust the plan before approving/i }),
    );
    fireEvent.change(screen.getByLabelText(/reviewer note \(optional\)/i), {
      target: { value: "looks right" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));

    await waitFor(() => {
      expect(onActed).toHaveBeenCalledTimes(1);
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("/api/plans");
    expect(captured[0]?.body).toEqual({
      action: "approve-with-edits",
      entryId: "revq_SYNTH-000001",
      edits: { note: "looks right" },
    });
    const payload = onActed.mock.calls[0]?.[0] as { kind: string };
    expect(payload.kind).toBe("approved");

    // The aria-live announcement reflects the approval.
    expect(
      screen.getByText(/Candidate plan approved — published to your plan store/),
    ).toBeTruthy();
  });

  it("posts concept-code edits (codes changed ride the command)", async () => {
    const captured = stubFetch(approveResponse());
    render(
      <PlanReview intent={INTENT} review={reviewWith({})} onActed={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /adjust the plan before approving/i }),
    );
    // Widen the committed codes (Heart Rate code added).
    fireEvent.click(
      screen.getByRole("checkbox", { name: /SYNTH-8867-4 — Heart Rate/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));
    await waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    expect(captured[0]?.body).toEqual({
      action: "approve-with-edits",
      entryId: "revq_SYNTH-000001",
      edits: { metrics: ["SYNTH-8480-5", "SYNTH-8867-4"] },
    });
  });

  it("blocks approval with zero committed codes (validation error)", () => {
    render(
      <PlanReview intent={INTENT} review={reviewWith({})} onActed={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /adjust the plan before approving/i }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /SYNTH-8480-5 — Blood Pressure Systolic/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));
    expect(
      screen.getByText("Keep at least one committed concept code."),
    ).toBeTruthy();
  });

  it("rejects with a required reason and fires onActed with the terminal state", async () => {
    const onActed = vi.fn();
    const captured = stubFetch(rejectResponse());
    render(
      <PlanReview intent={INTENT} review={reviewWith({})} onActed={onActed} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject plan" }));
    // Reason is required first.
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(screen.getByText("A rejection reason is required.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/why are you rejecting this plan\?/i), {
      target: { value: "not the right cadence for me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));

    await waitFor(() => {
      expect(onActed).toHaveBeenCalledTimes(1);
    });
    expect(captured[0]?.body).toEqual({
      action: "reject",
      entryId: "revq_SYNTH-000001",
      reason: "not the right cadence for me",
    });
    const payload = onActed.mock.calls[0]?.[0] as { kind: string };
    expect(payload.kind).toBe("rejected");
    expect(
      screen.getByText(/Candidate plan rejected — the review entry is closed/),
    ).toBeTruthy();
  });

  it("surfaces refusal envelopes (entry already acted on) in the live region", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          error: {
            code: "validation-failed",
            message: "The plan review action was refused.",
            details: {
              issues: [
                {
                  field: "entryId",
                  problem: "This review entry was already acted on (terminal).",
                },
              ],
            },
            requestId: "SYNTH-REQ-000009",
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    render(
      <PlanReview intent={INTENT} review={reviewWith({})} onActed={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Could not apply the review action: The plan review action was refused.",
        ),
      ).toBeTruthy();
    });
  });
});
