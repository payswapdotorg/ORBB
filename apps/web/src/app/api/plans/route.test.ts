// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { createIntentRecord, resetIntentStore } from "@/lib/intents/store";

/**
 * Route contract tests (M6-A): the `/api/plans` stub applies typed
 * reviewer acts — approve-with-edits lands the plan in the published store
 * ONLY through the domain-transition mirror, reject is terminal, repeated
 * acts and unknown entries are refused with the error envelope, and GET
 * exposes the published store + pending reviews + audit trail.
 */

afterEach(() => {
  resetIntentStore();
});

const NOW = new Date("2026-09-12T10:00:00.000Z");

function seedPendingEntry(cadencePerDay = 1): string {
  const stored = createIntentRecord({
    draftId: "SYNTH-DRAFT-seed-0001",
    goal: {
      metricId: "SYNTH-metric-bp-systolic",
      direction: "decrease",
      target: 120,
    },
    constraints: { cadencePerDay, methodPreference: "any" },
    now: NOW,
  });
  return stored.review.entry.entryId;
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/plans", () => {
  it("approves with edits and returns the published plan + audit record", async () => {
    const entryId = seedPendingEntry();
    const response = await POST(
      jsonRequest({
        action: "approve-with-edits",
        entryId,
        edits: { note: "approved after review" },
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      synthetic: boolean;
      kind: string;
      plan: { state: string; planId: string; reviewerNote?: string };
      review: { state: string };
      audit: { kind: string; fromState: string; toState: string };
    };
    expect(payload.kind).toBe("approved");
    expect(payload.plan.state).toBe("published");
    expect(payload.plan.reviewerNote).toBe("approved after review");
    expect(payload.review.state).toBe("approved");
    expect(payload.audit.fromState).toBe("draft");
    expect(payload.audit.toState).toBe("published");
  });

  it("refuses a repeated act on an approved entry (entry-not-pending)", async () => {
    const entryId = seedPendingEntry();
    await POST(
      jsonRequest({ action: "approve-with-edits", entryId }),
    );
    const response = await POST(
      jsonRequest({ action: "approve-with-edits", entryId }),
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { code: string; details?: { issues: { problem: string }[] } };
    };
    expect(payload.error.code).toBe("validation-failed");
    expect(payload.error.details?.issues[0]?.problem).toContain("already acted on");
  });

  it("refuses unknown entries with the typed problem (no values echoed)", async () => {
    const response = await POST(
      jsonRequest({
        action: "reject",
        entryId: "revq_SYNTH-999999",
        reason: "not my plan",
      }),
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { details?: { issues: { problem: string }[] } };
    };
    expect(payload.error.details?.issues[0]?.problem).toContain("No pending review entry");
  });

  it("rejects terminally and records the reason in the audit", async () => {
    const entryId = seedPendingEntry();
    const response = await POST(
      jsonRequest({
        action: "reject",
        entryId,
        reason: "cadence does not fit my mornings",
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      kind: string;
      review: { state: string };
      audit: { kind: string; reason: string };
    };
    expect(payload.kind).toBe("rejected");
    expect(payload.review.state).toBe("rejected");
    expect(payload.audit.reason).toBe("cadence does not fit my mornings");
  });

  it("refuses approve-with-edits when the entry proposed no executable plan", async () => {
    const stored = createIntentRecord({
      draftId: "SYNTH-DRAFT-seed-0002",
      goal: {
        metricId: "SYNTH-metric-sleep-minutes",
        direction: "increase",
        target: 480,
      },
      constraints: { cadencePerDay: 1, methodPreference: "measured-only" },
      now: NOW,
    });
    const response = await POST(
      jsonRequest({
        action: "approve-with-edits",
        entryId: stored.review.entry.entryId,
      }),
    );
    expect(response.status).toBe(422);
  });

  it("rejects unparseable JSON with a 400 invalid-request envelope", async () => {
    const response = await POST(jsonRequest("{not json"));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid-request");
  });

  it("rejects a reject act without a reason (422 with field issue)", async () => {
    const entryId = seedPendingEntry();
    const response = await POST(
      jsonRequest({ action: "reject", entryId, reason: "" }),
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { details?: { issues: { field: string }[] } };
    };
    expect(payload.error.details?.issues[0]?.field).toBe("reason");
  });
});

describe("GET /api/plans", () => {
  it("lists the published store, pending reviews, and the audit trail", async () => {
    const entryId = seedPendingEntry();
    seedSecondPending();
    await POST(
      jsonRequest({ action: "approve-with-edits", entryId, edits: { note: "ok" } }),
    );

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      synthetic: boolean;
      personId: string;
      published: { planId: string; state: string }[];
      pending: { entryId: string }[];
      audit: { kind: string }[];
    };
    expect(payload.synthetic).toBe(true);
    expect(payload.published).toHaveLength(1);
    expect(payload.published[0]?.state).toBe("published");
    expect(payload.pending).toHaveLength(1);
    // enqueued x2 + approved = 3 audit records in order.
    expect(payload.audit.map((record) => record.kind)).toEqual([
      "enqueued",
      "enqueued",
      "approved",
    ]);
  });
});

function seedSecondPending(): string {
  const stored = createIntentRecord({
    draftId: "SYNTH-DRAFT-seed-0003",
    goal: {
      metricId: "SYNTH-metric-heart-rate",
      direction: "decrease",
      target: 60,
    },
    constraints: { cadencePerDay: 1, methodPreference: "any" },
    now: NOW,
  });
  return stored.review.entry.entryId;
}
