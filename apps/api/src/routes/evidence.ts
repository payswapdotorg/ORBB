/**
 * ORBB edge API — /v1/evidence/:id (M3-A, A21).
 *
 * Evidence-object metadata for the principal — person-scoped 404
 * semantics: a foreign id and a missing id are indistinguishable
 * (existence secrecy). The response carries the §5 operational field
 * list plus the upload-plane linkage; the envelope-encrypted sensitive
 * metadata is never serialized (see serialize.ts).
 */
import type { Hono } from "hono";
import type { EvidenceId } from "@orbb/domain";
import { apiNotFound } from "../errors.js";
import { serializeEvidenceMetadata } from "../serialize.js";
import { requirePrincipal } from "../principal.js";
import { parsePathId } from "../validation.js";
import type { ApiDependencies } from "../context.js";
import type { ApiEnv } from "../context.js";

export function registerEvidenceRoutes(router: Hono<ApiEnv>, deps: ApiDependencies): void {
  router.get("/evidence/:id", requirePrincipal(deps.principalVerifier), async (c) => {
    const principal = c.get("principal");
    const id = parsePathId("evidence", c.req.param("id")) as EvidenceId;
    const evidence = await deps.db.evidence.findById(id);
    if (evidence === undefined || evidence.personId !== principal.personId) {
      throw apiNotFound("Evidence object");
    }
    return c.json(serializeEvidenceMetadata(evidence), 200);
  });
}
