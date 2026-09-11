import { describe, expect, it } from "vitest";
import { PersistenceError } from "@orbb/db";
import type { PersonRecord } from "@orbb/db";
import { createTestApi, readJson, requestJson, type TestApi } from "./testing/harness.js";

/**
 * /v1/intents contract: creation round-trip (state machine entry state,
 * opaque server-minted ids), person-scoped reads with uniform 404
 * (existence secrecy), newest-first cursor pagination with opaque
 * cursors, and the §4 transactional-outbox discipline.
 */

interface IntentJson {
  id: string;
  personId: string;
  objective: string;
  state: string;
  createdAt: string;
}

interface PageJson {
  items: IntentJson[];
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
  const api = createTestApi("intents");
  const personA = await api.seedPerson("token-a");
  const personB = await api.seedPerson("token-b");
  return { api, tokenA: "token-a", tokenB: "token-b", personA, personB };
}

const OBJECTIVE = "SYNTH-objective-alpha";

describe("POST /v1/intents", () => {
  it("creates a draft intent for the principal (201 + Location + envelope-safe body)", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/intents", {
      token: tokenA,
      body: { objective: OBJECTIVE },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toMatch(/^\/v1\/intents\/intent_[A-Za-z0-9_-]+$/);
    const intent = await readJson<IntentJson>(response);
    expect(intent.id).toMatch(/^intent_[A-Za-z0-9_-]{16,128}$/);
    expect(intent.state).toBe("draft");
    expect(intent.objective).toBe(OBJECTIVE);
    expect(intent.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // The personId in the body is the PRINCIPAL's (never client-supplied).
    const stored = await api.db.persons.list({ limit: 200 });
    expect(stored.items.map((p) => p.id)).toContain(intent.personId);
  });

  it("round-trips through GET /v1/intents/:id with the identical body", async () => {
    const { api, tokenA } = await setup();
    const created = await readJson<IntentJson>(
      await requestJson(api.app, "/v1/intents", { token: tokenA, body: { objective: OBJECTIVE } }),
    );
    const fetched = await readJson<IntentJson>(
      await requestJson(api.app, `/v1/intents/${created.id}`, { token: tokenA }),
    );
    expect(fetched).toEqual(created);
  });

  it("requires application/json content type (400 envelope)", async () => {
    const { api, tokenA } = await setup();
    const response = await api.app.request("/v1/intents", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "text/plain" },
      body: JSON.stringify({ objective: OBJECTIVE }),
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("invalid-request");
  });

  it("rejects unparseable JSON with a 400 envelope", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/intents", {
      token: tokenA,
      rawBody: "{not json",
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("invalid-request");
  });

  it("rejects a non-object body with a 400 envelope", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/intents", {
      token: tokenA,
      rawBody: "[\"objective\"]",
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("invalid-request");
  });

  it("rejects a missing objective with 422 + field-level details", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/intents", {
      token: tokenA,
      body: {},
    });
    expect(response.status).toBe(422);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("validation-failed");
    expect(body.error.details?.issues?.map((issue) => issue.field)).toEqual(["objective"]);
  });

  it("rejects unknown fields with 422 (strict surface)", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/intents", {
      token: tokenA,
      body: { objective: OBJECTIVE, personId: "prsn_SYNTH-attacker-controlled-1" },
    });
    expect(response.status).toBe(422);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.details?.issues?.map((issue) => issue.field)).toEqual(["personId"]);
  });

  it("commits INTENT_CREATED into the transactional outbox (§4)", async () => {
    const { api, tokenA } = await setup();
    const created = await readJson<IntentJson>(
      await requestJson(api.app, "/v1/intents", { token: tokenA, body: { objective: OBJECTIVE } }),
    );
    const events = api.db
      .listOutboxForTests()
      .filter((event) => event.eventType === "INTENT_CREATED");
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: "INTENT_CREATED",
      intentId: created.id,
      personId: created.personId,
    });
    // PHI discipline: the free-text objective never enters the event stream.
    expect(JSON.stringify(payload)).not.toContain(OBJECTIVE);
    expect(events[0]!.eventId).toMatch(/^evt_[0-9a-f]{64}$/);
  });

  it("the in-memory double enforces the §4 outbox-required guard (fidelity)", async () => {
    const { api, personA } = await setup();
    await expect(
      api.db.transaction((uow) =>
        uow.intents.insert(
          {
            id: "intent_SYNTH-guard-probe-0001" as never,
            personId: personA.id,
            objective: "SYNTH-guard",
            state: "draft",
            createdAt: api.clock.now(),
          },
          { idempotencyKey: "guard-probe-1" },
        ),
      ),
    ).rejects.toThrowError(PersistenceError);
  });
});

describe("GET /v1/intents/:id — existence secrecy", () => {
  it("answers 404 (not 403) for another person's intent", async () => {
    const { api, tokenA, tokenB } = await setup();
    const created = await readJson<IntentJson>(
      await requestJson(api.app, "/v1/intents", { token: tokenA, body: { objective: OBJECTIVE } }),
    );
    const response = await requestJson(api.app, `/v1/intents/${created.id}`, { token: tokenB });
    expect(response.status).toBe(404);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("not-found");
    expect(body.error.message).not.toContain(created.id);
  });

  it("answers 404 for a missing id (indistinguishable from foreign)", async () => {
    const { api, tokenA, tokenB } = await setup();
    const created = await readJson<IntentJson>(
      await requestJson(api.app, "/v1/intents", { token: tokenA, body: { objective: OBJECTIVE } }),
    );
    const missing = await requestJson(api.app, "/v1/intents/intent_SYNTH-does-not-exist-01", {
      token: tokenA,
    });
    const foreign = await requestJson(api.app, `/v1/intents/${created.id}`, { token: tokenB });
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    const missingBody = await readJson<ErrorBody>(missing);
    const foreignBody = await readJson<ErrorBody>(foreign);
    expect(missingBody.error.code).toBe(foreignBody.error.code);
    expect(missingBody.error.message).toBe(foreignBody.error.message);
  });

  it("answers 404 for a malformed id (no grammar hints leaked)", async () => {
    const { api, tokenA } = await setup();
    const response = await requestJson(api.app, "/v1/intents/not-an-intent-id", { token: tokenA });
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("not-found");
  });

  it("answers 401 without credentials", async () => {
    const { api } = await setup();
    const response = await requestJson(api.app, "/v1/intents/intent_SYNTH-whatever-00000001");
    expect(response.status).toBe(401);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("unauthenticated");
  });
});

describe("GET /v1/intents — cursor pagination", () => {
  async function seeded(): Promise<TestApi> {
    const api = createTestApi("intents-page");
    await api.seedPerson("token-a");
    for (let i = 1; i <= 5; i += 1) {
      await requestJson(api.app, "/v1/intents", {
        token: "token-a",
        body: { objective: `SYNTH-objective-${i}` },
      });
      api.clock.advance(1_000);
    }
    return api;
  }

  it("pages newest-first with opaque cursors and a hasMore/nextCursor envelope", async () => {
    const api = await seeded();
    const page1 = await readJson<PageJson>(
      await requestJson(api.app, "/v1/intents?limit=2", { token: "token-a" }),
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(typeof page1.nextCursor).toBe("string");
    expect(page1.nextCursor).not.toBeNull();
    // Newest first: objective-5 then objective-4.
    expect(page1.items.map((intent) => intent.objective)).toEqual([
      "SYNTH-objective-5",
      "SYNTH-objective-4",
    ]);
    // The cursor is opaque: it is not one of the resource ids.
    expect(page1.items.map((intent) => intent.id)).not.toContain(page1.nextCursor);

    const page2 = await readJson<PageJson>(
      await requestJson(api.app, `/v1/intents?limit=2&cursor=${page1.nextCursor}`, {
        token: "token-a",
      }),
    );
    expect(page2.items.map((intent) => intent.objective)).toEqual([
      "SYNTH-objective-3",
      "SYNTH-objective-2",
    ]);
    expect(page2.hasMore).toBe(true);

    const page3 = await readJson<PageJson>(
      await requestJson(api.app, `/v1/intents?limit=2&cursor=${page2.nextCursor}`, {
        token: "token-a",
      }),
    );
    expect(page3.items.map((intent) => intent.objective)).toEqual(["SYNTH-objective-1"]);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();
  });

  it("pagination is stable: identical queries return identical pages", async () => {
    const api = await seeded();
    const first = await (
      await requestJson(api.app, "/v1/intents?limit=3", { token: "token-a" })
    ).text();
    const second = await (
      await requestJson(api.app, "/v1/intents?limit=3", { token: "token-a" })
    ).text();
    expect(first).toBe(second);
  });

  it("a cursor only exposes the caller's own page stream (person scoping holds)", async () => {
    const api = await seeded();
    await api.seedPerson("token-b");
    const page1 = await readJson<PageJson>(
      await requestJson(api.app, "/v1/intents?limit=2", { token: "token-a" }),
    );
    // token-b has NO intents: following A's cursor yields an empty page
    // for B (the anchor filters B's empty stream — no cross-person leak).
    const pageB = await readJson<PageJson>(
      await requestJson(api.app, `/v1/intents?limit=2&cursor=${page1.nextCursor}`, {
        token: "token-b",
      }),
    );
    expect(pageB.items).toEqual([]);
    expect(pageB.hasMore).toBe(false);
    expect(pageB.nextCursor).toBeNull();
  });

  it("rejects a non-integer limit with a 400 envelope", async () => {
    const api = await seeded();
    const response = await requestJson(api.app, "/v1/intents?limit=abc", { token: "token-a" });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("invalid-request");
  });

  it("rejects an out-of-range limit with a 400 envelope (db-side single source of truth)", async () => {
    const api = await seeded();
    for (const limit of ["0", "-1", "201"]) {
      const response = await requestJson(api.app, `/v1/intents?limit=${limit}`, {
        token: "token-a",
      });
      expect(response.status).toBe(400);
      expect((await readJson<ErrorBody>(response)).error.code).toBe("invalid-request");
    }
  });

  it("rejects a malformed cursor with a 400 envelope (value never echoed)", async () => {
    const api = await seeded();
    const response = await requestJson(api.app, "/v1/intents?cursor=not-a-cursor", {
      token: "token-a",
    });
    expect(response.status).toBe(400);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("invalid-request");
    expect(body.error.message).not.toContain("not-a-cursor");
  });
});
