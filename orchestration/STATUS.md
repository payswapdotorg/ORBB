# ORBB Orchestration Status

current_milestone: M0 — repository foundation
architecture_status: FROZEN FOR IMPLEMENTATION
implementation_status: NOT STARTED
active_worker_slots: 0/3
latest_green_commit: none
preview_url: none
last_dogfood: none
last_audit: 2026-09-10 — second bootstrap audit completed
known_risks:
- Free-tier infrastructure is suitable for development and early experimentation, not automatically a regulated production environment.
- The repository does not yet contain the generated `pnpm-lock.yaml`; M0-C must create it before reproducible/frozen CI installation becomes mandatory.
- Mobile health APIs require native platform permissions and real-device validation.
- Clinical/research features require jurisdiction-specific governance before real-world use.
- No preview/staging deployment exists yet.

next_dispatch:
- Lane C: A0/A3/A4/A5 repository bootstrap, lockfile, CI/test harness.
- Lane A: A1/A2 package boundaries, domain primitives, environment contract.
- Lane B: establish design system foundation and app shells; do not invent domain flows beyond M0.

Do not mark this file green until actual code, tests, and preview verification exist.
