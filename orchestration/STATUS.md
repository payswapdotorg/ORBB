# ORBB Orchestration Status

current_milestone: M1 — domain kernel (IN PROGRESS: M1-A + M1-B merged)
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: M0 COMPLETE — all three lanes merged, exit criteria verified
active_worker_slots: 1/3 (m1-c-observability queued-capacity; m1-b-ui slot freed on merge)
latest_green_commit: cd08099 (Merge PR #8: M1-B component library)
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
- M1-B (PR #8, Lane B): design-system component library — forms/disclosure/card+table/timeline/consent-sheet/measurement-controls/SVG charts + usePrefersReducedMotion; @orbb/ui 34->176 tests (142 new); react-dom peerDependency (ConsentSheet portal). Workspace 457 tests.

in_flight:
- M1-C (Lane C): packages/observability (PHI redaction engine, structured logger, trace primitives). Session accepted (/c/65371bbd), queued-capacity behind evening peak; queue_watch staleness-assault armed (0/5 historical queued-zombies ever self-recovered — fresh dispatch beats them).

next_dispatch:
- After M1-B/M1-C: M1 exit check (all transitions + illegal states covered), then M2 (persistence/DataBox) packets: M2-A schema/migrations/repositories/audit; M2-C object store/encryption/upload flow (rebalanced lanes — M2 roadmap items are all Lane A; lead splits by stable interface boundaries).

Do not mark this file green until actual code, tests, and preview verification exist.
