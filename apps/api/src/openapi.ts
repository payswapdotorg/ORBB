/**
 * ORBB edge API — A26 OpenAPI 3.1 document.
 *
 * RECORDED CHOICE: the document is hand-built from route metadata kept
 * beside the router (single-file source of truth), served at
 * `GET /v1/openapi.json` (public: it carries no person data — every
 * example is synthetic and marked `SYNTH-`, matching the @orbb/testkit
 * fixture grammar). No OpenAPI-generation library — zero new runtime
 * deps; the contract test in `openapi.test.ts` proves the document and
 * the Hono router cannot drift (exact path+method set equality).
 *
 * Documented decisions mirrored here:
 *   - the standardized error envelope on every non-2xx response;
 *   - `Idempotency-Key` on every mutating operation (A24);
 *   - cursor pagination envelopes (`nextCursor: string | null`,
 *     `hasMore: boolean`);
 *   - 401 on principal-scoped routes (the auth scheme itself lands with
 *     A22/A23 — `bearerAuth` is the documented placeholder, and the
 *     description says so);
 *   - `/healthz` is an infrastructure probe OUTSIDE `/v1` (the document
 *     scopes the versioned public API; the probe is described in
 *     `info.description`).
 */
import { EVIDENCE_LABELS } from "@orbb/domain";

/** Minimal structural typing for the hand-built document. */
export type OpenApiJson = Record<string, unknown>;

export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: readonly { readonly url: string; readonly description: string }[];
  readonly paths: Readonly<Record<string, OpenApiJson>>;
  readonly components: OpenApiJson;
}

// ---------------------------------------------------------------------------
// Synthetic example ids (obviously fake; testkit grammar).
// ---------------------------------------------------------------------------

const EXAMPLE_PERSON_ID = "prsn_SYNTH-openapi-00000001";
const EXAMPLE_INTENT_ID = "intent_SYNTH-openapi-00000002";
const EXAMPLE_OBSERVATION_ID = "obs_SYNTH-openapi-00000003";
const EXAMPLE_EVIDENCE_ID = "evid_SYNTH-openapi-00000004";
const EXAMPLE_SOURCE_ID = "src_SYNTH-openapi-00000005";
const EXAMPLE_PROVENANCE_ID = "prov_SYNTH-openapi-00000006";
const EXAMPLE_REQUEST_ID = "req_SYNTH-openapi-00000007";
const EXAMPLE_CURSOR = "SYNTH-opaque-cursor-value-not-a-real-cursor";

const CANONICAL_ID_PATTERN = "^[a-z]+_[A-Za-z0-9_-]{16,128}$";

// ---------------------------------------------------------------------------
// Reusable pieces.
// ---------------------------------------------------------------------------

const ERROR_BODY_SCHEMA: OpenApiJson = {
  type: "object",
  description: "Standardized API error (architecture §3). The stable contract is the code, never the message.",
  required: ["code", "message", "requestId"],
  properties: {
    code: {
      type: "string",
      enum: [
        "invalid-request",
        "unauthenticated",
        "forbidden",
        "not-found",
        "conflict",
        "validation-failed",
        "rate-limited",
        "internal-error",
      ],
    },
    message: { type: "string", description: "PHI-safe description of the violated invariant." },
    details: {
      type: "object",
      description: "Optional structured details (e.g. validation issues with field paths).",
      additionalProperties: true,
    },
    requestId: { type: "string", description: "The request id echoed/minted for this request." },
  },
  example: {
    code: "not-found",
    message: "Intent not found.",
    requestId: EXAMPLE_REQUEST_ID,
  },
};

const ERROR_ENVELOPE_SCHEMA: OpenApiJson = {
  type: "object",
  required: ["error"],
  properties: { error: { $ref: "#/components/schemas/ErrorBody" } },
};

const ERROR_RESPONSES: Record<string, OpenApiJson> = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthenticated" },
  "404": { $ref: "#/components/responses/NotFound" },
  "422": { $ref: "#/components/responses/ValidationFailed" },
  "500": { $ref: "#/components/responses/InternalError" },
};

const MUTATING_ERROR_RESPONSES: Record<string, OpenApiJson> = {
  ...ERROR_RESPONSES,
  "409": { $ref: "#/components/responses/Conflict" },
};

const CURSOR_QUERY_PARAM: OpenApiJson = {
  name: "cursor",
  in: "query",
  required: false,
  description: "Opaque pagination cursor from a previous `nextCursor`.",
  schema: { type: "string", minLength: 1 },
  example: EXAMPLE_CURSOR,
};

const LIMIT_QUERY_PARAM: OpenApiJson = {
  name: "limit",
  in: "query",
  required: false,
  description: "Page size (integer between 1 and 200; default 50).",
  schema: { type: "integer", minimum: 1, maximum: 200 },
  example: 50,
};

const IDEMPOTENCY_KEY_HEADER: OpenApiJson = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Caller-generated idempotency key (1-256 characters). Retrying the same mutation with the same key replays the original response; a concurrent duplicate gets 409.",
  schema: { type: "string", minLength: 1, maxLength: 256 },
  example: "SYNTH-idempotency-key-0001",
};

const REQUEST_ID_HEADER_PARAM: OpenApiJson = {
  name: "x-request-id",
  in: "header",
  required: false,
  description: "Echoed on every response when well-formed; otherwise a fresh id is minted.",
  schema: { type: "string", minLength: 1, maxLength: 128 },
  example: EXAMPLE_REQUEST_ID,
};

const IDEMPOTENCY_REPLAYED_HEADER: OpenApiJson = {
  description: "Present (true) when this response is an idempotent replay of the original.",
  schema: { type: "string", enum: ["true"] },
};

const PAGEEnvelopeProperties = (itemRef: string): OpenApiJson => ({
  type: "object",
  required: ["items", "nextCursor", "hasMore"],
  properties: {
    items: { type: "array", items: { $ref: itemRef } },
    nextCursor: {
      type: ["string", "null"],
      description: "Cursor to the next page; null when the iteration is exhausted.",
    },
    hasMore: {
      type: "boolean",
      description: "True iff more rows may follow (nextCursor is non-null).",
    },
  },
});

const ID_PARAM = (name: string, example: string, description: string): OpenApiJson => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", pattern: CANONICAL_ID_PATTERN },
  example,
});

const JSON_MEDIA = (schemaRef: string, example: OpenApiJson): OpenApiJson => ({
  "application/json": { schema: { $ref: schemaRef }, example },
});

// ---------------------------------------------------------------------------
// Resource schemas.
// ---------------------------------------------------------------------------

const PERSON_PROFILE_SCHEMA: OpenApiJson = {
  type: "object",
  required: ["id", "displayName"],
  properties: {
    id: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_PERSON_ID },
    displayName: { type: "string", example: "SYNTH-Person-00000001" },
  },
};

const INTENT_SCHEMA: OpenApiJson = {
  type: "object",
  required: ["id", "personId", "objective", "state", "createdAt"],
  properties: {
    id: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_INTENT_ID },
    personId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_PERSON_ID },
    objective: { type: "string", example: "SYNTH-objective-00000001" },
    state: { type: "string", enum: ["draft", "active", "paused", "achieved", "retired"] },
    createdAt: { type: "string", format: "date-time", example: "2026-01-01T00:00:00.000Z" },
    evidencePackVersion: { type: "integer", minimum: 1 },
    planId: { type: "string", pattern: CANONICAL_ID_PATTERN },
  },
};

const INTENT_CREATE_SCHEMA: OpenApiJson = {
  type: "object",
  required: ["objective"],
  properties: {
    objective: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description: "Free-text objective statement (the server derives id, state, createdAt).",
      example: "SYNTH-objective-00000001",
    },
  },
  additionalProperties: false,
};

const OBSERVATION_SCHEMA: OpenApiJson = {
  type: "object",
  required: [
    "id",
    "personId",
    "conceptCode",
    "value",
    "unit",
    "effectiveAt",
    "observedAt",
    "sourceId",
    "methodId",
    "validationState",
    "provenanceId",
    "evidenceLabel",
  ],
  properties: {
    id: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_OBSERVATION_ID },
    personId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_PERSON_ID },
    conceptCode: { type: "string", example: "SYNTH-8867-4" },
    value: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }], example: 72 },
    unit: { type: "string", example: "SYNTH-unit" },
    effectiveAt: { type: "string", format: "date-time", example: "2026-01-01T00:00:00.000Z" },
    observedAt: { type: "string", format: "date-time", example: "2026-01-01T00:00:01.000Z" },
    sourceId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_SOURCE_ID },
    methodId: { type: "string", example: "SYNTH-method-manual" },
    validationState: { type: "string", enum: ["pending", "validated", "rejected", "superseded"] },
    provenanceId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_PROVENANCE_ID },
    evidenceLabel: { type: "string", enum: [...EVIDENCE_LABELS] },
    evidenceId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_EVIDENCE_ID },
    quality: { type: "number", minimum: 0, maximum: 1 },
    supersedesId: { type: "string", pattern: CANONICAL_ID_PATTERN },
  },
};

const OBSERVATION_CREATE_SCHEMA: OpenApiJson = {
  type: "object",
  required: [
    "conceptCode",
    "value",
    "unit",
    "effectiveAt",
    "observedAt",
    "sourceId",
    "methodId",
    "evidenceLabel",
  ],
  properties: {
    conceptCode: { type: "string", minLength: 1, maxLength: 128, example: "SYNTH-8867-4" },
    value: {
      oneOf: [
        { type: "string", minLength: 1, maxLength: 512 },
        { type: "number" },
        { type: "boolean" },
      ],
      example: 72,
    },
    unit: { type: "string", maxLength: 64, example: "SYNTH-unit" },
    effectiveAt: { type: "string", format: "date-time", example: "2026-01-01T00:00:00.000Z" },
    observedAt: { type: "string", format: "date-time", example: "2026-01-01T00:00:01.000Z" },
    sourceId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_SOURCE_ID },
    methodId: { type: "string", minLength: 1, maxLength: 128, example: "SYNTH-method-manual" },
    evidenceLabel: { type: "string", enum: [...EVIDENCE_LABELS], example: "MEASURED" },
    evidenceId: {
      type: "string",
      pattern: CANONICAL_ID_PATTERN,
      description: "Optional link to the principal's own evidence object.",
      example: EXAMPLE_EVIDENCE_ID,
    },
    quality: { type: "number", minimum: 0, maximum: 1, example: 0.9 },
  },
  additionalProperties: false,
};

const EVIDENCE_METADATA_SCHEMA: OpenApiJson = {
  type: "object",
  required: [
    "id",
    "personId",
    "objectKey",
    "mediaType",
    "sha256",
    "sizeBytes",
    "capturedAt",
    "sourceType",
    "provenanceId",
    "retentionClass",
    "state",
  ],
  properties: {
    id: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_EVIDENCE_ID },
    personId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_PERSON_ID },
    objectKey: {
      type: "string",
      description: "Opaque content-addressed object key.",
      example: `evidence/v1/${EXAMPLE_EVIDENCE_ID}/SYNTH-sha256-hex-not-a-real-digest`,
    },
    mediaType: { type: "string", example: "image/jpeg" },
    sha256: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      example: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    sizeBytes: { type: "integer", minimum: 0, example: 42 },
    capturedAt: { type: "string", format: "date-time", example: "2026-01-01T00:00:00.000Z" },
    sourceType: { type: "string", example: "upload" },
    provenanceId: { type: "string", pattern: CANONICAL_ID_PATTERN, example: EXAMPLE_PROVENANCE_ID },
    retentionClass: { type: "string", example: "original" },
    state: { type: "string", enum: ["active"] },
    createdAt: { type: "string", format: "date-time" },
    sessionId: { type: "string", pattern: CANONICAL_ID_PATTERN },
  },
  description:
    "Operational metadata only. The envelope-encrypted sensitive metadata is never returned by this API.",
};

// ---------------------------------------------------------------------------
// Document assembly.
// ---------------------------------------------------------------------------

function errorResponse(description: string, exampleCode: string, exampleMessage: string): OpenApiJson {
  return {
    description,
    headers: {
      "x-request-id": REQUEST_ID_HEADER_PARAM,
    },
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorEnvelope" },
        example: {
          error: { code: exampleCode, message: exampleMessage, requestId: EXAMPLE_REQUEST_ID },
        },
      },
    },
  };
}

/** Builds the OpenAPI 3.1 document for the /v1 surface. */
export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, OpenApiJson> = {
    "/me": {
      get: {
        operationId: "getMe",
        summary: "Person profile of the authenticated principal",
        security: [{ bearerAuth: [] }],
        parameters: [REQUEST_ID_HEADER_PARAM],
        responses: {
          "200": {
            description: "The principal's person profile.",
            headers: { "x-request-id": REQUEST_ID_HEADER_PARAM },
            content: JSON_MEDIA("#/components/schemas/PersonProfile", {
              id: EXAMPLE_PERSON_ID,
              displayName: "SYNTH-Person-00000001",
            }),
          },
          ...ERROR_RESPONSES,
        },
      },
    },
    "/intents": {
      post: {
        operationId: "createIntent",
        summary: "Create a draft health intent for the principal",
        security: [{ bearerAuth: [] }],
        parameters: [REQUEST_ID_HEADER_PARAM, IDEMPOTENCY_KEY_HEADER],
        requestBody: {
          required: true,
          content: JSON_MEDIA("#/components/schemas/IntentCreateRequest", {
            objective: "SYNTH-objective-00000001",
          }),
        },
        responses: {
          "201": {
            description: "The created intent (state is always draft).",
            headers: {
              "x-request-id": REQUEST_ID_HEADER_PARAM,
              Location: {
                description: "The canonical path of the created intent.",
                schema: { type: "string" },
              },
              "Idempotency-Replayed": IDEMPOTENCY_REPLAYED_HEADER,
            },
            content: JSON_MEDIA("#/components/schemas/Intent", {
              id: EXAMPLE_INTENT_ID,
              personId: EXAMPLE_PERSON_ID,
              objective: "SYNTH-objective-00000001",
              state: "draft",
              createdAt: "2026-01-01T00:00:00.000Z",
            }),
          },
          ...MUTATING_ERROR_RESPONSES,
        },
      },
      get: {
        operationId: "listIntents",
        summary: "List the principal's intents (newest-first, cursor pagination)",
        security: [{ bearerAuth: [] }],
        parameters: [REQUEST_ID_HEADER_PARAM, CURSOR_QUERY_PARAM, LIMIT_QUERY_PARAM],
        responses: {
          "200": {
            description: "A page of intents.",
            headers: { "x-request-id": REQUEST_ID_HEADER_PARAM },
            content: JSON_MEDIA("#/components/schemas/IntentPage", {
              items: [
                {
                  id: EXAMPLE_INTENT_ID,
                  personId: EXAMPLE_PERSON_ID,
                  objective: "SYNTH-objective-00000001",
                  state: "draft",
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ],
              nextCursor: null,
              hasMore: false,
            }),
          },
          ...ERROR_RESPONSES,
        },
      },
    },
    "/intents/{id}": {
      get: {
        operationId: "getIntent",
        summary: "Fetch one of the principal's intents",
        description:
          "404 for ANY id that is not the principal's own — missing and foreign ids are indistinguishable (existence secrecy).",
        security: [{ bearerAuth: [] }],
        parameters: [
          REQUEST_ID_HEADER_PARAM,
          ID_PARAM("id", EXAMPLE_INTENT_ID, "Opaque intent id."),
        ],
        responses: {
          "200": {
            description: "The intent.",
            headers: { "x-request-id": REQUEST_ID_HEADER_PARAM },
            content: JSON_MEDIA("#/components/schemas/Intent", {
              id: EXAMPLE_INTENT_ID,
              personId: EXAMPLE_PERSON_ID,
              objective: "SYNTH-objective-00000001",
              state: "draft",
              createdAt: "2026-01-01T00:00:00.000Z",
            }),
          },
          ...ERROR_RESPONSES,
        },
      },
    },
    "/observations": {
      post: {
        operationId: "createObservation",
        summary: "Record an observation for the principal",
        description:
          "The personId is always the principal's; validationState is always pending; provenance is synthesized server-side in the same transaction. evidenceId must reference the principal's own evidence object.",
        security: [{ bearerAuth: [] }],
        parameters: [REQUEST_ID_HEADER_PARAM, IDEMPOTENCY_KEY_HEADER],
        requestBody: {
          required: true,
          content: JSON_MEDIA("#/components/schemas/ObservationCreateRequest", {
            conceptCode: "SYNTH-8867-4",
            value: 72,
            unit: "SYNTH-unit",
            effectiveAt: "2026-01-01T00:00:00.000Z",
            observedAt: "2026-01-01T00:00:01.000Z",
            sourceId: EXAMPLE_SOURCE_ID,
            methodId: "SYNTH-method-manual",
            evidenceLabel: "MEASURED",
          }),
        },
        responses: {
          "201": {
            description: "The recorded observation (validationState is pending).",
            headers: {
              "x-request-id": REQUEST_ID_HEADER_PARAM,
              Location: {
                description: "The canonical path of the created observation.",
                schema: { type: "string" },
              },
              "Idempotency-Replayed": IDEMPOTENCY_REPLAYED_HEADER,
            },
            content: JSON_MEDIA("#/components/schemas/Observation", {
              id: EXAMPLE_OBSERVATION_ID,
              personId: EXAMPLE_PERSON_ID,
              conceptCode: "SYNTH-8867-4",
              value: 72,
              unit: "SYNTH-unit",
              effectiveAt: "2026-01-01T00:00:00.000Z",
              observedAt: "2026-01-01T00:00:01.000Z",
              sourceId: EXAMPLE_SOURCE_ID,
              methodId: "SYNTH-method-manual",
              validationState: "pending",
              provenanceId: EXAMPLE_PROVENANCE_ID,
              evidenceLabel: "MEASURED",
            }),
          },
          ...MUTATING_ERROR_RESPONSES,
        },
      },
      get: {
        operationId: "listObservations",
        summary: "List the principal's observations (newest-first, cursor pagination)",
        security: [{ bearerAuth: [] }],
        parameters: [
          REQUEST_ID_HEADER_PARAM,
          CURSOR_QUERY_PARAM,
          LIMIT_QUERY_PARAM,
          {
            name: "conceptCode",
            in: "query",
            required: false,
            description: "Optional terminology filter (e.g. a LOINC concept code).",
            schema: { type: "string", minLength: 1, maxLength: 128 },
            example: "SYNTH-8867-4",
          },
        ],
        responses: {
          "200": {
            description: "A page of observations.",
            headers: { "x-request-id": REQUEST_ID_HEADER_PARAM },
            content: JSON_MEDIA("#/components/schemas/ObservationPage", {
              items: [
                {
                  id: EXAMPLE_OBSERVATION_ID,
                  personId: EXAMPLE_PERSON_ID,
                  conceptCode: "SYNTH-8867-4",
                  value: 72,
                  unit: "SYNTH-unit",
                  effectiveAt: "2026-01-01T00:00:00.000Z",
                  observedAt: "2026-01-01T00:00:01.000Z",
                  sourceId: EXAMPLE_SOURCE_ID,
                  methodId: "SYNTH-method-manual",
                  validationState: "pending",
                  provenanceId: EXAMPLE_PROVENANCE_ID,
                  evidenceLabel: "MEASURED",
                },
              ],
              nextCursor: null,
              hasMore: false,
            }),
          },
          ...ERROR_RESPONSES,
        },
      },
    },
    "/observations/{id}": {
      get: {
        operationId: "getObservation",
        summary: "Fetch one of the principal's observations",
        description:
          "404 for ANY id that is not the principal's own — missing and foreign ids are indistinguishable (existence secrecy).",
        security: [{ bearerAuth: [] }],
        parameters: [
          REQUEST_ID_HEADER_PARAM,
          ID_PARAM("id", EXAMPLE_OBSERVATION_ID, "Opaque observation id."),
        ],
        responses: {
          "200": {
            description: "The observation.",
            headers: { "x-request-id": REQUEST_ID_HEADER_PARAM },
            content: JSON_MEDIA("#/components/schemas/Observation", {
              id: EXAMPLE_OBSERVATION_ID,
              personId: EXAMPLE_PERSON_ID,
              conceptCode: "SYNTH-8867-4",
              value: 72,
              unit: "SYNTH-unit",
              effectiveAt: "2026-01-01T00:00:00.000Z",
              observedAt: "2026-01-01T00:00:01.000Z",
              sourceId: EXAMPLE_SOURCE_ID,
              methodId: "SYNTH-method-manual",
              validationState: "pending",
              provenanceId: EXAMPLE_PROVENANCE_ID,
              evidenceLabel: "MEASURED",
            }),
          },
          ...ERROR_RESPONSES,
        },
      },
    },
    "/evidence/{id}": {
      get: {
        operationId: "getEvidenceMetadata",
        summary: "Fetch metadata of one of the principal's evidence objects",
        description:
          "404 for ANY id that is not the principal's own — missing and foreign ids are indistinguishable (existence secrecy).",
        security: [{ bearerAuth: [] }],
        parameters: [
          REQUEST_ID_HEADER_PARAM,
          ID_PARAM("id", EXAMPLE_EVIDENCE_ID, "Opaque evidence object id."),
        ],
        responses: {
          "200": {
            description: "The evidence object's operational metadata.",
            headers: { "x-request-id": REQUEST_ID_HEADER_PARAM },
            content: JSON_MEDIA("#/components/schemas/EvidenceMetadata", {
              id: EXAMPLE_EVIDENCE_ID,
              personId: EXAMPLE_PERSON_ID,
              objectKey: `evidence/v1/${EXAMPLE_EVIDENCE_ID}/SYNTH-sha256-hex-not-a-real-digest`,
              mediaType: "image/jpeg",
              sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              sizeBytes: 42,
              capturedAt: "2026-01-01T00:00:00.000Z",
              sourceType: "upload",
              provenanceId: EXAMPLE_PROVENANCE_ID,
              retentionClass: "original",
              state: "active",
            }),
          },
          ...ERROR_RESPONSES,
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        summary: "This OpenAPI 3.1 document (public)",
        parameters: [REQUEST_ID_HEADER_PARAM],
        responses: {
          "200": {
            description: "The OpenAPI 3.1 document describing the /v1 surface.",
            headers: { "x-request-id": REQUEST_ID_HEADER_PARAM },
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "ORBB Personal Health Operating System — Public API",
      version: "1.0.0",
      description:
        "The versioned REST surface (architecture §3). Every error uses the standardized envelope { error: { code, message, details?, requestId } }. Mutations accept an Idempotency-Key (retries replay the original response; concurrent duplicates get 409). List endpoints paginate with opaque cursors, newest-first. Ids are opaque — never raw database ids. All examples are synthetic (SYNTH- marked); no real person data appears anywhere in this document. The authentication scheme is a documented placeholder — the real verifier (passkeys/sessions/scoped tokens) lands with the identity milestone. /healthz is an infrastructure liveness probe outside the /v1 surface: GET /healthz returns { ok: true, service: 'orbb-api' }.",
    },
    servers: [
      {
        url: "/v1",
        description: "The versioned REST surface (mounted under /v1).",
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Placeholder scheme: the principal verifier seam resolves the request to { personId, roles } or answers 401. The concrete credential format is owned by the identity milestone.",
        },
      },
      schemas: {
        ErrorEnvelope: ERROR_ENVELOPE_SCHEMA,
        ErrorBody: ERROR_BODY_SCHEMA,
        PersonProfile: PERSON_PROFILE_SCHEMA,
        Intent: INTENT_SCHEMA,
        IntentCreateRequest: INTENT_CREATE_SCHEMA,
        IntentPage: PAGEEnvelopeProperties("#/components/schemas/Intent"),
        Observation: OBSERVATION_SCHEMA,
        ObservationCreateRequest: OBSERVATION_CREATE_SCHEMA,
        ObservationPage: PAGEEnvelopeProperties("#/components/schemas/Observation"),
        EvidenceMetadata: EVIDENCE_METADATA_SCHEMA,
      },
      parameters: {
        CursorQuery: CURSOR_QUERY_PARAM,
        LimitQuery: LIMIT_QUERY_PARAM,
        IdempotencyKeyHeader: IDEMPOTENCY_KEY_HEADER,
        RequestIdHeader: REQUEST_ID_HEADER_PARAM,
      },
      responses: {
        BadRequest: errorResponse(
          "Malformed transport input (unparseable JSON, bad query/header values).",
          "invalid-request",
          "Request body is not valid JSON.",
        ),
        Unauthenticated: errorResponse(
          "No principal could be resolved for this request.",
          "unauthenticated",
          "Authentication is required: no principal could be resolved for this request.",
        ),
        NotFound: errorResponse(
          "Unknown route, or the resource does not exist for this principal (missing and foreign are indistinguishable).",
          "not-found",
          "Intent not found.",
        ),
        Conflict: errorResponse(
          "Idempotency claim in flight for this key+route+principal, or a persistence state conflict.",
          "conflict",
          "An idempotent request with this key is still in flight for this route; retry after it completes.",
        ),
        ValidationFailed: errorResponse(
          "Well-formed JSON that violates the domain input contract.",
          "validation-failed",
          "Invalid intent creation request.",
        ),
        InternalError: errorResponse(
          "Internal failure (transaction integrity or an unexpected error).",
          "internal-error",
          "An internal error occurred.",
        ),
      },
    },
  };
}
