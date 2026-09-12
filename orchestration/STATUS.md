# ORBB Orchestration Status

current_milestone: M6 — consumer product (dispatching)
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: M0-M5 COMPLETE (PRs #4-#21); 18 PRs total
active_worker_slots: 0/3 (m3-b queued, hard-frozen per lesson 16 after usage-limit detection)
latest_green_commit: 175d7e1 (Merge PR #21: M5-C AI seam + review workflow + exit harness)
preview_url: none (Vercel preview pending operator account link; web shell dogfooded locally by lead)
last_dogfood: 2026-09-10 18:5x UTC — lead exercised the web shell end-to-end (role switch, emphasis, DataBox journey; VLM-verified screenshots)
last_audit: 2026-09-10 — session audit by resident tech lead

milestone_M0_evidence:
- PR #4 (M0-A, Lane A): 8 packages, 86 tests. CI green.
- PR #5 (M0-C, Lane C): testkit 43 + platform 22 + workers 4 tests; wrangler dry-run builds credential-free; CI hardening. CI green.
- PR #6 (M0-B, Lane B): ui 34 + web 8 + mobile 5 tests; Playwright chromium journey green in CI AND lead sandbox; maestro config checked in. CI green.
- Exit criteria (all verified on fresh main @ 96c267a): clean frozen install, lint 15/15, typecheck 15/15, unit tests 202+, web build 13/13, mobile typecheck, both Worker dry-run builds, Web E2E green, lead dogfood of user journey complete.

known_risks:
- Free-tier infrastructure is suitable for development and early experimentation, not automatically a regulated production environment.
- Mobile health APIs require native platform permissions and real-device validation.
- Clinical/research features require jurisdiction-specific governance before real-world use.
- GLM-5.3 capacity/usage windows intermittently gate worker dispatch (mitigations: two-state acceptance protocol, per-session recovery flags, dashboard sandbox release, hard-freeze discipline — see replay2 AGENT_BOOT_PROMPT.md learnings 9-16).
- Vercel preview deployment pending operator account link.

merged_in_M1:
- M1-A (PR #7, Lane A): metric/method/capability + supersession lifecycle + deny-by-default access evaluation; domain 51->162 tests; contracts +2 event types (OBSERVATION_SUPERSEDED, ACCESS_EVALUATED).
- M1-B (PR #8, Lane B): design-system component library — forms/disclosure/card+table/timeline/consent-sheet/measurement-controls/SVG charts + usePrefersReducedMotion; @orbb/ui 34->176 tests (142 new); react-dom peerDependency (ConsentSheet portal).
- M1-C (PR #9, Lane C): @orbb/observability — structured logger, deny-by-default PHI redaction engine (hash-once pseudonyms), trace primitives, route-pattern-only request envelope; zero runtime deps; 73 tests / 236 assertions + 28 not.toContain PHI proofs. Lockfile +18 lines (new importer).
- M2-C (PR #10, Lane C): @orbb/databox real content — R2ObjectStore (hand-rolled SigV4, no aws-sdk, presigned PUT/GET), KeyProvider/SecretKeyProvider/EnvelopeEncryptor (HKDF+AES-256-GCM, context binding), UploadSessionService (§6 flow, idempotent finalize, TTL, exactly-once EVIDENCE_INGESTED); 115 tests; lockfile +13/-3. Contract handoffs recorded: EvidenceIngestedEvent -> contracts promotion, platform ObjectStore gaps (in-memory double, contentType N+1, presign seam), Lane A outbox closing the post-commit event gap, live-R2 verification in deployment packet.
- M2-A (PR #11, Lane A): @orbb/db real content — 11-table Drizzle schema (opaque domain ids as PKs, id-grammar CHECKs, frozen vocabularies), additive migrations (append-only trigger on access_audits), 9 repos + UnitOfWork transactional outbox, idempotency ledger, pure cursor pagination; PGlite harness executes real migration SQL; 104 db tests + 19 databox (A18) tests; workspace 767 passed. Gitleaks false-positive on a synthetic fixture resolved by branch squash (string never in history; scanner at full sensitivity).
- M1 EXIT verified on fresh main a56bee4: frozen install 0, lint 16/16, typecheck 16/16, test 16/16 (530 tests), build 14/14; domain 162 tests cover ALL state machines' legal grammars + illegal transitions + terminal states + self-loops (intent/plan/observation+supersession/grant/access audited by name).

merged_in_M2:
- M2-C (PR #10, Lane C): @orbb/databox — R2ObjectStore (hand-rolled SigV4), EnvelopeEncryptor (HKDF+AES-256-GCM), UploadSessionService (§6 flow); 115 tests.
- M2-A (PR #11, Lane A): @orbb/db — 11-table Drizzle schema, additive migrations, 9 repos + UnitOfWork transactional outbox, idempotency ledger, cursor pagination, append-only access audits; PGlite executes real migration SQL; 104 db tests.
- M2-D (PR #12, Lane A): EvidenceMetadataStoreDb adapter — finalizeEvidence commits session-finalize + evidence upsert + EVIDENCE_INGESTED outbox row in ONE Db.transaction() (post-commit event gap CLOSED; regression guard proves recoverability via listPending -> markPublished); upload_sessions migration 0002 (grammar CHECKs, frozen vocabulary, FK); E2E synthetic journey (real UploadSessionService + PGlite + in-memory ObjectStore + EnvelopeEncryptor) with 3 regression guards; deterministic derived ids (domain-separated SHA-256) for crash-retry idempotency; @orbb/db 122 tests; lockfile +3 (db -> databox importer).
- M2 EXIT verified on fresh main 1eca964: frozen install 0, lint 16/16, typecheck 16/16, test 785 passed | 3 DATABASE_URL-gated skips, build 14/14; journey.test.ts explicitly green (upload -> finalize -> retrieval -> audit end-to-end with synthetic data — the M2 exit criterion). Transit note: migration SQL arrived chat-mangled (smart primes/zero-width/identifier reflow); repaired at the integration station against schema.ts ground truth — all 9 drift guards green, PGlite executes the real SQL in every db test.

in_flight:
- M6 wave (consumer product B1-B10: onboarding, intent creation, plan review, today/task flow, observation/provenance detail, DataBox timeline/search, sharing/revocation UX, notification engine, consent settings, adherence abstraction) — packetizing.

merged_in_M3:
- M3-C (PR #13, Lane C): @orbb/auth — SessionService (opaque hashed tokens, atomic rotate), dependency-free WebAuthn (hand-written CBOR, ES256/Ed25519/RS256, none+packed attestation, signCount clone detection), email OTP (single-use/TTL/throttle), recovery codes (hashed, timingSafeEqual), Upstash REST rate-limit adapter (SHAPE-VERIFIED via fetch stub, fail-closed, parity-tested vs in-memory), AccountService seams; zero external runtime deps; 147 tests; lockfile +16/-3.
- M3-A (PR #14, Lane A): apps/api /v1 router — error envelope {code,message,details?,requestId}, principal middleware seam, person-scoped resources (intents/observations/evidence; cursor pagination; cross-person 404 existence secrecy), A24 idempotency middleware (replay returns original response, concurrent duplicate 409), A26 OpenAPI 3.1 (SYNTH-only examples); wrangler dry-run 117.73 KiB driver-free bundle; 85 tests; lockfile +19/-3. CI fix included: workers-job dry-runs use dependency-inclusive pnpm filter ('@orbb/api...') so @orbb/domain dist exists before wrangler bundles (fresh-checkout resolution failure root-caused and fixed at the integration station).
- Combined state on rebased branch: 1015 passed | 3 gated skips.

merged_in_M3 (completion):
- M3-B (PR #15, Lane B): apps/web DataBox journey on the design system — Evidence Table (sortable, pure sort fn) + DisclosurePanel metadata, Evidence Timeline, Sparkline+BarChart summary card, ConsentSheet share-with-clinician flow (focus trap, reduced motion, i18n overrides), measurement capture form (ValueInput/MethodPicker/DueWindow/FieldWrapper) -> API route stub with typed echo, clinician emphasis aria-live integration; Playwright journeys extended (4 e2e green: evidence/consent/measurement); web unit 8 -> 65 tests; zero new runtime deps; SYNTH-only fixtures.
- M3 EXIT verified on fresh main 9d74cd9: frozen install 0, lint 16/16, typecheck 16/16, test 16/16, build 14/14; cross-person existence-secrecy explicitly tested on all person-scoped resources (intents.test.ts:170, evidence.test.ts:59, observations.test.ts:195 — "404 (not 403) for another person's..."), api suite 85/85. Transit: sandbox files-API tarball harvest, sha256 byte-verified (6d6ba578...).

merged_in_M4:
- M4-A (PR #16, Lane A): @orbb/measurement engine core — MetricCatalog with versioned supersession (A27), MeasurementMethodRegistry + deny-by-default CapabilityIndex (A28), deterministic ProtocolDefinition->Plan compiler (A29), idempotent TaskScheduler with UTC window math + missed-window roll-forward/backfill (A30), AttemptRecorder with completion quality states + method fallback (A31), same-metric multi-source reconciliation with per-source provenance (M4 exit seam); interface-driven (injected stores/registries/clock/id-factory, zero db imports); 93 tests; lockfile +6 (@orbb/testkit devDep). Transit: sandbox tarball byte-verified (sha256 536769d7...).

merged_in_M4:
- M4-A (PR #16, Lane A): @orbb/measurement engine core — MetricCatalog/versioned supersession, MethodRegistry+CapabilityIndex deny-by-default, deterministic PlanCompiler, idempotent TaskScheduler (UTC window math, roll-forward/backfill), AttemptRecorder quality states, multi-source reconciliation; interface-driven; 93 tests.
- M4-B (PR #17, Lane B): manual capture UX — web capture flow (SYNTH catalog->method->per-metric values->review with quality self-assessment->typed API stub), capture history (Table+Disclosure+Timeline), measurements workspace; mobile capture/history/health screens with offline-tolerant queue; maestro flows; supersedes M3-B form stubs (5 files git rm); web unit 65->123, mobile libs 23.
- M4-C (PR #18, Lane C): @orbb/platform health seam — MeasurementSourceRegistry+DeviceSourceAdapter (A32), HealthKitAdapter (A34) + HealthConnectAdapter (A35) TS seams with synthetic native doubles, Expo config-plugin surface, unit-conversion-at-normalization with provenance; platform 22->96 tests.
- M4 EXIT verified on fresh main b7ee95d: all gates 0; m4-exit-harness.test.ts green — heart rate acquired by TWO methods (manual + device adapter) reconciled into one canonical observation view with per-source provenance, deterministic replay.
- All three delivered via byte-verified sandbox tarball harvests (sha256: 536769d7 / e934a98b / 223f438d).

merged_in_M5:
- M5-A (PR #19, Lane A): packages/intents — EvidencePack schema (A36: content-addressed summaries, canonical-JSON serialization, append-only versioning), registry (A37: lineage + provenance, deny-by-default), deterministic IntentCompiler (A38: explainability audit trails, drafts only); 76 tests.
- M5-B (PR #20, Lane A): BurdenOptimizer (A39: Pareto-minimal under burden/coverage, deterministic tie-breaks), ResourceMatcher (A40: source+coverage gating with typed drop reasons), SafetyRuleEngine (A41: data-driven rules, PASS|ESCALATE|REJECT, ESCALATE-never-publishes type-encoded); intents 161 tests.
- M5-C (PR #21, Lane C): ProposalService seam (A42: SYNTH deterministic double, model provenance, no decision authority), ReviewWorkflow (A43: frozen domain draft->published transition, full audit trail, nothing publishes without review — type-encoded); intents 180 tests.
- M5 EXIT verified on fresh main 175d7e1: all gates 0; m5-exit-harness.test.ts 19/19 — THREE intents (manage-blood-pressure / increase-activity / improve-sleep) generate explainable plans from versioned EvidencePacks; audit trail proves pack lineage + published-only states + review traceability; deterministic replay. No plan executes before publication.
- All deliveries byte-verified sandbox tarballs (sha256: 753ec0b1 / 39a5d2f8 / 491b7464); one lesson-10 continuation nudge revived a stalled m5-a turn.

next_dispatch:
- M6 packets (B1-B10 by lane: web/mobile UX + notification engine + adherence abstraction); exit: golden journeys #1 #2 #4 #7 pass on web + supported mobile paths.

Do not mark this file green until actual code, tests, and preview verification exist.
