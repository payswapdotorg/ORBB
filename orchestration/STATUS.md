# ORBB Orchestration Status

current_milestone: M2 — persistence/DataBox (IN PROGRESS: m2-a + m2-c dispatched)
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: M0 + M1 COMPLETE — all six packets merged (PRs #4-#9), exit criteria verified
active_worker_slots: 0/3 (M2-A + M2-C merged; M2-D integration packet dispatching for exit criterion)
latest_green_commit: 43249bb (Merge PR #11: M2-A persistence core — schema/repos/outbox/audit)
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

in_flight:
- M2-D (Lane A): db-backed EvidenceMetadataStore adapter + E2E synthetic journey (upload -> finalize -> retrieval -> audit) + outbox closing the post-commit event gap — the M2 exit-criterion packet (handoffs from M2-C + M2-A reports).

next_dispatch:
- After M2-D: M2 exit check (E2E journey green), then M3 (API + identity) packets: router/errors, auth/session, person/account management, evidence+observation endpoints.

Do not mark this file green until actual code, tests, and preview verification exist.
