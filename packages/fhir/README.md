# @orbb/fhir — the deterministic internal→FHIR R4 boundary mapper

> Backend architecture §10 (doctrine): "FHIR R4 is the boundary representation for clinical integrations. Internal storage can be optimized for application behavior but must map to FHIR resources with stable provenance."

`@orbb/fhir` (M7-A work item **A46**, Lane A) is the one-directional translation layer: **ORBB domain objects in, FHIR R4 JSON out**. It is a pure package — no I/O, no clock, no runtime dependencies (type-only `@orbb/domain` / `@orbb/measurement` imports plus `node:crypto` for deterministic ids).

**FHIR→internal ingestion is NOT in scope** — see [Future-milestone handoffs](#future-milestone-handoffs).

## The seven mappers

| Mapper | Domain input | FHIR R4 output |
| --- | --- | --- |
| `mapPatient(personId, ctx)` | `PersonId` (opaque canonical id) | `Patient` |
| `mapObservation(observation, ctx)` | domain `Observation` (validation states, supersession, typed values) | `Observation` |
| `mapDiagnosticReport({ task, attempts }, ctx)` | measurement task + its full attempt set | `DiagnosticReport` |
| `mapCondition(intent, ctx)` | domain `HealthIntent` + registered health focus | `Condition` |
| `mapDocumentReference(evidence, ctx)` | `EvidenceObject` record (§5 field list, the @orbb/db shape) | `DocumentReference` |
| `mapConsent(grant, ctx)` | domain `AccessGrant` (+ optional `issuedAt`) | `Consent` |
| `mapProvenance(provenance, targets, ctx)` | domain `Provenance` + mapped-resource targets | `Provenance` |

All mappers are pure functions `(domain object, mapping context) -> FHIR resource JSON` (Provenance additionally takes its target references — the domain record carries no target list, verified against the `@orbb/db` `provenances` table).

## Determinism (hard requirement)

- **Same input → byte-identical JSON.** `serializeCanonical(resource)` emits canonical JSON: object keys sorted by UTF-16 code unit order, no insignificant whitespace, ECMAScript shortest-round-trip number formatting (JCS/RFC 8785-aligned). Array order is preserved — order is domain data (e.g. grant scope entries, method order); canonical determinism means "same input, same bytes", never reordering domain data.
- **Deterministic resource ids.** `deriveResourceId(resourceType, sourceDomainId)` = domain-separated SHA-256 over the length-prefixed canonical parts `orbb/fhir/resource-id/v1 | <resourceType> | <sourceDomainId>`, rendered `<kebab-type>-<32 hex>` (≤ 64 chars, FHIR-legal). This is the @orbb/db derived-id pattern (`<prefix>_<sha256hex>`) adapted to the FHIR id charset (`_` is illegal in FHIR ids, so the separator is `-`). Recomputing adds nothing: mapping twice is identical, and the same source id yields different ids per resource type (domain separation).
- **No wall-clock time.** The mapping context deliberately carries **no clock** — no output timestamp derives from mapping time; every instant comes from the domain objects (`effectiveAt`, `observedAt`, window bounds, `recordedAt`, `occurredAt`, `createdAt`, `issuedAt`, `expiresAt`, `capturedAt`).
- **Golden fixtures** (`test/goldens/*.json`) are `prettyCanonical(resource) + "\n"` — the same canonical structure, 2-space indented for reviewability. Tests additionally prove `serializeCanonical(JSON.parse(golden)) === serializeCanonical(resource)`, so the golden and the compact boundary form carry exactly the same bytes. Regenerate with `bun test/goldens/generate.ts`.
- **Determinism proofs** (tests): map-twice byte-identical for whole worlds, including across a **serialized re-instantiation** of the domain inputs (JSON round-trip with Date revival).

## PHI discipline (hard requirement)

- SYNTH fixtures only; every test world is tagged `synthetic: true`.
- The mapper moves **opaque ids and vocabulary labels** — never free-text notes (the HealthIntent `objective` is shape-validated but NEVER emitted; tests assert objective strings do not appear in any output), never evidence content bytes (only digest/size/mime/opaque reference; the encrypted envelope is not even part of the input type), never observation values beyond the typed value shapes.
- The no-PHI proofs walk every string in fixtures and outputs against a safe-pattern allowlist (ids, ISO instants, hex/base64 digests, namespace URIs, frozen vocabularies, SYNTH-marked tokens) and assert no email/phone/name-shaped strings outside sanctioned vocabulary displays.
- Timestamps serialize via the exact `Date.toISOString()` (UTC, ms).

## The mapping context — deliberate ports

`createFhirMappingContext(options?)` validates and freezes:

| Port | Default | Purpose |
| --- | --- | --- |
| `namespace` | `https://orbb.test/synth` (the SYNTH namespace) | System URIs for identifiers/vocabularies. ORBB has no production domain; the reserved-TLD `orbb.test` origin is the only URL the repo already uses (@orbb/auth synthetic origins). Configurable — retargeting is a tech-lead constant change, not a mapper change. |
| `demographics` | `NO_DEMOGRAPHICS` | The deliberate demographic disclosure port. MUST be a pure function of the person id. Default discloses nothing → identifier-only Patient. |
| `metrics` | `[]` | Metric vocabulary: `{ metricId, conceptCode, conceptSystem, display?, category?, categorySystem? }`. Unique by metricId AND conceptCode (context construction fails closed on duplicates). |
| `intentFocuses` | `[]` | Per-intent health-focus metric ids (the M5/M6 structured goal read model; the M0 domain objective is free text and never mapped). |
| `provenanceRecords` | `[]` | The provenance registry linked by provenance-carrying domain objects. |

The defaults are deliberately **useless for clinical mapping** — Observation mapping fails closed without the metric vocabulary (a mandatory FHIR code element cannot be invented) and without the provenance record. Callers must make vocabulary, provenance, and demographic decisions explicitly.

## Decision tables (domain → FHIR, field by field)

### Patient (from `PersonId`)

| ORBB | FHIR R4 | Decision |
| --- | --- | --- |
| PersonId (opaque canonical id) | `identifier[0]` = `{ system: <ns>/id/person, value: <id> }` | The identifier IS the boundary identity. |
| PersonId | `id` | `deriveResourceId("Patient", personId)` (deterministic). |
| — | `name`, `birthDate`, `gender`, `telecom`, `address` | **Privacy-first binding decision:** NEVER emitted from ORBB data. Only a deliberate `DemographicPort` can disclose them (validated: birthDate must be a real `YYYY-MM-DD`; names/telecom/address parts non-empty). The mapper never invents demographics and never reads a Person `displayName`. |

### Observation (from the domain `Observation`)

| ORBB | FHIR R4 | Decision |
| --- | --- | --- |
| `id` | `id`, `identifier[0]` (`<ns>/id/observation`) | Deterministic derivation + durable business identifier. |
| `validationState` | `status` | **The exact status rule (recorded, verified against `supersede()` semantics):** `pending→preliminary`, `validated→final`, `rejected→entered-in-error`, `superseded→entered-in-error`. Supersession follows the FHIR-observation-style replace pattern: the domain never mutates in place, so the retired observation maps `entered-in-error` while its replacement maps via its own state (`validated→final`). The replacement's `supersedesId` does NOT inflate status to `amended`/`corrected` — those codes describe mutation of a single resource, contradicting the immutable replacement model; the correction chain stays queryable via domain ids and provenance. |
| `conceptCode` (via metric vocabulary) | `code.coding[0]` = `{ system: <conceptSystem>, code, display? }` | System + display are caller-bound vocabulary; unresolved codes fail closed (`unresolved-concept-code`). |
| metric `category`/`categorySystem` | `category[0].coding[0]` | Emitted only when the vocabulary entry carries both; the ORBB category is a loose grouping label, so the SYSTEM is caller-bound (not assumed to be FHIR `observation-category`). |
| `value: number` + `unit` | `valueQuantity` = `{ value, unit? }` | Unit only when non-empty. |
| `value: string` | `valueString` | Code/text values map as strings. |
| `value: boolean` | `valueBoolean` | The M0 union admits booleans; FHIR has a native element (silent coercion would lose type fidelity). |
| `personId` | `subject` = `{ reference: "Patient/<derived>", identifier: { <ns>/id/person, personId } }` | Both forms always: resolvable relative reference + durable opaque identifier. |
| `effectiveAt` / `observedAt` | `effectiveDateTime` / `issued` | Exact `toISOString()`. |
| `methodId` | `method.coding[0]` = `{ system: <ns>/vocab/method-code, code }` | Opaque method code moved verbatim under the ORBB vocabulary namespace. |
| `evidenceLabel` | `meta.tag[0]` = `{ system: <ns>/vocab/evidence-label, code }` | R4 has no standard observation-reliability element; a namespaced workflow tag is the standard-conformant carrier (no invented extensions). |
| `sourceId` | — (NOT emitted) | The source actor rides the linked Provenance agent (stable provenance is the FHIR-native carrier). |
| `supersedesId` | — (NOT emitted) | R4 Observation has no `replaces` element; the chain is preserved by domain ids + provenance (see status rule above). |
| `quality` | — (NOT emitted) | R4 has no standard confidence element; quality stays internal (the M4 reconciliation lane owns its semantics). |
| `evidenceId` | — (NOT emitted) | No standard Observation→DocumentReference element; evidence linkage is derivable on the ORBB side. |
| `provenanceId` | — (fail-closed requirement) | The record MUST exist in the context's provenance registry (`missing-provenance`). |

### DiagnosticReport (from task/attempt groupings)

| ORBB | FHIR R4 | Decision |
| --- | --- | --- |
| `task.id` | `id`, `identifier[0]` (`<ns>/id/task`) | **Grouping assumption (binding): one report per task attempt set** — a task plus EVERY attempt recorded against it (partial/low-quality included; data is never discarded; supersession status lives on each Observation). Zero attempts are legal (scheduler-materialized open task). |
| `task.planId` | `basedOn[0]` = identifier-only reference (`<ns>/id/plan`) | Plans are not one of the seven mapped types: identifier-only linkage, no asserted CarePlan. |
| `task.state` + attempt count | `status` | `completed→final`; `open`+attempts→`partial`; `open`+0 attempts→`registered`. |
| `task.conceptCode` (via vocabulary) | `code` | Same vocabulary resolution as Observation (fail-closed). |
| `task.personId` | `subject` | Patient reference. |
| `task.window` | `effectivePeriod` = `{ start, end }` | The half-open measurement window. |
| attempts (canonically ordered) | `result[]` | Observation references in canonical (recordedAt, attemptId) order — deterministic from the SET regardless of input array order. |
| last attempt `recordedAt` | `issued` | Max over the canonically ordered set; omitted when no attempts. |
| attempts' `provenanceId` | — (fail-closed requirement) | Every attempt's provenance record MUST exist in the context. For attempt-less reports there is no domain provenance field on the task — linkage is then a world-level concern (coverage invariant). |
| `performer` | — (NOT emitted) | This packet maps no Practitioner/Organization (A44's model); attempt provenance carries the actors. |

### Condition (from `HealthIntent`)

| ORBB | FHIR R4 | Decision |
| --- | --- | --- |
| `id` | `id`, `identifier[0]` (`<ns>/id/intent`) | Deterministic derivation + durable identifier. |
| — (nothing) | `verificationStatus` | **BINDING DOCTRINE: always `provisional`.** Intents are goals, not diagnoses — never a confirmed/differential/refuted assertion from intent data. Unconditional. |
| `state` | `clinicalStatus` | **Conservative table (recorded; the weakest translation in the package, flagged for tech-lead review):** `draft→inactive`, `active→active`, `paused→inactive`, `achieved→resolved`, `retired→inactive` (retired deliberately NOT `resolved` — nothing was asserted achieved). Expresses whether the focus is pursued, not disease course. |
| registered focus metric (via vocabulary) | `code` | The intent's health-focus vocabulary (the M5/M6 goal metrics). Unregistered focus → `intent-focus-unknown`; unresolvable metric → `unresolved-metric`; **multi-focus intents fail closed (`multi-focus-intent`)** — one Condition.code is one clinical concept; collapsing focus metrics would assert comorbidity that does not exist. |
| `personId` | `subject` | Patient reference. |
| `createdAt` | `recordedDate` | Exact `toISOString()`. |
| `objective` | — (NEVER emitted) | Free text; PHI discipline (tested non-leakage). |
| `onset`/`abatement`/`asserter`/`recorder`/`category` | — (NOT emitted) | Nothing in the domain intent carries them; omitting beats inventing. |

### DocumentReference (from evidence objects)

| ORBB | FHIR R4 | Decision |
| --- | --- | --- |
| `id` | `id`, `identifier[0]` (`<ns>/id/evidence`) | Deterministic derivation + durable identifier. |
| `state` ("active") | `status: "current"` | The frozen lifecycle vocabulary has one state; future states extend the table. |
| `id` (opaque) | `content[0].attachment.url` | **Per the work order:** the url carries the opaque EvidenceId — NOT the object key (storage detail) and NEVER a presigned URL (§6 PHI-in-URLs; determinism). Resolution happens through ORBB's authorized object plane. |
| `mediaType` | `attachment.contentType` | Verbatim. |
| `sizeBytes` | `attachment.size` | Verbatim. |
| `sha256` | `attachment.hash` | Base64-encoded digest (R4 Attachment.hash representation; hex→bytes→base64, deterministic). |
| `capturedAt` | `attachment.creation` | Exact `toISOString()`. |
| `createdAt` (optional) | `date` | Emitted ONLY when present — never invented. |
| `personId` | `subject` | Patient reference. |
| `provenanceId` | — (fail-closed requirement) | The record MUST exist in the context. |
| `type`/`category`/`custodian`/`author` | — (NOT emitted) | No document-type vocabulary supplied in this packet; omitting beats inventing. |
| `objectKey`, `encryptedMetadata`, `sourceType`, `retentionClass`, `sessionId` | — (NOT emitted) | Object-plane storage details and envelope bytes stay internal. |

### Consent (from `AccessGrant`)

| ORBB | FHIR R4 | Decision |
| --- | --- | --- |
| `id` | `id`, `identifier[0]` (`<ns>/id/grant`) | Deterministic derivation + durable identifier. |
| `state` | `status` | `active→active`; **`revoked→inactive`** (the provision remains as the historical record of what the grant was). |
| `purpose` | `scope.coding` = [`patient-privacy` (standard), `<purpose>` (ORBB vocab)] + `category[0]` | Scope carries BOTH the standard `patient-privacy` coding (recorded assumption: an AccessGrant is definitionally a consent governing access to the person's health information — not a guess about the purpose's meaning) and the purpose label verbatim under `<ns>/vocab/purpose-of-use` (CodeableConcept codings are standard translations). Binding purposes to standard category codes is future vocabulary curation. |
| `subjectId` | `patient` | Patient reference. |
| `issuedAt` (optional) + `expiresAt` | `provision.period` + `dateTime` | `provision.type: "permit"` with period `{ start: issuedAt?, end: expiresAt }`. The domain grant carries no issued timestamp (the @orbb/db row's `createdAt` is it — callers pass it explicitly); **without it the period has end only and `dateTime` is omitted — the mapper never invents a period start.** |
| `scope[]` (in domain order) | `provision.action[]` | Scope entries verbatim under `<ns>/vocab/scope-permission`, grammar-validated (`<kind>:<operation>`, one colon, non-empty segments — the domain `parseScopePermission` rule). |
| — | — | **Deny-by-default survival:** a Consent permit-resource exists ONLY as the mapping OF a grant (the grant's existence IS the permission). Exactly one Consent-producing export (`mapConsent`); its input is structurally an AccessGrant; absence of a grant can never yield a permit-resource. Proven in tests with the REAL domain evaluator: no grants → DENY → a grantless world maps zero Consents. |

### Provenance (from domain `Provenance` + targets)

| ORBB | FHIR R4 | Decision |
| --- | --- | --- |
| `provenanceId` | `id` | `deriveResourceId("Provenance", provenanceId)`. R4 Provenance has **no Identifier element** — the opaque `prov_` id is carried only through the deterministic resource id (recorded R4 limitation; re-evaluate at future FHIR versions). |
| mapped resources (mapper input) | `target[]` | FHIR-native linkage direction (R4 clinical resources carry no provenance backlink). Targets are explicit input: the domain record has no target list (verified against the db schema). |
| `occurredAt` | `occurredDateTime` + `recorded` | Both map the domain's single instant (the domain carries no separate record time; the mapper never invents one). `recorded` is a mandatory R4 instant. |
| `actor` (PersonId\|DeviceId\|SourceId) | `agent[0].type` = `{ <ns>/vocab/actor-kind, person|device|source }` + `agent[0].who` = identifier-only | The frozen actor vocabulary is **entity-kind** based; R4's ProvenanceParticipantType is **role**-based with no entity-kind codes — under an extensible binding the honest carrier is a namespaced code. `who` is identifier-only uniformly (no Patient-typed reference: that would falsely assert every person actor is the mapped subject). |
| `causationId`/`correlationId` | — (NOT emitted) | No standard R4 element; internal correlation tokens stay internal (recorded handoff). |

## Stable provenance — the linkage invariant

"Every mapped clinical resource must carry a Provenance linkage" is enforced at two levels:

1. **Mapper-internal (fail-closed):** domain objects that carry a `provenanceId` (Observation, EvidenceObject, MeasurementAttempt) fail closed (`missing-provenance`) when their record is absent from the context's registry — "every observation needs provenance" holds at the boundary.
2. **World-level (`assertProvenanceCoverage(resources, provenances)`):** every mapped non-Provenance resource must be targeted by ≥1 mapped Provenance. This covers the domain objects WITHOUT a provenance field (bare PersonId, HealthIntent, AccessGrant, attempt-less tasks), whose linkage is supplied by the composed world. Tests run the checker over every test world (and its negative: removing one provenance fails it).

## Fail-closed error surface

`FhirMappingError` with typed `kind` (PHI-safe messages — values never echoed):

`invalid-input` · `invalid-context` · `unknown-vocabulary` (frozen domain vocabularies) · `unresolved-concept-code` · `unresolved-metric` · `intent-focus-unknown` · `multi-focus-intent` · `missing-provenance` · `provenance-coverage` · `non-canonical-value` (canonical serializer rejects Dates/undefined/functions/non-finite numbers).

Unknown vocabulary → typed mapping failure, **never a silent partial resource**. Validation order in the mappers: structural guard → provenance linkage → vocabulary resolution (recorded; tested).

## Reference policy (uniform, recorded)

- References to the seven mapped types carry BOTH a relative `reference` (`Type/<deterministic-id>`) and the durable business `identifier` (opaque domain id under its kind namespace).
- References to kinds ORBB does not map in this packet (e.g. `basedOn` → plan) are identifier-only.
- No reference ever carries a `display` (names are PHI).

## Zero runtime dependencies; type-only kernel imports

src/ imports ONLY TYPES from `@orbb/domain` and `@orbb/measurement` (per the packet brief — "@orbb/domain: types only"). Input types are local structural mirrors locked to the kernel at COMPILE time (`src/compat.ts`: domain `Observation`/`HealthIntent`/`AccessGrant`/`Provenance` and measurement `MeasurementTask`/`MeasurementAttempt` each must be assignable to their mirrors). Frozen VALUE vocabularies are mirrored locally and drift-guarded at RUNTIME by tests that import the real `@orbb/domain` / `@orbb/measurement` constants and assert deep equality.

## Test suite (definition of done)

- `golden.test.ts` — golden-file snapshots for all seven resource types (16 files, deterministic, diff-stable).
- `determinism.test.ts` — map-twice byte-identical (whole worlds), serialized re-instantiation, resource-id purity/domain separation, canonical serializer invariants.
- `privacy.test.ts` — no-PHI proofs over fixtures, outputs, and goldens (safe-pattern allowlists, demographic-key absence, free-text objective non-leakage, evidence-content non-transport).
- `doctrine.test.ts` — privacy-first Patient (default port = identifier-only), the Condition `provisional` doctrine, the superseded-observation status rule, Consent inactive-on-revoked, deny-by-default survival (with the real domain evaluator).
- `invariant.test.ts` — provenance-linkage invariant over every world (+ negative), the malformed-input battery, vocabulary drift guards, @orbb/testkit interop, exported-surface proofs.

Battery: `pnpm install` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`.

## Future-milestone handoffs (recorded)

1. **FHIR→internal ingestion is NOT in scope for A46** — this package is one-directional by design. Ingestion (mapping FHIR resources into ORBB domain objects, with authorization and provenance minting) is a future-milestone work item; the local structural input types and the reference policy here are the seams it will build against.
2. **SMART on FHIR launch boundary** is A47 — no SMART/OAuth surface exists here.
3. **Clinical entity mappings** (Organization/Practitioner/CareTeam — A44/A45) are absent: `performer`/`author`/`custodian` elements are omitted rather than invented.
4. **Bundle/composition API** (e.g. a patient-timeline Bundle) belongs to A49 (patient timeline API); the coverage checker is the composition-time invariant it will call.
5. **Multi-focus intents → per-focus Conditions**: refused here (`multi-focus-intent`); revisit with the clinical lane.
6. **Condition.clinicalStatus table** is the weakest translation (intent state machine ≠ clinical course) — flagged for tech-lead review with future Condition curation.
7. **Provenance correlation tokens** (`causationId`/`correlationId`) and the R4 lack of `Provenance.identifier` — re-evaluate at the next FHIR version bump.
8. **Metric category binding**: when the measurement lane curates categories to the FHIR `observation-category` vocabulary, flip the caller-bound `categorySystem` — no mapper change.
