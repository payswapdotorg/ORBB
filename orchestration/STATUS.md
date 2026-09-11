# ORBB Orchestration Status

current_milestone: M3 — API + identity (DISPATCHING: m3-a/m3-b/m3-c packets)
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: M0 + M1 + M2 COMPLETE — PRs #4-#12 merged, all exit criteria verified on fresh main
active_worker_slots: 0/3 (M2-D merged; M3 packets dispatching)
latest_green_commit: 1eca964 (Merge PR #12: M2-D db-backed upload store + M2 exit journey)
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
- none (M3 packets dispatching now: m3-a-api, m3-b-webshell, m3-c-identity)

next_dispatch:
- M3 (A21 router/errors + A24 idempotency middleware + A26 OpenAPI; A22/A25 identity core with passkeys/email OTP + rate limits; Lane B web shell mounting the DataBox journey on the design system).

Do not mark this file green until actual code, tests, and preview verification exist.
