// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { listRecentCaptures, resetCaptureStore } from "@/lib/capture/store";

/**
 * Route contract tests (M4-B): the `/api/capture` stub enforces the
 * error-envelope style (typed codes, PHI-safe messages, field-level
 * issues), stores valid submissions, and lists them person-scoped.
 */

afterEach(() => {
  resetCaptureStore();
});

const VALID_BODY = {
  shapeId: "SYNTH-shape-bp-panel",
  methodOptionId: "SYNTH-method-manual-bp-panel",
  fieldValues: { systolic: 118, diastolic: 76 },
  qualityState: "partial",
  capturedAt: "2026-09-10T08:30:00.000Z",
  notes: "morning reading",
};

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/capture", () => {
  it("records a valid submission and echoes the stored capture", async () => {
    const response = await POST(jsonRequest(VALID_BODY));
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    const record = payload as Record<string, unknown>;
    expect(record.synthetic).toBe(true);
    const capture = record.capture as Record<string, unknown>;
    expect(capture.captureId).toBe("SYNTH-CAP-000001");
    expect(capture.qualityState).toBe("partial");
    const observations = capture.observations as unknown[];
    expect(observations).toHaveLength(2);
    expect(listRecentCaptures()).toHaveLength(1);
  });

  it("rejects unparseable JSON with a 400 invalid-request envelope", async () => {
    const response = await POST(jsonRequest("{not json"));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: Record<string, unknown> };
    expect(payload.error.code).toBe("invalid-request");
    expect(typeof payload.error.requestId).toBe("string");
    expect(String(payload.error.requestId).startsWith("SYNTH-REQ-")).toBe(true);
  });

  it("rejects contract violations with a 422 validation-failed envelope and typed issues", async () => {
    const response = await POST(
      jsonRequest({ ...VALID_BODY, fieldValues: { systolic: 500, diastolic: 76 } }),
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { code: string; details: { issues: { field: string; problem: string }[] } };
    };
    expect(payload.error.code).toBe("validation-failed");
    const systolicIssue = payload.error.details.issues.find(
      (issue) => issue.field === "fieldValues.systolic",
    );
    expect(systolicIssue).toBeDefined();
    expect(systolicIssue?.problem).toContain("between 60 and 300");
    expect(systolicIssue?.problem).not.toContain("500");
    expect(listRecentCaptures()).toHaveLength(0);
  });

  it("rejects a non-object body with the validation envelope", async () => {
    const response = await POST(jsonRequest([1, 2, 3]));
    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("validation-failed");
  });
});

describe("GET /api/capture", () => {
  it("lists stored captures most recent first, person-scoped", async () => {
    await POST(jsonRequest(VALID_BODY));
    await POST(
      jsonRequest({
        shapeId: "SYNTH-shape-heart-rate",
        methodOptionId: "SYNTH-method-manual-heart-rate",
        fieldValues: { heartRate: 64 },
        qualityState: "complete",
        capturedAt: "2026-09-10T09:30:00.000Z",
      }),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      synthetic: boolean;
      personId: string;
      captures: { captureId: string; shapeId: string }[];
    };
    expect(payload.synthetic).toBe(true);
    expect(payload.personId).toBe("prsn_SYNTH-person-0001");
    expect(payload.captures).toHaveLength(2);
    expect(payload.captures[0]?.shapeId).toBe("SYNTH-shape-heart-rate");
    expect(payload.captures[1]?.shapeId).toBe("SYNTH-shape-bp-panel");
  });

  it("returns an empty list before any capture", async () => {
    const response = await GET();
    const payload = (await response.json()) as { captures: unknown[] };
    expect(payload.captures).toEqual([]);
  });
});
