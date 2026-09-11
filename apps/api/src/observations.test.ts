import { describe, expect, it } from "vitest";
import type { PersonRecord } from "@orbb/db";
import { createTestApi, readJson, requestJson, type TestApi } from "./testing/harness.js";

/**
 * /v1/observations contract: self-only creation (provenance synthesized
 * server-side, validation state pending), person-scoped reads with
 * uniform 404 (existence secrecy), conceptCode filtering, cursor
 * pagination, evidence linkage rules, and body validation.
 */

interface ObservationJson {
  id: string;
  personId: string;
  conceptCode: string;
  value: string | number | boolean;
  unit: string;
  effectiveAt: string;
  observedAt: string;
  sourceId: string;
  methodId: string;
  validationState: string;
  provenanceId: string;
  evidenceLabel: string;
  evidenceId?: string;
  quality?: number;
}

interface PageJson {
  items: ObservationJson[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface ErrorBody {
  error: { code: string; message: string; details?: { issues?: Array<{ field: string }> }; requestId: string };
}

async function setup(): Promise<{
  api: TestApi;
  tokenA: string;
  tokenB: string;
  personA: PersonRecord;
  personB: PersonRecord;
}> {
  const api = createTestApi("observations");
  const personA = await api.seedPerson("token-a");
  const personB = await api.seedPerson("token-b");
  return { api, tokenA: "token-a", tokenB: "token-b", personA, personB };
}

const BASE_BODY = {
  conceptCode: "SYNTH-8867-4",
  value: 72,
  unit: "beats/min",
  effectiveAt: "2026-01-01T00:00:00.000Z",
  observedAt: "2026-01-01T00:00:01.000Z",
  sourceId: "src_SYNTH-observations-00000001",
  methodId: "SYNTH-method-manual",
  evidenceLabel: "MEASURED",
};

describe("POST /v1/observations", () => {
  it("records a pending observation for the principal with synthesized provenance", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/observations", {
      token: tokenA,
      body: BASE_BODY,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toMatch(/^\/v1\/observations\/obs_[A-Za-z0-9_-]+$/);
    const observation = await readJson<ObservationJson>(response);
    expect(observation.id).toMatch(/^obs_[A-Za-z0-9_-]{16,128}$/);
    expect(observation.validationState).toBe("pending");
    expect(observation.conceptCode).toBe(BASE_BODY.conceptCode);
    expect(observation.value).toBe(72);
    expect(observation.evidenceLabel).toBe("MEASURED");
    expect(observation.quality).toBeUndefined();
    expect(observation.evidenceId).toBeUndefined();
    // Provenance synthesized server-side (deterministic prov_<sha256> id).
    expect(observation.provenanceId).toMatch(/^prov_[0-9a-f]{64}$/);
    // The synthesized provenance row exists (FK satisfied).
    expect(await api.db.provenances.findById(observation.provenanceId as never)).toBeDefined();
  });

  it("commits OBSERVATION_RECORDED into the transactional outbox (§4)", async () => {
    const { api, tokenA } = await setup();
    const observation = await readJson<ObservationJson>(
      await requestJson(api.app, "/v1/observations", { token: tokenA, body: BASE_BODY }),
    );
    const events = api.db
      .listOutboxForTests()
      .filter((event) => event.eventType === "OBSERVATION_RECORDED");
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: "OBSERVATION_RECORDED",
      observationId: observation.id,
      personId: observation.personId,
    });
    // PHI-conservative event: no values, no units, no concept codes.
    expect(JSON.stringify(payload)).not.toContain("8867");
    expect(JSON.stringify(payload)).not.toContain("beats");
  });

  it("accepts string and boolean values, empty units, and quality in [0,1]", async () => {
    const { api, tokenA } = await setup();
    const textObs = await readJson<ObservationJson>(
      await requestJson(api.app, "/v1/observations", {
        token: tokenA,
        body: { ...BASE_BODY, value: "SYNTH-coded-value", unit: "", quality: 0.5 },
      }),
    );
    expect(textObs.value).toBe("SYNTH-coded-value");
    expect(textObs.unit).toBe("");
    expect(textObs.quality).toBe(0.5);

    const boolObs = await readJson<ObservationJson>(
      await requestJson(api.app, "/v1/observations", {
        token: tokenA,
        body: { ...BASE_BODY, value: true },
      }),
    );
    expect(boolObs.value).toBe(true);
  });

  it("links the principal's OWN evidence object (evidenceId round-trips)", async () => {
    const { api, tokenA, personA } = await setup();
    const evidence = await api.seedEvidence(personA.id);
    const observation = await readJson<ObservationJson>(
      await requestJson(api.app, "/v1/observations", {
        token: tokenA,
        body: { ...BASE_BODY, evidenceId: evidence.id },
      }),
    );
    expect(observation.evidenceId).toBe(evidence.id);
  });

  it("rejects a FOREIGN evidence id with 422 (existence not leaked)", async () => {
    const { api, tokenA, personB } = await setup();
    const foreignEvidence = await api.seedEvidence(personB.id);
    const response = await requestJson(api.app, "/v1/observations", {
      token: tokenA,
      body: { ...BASE_BODY, evidenceId: foreignEvidence.id },
    });
    expect(response.status).toBe(422);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("validation-failed");
    expect(body.error.details?.issues?.map((issue) => issue.field)).toEqual(["evidenceId"]);
  });

  it("rejects a MISSING evidence id with 422", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/observations", {
      token: tokenA,
      body: { ...BASE_BODY, evidenceId: "evid_SYNTH-does-not-exist-00000001" },
    });
    expect(response.status).toBe(422);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("validation-failed");
  });

  it.each([
    ["evidenceLabel", { ...BASE_BODY, evidenceLabel: "GUESSED" }, "evidenceLabel"],
    ["quality", { ...BASE_BODY, quality: 1.5 }, "quality"],
    ["sourceId", { ...BASE_BODY, sourceId: "not-a-src-id" }, "sourceId"],
    ["effectiveAt", { ...BASE_BODY, effectiveAt: "not-a-date" }, "effectiveAt"],
    ["value", { ...BASE_BODY, value: { nested: true } }, "value"],
    ["conceptCode", { ...BASE_BODY, conceptCode: "" }, "conceptCode"],
    ["methodId", { ...BASE_BODY, methodId: "" }, "methodId"],
    ["unknown field", { ...BASE_BODY, supersedesId: "obs_SYNTH-attacks-00000001" }, "supersedesId"],
    ["validationState", { ...BASE_BODY, validationState: "validated" }, "validationState"],
  ])("rejects an invalid %s with 422 + field-level details", async (_name, body, field) => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/observations", {
      token: tokenA,
      body,
    });
    expect(response.status).toBe(422);
    const parsed = await readJson<ErrorBody>(response);
    expect(parsed.error.code).toBe("validation-failed");
    expect(parsed.error.details?.issues?.map((issue) => issue.field)).toContain(field);
  });

  it("rejects a missing observedAt with 422 (required field)", async () => {
    const { api, tokenA } = await setup();
    const { observedAt: _omit, ...body } = BASE_BODY;
    void _omit;
    const response = await requestJson(api.app, "/v1/observations", { token: tokenA, body });
    expect(response.status).toBe(422);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("validation-failed");
  });
});

describe("GET /v1/observations/:id — existence secrecy", () => {
  it("answers 404 (not 403) for another person's observation", async () => {
    const { api, tokenA, tokenB } = await setup();
    const created = await readJson<ObservationJson>(
      await requestJson(api.app, "/v1/observations", { token: tokenA, body: BASE_BODY }),
    );
    const response = await requestJson(api.app, `/v1/observations/${created.id}`, {
      token: tokenB,
    });
    expect(response.status).toBe(404);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("not-found");
    expect(body.error.message).not.toContain(created.id);
  });

  it("answers 404 for malformed and missing ids, indistinguishably", async () => {
    const { api, tokenA } = await setup();
    const malformed = await requestJson(api.app, "/v1/observations/zzz", { token: tokenA });
    const missing = await requestJson(api.app, "/v1/observations/obs_SYNTH-missing-000000001", {
      token: tokenA,
    });
    expect(malformed.status).toBe(404);
    expect(missing.status).toBe(404);
    expect((await readJson<ErrorBody>(malformed)).error.code).toBe("not-found");
    expect((await readJson<ErrorBody>(missing)).error.code).toBe("not-found");
  });

  it("round-trips the created body via GET", async () => {
    const { api, tokenA } = await setup();
    const created = await readJson<ObservationJson>(
      await requestJson(api.app, "/v1/observations", { token: tokenA, body: BASE_BODY }),
    );
    const fetched = await readJson<ObservationJson>(
      await requestJson(api.app, `/v1/observations/${created.id}`, { token: tokenA }),
    );
    expect(fetched).toEqual(created);
  });
});

describe("GET /v1/observations — pagination + conceptCode filter", () => {
  async function seeded(): Promise<TestApi> {
    const api = createTestApi("observations-page");
    await api.seedPerson("token-a");
    for (let i = 1; i <= 4; i += 1) {
      await requestJson(api.app, "/v1/observations", {
        token: "token-a",
        body: { ...BASE_BODY, conceptCode: `SYNTH-concept-A`, value: i },
      });
      api.clock.advance(1_000);
      await requestJson(api.app, "/v1/observations", {
        token: "token-a",
        body: { ...BASE_BODY, conceptCode: `SYNTH-concept-B`, value: i },
      });
      api.clock.advance(1_000);
    }
    return api;
  }

  it("pages newest-first across the unfiltered stream", async () => {
    const api = await seeded();
    const page1 = await readJson<PageJson>(
      await requestJson(api.app, "/v1/observations?limit=4", { token: "token-a" }),
    );
    expect(page1.items).toHaveLength(4);
    expect(page1.hasMore).toBe(true);
    // Newest first: the last-created B observation leads.
    expect(page1.items[0]!.conceptCode).toBe("SYNTH-concept-B");
    expect(page1.items[0]!.value).toBe(4);
    const page2 = await readJson<PageJson>(
      await requestJson(api.app, `/v1/observations?limit=4&cursor=${page1.nextCursor}`, {
        token: "token-a",
      }),
    );
    expect([...page1.items, ...page2.items]).toHaveLength(8);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
    // Stable total order: strictly decreasing observed anchors.
    const all = [...page1.items, ...page2.items];
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i]!.observedAt <= all[i - 1]!.observedAt).toBe(true);
    }
  });

  it("filters by conceptCode within the principal's stream", async () => {
    const api = await seeded();
    const page = await readJson<PageJson>(
      await requestJson(api.app, "/v1/observations?conceptCode=SYNTH-concept-A", {
        token: "token-a",
      }),
    );
    expect(page.items).toHaveLength(4);
    expect(page.items.every((observation) => observation.conceptCode === "SYNTH-concept-A")).toBe(
      true,
    );
    expect(page.hasMore).toBe(false);
  });

  it("rejects an empty conceptCode filter with a 400 envelope", async () => {
    const api = await seeded();
    const response = await requestJson(api.app, "/v1/observations?conceptCode=", {
      token: "token-a",
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("invalid-request");
  });

  it("isolates listings per principal (B sees none of A's observations)", async () => {
    const api = await seeded();
    await api.seedPerson("token-b");
    const pageB = await readJson<PageJson>(
      await requestJson(api.app, "/v1/observations", { token: "token-b" }),
    );
    expect(pageB.items).toEqual([]);
    expect(pageB.nextCursor).toBeNull();
  });
});
