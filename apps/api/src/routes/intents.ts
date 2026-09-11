/**
 * ORBB edge API — /v1/intents (M3-A, A21).
 *
 *   POST /v1/intents        create a draft intent for the principal (A24)
 *   GET  /v1/intents        the principal's intents, newest-first (cursor)
 *   GET  /v1/intents/:id    one intent — 404 on ANY id that is not the
 *                           principal's own (missing, foreign, malformed:
 *                           uniform 404, existence never leaked)
 *
 * Creation contract (recorded):
 *   - The client supplies ONLY `objective`. The server derives the
 *     opaque `intent_` id, `state: "draft"` (the state machine's entry
 *     state), and `createdAt` from the injected clock.
 *   - The mutation runs in ONE Db transaction with the INTENT_CREATED
 *     outbox event (architecture §4). The outbox event id is
 *     deterministic in the idempotency repo key, so crash retries
 *     converge on the same event row (M2-D precedent).
 *   - The event payload carries opaque ids and timestamps ONLY — the
 *     free-text objective never enters the event stream (PHI).
 */
import type { Hono } from "hono";
import { ID_PREFIXES, type HealthIntent, type IntentId } from "@orbb/domain";
import type { EventId } from "@orbb/contracts";
import { apiNotFound } from "../errors.js";
import { serializeIntent, pageEnvelope } from "../serialize.js";
import { requirePrincipal } from "../principal.js";
import { withIdempotencyDeps } from "../idempotency.js";
import { deriveIntentCreatedEventId } from "../ids.js";
import { parseIntentCreateBody, parsePageQuery, parsePathId, readJsonObjectBody } from "../validation.js";
import type { ApiDependencies } from "../context.js";
import type { ApiEnv } from "../context.js";

/** POST /v1/intents route template (the A24 claim scope). */
export const INTENTS_CREATE_ROUTE = "POST /v1/intents";

export function registerIntentsRoutes(router: Hono<ApiEnv>, deps: ApiDependencies): void {
  const withIdempotency = withIdempotencyDeps({ ids: deps.ids, ledger: deps.idempotency });

  router.post(
    "/intents",
    requirePrincipal(deps.principalVerifier),
    withIdempotency(INTENTS_CREATE_ROUTE),
    async (c) => {
      const principal = c.get("principal");
      const repoKey = c.get("idempotencyRepoKey");
      const input = parseIntentCreateBody(await readJsonObjectBody(c));

      const intent: HealthIntent = {
        id: deps.ids.next(ID_PREFIXES.intent) as IntentId,
        personId: principal.personId,
        objective: input.objective,
        state: "draft",
        createdAt: deps.clock.now(),
      };
      const eventId = await deriveIntentCreatedEventId(repoKey);

      const stored = await deps.db.transaction(async (uow) => {
        const row = await uow.intents.insert(intent, { idempotencyKey: repoKey });
        await uow.appendEvent({
          eventId: eventId as EventId,
          eventType: "INTENT_CREATED",
          payload: JSON.stringify({
            type: "INTENT_CREATED" as const,
            eventId,
            intentId: row.id,
            personId: row.personId,
            occurredAt: row.createdAt.toISOString(),
          }),
        });
        return row;
      });

      c.header("location", `/v1/intents/${stored.id}`);
      return c.json(serializeIntent(stored), 201);
    },
  );

  router.get("/intents", requirePrincipal(deps.principalVerifier), async (c) => {
    const principal = c.get("principal");
    const page = parsePageQuery(c);
    const result = await deps.db.intents.listByPerson(principal.personId, page);
    return c.json(pageEnvelope(result.items.map(serializeIntent), result.nextCursor), 200);
  });

  router.get("/intents/:id", requirePrincipal(deps.principalVerifier), async (c) => {
    const principal = c.get("principal");
    const id = parsePathId("intent", c.req.param("id")) as IntentId;
    const intent = await deps.db.intents.findById(id);
    if (intent === undefined || intent.personId !== principal.personId) {
      throw apiNotFound("Intent");
    }
    return c.json(serializeIntent(intent), 200);
  });
}
