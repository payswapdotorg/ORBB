# AGENTS.md

## Before touching code

Read:
1. `docs/LLM_TECH_LEAD.md`
2. `docs/BACKEND_ARCHITECTURE.md`
3. `docs/UI_UX_ARCHITECTURE.md`
4. `docs/DEPLOYMENT_ARCHITECTURE.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `docs/AGENT_PROTOCOL.md`

## Operating rules

- Do not invent missing requirements when they affect security, privacy, clinical safety, or data integrity. Make the safest architecture-consistent assumption and record it.
- Do not rewrite frozen architecture to simplify implementation.
- Read the actual code before claiming something exists.
- Preserve provider portability through interfaces.
- Never use real medical data in development/test fixtures.
- Never log PHI.
- Every mutation needs authorization and, when appropriate, idempotency.
- Every observation needs provenance.
- Every raw evidence object retains its source metadata.
- UI features require UI-level tests.
- Health-related AI output must remain non-authoritative until governed by the appropriate rule/review layer.

## Worker lanes

Three concurrent lanes are allowed: A Domain/API/Data, B Product UX, C Platform/QA. See `docs/AGENT_PROTOCOL.md`.

## Definition of done

A task is not done because code compiles. It needs tests, contract/doc updates, security/privacy review as applicable, a deployed preview where possible, and user-mode dogfooding for user-visible behavior.
