# ORBB Orchestration Status

current_milestone: M0 — repository foundation
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: IN PROGRESS (M0-A + M0-C merged; M0-B dispatched, awaiting generation slot)
active_worker_slots: 1/3 (m0-b-ui accepted+queued; peak-hour GLM-5.3 capacity)
latest_green_commit: 09a7d3f (Merge PR #5: M0-C CI/test harness)
preview_url: none (lands with M0-B web shell)
last_dogfood: none (no user-visible surface yet)
last_audit: 2026-09-10 — session audit by resident tech lead
known_risks:
- Free-tier infrastructure is suitable for development and early experimentation, not automatically a regulated production environment.
- Mobile health APIs require native platform permissions and real-device validation.
- Clinical/research features require jurisdiction-specific governance before real-world use.
- GLM-5.3 capacity popups intermittently block worker dispatch; assault loop retries per operator policy (never wait).
- gitleaks required full-history checkout (fixed in PR #4).

completed:
- M0-A (PR #4, Lane A): 8 packages — domain (51 tests), contracts (20), config (13), boundary shells db/auth/databox/measurement/consent. CI green.
- M0-C (PR #5, Lane C): packages/testkit (43 tests) + platform (22 tests), apps/api + apps/worker (wrangler dry-run builds), CI Playwright wiring + workers job, orchestration/REPORT.md. CI green. Total workspace tests: 155.

in_flight:
- M0-B (Lane B): web/mobile shells, packages/ui tokens, Playwright + Maestro smoke journeys. Session accepted (queued server-side); prior queued sessions were destroyed by the site during peak hours — dispatcher re-arms automatically.

next_dispatch:
- After M0-B/M0-C land: verify M0 exit criteria (clean install, typecheck, lint, unit test, web build, mobile typecheck, Worker build), dogfood web shell, close M0, dispatch M1 (domain kernel) in three packets.

Do not mark this file green until actual code, tests, and preview verification exist.
