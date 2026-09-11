import { describe, expect, it } from "vitest";
import { createTestApi, readJson, requestJson, type TestApi } from "./testing/harness.js";

/**
 * /v1/evidence/:id contract: metadata retrieval for the principal's own
 * evidence objects only, with uniform 404 (existence secrecy) and no
 * envelope-encrypted metadata in the response.
 */

interface EvidenceMetadataJson {
  id: string;
  personId: string;
  objectKey: string;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  capturedAt: string;
  sourceType: string;
  provenanceId: string;
  retentionClass: string;
  state: string;
  createdAt?: string;
  sessionId?: string;
}

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

async function setup(): Promise<{ api: TestApi; evidence: EvidenceMetadataJson }> {
  const api = createTestApi("evidence");
  const person = await api.seedPerson("token-a");
  await api.seedPerson("token-b");
  const evidence = await api.seedEvidence(person.id);
  return {
    api,
    evidence: evidence as unknown as EvidenceMetadataJson,
  };
}

describe("GET /v1/evidence/:id", () => {
  it("returns the metadata for the principal's own evidence object", async () => {
    const { api, evidence } = await setup();
    const response = await requestJson(api.app, `/v1/evidence/${evidence.id}`, {
      token: "token-a",
    });
    expect(response.status).toBe(200);
    const body = await readJson<EvidenceMetadataJson>(response);
    expect(body.id).toBe(evidence.id);
    expect(body.personId).toBe(evidence.personId);
    expect(body.objectKey).toMatch(/^evidence\/v1\/evid_[A-Za-z0-9_-]+\//);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(body.state).toBe("active");
    expect(body.retentionClass).toBe("original");
    expect(body.capturedAt).toMatch(/^\d{4}-/);
  });

  it("answers 404 (not 403) for a foreign person's evidence id", async () => {
    const { api, evidence } = await setup();
    const response = await requestJson(api.app, `/v1/evidence/${evidence.id}`, {
      token: "token-b",
    });
    expect(response.status).toBe(404);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("not-found");
    expect(body.error.message).not.toContain(evidence.id);
  });

  it("answers 404 for a missing id (indistinguishable from foreign)", async () => {
    const { api } = await setup();
    const response = await requestJson(api.app, "/v1/evidence/evid_SYNTH-missing-000000001", {
      token: "token-a",
    });
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("not-found");
  });

  it("answers 404 for a malformed id (uniform with existence secrecy)", async () => {
    const { api } = await setup();
    const response = await requestJson(api.app, "/v1/evidence/evid_short", { token: "token-a" });
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("not-found");
  });

  it("answers 401 without credentials", async () => {
    const { api, evidence } = await setup();
    const response = await requestJson(api.app, `/v1/evidence/${evidence.id}`);
    expect(response.status).toBe(401);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("unauthenticated");
  });
});
