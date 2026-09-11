/**
 * ORBB edge API — /v1/observations (M3-A, A21).
 *
 *   POST /v1/observations        record an observation for the principal
 *                                (A24 idempotency; synthesized provenance)
 *   GET  /v1/observations        the principal's observations, newest-first
 *                                (cursor; optional conceptCode filter)
 *   GET  /v1/observations/:id    one observation — uniform 404 on ids that
 *                                are not the principal's own
 *
 * Creation contract (recorded decisions):
 *   - A principal can ONLY create observations for THEMSELVES: the
 *     personId is always the principal's (no client-supplied personId
 *     is accepted — cross-person creation is impossible by construction).
 *   - `validationState` is ALWAYS "pending" (the state machine's entry
 *     state; validation is a separate downstream flow, not a client
 *     input). `supersedesId` is not settable through this endpoint (the
 *     amendment flow is separate).
 *   - PROVENANCE (architecture rule: every observation needs provenance):
 *     the endpoint synthesizes a provenance record inside the SAME
 *     transaction — actor = subject = the principal, `occurredAt` = the
 *     observation's `observedAt`, and a provenance id DETERMINISTIC in
 *     the idempotency repo key (the M2-D synthesized-upload-provenance
 *     precedent: crash retries converge on the same row). Clients cannot
 *     attach arbitrary provenance.
 *   - `evidenceId`, when supplied, must reference the principal's OWN
 *     existing evidence object: missing or foreign ids are a 422 (body
 *     semantic violation; a foreign id reveals nothing about existence).
 *   - The OBSERVATION_RECORDED outbox event commits in the same
 *     transaction (§4); its id is deterministic in the repo key, and its
 *     payload carries opaque ids and timestamps only (no values, no
 *     concept codes — PHI-conservative).
 */
import type { Hono } from "hono";
import {
  ID_PREFIXES,
  parseQualityScore,
  type EvidenceId,
  type Observation,
  type ObservationId,
} from "@orbb/domain";
import type { EventId } from "@orbb/contracts";
import { ApiError, apiNotFound } from "../errors.js";
import { serializeObservation, pageEnvelope } from "../serialize.js";
import { requirePrincipal } from "../principal.js";
import { withIdempotencyDeps } from "../idempotency.js";
import { deriveObservationProvenanceId, deriveObservationRecordedEventId } from "../ids.js";
import {
  parseConceptCodeFilter,
  parseObservationCreateBody,
  parsePageQuery,
  parsePathId,
  readJsonObjectBody,
} from "../validation.js";
import type { ApiDependencies } from "../context.js";
import type { ApiEnv } from "../context.js";

/** POST /v1/observations route template (the A24 claim scope). */
export const OBSERVATIONS_CREATE_ROUTE = "POST /v1/observations";

export function registerObservationsRoutes(router: Hono<ApiEnv>, deps: ApiDependencies): void {
  const withIdempotency = withIdempotencyDeps({ ids: deps.ids, ledger: deps.idempotency });

  router.post(
    "/observations",
    requirePrincipal(deps.principalVerifier),
    withIdempotency(OBSERVATIONS_CREATE_ROUTE),
    async (c) => {
      const principal = c.get("principal");
      const repoKey = c.get("idempotencyRepoKey");
      const input = parseObservationCreateBody(await readJsonObjectBody(c));

      if (input.evidenceId !== undefined) {
        const evidence = await deps.db.evidence.findById(input.evidenceId);
        if (evidence === undefined || evidence.personId !== principal.personId) {
          throw new ApiError(
            "validation-failed",
            "Invalid observation creation request: the evidence reference does not name the principal's own evidence object.",
            {
              details: {
                issues: [
                  {
                    field: "evidenceId",
                    problem:
                      "must reference an existing evidence object that belongs to the authenticated person",
                  },
                ],
              },
            },
          );
        }
      }

      // Synthesized provenance (see module docs): deterministic id in the
      // repo key, so crash retries converge on the same provenance row.
      const provenanceId = (await deriveObservationProvenanceId(
        repoKey,
      )) as Observation["provenanceId"];

      const observation: Observation = {
        id: deps.ids.next(ID_PREFIXES.observation) as ObservationId,
        personId: principal.personId,
        conceptCode: input.conceptCode,
        value: input.value,
        unit: input.unit,
        effectiveAt: input.effectiveAt,
        observedAt: input.observedAt,
        sourceId: input.sourceId,
        methodId: input.methodId,
        validationState: "pending",
        provenanceId,
        evidenceLabel: input.evidenceLabel,
        ...(input.evidenceId !== undefined ? { evidenceId: input.evidenceId as EvidenceId } : {}),
        ...(input.quality !== undefined ? { quality: parseQualityScore(input.quality) } : {}),
      };
      const eventId = await deriveObservationRecordedEventId(repoKey);

      const stored = await deps.db.transaction(async (uow) => {
        await uow.provenances.insert(
          {
            provenanceId,
            actor: principal.personId,
            subject: principal.personId,
            occurredAt: observation.observedAt,
          },
          { idempotencyKey: `${repoKey}:prov` },
        );
        const row = await uow.observations.insert(observation, { idempotencyKey: repoKey });
        await uow.appendEvent({
          eventId: eventId as EventId,
          eventType: "OBSERVATION_RECORDED",
          payload: JSON.stringify({
            type: "OBSERVATION_RECORDED" as const,
            eventId,
            observationId: row.id,
            personId: row.personId,
            occurredAt: row.observedAt.toISOString(),
          }),
        });
        return row;
      });

      c.header("location", `/v1/observations/${stored.id}`);
      return c.json(serializeObservation(stored), 201);
    },
  );

  router.get("/observations", requirePrincipal(deps.principalVerifier), async (c) => {
    const principal = c.get("principal");
    const page = parsePageQuery(c);
    const conceptCode = parseConceptCodeFilter(c);
    const result =
      conceptCode !== undefined
        ? await deps.db.observations.listByPersonAndConcept(principal.personId, conceptCode, page)
        : await deps.db.observations.listByPerson(principal.personId, page);
    return c.json(pageEnvelope(result.items.map(serializeObservation), result.nextCursor), 200);
  });

  router.get("/observations/:id", requirePrincipal(deps.principalVerifier), async (c) => {
    const principal = c.get("principal");
    const id = parsePathId("observation", c.req.param("id")) as ObservationId;
    const observation = await deps.db.observations.findById(id);
    if (observation === undefined || observation.personId !== principal.personId) {
      throw apiNotFound("Observation");
    }
    return c.json(serializeObservation(observation), 200);
  });
}
