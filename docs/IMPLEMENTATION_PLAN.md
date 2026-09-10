# Implementation Plan

The roadmap below is the authoritative execution order. Workers may choose implementation details inside a work item, but they may not alter domain boundaries, security invariants, evidence labels, or the definition of done without an ADR approved by the tech lead.

## Lane model

Exactly three concurrent worker lanes are preferred:

- **Lane A — Domain/API/Data:** packages/domain, db, contracts, auth, DataBox, measurement, consent, backend.
- **Lane B — Product UX:** web, mobile, UI system, role surfaces, accessibility, user journeys.
- **Lane C — Platform/QA:** deployment, CI, adapters, observability, Playwright/Maestro, security, dogfood fixtures.

The tech lead owns integration and may temporarily rebalance lanes. Workers never merge directly to main.

## Milestone 0 — Repository foundation

A0. Monorepo bootstrap: pnpm + Turborepo + TypeScript strict mode.
A1. Package boundaries and dependency rules.
A2. Environment schema and secret conventions.
A3. CI skeleton and protected main expectations.
A4. Testkit with deterministic clock, IDs, synthetic people, devices, observations, consent grants.
A5. Web/mobile/API empty shells that build.
Exit: clean install, typecheck, lint, unit test, web build, mobile typecheck, Worker build.

## Milestone 1 — Domain kernel

A6. Canonical IDs and typed domain primitives.
A7. Evidence labels and provenance model.
A8. MetricDefinition and MeasurementMethod.
A9. Observation lifecycle and validation state machine.
A10. HealthIntent state machine.
A11. MeasurementPlan state machine.
A12. AccessGrant/Consent evaluation rules.
A13. Domain event envelope and outbox interfaces.
Exit: pure domain tests cover all transitions and illegal states.

## Milestone 2 — Persistence/DataBox

A14. Neon schema and migrations using Drizzle.
A15. Repository interfaces + Postgres implementation.
A16. R2 ObjectStore implementation.
A17. DataBox upload-session and finalize flow.
A18. Evidence checksum/metadata validation.
A19. Envelope encryption abstraction and secure development provider.
A20. Immutable access audit records.
Exit: evidence upload → metadata → retrieval → audit works end-to-end with synthetic data.

## Milestone 3 — API + identity

A21. API router and standardized errors.
A22. Authentication/session system with passkeys/email and recovery.
A23. Authorization middleware and role bindings.
A24. Idempotency middleware.
A25. Rate limits and abuse protection through Upstash.
A26. OpenAPI generation + contract tests.
Exit: authenticated user can create/retrieve their own intent, evidence and observations; another user cannot.

## Milestone 4 — Measurement engine

A27. Metric catalog.
A28. Measurement capabilities and methods.
A29. Plan compiler from manually authored protocol definitions.
A30. Task scheduler.
A31. Task completion/fallback/quality states.
A32. Device-source abstraction.
A33. Manual measurement capture.
A34. HealthKit adapter.
A35. Health Connect adapter.
Exit: a real supported metric can be acquired by at least two methods and reconciled with provenance.

## Milestone 5 — Intent Compiler

A36. EvidencePack schema/versioning.
A37. EvidencePack registry and provenance.
A38. Deterministic protocol compiler.
A39. Burden optimizer.
A40. Resource/capability matching.
A41. Safety/escalation rule engine.
A42. AI proposal service isolated behind interface.
A43. Human review/publish workflow.
Exit: at least three intents generate explainable plans from versioned EvidencePacks; no plan executes before publication.

## Milestone 6 — Consumer product

B1. Onboarding.
B2. Intent creation.
B3. Plan review.
B4. Today/measurement task flow.
B5. Observation/provenance detail.
B6. DataBox timeline/search.
B7. Sharing and revocation UX.
B8. Notification/reminder engine.
B9. Consent settings.
B10. Adherence enforcement abstraction and OS-specific capabilities.
Exit: golden user journey #1, #2, #4, #7 passes on web and supported mobile paths.

## Milestone 7 — Clinical OS

A44. Organization/clinic/practitioner model.
A45. Patient linking and care-team permissions.
A46. FHIR mapper for Patient/Observation/DiagnosticReport/Condition/DocumentReference/Consent/Provenance.
A47. SMART launch boundary.
A48. Clinical task/worklist.
A49. Patient timeline API.
B11. Clinician worklist.
B12. Patient overview.
B13. Shared-data workflow.
B14. Measurement request/order UI.
C1. Clinical E2E suite and PHI-redaction assertions.
Exit: clinician can request authorized data and reason over a longitudinal patient timeline.

## Milestone 8 — Measurement marketplace

A50. ServiceOrder state machine.
A51. CHW provider model.
A52. Scheduling/visit model.
A53. Equipment inventory/rental/borrow model.
A54. Community equipment pool.
A55. Provider compensation ledger.
B15. Services marketplace.
B16. CHW task capture.
B17. Equipment discovery and booking.
Exit: a missing measurement can be fulfilled by a human provider or equipment path and results reach the same Observation model.

## Milestone 9 — Extension platform

A56. Extension manifest v1.
A57. Capability/permission model.
A58. Sandboxed execution interface.
A59. Extension test harness.
A60. Publisher/version/review model.
A61. Install/uninstall/revoke.
A62. Measurement adapter contract.
B18. Developer console.
B19. Permissions UX.
B20. Marketplace UI.
C2. Malicious-extension test suite.
Exit: sample thermometer-photo adapter can execute in sandbox, create an `ESTIMATED` observation, retain source evidence, and cannot read unrelated DataBox objects.

## Milestone 10 — Research platform

A63. Study and StudyVersion model.
A64. Eligibility rules.
A65. Participant consent and study grants.
A66. Study tasks and compensation.
A67. Research data-access requests.
A68. Cohort/predicate query abstraction.
A69. Dataset export with provenance.
B21. Research console.
B22. Participant study UX.
B23. Consent/compensation UX.
Exit: a synthetic study can recruit, schedule measurements, receive evidence, compute eligibility, and deliver a governed dataset.

## Milestone 11 — Privacy-preserving computation

A70. Predicate result contracts.
A71. Selective disclosure credentials/proofs.
A72. ZK proof provider abstraction.
A73. Cohort computation job interface.
A74. Leakage/security tests.
Exit: demonstrate a privacy-preserving eligibility assertion without disclosing the underlying observation values.

## Milestone 12 — Doctor-grade intelligence

A75. Longitudinal change detection.
A76. Missing-measurement reasoning.
A77. Baseline/trend/episode abstractions.
A78. Clinical summarization with citations to source observations.
A79. Research protocol assistant.
A80. Alert prioritization.
A81. Model registry/evaluation harness.
Exit: clinician copilot outputs are source-grounded, versioned, uncertain where appropriate, and never directly write diagnoses/orders.

## Milestone 13 — Production hardening

C3. Full security review mapped to OWASP ASVS 5.0.
C4. Threat model and abuse cases.
C5. Data retention/deletion workflows.
C6. Disaster recovery drills.
C7. Backup/restore tests.
C8. Rate-limit/load tests.
C9. Dependency/SBOM/license checks.
C10. Observability dashboards and alerting.
C11. Accessibility audit.
C12. Web cross-browser suite.
C13. Mobile device matrix.
C14. Production runbooks.
C15. Incident response tabletop.
Exit: release candidate satisfies every production gate and all golden journeys.

## Parallelization rules

The tech lead may dispatch A/B/C concurrently only when their contracts are already frozen. Never parallelize two workers against an unstable schema boundary. Shared packages change only through reviewed contract changes.

## Release gates

No milestone closes until:
`typecheck + lint + unit + contract + integration + security + UI E2E + dogfood + docs` are green, and the tech lead has reviewed the diff and manually exercised the relevant workflow in the deployed preview.

The product is production-ready only when all milestones through 13 are green and the production checklist is signed in `docs/RELEASE_CHECKLIST.md`.
