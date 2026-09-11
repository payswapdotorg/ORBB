import { describe, expect, it } from "vitest";
import { createTestApi, readJson, requestJson, type TestApi } from "./testing/harness.js";

/**
 * A24 idempotency middleware contract:
 *   - replay returns the ORIGINAL response byte-for-byte (+ header);
 *   - concurrent duplicates get 409 (recorded choice: no waiting);
 *   - the claim is scoped by key + principal + route;
 *   - a missing header mints a fresh key (no cross-request dedupe);
 *   - malformed keys are 400s;
 *   - deterministic 4xx responses are replayable originals;
 *   - 5xx responses ABANDON the claim (retry re-executes);
 *   - repository-level keys converge even without the response ledger.
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
  error: { code: string; message: string; requestId: string };
}

async function setup(): Promise<TestApi> {
  const api = createTestApi("idempotency");
  await api.seedPerson("token-a");
  await api.seedPerson("token-b");
  return api;
}

describe("A24 replay semantics", () => {
  it("returns the ORIGINAL response (byte-identical) with Idempotency-Replayed: true", async () => {
    const api = await setup();
    const first = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-idem-1" },
      headers: { "idempotency-key": "SYNTH-key-1" },
    });
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotency-replayed")).toBeNull();

    const replay = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-idem-1" },
      headers: { "idempotency-key": "SYNTH-key-1" },
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.text()).toBe(await first.text());
    // The replay carries THIS request's request id, not the stored one.
    expect(replay.headers.get("x-request-id")).not.toBe(first.headers.get("x-request-id"));
    expect(replay.headers.get("x-request-id")).toMatch(/^req_SYNTH-/);

    // Exactly one intent row and one INTENT_CREATED event exist.
    const page = await readJson<PageJson>(
      await requestJson(api.app, "/v1/intents", { token: "token-a" }),
    );
    expect(page.items).toHaveLength(1);
    expect(
      api.db.listOutboxForTests().filter((event) => event.eventType === "INTENT_CREATED"),
    ).toHaveLength(1);
  });

  it("replays the ORIGINAL body even when the retry payload differs (first-write-wins)", async () => {
    const api = await setup();
    const first = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-original" },
      headers: { "idempotency-key": "SYNTH-key-2" },
    });
    const replay = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-DIFFERENT" },
      headers: { "idempotency-key": "SYNTH-key-2" },
    });
    expect(replay.status).toBe(201);
    const replayText = await replay.text();
    expect((JSON.parse(replayText) as IntentJson).objective).toBe("SYNTH-objective-original");
    expect(replayText).toBe(await first.text());
    // Still one row.
    const page = await readJson<PageJson>(
      await requestJson(api.app, "/v1/intents", { token: "token-a" }),
    );
    expect(page.items).toHaveLength(1);
  });

  it("scopes the claim by principal: the same key works independently for another person", async () => {
    const api = await setup();
    const forA = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-A" },
      headers: { "idempotency-key": "SYNTH-shared-key" },
    });
    const forB = await requestJson(api.app, "/v1/intents", {
      token: "token-b",
      body: { objective: "SYNTH-objective-B" },
      headers: { "idempotency-key": "SYNTH-shared-key" },
    });
    expect(forA.status).toBe(201);
    expect(forB.status).toBe(201); // NOT a replay: different principal.
    expect((await readJson<IntentJson>(forB)).objective).toBe("SYNTH-objective-B");
  });

  it("scopes the claim by route: the same key on another mutating route is independent", async () => {
    const api = await setup();
    const intent = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-route" },
      headers: { "idempotency-key": "SYNTH-route-key" },
    });
    const observation = await requestJson(api.app, "/v1/observations", {
      token: "token-a",
      body: {
        conceptCode: "SYNTH-8867-4",
        value: 72,
        unit: "beats/min",
        effectiveAt: "2026-01-01T00:00:00.000Z",
        observedAt: "2026-01-01T00:00:01.000Z",
        sourceId: "src_SYNTH-idempotency-00000001",
        methodId: "SYNTH-method-manual",
        evidenceLabel: "MEASURED",
      },
      headers: { "idempotency-key": "SYNTH-route-key" },
    });
    expect(intent.status).toBe(201);
    expect(observation.status).toBe(201);
    expect(observation.headers.get("idempotency-replayed")).toBeNull();
  });

  it("repository-level idempotency converges even when the response ledger misses", async () => {
    // Simulate a response-ledger loss (fresh ledger, same Db): the repo
    // ledger + deterministic event ids must still converge.
    const api = await setup();
    const first = await readJson<IntentJson>(
      await requestJson(api.app, "/v1/intents", {
        token: "token-a",
        body: { objective: "SYNTH-objective-converge" },
        headers: { "idempotency-key": "SYNTH-converge-key" },
      }),
    );
    // Swap in an empty response ledger (a NEW app over the same db/clock/ids).
    const { createOrbbApi } = await import("./app.js");
    const { InMemoryIdempotencyLedger } = await import("./idempotency.js");
    const freshApp = createOrbbApi({
      principalVerifier: api.verifier,
      db: api.db,
      idempotency: new InMemoryIdempotencyLedger(),
      clock: api.clock,
      ids: api.ids,
      requestIds: {
        next: () => "req_SYNTH-fresh-ledger-00000001",
      },
    });
    const retry = await readJson<IntentJson>(
      await freshApp.request("/v1/intents", {
        method: "POST",
        headers: {
          authorization: "Bearer token-a",
          "content-type": "application/json",
          "idempotency-key": "SYNTH-converge-key",
        },
        body: JSON.stringify({ objective: "SYNTH-objective-converge" }),
      }),
    );
    expect(retry.id).toBe(first.id); // same stored record, no duplicate row
    const page = await readJson<PageJson>(
      await requestJson(api.app, "/v1/intents", { token: "token-a" }),
    );
    expect(page.items).toHaveLength(1);
    // ... and no second outbox event (deterministic event id dedupe).
    expect(
      api.db.listOutboxForTests().filter((event) => event.eventType === "INTENT_CREATED"),
    ).toHaveLength(1);
  });
});

describe("A24 concurrent duplicates", () => {
  it("a concurrent duplicate gets 409 (recorded choice: no waiting)", async () => {
    const api = await setup();
    const headers = {
      authorization: "Bearer token-a",
      "content-type": "application/json",
      "idempotency-key": "SYNTH-concurrent-key",
    };
    const body = JSON.stringify({ objective: "SYNTH-objective-concurrent" });
    const [first, second] = await Promise.all([
      api.app.request("/v1/intents", { method: "POST", headers, body }),
      api.app.request("/v1/intents", { method: "POST", headers, body }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = first.status === 409 ? first : second;
    const conflictBody = await readJson<ErrorBody>(conflict);
    expect(conflictBody.error.code).toBe("conflict");
    expect(conflict.headers.get("x-request-id")).toBe(conflictBody.error.requestId);
  });
});

describe("A24 header handling", () => {
  it("proceeds without dedupe when no Idempotency-Key is sent (minted internal key)", async () => {
    const api = await setup();
    const first = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-nokey-1" },
    });
    const second = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-nokey-2" },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotency-replayed")).toBeNull();
    const page = await readJson<PageJson>(
      await requestJson(api.app, "/v1/intents", { token: "token-a" }),
    );
    expect(page.items).toHaveLength(2);
  });

  it("rejects an empty Idempotency-Key with a 400 envelope", async () => {
    const api = await setup();
    const response = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-empty-key" },
      headers: { "idempotency-key": "" },
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("invalid-request");
  });

  it("rejects an over-length Idempotency-Key (> 256 chars) with a 400 envelope", async () => {
    const api = await setup();
    const response = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-long-key" },
      headers: { "idempotency-key": "x".repeat(257) },
    });
    expect(response.status).toBe(400);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("invalid-request");
    expect(body.error.message).not.toContain("xxx");
  });

  it("unauthenticated requests never consume claims (401 before the claim)", async () => {
    const api = await setup();
    const unauthenticated = await requestJson(api.app, "/v1/intents", {
      body: { objective: "SYNTH-objective-unauth" },
      headers: { "idempotency-key": "SYNTH-unauth-key" },
    });
    expect(unauthenticated.status).toBe(401);
    // The same key still works for a FIRST authenticated request.
    const authenticated = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: { objective: "SYNTH-objective-unauth" },
      headers: { "idempotency-key": "SYNTH-unauth-key" },
    });
    expect(authenticated.status).toBe(201);
    expect(authenticated.headers.get("idempotency-replayed")).toBeNull();
  });
});

describe("A24 error-response lifecycle", () => {
  it("a deterministic 422 is stored as the replayable original", async () => {
    const api = await setup();
    const headers = { "idempotency-key": "SYNTH-invalid-key" };
    const first = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: {},
      headers,
    });
    expect(first.status).toBe(422);
    const replay = await requestJson(api.app, "/v1/intents", {
      token: "token-a",
      body: {},
      headers,
    });
    expect(replay.status).toBe(422);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.text()).toBe(await first.text());
  });

  it("a 5xx ABANDONS the claim so a later retry re-executes", async () => {
    const api = createTestApi("idempotency-5xx");
    // Register a principal whose person row does NOT exist yet: the
    // intent insert trips the persons FK (plain driver error -> 500).
    api.verifier.register("token-ghost", {
      personId: "prsn_SYNTH-ghost-person-0000001" as never,
      roles: ["self"],
    });
    const headers = { "idempotency-key": "SYNTH-fivehundred-key" };
    const failing = await requestJson(api.app, "/v1/intents", {
      token: "token-ghost",
      body: { objective: "SYNTH-objective-retry" },
      headers,
    });
    expect(failing.status).toBe(500);
    expect((await readJson<ErrorBody>(failing)).error.code).toBe("internal-error");

    // The person row appears (signup completes); the SAME key retries.
    await api.db.transaction((uow) =>
      uow.persons.insert(
        { id: "prsn_SYNTH-ghost-person-0000001" as never, displayName: "SYNTH-Ghost" },
        { idempotencyKey: "ghost-person-seed" },
      ),
    );
    const retry = await requestJson(api.app, "/v1/intents", {
      token: "token-ghost",
      body: { objective: "SYNTH-objective-retry" },
      headers,
    });
    expect(retry.status).toBe(201); // claim was abandoned, not poisoned
    expect(retry.headers.get("idempotency-replayed")).toBeNull();
  });
});
