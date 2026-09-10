# ORBB Orchestration Status

current_milestone: M0 — repository foundation
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: IN PROGRESS (M0-A merged; M0-B/M0-C dispatched)
active_worker_slots: 2/3 (m0-b-ui, m0-c-platform — fighting GLM-5.3 capacity)
latest_green_commit: 66681d5 (Merge PR #4: M0-A domain package boundaries)
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

in_flight:
- M0-B (Lane B): web/mobile shells, packages/ui tokens, Playwright + Maestro smoke journeys. Dispatched, awaiting send under capacity.
- M0-C (Lane C): CI/test harness, packages/testkit + platform adapters, api/worker shells. Dispatched, awaiting send under capacity.

next_dispatch:
- After M0-B/M0-C land: verify M0 exit criteria (clean install, typecheck, lint, unit test, web build, mobile typecheck, Worker build), dogfood web shell, close M0, dispatch M1 (domain kernel) in three packets.

Do not mark this file green until actual code, tests, and preview verification exist.
