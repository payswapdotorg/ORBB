import { describe, expect, it } from "vitest";
import app from "./index.js";

describe("GET /healthz (orbb-api)", () => {
  it("returns 200 with the ok payload via the Hono app (no network)", async () => {
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true, service: "orbb-api" });
  });
});
