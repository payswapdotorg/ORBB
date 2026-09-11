/**
 * ORBB edge API — the /v1 router factory (M3-A, A21).
 *
 * `createOrbbApi(deps)` builds the full Hono application from INJECTED
 * dependencies (principal verifier, Db facade, A24 idempotency ledger,
 * clock, id sources). No live bindings, no globals — the Worker entry
 * resolves the dependencies from the environment, tests resolve them
 * from in-memory doubles.
 *
 * Middleware order (outermost → innermost):
 *   requestId → [route] requirePrincipal → withIdempotency → handler
 *
 * Surfaces:
 *   GET /healthz           public liveness probe (M0 contract, unchanged)
 *   GET /v1/openapi.json   public A26 OpenAPI 3.1 document
 *   /v1 person-scoped resources (see routes/)
 *
 * Every error — thrown or unmatched — renders through the standardized
 * envelope (errors.ts).
 */
import { Hono } from "hono";
import { errorHandler, notFoundHandler, requestIdMiddleware } from "./errors.js";
import { buildOpenApiDocument } from "./openapi.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerIntentsRoutes } from "./routes/intents.js";
import { registerObservationsRoutes } from "./routes/observations.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";
import type { ApiApp, ApiDependencies, ApiEnv } from "./context.js";

export function createOrbbApi(deps: ApiDependencies): ApiApp {
  const app = new Hono<ApiEnv>();

  app.use(requestIdMiddleware(deps.requestIds));
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.get("/healthz", (c) => c.json({ ok: true, service: "orbb-api" }));

  const v1 = new Hono<ApiEnv>();
  v1.get("/openapi.json", (c) => c.json(buildOpenApiDocument()));
  registerMeRoutes(v1, deps);
  registerIntentsRoutes(v1, deps);
  registerObservationsRoutes(v1, deps);
  registerEvidenceRoutes(v1, deps);
  app.route("/v1", v1);

  return app;
}
