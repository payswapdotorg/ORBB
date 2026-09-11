import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi.js";
import { createTestApi, readJson, requestJson } from "./testing/harness.js";
import type { OpenApiJson } from "./openapi.js";

/**
 * A26 contract tests: the OpenAPI 3.1 document is served publicly and
 * CANNOT drift from the Hono router (exact path+method parity), every
 * mutating operation documents the Idempotency-Key, every example is
 * synthetic, and the error envelope is a named reusable schema.
 */

const ID_PREFIXES = ["prsn_", "intent_", "obs_", "evid_", "prov_", "src_"] as const;

function docOperations(doc: {
  paths: Readonly<Record<string, OpenApiJson>>;
}): Array<{ method: string; path: string; operation: OpenApiJson }> {
  const operations: Array<{ method: string; path: string; operation: OpenApiJson }> = [];
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method] as OpenApiJson | undefined;
      if (operation !== undefined) {
        operations.push({ method, path, operation });
      }
    }
  }
  return operations;
}

/** Collects every string `example` under `node`, with its JSON path. */
function collectExamples(node: unknown, trail = "$"): Array<{ trail: string; value: unknown }> {
  if (typeof node !== "object" || node === null) {
    return [];
  }
  const examples: Array<{ trail: string; value: unknown }> = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      examples.push(...collectExamples(item, `${trail}[${index}]`));
    });
    return examples;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "example" || key === "examples") {
      examples.push({ trail: `${trail}.${key}`, value });
    }
    examples.push(...collectExamples(value, `${trail}.${key}`));
  }
  return examples;
}

describe("GET /v1/openapi.json (A26)", () => {
  it("serves a public OpenAPI 3.1 document", async () => {
    const api = createTestApi("openapi");
    const response = await requestJson(api.app, "/v1/openapi.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const doc = await readJson<{ openapi: string; info: { title: string; version: string }; servers: Array<{ url: string }> }>(response);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toContain("ORBB");
    expect(doc.info.version).toBe("1.0.0");
    expect(doc.servers[0]?.url).toBe("/v1");
  });

  it("documents exactly the /v1 routes the router registers (no drift)", async () => {
    const api = createTestApi("openapi-parity");
    const doc = buildOpenApiDocument();
    // Hono's `routes` carries one entry per handler (middleware chains
    // duplicate entries) and uses `:param` syntax — dedupe and normalize
    // before comparing with the OpenAPI `{param}` style under /v1.
    const registered = [
      ...new Set(
        api.app.routes
          .filter(
            (route) =>
              route.path.startsWith("/v1") &&
              (route.method === "GET" || route.method === "POST"),
          )
          .map((route) =>
            `${route.method} ${route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`,
          ),
      ),
    ].sort();
    const documented = docOperations(doc)
      .map(({ method, path }) => `${method.toUpperCase()} /v1${path}`)
      .sort();
    expect(documented).toEqual(registered);
  });

  it("documents every mutation with the Idempotency-Key header", () => {
    const doc = buildOpenApiDocument();
    const mutations = docOperations(doc).filter(({ method }) => method === "post");
    expect(mutations.map(({ path }) => path).sort()).toEqual(["/intents", "/observations"]);
    for (const { path, operation } of mutations) {
      const parameters = (operation.parameters ?? []) as Array<{
        name?: string;
        $ref?: string;
      }>;
      const names = parameters.map((parameter) => parameter.name ?? parameter.$ref ?? "");
      expect(
        names.some((name) => name === "Idempotency-Key" || name.includes("IdempotencyKeyHeader")),
        `${path} must document Idempotency-Key`,
      ).toBe(true);
    }
  });

  it("every principal-scoped operation documents 401 and references the error envelope", () => {
    const doc = buildOpenApiDocument();
    const secured = docOperations(doc).filter(({ path }) => path !== "/openapi.json");
    expect(secured.length).toBeGreaterThanOrEqual(7);
    for (const { method, path, operation } of secured) {
      const responses = (operation.responses ?? {}) as Record<string, OpenApiJson>;
      expect(responses["401"], `${method} ${path} must document 401`).toBeDefined();
      expect(responses["500"], `${method} ${path} must document 500`).toBeDefined();
      expect(JSON.stringify(responses["401"])).toContain("#/components/responses/");
    }
  });

  it("documents the error envelope and pagination envelope schemas", () => {
    const doc = buildOpenApiDocument();
    const schemas = (doc.components as { schemas?: Record<string, OpenApiJson> }).schemas ?? {};
    expect(schemas["ErrorEnvelope"]).toBeDefined();
    expect(schemas["ErrorBody"]).toBeDefined();
    expect(schemas["IntentPage"]).toBeDefined();
    expect(schemas["ObservationPage"]).toBeDefined();
    const errorBody = JSON.stringify(schemas["ErrorBody"]);
    expect(errorBody).toContain("requestId");
    expect(errorBody).toContain("validation-failed");
  });

  it("carries ONLY synthetic examples (no PHI, no real ids)", () => {
    const doc = buildOpenApiDocument();
    const examples = collectExamples(doc);
    expect(examples.length).toBeGreaterThan(20);
    for (const { value } of examples) {
      if (typeof value === "string") {
        for (const prefix of ID_PREFIXES) {
          if (value.startsWith(prefix)) {
            expect(value).toContain("SYNTH-");
          }
        }
        expect(value).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}T\d{9}/); // no real-looking timestamps beyond the fixed synthetic ones
      }
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain("Alice");
      expect(serialized).not.toContain("John");
      expect(serialized).not.toContain("patient");
    }
  });

  it("describes existence secrecy and the concurrent-duplicate 409 in prose", () => {
    const doc = buildOpenApiDocument();
    const serialized = JSON.stringify(doc);
    expect(serialized).toContain("indistinguishable");
    expect(serialized).toContain("409");
    expect(serialized).toContain("Idempotency-Key");
  });
});
