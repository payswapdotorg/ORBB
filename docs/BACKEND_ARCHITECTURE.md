# Backend Architecture

## 1. Shape

Use a TypeScript monorepo with a modular, event-driven backend. Do not begin with dozens of microservices. Start as a modular monolith plus explicit asynchronous workers; extract services only when scale, isolation, or regulatory boundaries require it.

```text
Mobile / Web / Clinic / Research / Extension
                  |
             Edge/API layer
                  |
        +---------+---------+
        |                   |
   Command/query API     Upload broker
        |                   |
        +---------+---------+
                  |
          Domain application
        +----+----+----+----+
        |    |    |    |    |
     Intent DataBox Consent Care Study Marketplace
        |    |    |    |    |
        +---------+---------+
                  |
          Domain event log
                  |
       Cloudflare Queues/Workers
          +------+------+------+
          |             |      |
       notifications  plans   adapters
                  |
       Neon PostgreSQL
        /             \
 structured ledger     pgvector/search
                  |
             Cloudflare R2
             raw evidence

Redis (Upstash) = cache/rate limit/idempotency/locks only
```

## 2. Repository architecture

```text
apps/
  web/                Next.js role-aware web app
  mobile/             Expo React Native app
  api/                Cloudflare Worker HTTP API
  worker/             Cloudflare Worker async consumers
packages/
  domain/             pure domain types and invariants
  db/                 Drizzle schema/migrations/repositories
  contracts/          OpenAPI + event + extension contracts
  auth/               sessions, passkeys, scoped tokens
  databox/            evidence/object abstractions and crypto
  measurement/        metrics, methods, plans, schedules
  consent/            grants, revocation, access evaluation
  fhir/               FHIR mapping and SMART integration
  extensions/         extension manifests/sandbox contracts
  research/            study/protocol primitives
  clinical/            clinician/care primitives
  ui/                  design system
  config/              environment/config schemas
  testkit/             fixtures, factories, deterministic clocks
  observability/       structured logging, tracing, redaction
```

## 3. API style

External API: versioned REST with OpenAPI 3.1. Internal domain interfaces are TypeScript contracts. Use idempotency keys for every mutating endpoint that can be retried.

Use resource-oriented commands such as:
- POST /v1/intents
- POST /v1/measurement-plans
- POST /v1/observations
- POST /v1/evidence/upload-sessions
- POST /v1/access-grants
- POST /v1/service-orders
- POST /v1/studies
- POST /v1/extensions/installations

Use cursor pagination. Never expose raw database IDs where opaque public identifiers are more appropriate.

## 4. Transaction rules

Every domain mutation runs inside a Postgres transaction. The transaction writes domain state plus an outbox event. Workers consume the outbox asynchronously. Handlers are idempotent using event IDs and idempotency keys.

Do not use Redis as a transaction coordinator. Do not assume queue exactly-once delivery.

## 5. Core schemas

### Identity
`Person`, `Account`, `Organization`, `Practitioner`, `CareTeam`, `RoleBinding`, `Device`, `MeasurementSource`.

### Intent
`HealthIntent(id, personId, objective, state, createdAt, evidencePackVersion, planId)`.

### Evidence/observation
`EvidenceObject(id, personId, objectKey, mediaType, sha256, capturedAt, sourceType, provenanceId, retentionClass)`.
`Observation(id, personId, conceptCode, value, unit, effectiveAt, observedAt, sourceId, methodId, evidenceId, quality, validationState, provenanceId)`.

### Measurement
`MetricDefinition`, `MeasurementMethod`, `MeasurementCapability`, `MeasurementPlan`, `PlanMetric`, `MeasurementTask`, `MeasurementWindow`, `MeasurementAttempt`, `ServiceOrder`.

### Access
`ConsentPolicy`, `AccessGrant`, `Purpose`, `Recipient`, `DataScope`, `AccessDecision`, `AccessAudit`, `Revocation`.

### Interpretation
`DerivedResult`, `ModelVersion`, `RuleVersion`, `EvidenceBasis`, `Uncertainty`, `SafetyFlag`.

### Marketplace
`Extension`, `ExtensionVersion`, `CapabilityManifest`, `PermissionManifest`, `Publisher`, `Installation`, `Price`, `Entitlement`, `MeasurementAdapter`.

### Clinical/research
`PatientLink`, `Encounter`, `CarePlan`, `ClinicalTask`, `Study`, `StudyVersion`, `EligibilityRule`, `Participant`, `StudyTask`, `Compensation`, `DataAccessRequest`, `StudyDataset`.

## 6. DataBox design

Use two planes:

1. Structured health ledger in Postgres.
2. Evidence/object plane in R2.

Every R2 object has a database metadata record before or atomically alongside publication. Objects are addressed by opaque object IDs and content hashes, not user-controlled paths.

Raw object upload flow:
1. authorize purpose/scope;
2. create upload session;
3. issue short-lived signed upload URL;
4. upload directly to R2;
5. verify object checksum and metadata;
6. finalize EvidenceObject transaction;
7. emit `EVIDENCE_INGESTED`;
8. queue extraction/transcoding/classification tasks;
9. retain original evidence.

Never send full PHI through PostHog, Sentry breadcrumbs, generic logs, queue metadata, or URLs.

## 7. Encryption and privacy

Use application-layer envelope encryption behind a `KeyProvider` interface. Each DataBox has one or more data-encryption keys; sensitive object payloads are encrypted before persistence where practical. Production key management is pluggable so development can use a secret-backed provider and regulated deployments can use a cloud KMS/HSM.

Access decisions are deny-by-default and computed from:
`subject + recipient + resource + purpose + operation + time + consent + policy + relationship + emergency state`.

Every access produces an immutable audit event.

## 8. AI boundary

AI services receive typed, minimized context. Models cannot directly mutate clinical state. A model may produce `Proposal`, `Summary`, `Extraction`, `Classification`, or `RecommendationDraft` artifacts; deterministic policy and authorized actors decide whether they become authoritative state.

AI-generated measurement extraction always retains source evidence and reports confidence plus model/version provenance.

## 9. Extension security

Extensions are untrusted. Manifest declares capabilities and permissions. Server-side extensions execute in a sandboxed runtime with no direct database credentials. Client extensions run in isolated webviews/iframes or native capability wrappers with explicit permission prompts.

Capabilities are narrow verbs, e.g.:
`READ_OBSERVATION(type)`, `CREATE_OBSERVATION(type)`, `READ_EVIDENCE(kind)`, `RUN_COMPUTATION`, `REQUEST_DEVICE_ACCESS`.

No `READ_ALL_DATABOX` capability exists.

## 10. Clinical interoperability

FHIR R4 is the boundary representation for clinical integrations. Internal storage can be optimized for application behavior but must map to FHIR resources with stable provenance. SMART on FHIR launches must use narrowly scoped OAuth authorization.

## 11. Event model

Canonical events include:
`INTENT_CREATED`, `PLAN_PUBLISHED`, `TASK_DUE`, `OBSERVATION_RECORDED`, `EVIDENCE_INGESTED`, `ACCESS_GRANTED`, `ACCESS_REVOKED`, `SERVICE_ORDER_CREATED`, `SERVICE_ORDER_FULFILLED`, `EXTENSION_INSTALLED`, `STUDY_ENROLLED`, `SAFETY_FLAG_RAISED`.

Events have:
`eventId, type, version, occurredAt, actor, subject, correlationId, causationId, payloadSchemaVersion`.

## 12. Why these providers

Neon PostgreSQL is preferred for the relational source of truth because its Free plan currently provides 100 projects, 100 CU-hours/project/month, 0.5 GB/project, and scale-to-zero behavior; it also exposes branching and pgvector-related ecosystem support. citeturn338507search0

Cloudflare R2 is the object plane because the current free tier includes 10 GB-month, 1M Class A operations, 10M Class B operations and no egress fees. citeturn900160search13

Cloudflare Workers/Queues provide a good asynchronous edge layer; the current Free plan includes Workers requests and Queues with 10,000 queue operations/day, while Queues provide retries and durable delivery semantics. citeturn900160search0turn900160search2turn900160search9

Upstash Redis is disposable coordination state; its current free Redis tier is $0/month with 256 MB and 10 GB bandwidth. citeturn647822search8

Vercel hosts the web application and preview deployments; the current Hobby tier is $0/month with automatic CI/CD, CDN, WAF/DDoS protections and usage limits suitable for early development. citeturn900160search6
