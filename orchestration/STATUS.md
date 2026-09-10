# ORBB Orchestration Status

current_milestone: M1 — domain kernel (M0 COMPLETE)
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: M0 COMPLETE — all three lanes merged, exit criteria verified
active_worker_slots: 0/3 (M1 dispatch in flight)
latest_green_commit: 96c267a (Merge PR #6: M0-B web/mobile UI foundation)
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

next_dispatch:
- M1-A (Lane A): domain kernel deepening — MetricDefinition/MeasurementMethod/capability, observation supersession lifecycle, deny-by-default access evaluation engine.
- M1-B (Lane B): packages/ui component library expansion (forms, disclosure, table, timeline, consent sheet, capture controls, charts).
- M1-C (Lane C): packages/observability — structured logging, PHI redaction engine, trace primitives, request envelope.

Do not mark this file green until actual code, tests, and preview verification exist.
