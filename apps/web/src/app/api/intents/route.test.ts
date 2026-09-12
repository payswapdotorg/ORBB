// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { resetIntentStore } from "@/lib/intents/store";

/**
 * Route contract tests (M6-A): the `/api/intents` stub enforces the
 * error-envelope style (typed codes, PHI-safe messages, field-level
 * issues), stores valid submissions idempotently by client draft id, and
 * lists them person-scoped.
 */

afterEach(() => {
  resetIntentStore();
});

const VALID_BODY = {
  draftId: "SYNTH-DRAFT-test-0001",
  goal: { metricId: "SYNTH-metric-bp-systolic", direction: "decrease", target: 120 },
  constraints: { cadencePerDay: 1, methodPreference: "any" },
};

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/intents", () => {
  it("compiles a valid submission into an intent + pending review entry", async () => {
    const response = await POST(jsonRequest(VALID_BODY));
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    const record = payload as Record<string, unknown>;
    expect(record.synthetic).toBe(true);
    const intent = record.intent as Record<string, unknown>;
    expect(intent.intentId).toBe("intent_SYNTH-intent-000001");
    expect(intent.personId).toBe("prsn_SYNTH-person-0001");
    expect(intent.objective).toBe(
      "Lower Blood Pressure Systolic toward 120 mmHg.",
    );
    const review = record.review as Record<string, unknown>;
    expect(review.entryId).toBe("revq_SYNTH-000001");
    expect(review.state).toBe("pending");
    const candidate = review.candidate as Record<string, unknown>;
    expect(candidate.state).toBe("draft");
    expect(candidate.methodId).toBe("SYNTH-method-bpsys-manual");
    const safety = review.safety as Record<string, unknown>;
    expect(safety.kind).toBe("PASS");
  });

  it("replays the SAME response for a repeated draft id (idempotency)", async () => {
    const first = await POST(jsonRequest(VALID_BODY));
    const firstPayload = await first.json();
    const second = await POST(jsonRequest(VALID_BODY));
    const secondPayload = await second.json();
    expect(second.status).toBe(200);
    expect(secondPayload).toEqual(firstPayload);

    // The intent list still holds exactly one intent.
    const list = await GET();
    const listPayload = (await list.json()) as {
      intents: unknown[];
    };
    expect(listPayload.intents).toHaveLength(1);
  });

  it("carries weekly-cadence safety outcomes as ESCALATE with reason codes", async () => {
    const response = await POST(
      jsonRequest({
        ...VALID_BODY,
        draftId: "SYNTH-DRAFT-test-0002",
        constraints: { cadencePerDay: 1 / 7, methodPreference: "any" },
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      review: { safety: { kind: string; reasonCodes: string[] } };
    };
    expect(payload.review.safety.kind).toBe("ESCALATE");
    expect(payload.review.safety.reasonCodes).toEqual(["cadence-below-floor"]);
  });

  it("rejects unparseable JSON with a 400 invalid-request envelope", async () => {
    const response = await POST(jsonRequest("{not json"));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: Record<string, unknown> };
    expect(payload.error.code).toBe("invalid-request");
    expect(String(payload.error.requestId).startsWith("SYNTH-REQ-")).toBe(true);
  });

  it("rejects contract violations with a 422 validation-failed envelope and typed issues", async () => {
    const response = await POST(
      jsonRequest({
        ...VALID_BODY,
        goal: { metricId: "SYNTH-metric-unknown", direction: "sideways", target: 120 },
      }),
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { code: string; message: string; details?: { issues: { field: string }[] } };
    };
    expect(payload.error.code).toBe("validation-failed");
    expect(
      payload.error.details?.issues.map((issue) => issue.field),
    ).toContain("goal.metricId");
  });

  it("echoes the honest empty state when no executable candidate exists", async () => {
    const response = await POST(
      jsonRequest({
        draftId: "SYNTH-DRAFT-test-0003",
        goal: {
          metricId: "SYNTH-metric-sleep-minutes",
          direction: "increase",
          target: 480,
        },
        constraints: { cadencePerDay: 1, methodPreference: "measured-only" },
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      review: {
        candidate: null;
        dropped: { reason: string }[];
        safety: null;
      };
    };
    expect(payload.review.candidate).toBeNull();
    expect(payload.review.safety).toBeNull();
  });
});

describe("GET /api/intents", () => {
  it("lists the session's intents person-scoped (synthetic marker on)", async () => {
    await POST(jsonRequest(VALID_BODY));
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      synthetic: boolean;
      personId: string;
      intents: { intent: { intentId: string }; review: { state: string } }[];
    };
    expect(payload.synthetic).toBe(true);
    expect(payload.personId).toBe("prsn_SYNTH-person-0001");
    expect(payload.intents).toHaveLength(1);
    expect(payload.intents[0]?.intent.intentId).toBe("intent_SYNTH-intent-000001");
    expect(payload.intents[0]?.review.state).toBe("pending");
  });
});
