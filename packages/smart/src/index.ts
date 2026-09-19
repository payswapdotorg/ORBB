/**
 * @orbb/smart — the SMART-on-FHIR launch boundary for ORBB
 * (M7-A A47, Lane C). Doctrine: "SMART on FHIR launches must use
 * narrowly scoped OAuth authorization" (docs/BACKEND_ARCHITECTURE.md
 * §10).
 *
 * Public surface:
 *   - Launch-context parsing/validation (total, fail-closed, typed
 *     reasons): `parseSmartLaunchContext` + `SmartLaunchContext`.
 *   - The frozen read-shaped scope grammar:
 *     `patient/<ResourceType>.rs` over the allow-list
 *     `Patient | Observation | Condition | DocumentReference` —
 *     `parseSmartScope` / `parseSmartScopeSet` (+ typed rejections).
 *   - Deny-by-default scope evaluation + the boundary-never-widens
 *     intersection with the person's standing grants:
 *     `evaluateSmartScope`, `effectiveLaunchAccess`,
 *     `grantedAccessOf`.
 *   - The token-exchange seam: `SmartTokenExchange` with the SYNTH
 *     doubles `InMemoryTokenExchange` (tests) and `SynthEhrExchange`
 *     (the documented real-EHR provider contract: client registration,
 *     keysets — types + docs, zero network).
 *   - The audit-record shape for every validation/exchange outcome:
 *     `SmartLaunchAuditRecord` (injected clock + id factory, iss host
 *     only) — db handoff to the append-only `access_audits` table is
 *     recorded in audit.ts.
 *
 * Invariants kept: the boundary NEVER widens (a launch alone grants
 * nothing — compose with the kernel access evaluation, do not duplicate
 * it); no PHI in tokens, logs, audit shapes, or error messages
 * (identifiers only); opaque tokens hashed at rest (never a JWT with
 * embedded PHI in this package's SYNTH double); zero network calls;
 * zero external runtime dependencies (node:crypto + @orbb/testkit
 * seams only). Real EHR integration and jurisdiction-specific
 * governance are recorded handoffs, NOT shipped here.
 */
export * from "./errors.js";
export * from "./crypto.js";
export * from "./ids.js";
export * from "./audit.js";
export * from "./scopes.js";
export * from "./launch-context.js";
export * from "./evaluation.js";
export * from "./exchange.js";
export * from "./synth-ehr.js";
