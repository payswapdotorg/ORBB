import { describe, expect, it } from "vitest";
import app from "./index.js";
import { readJson } from "./testing/harness.js";

/**
 * The UNWIRED Worker shell (see index.ts): no auth, no persistence
 * bindings — /healthz and /v1/openapi.json are the public functional
 * surfaces; every principal-scoped route answers with an honest 401
 * envelope.
 */
describe("unwired Worker shell (orbb-api)", () => {
  it("GET /healthz returns 200 with the ok payload (M0 contract unchanged)", async () => {
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true, service: "orbb-api" });
  });

  it("GET /v1/openapi.json is public on the unwired shell (A26)", async () => {
    const response = await app.request("/v1/openapi.json");
    expect(response.status).toBe(200);
    const body = await readJson<{ openapi: string }>(response);
    expect(body.openapi).toBe("3.1.0");
  });

  it("principal-scoped routes answer 401 in envelope form (no fake auth)", async () => {
    const response = await app.request("/v1/me");
    expect(response.status).toBe(401);
    const body = await readJson<{ error: { code: string; requestId: string } }>(response);
    expect(body.error.code).toBe("unauthenticated");
    expect(typeof body.error.requestId).toBe("string");
    expect(body.error.requestId.length).toBeGreaterThan(0);
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
  });

  it("mutating routes answer 401 without credentials", async () => {
    const response = await app.request("/v1/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: "SYNTH-objective-shell" }),
    });
    expect(response.status).toBe(401);
    const body = await readJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("unauthenticated");
  });

  it("unknown routes answer 404 in envelope form", async () => {
    const response = await app.request("/definitely-not-a-route");
    expect(response.status).toBe(404);
    const body = await readJson<{ error: { code: string; message: string; requestId: string } }>(
      response,
    );
    expect(body.error).toEqual({
      code: "not-found",
      message: "The requested route does not exist.",
      requestId: body.error.requestId,
    });
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
  });

  it("unknown methods on known paths answer 404 in envelope form", async () => {
    const response = await app.request("/v1/me", { method: "DELETE" });
    expect(response.status).toBe(404);
    const body = await readJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("not-found");
  });
});
