/**
 * ORBB edge API — GET /v1/me (M3-A).
 *
 * Person profile of the resolved principal. The principal seam
 * guarantees the personId grammar; a missing profile row is a data
 * integrity anomaly surfaced as a clean 404 envelope (recorded).
 */
import type { Hono } from "hono";
import { apiNotFound } from "../errors.js";
import { serializePerson } from "../serialize.js";
import { requirePrincipal } from "../principal.js";
import type { ApiDependencies } from "../context.js";
import type { ApiEnv } from "../context.js";

export function registerMeRoutes(router: Hono<ApiEnv>, deps: ApiDependencies): void {
  router.get("/me", requirePrincipal(deps.principalVerifier), async (c) => {
    const principal = c.get("principal");
    const person = await deps.db.persons.findById(principal.personId);
    if (person === undefined) {
      throw apiNotFound("Person profile for the authenticated principal");
    }
    return c.json(serializePerson(person), 200);
  });
}
