import { describe, expect, it } from "vitest";
import { createLogger, InMemorySink, requestLogEnvelope, sanitizeRoutePattern, UNKNOWN_ROUTE_PATTERN } from "./index.js";

const RAW_URL_WITH_IDS =
  "/v1/patients/9f8e2c1a-3b4d-4c5e-8f9a-0a1b2c3d4e5f/observations?email=synth%40example.org&dob=SYNTH-2000-01-01";

describe("requestLogEnvelope", () => {
  it("produces the operational envelope with the route pattern", () => {
    const fields = requestLogEnvelope({
      method: "POST",
      path: RAW_URL_WITH_IDS,
      status: 201,
      durationMs: 42,
      requestId: "SYNTH-req-1",
      routePattern: "/v1/observations/:id",
    });

    expect(fields.event).toBe("http.request");
    expect(fields.method).toBe("POST");
    expect(fields.routePattern).toBe("/v1/observations/:id");
    expect(fields.status).toBe(201);
    expect(fields.durationMs).toBe(42);
    expect(fields.requestId).toBe("SYNTH-req-1");
  });

  it("never includes the raw path — raw URLs with ids are rejected/redacted", () => {
    const fields = requestLogEnvelope({ method: "GET", path: RAW_URL_WITH_IDS });

    const dump = JSON.stringify(fields);
    expect(Object.keys(fields)).not.toContain("path");
    expect(dump).not.toContain("9f8e2c1a");
    expect(dump).not.toContain("email=");
    expect(dump).not.toContain("dob=");
    expect(fields.routePattern).toBe("/v1/patients/:id/observations");
  });

  it("derives a sanitized pattern from the path when routePattern is missing", () => {
    const fields = requestLogEnvelope({ method: "GET", path: "/v1/patients/12345/observations" });
    expect(fields.routePattern).toBe("/v1/patients/:id/observations");
  });

  it("prefers the route pattern over the raw path", () => {
    const fields = requestLogEnvelope({
      method: "GET",
      path: RAW_URL_WITH_IDS,
      routePattern: "/v1/patients/:id/observations",
    });
    expect(fields.routePattern).toBe("/v1/patients/:id/observations");
  });

  it("falls back to the unknown pattern when nothing is routable", () => {
    expect(requestLogEnvelope({ method: "GET" }).routePattern).toBe(UNKNOWN_ROUTE_PATTERN);
    expect(requestLogEnvelope({ method: "GET", path: "" }).routePattern).toBe(
      UNKNOWN_ROUTE_PATTERN,
    );
    expect(requestLogEnvelope({ method: "GET", path: "   " }).routePattern).toBe(
      UNKNOWN_ROUTE_PATTERN,
    );
  });

  it("omits absent optional fields instead of writing undefined", () => {
    const fields = requestLogEnvelope({ method: "GET" });
    expect(Object.keys(fields).sort()).toEqual(["event", "method", "routePattern"]);
  });
});

describe("sanitizeRoutePattern", () => {
  it("preserves parameterized and plain patterns untouched", () => {
    expect(sanitizeRoutePattern("/v1/observations/:id")).toBe("/v1/observations/:id");
    expect(sanitizeRoutePattern("/v1/observations")).toBe("/v1/observations");
    expect(sanitizeRoutePattern("/health")).toBe("/health");
    expect(sanitizeRoutePattern("/v1/measurement-plans")).toBe("/v1/measurement-plans");
  });

  it("strips query strings and fragments", () => {
    expect(sanitizeRoutePattern("/v1/observations?token=SYNTH-secret&email=synth%40example.org")).toBe(
      "/v1/observations",
    );
    expect(sanitizeRoutePattern("/v1/observations#SYNTH-fragment")).toBe("/v1/observations");
  });

  it("replaces identifier-like segments with :id", () => {
    expect(sanitizeRoutePattern("/v1/observations/9f8e2c1a-3b4d-4c5e-8f9a-0a1b2c3d4e5f")).toBe(
      "/v1/observations/:id",
    );
    expect(sanitizeRoutePattern("/v1/observations/12345")).toBe("/v1/observations/:id");
    expect(sanitizeRoutePattern("/v1/observations/deadbeef99")).toBe("/v1/observations/:id");
    expect(sanitizeRoutePattern("/v1/people/01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("/v1/people/:id");
    expect(sanitizeRoutePattern("/v1/people/synth.person@example.org")).toBe("/v1/people/:id");
  });

  it("keeps short version segments and long digit-free route words", () => {
    expect(sanitizeRoutePattern("/v1/observations")).toBe("/v1/observations");
    expect(sanitizeRoutePattern("/measurementplans")).toBe("/measurementplans");
  });

  it("drops scheme and host from absolute URLs", () => {
    expect(sanitizeRoutePattern("https://api.synth.example.org/v1/observations/12345?x=1")).toBe(
      "/v1/observations/:id",
    );
    expect(sanitizeRoutePattern("https://api.synth.example.org")).toBe("/");
  });

  it("collapses only the identifier-like segments of a nested raw URL", () => {
    expect(sanitizeRoutePattern(RAW_URL_WITH_IDS)).toBe("/v1/patients/:id/observations");
  });
});

describe("request envelope through the logger (end-to-end PHI guard)", () => {
  it("logs the route pattern; raw URL ids never reach the sink", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    logger.info("request completed", {
      ...requestLogEnvelope({
        method: "GET",
        path: RAW_URL_WITH_IDS,
        status: 200,
        durationMs: 7,
        requestId: "SYNTH-req-5",
      }),
    });

    const record = sink.records[0];
    expect(record?.routePattern).toBe("/v1/patients/:id/observations");
    expect(record?.status).toBe(200);
    expect(record?.durationMs).toBe(7);
    expect(record?.requestId).toBe("SYNTH-req-5");

    const dump = JSON.stringify(sink.records);
    expect(dump).not.toContain("9f8e2c1a");
    expect(dump).not.toContain("synth%40example.org");
    expect(dump).not.toContain("SYNTH-2000-01-01");
    expect(dump).not.toContain("/v1/patients/12345");
  });

  it("raw path/url context fields are redacted by the default policy", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    logger.info("request completed", {
      event: "http.request",
      path: RAW_URL_WITH_IDS,
      url: `https://api.synth.example.org${RAW_URL_WITH_IDS}`,
      routePattern: "/v1/patients/:id/observations",
    });

    expect(sink.records[0]?.path).toBe("[REDACTED]");
    expect(sink.records[0]?.url).toBe("[REDACTED]");
    expect(sink.records[0]?.routePattern).toBe("/v1/patients/:id/observations");
    expect(JSON.stringify(sink.records)).not.toContain("9f8e2c1a");
  });
});
