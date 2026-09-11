import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { DomainInvariantError } from "@orbb/domain";
import { PersistenceError } from "@orbb/db";
import {
  ApiError,
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  type ApiErrorCode,
} from "./errors.js";
import { createTestApi, readJson, requestJson } from "./testing/harness.js";
import { DeterministicRequestIdFactory } from "./testing/harness.js";
import type { ApiEnv } from "./context.js";

/**
 * Contract hardening (packet bullet 2): every failure class renders the
 * standardized envelope { error: { code, message, details?, requestId } }
 * with the frozen status mapping.
 */

interface ErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: { issues?: Array<{ field: string; problem: string }> };
    requestId: string;
  };
}

/** A minimal app that throws every error class through the real wiring. */
function throwingApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use(requestIdMiddleware(new DeterministicRequestIdFactory("errors")));
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.get("/api-error", () => {
    throw new ApiError("forbidden", "Authorization denied.");
  });
  app.get("/rate-limited", () => {
    throw new ApiError("rate-limited", "Too many requests.");
  });
  app.get("/with-details", () => {
    throw new ApiError("validation-failed", "Invalid input.", {
      details: { issues: [{ field: "objective", problem: "expected a string" }] },
    });
  });
  app.get("/domain", () => {
    throw new DomainInvariantError("Invalid evidence label: expected one of MEASURED | ESTIMATED | IMPORTED | DERIVED.");
  });
  app.get("/persistence-conflict", () => {
    throw new PersistenceError("state-conflict", "Unique key conflict while storing health intent under a fresh idempotency key.");
  });
  app.get("/persistence-bad-request", () => {
    throw new PersistenceError("invalid-request", "Invalid pagination cursor: expected an opaque cursor produced by this API.");
  });
  app.get("/persistence-outbox", () => {
    throw new PersistenceError("outbox-required", "A mutating transaction appended no outbox event.");
  });
  app.get("/unknown", () => {
    throw new Error("secret stack text with patient data");
  });
  return app;
}

describe("error envelope (A21)", () => {
  it.each<[string, number, ApiErrorCode]>([
    ["/api-error", 403, "forbidden"],
    ["/rate-limited", 429, "rate-limited"],
    ["/domain", 422, "validation-failed"],
    ["/persistence-conflict", 409, "conflict"],
    ["/persistence-bad-request", 400, "invalid-request"],
    ["/persistence-outbox", 500, "internal-error"],
  ])("%s -> %d %s", async (path, status, code) => {
    const response = await throwingApp().request(path);
    expect(response.status).toBe(status);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe(code);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(typeof body.error.requestId).toBe("string");
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
  });

  it("envelope key order is code, message, (details,) requestId", async () => {
    const response = await throwingApp().request("/with-details");
    const body = await readJson<ErrorBody>(response);
    expect(Object.keys(body.error)).toEqual(["code", "message", "details", "requestId"]);
    expect(body.error.details?.issues).toEqual([
      { field: "objective", problem: "expected a string" },
    ]);
  });

  it("details is ABSENT when not provided (no null/empty placeholder)", async () => {
    const response = await throwingApp().request("/api-error");
    const body = await readJson<ErrorBody>(response);
    expect(Object.keys(body.error)).toEqual(["code", "message", "requestId"]);
    expect(body.error.details).toBeUndefined();
  });

  it("unknown errors collapse to the generic 500 message (no PHI leakage)", async () => {
    const response = await throwingApp().request("/unknown");
    expect(response.status).toBe(500);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("internal-error");
    expect(body.error.message).toBe("An internal error occurred.");
    expect(body.error.message).not.toContain("secret");
  });
});

describe("request-id middleware (A21)", () => {
  it("echoes a well-formed x-request-id", async () => {
    const response = await throwingApp().request("/api-error", {
      headers: { "x-request-id": "web-b0a3a7af-d29b-4212-a073-48f190356fcc" },
    });
    expect(response.headers.get("x-request-id")).toBe(
      "web-b0a3a7af-d29b-4212-a073-48f190356fcc",
    );
    const body = await readJson<ErrorBody>(response);
    expect(body.error.requestId).toBe("web-b0a3a7af-d29b-4212-a073-48f190356fcc");
  });

  it("mints a fresh id when the echoed header is malformed (never echoes junk)", async () => {
    const response = await throwingApp().request("/api-error", {
      headers: { "x-request-id": "bad id with spaces!" },
    });
    const minted = response.headers.get("x-request-id");
    expect(minted).not.toBeNull();
    expect(minted).not.toBe("bad id with spaces!");
    const body = await readJson<ErrorBody>(response);
    expect(body.error.requestId).toBe(minted);
  });

  it("mints a fresh id when the header is absent", async () => {
    const response = await throwingApp().request("/api-error");
    const minted = response.headers.get("x-request-id");
    expect(minted).toMatch(/^req_SYNTH-/);
  });

  it("success responses also carry x-request-id", async () => {
    const api = createTestApi("request-id-success");
    const person = await api.seedPerson("token-a");
    const response = await requestJson(api.app, "/v1/me", { token: "token-a" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^req_SYNTH-/);
    expect((await readJson<{ id: string }>(response)).id).toBe(person.id);
  });
});
