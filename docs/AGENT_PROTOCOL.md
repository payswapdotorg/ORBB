# ORBB Agent Protocol

## Worker handoff template

```yaml
work_item: A00
milestone: M0
owner_lane: A|B|C
objective: "one sentence"
allowed_paths:
  - packages/domain/**
forbidden_paths:
  - apps/mobile/**
contracts:
  - docs/...
dependencies:
  - A00
acceptance:
  - "specific observable condition"
  - "specific automated test"
required_evidence:
  - tests
  - screenshots-or-playwright-report
  - migration-report
```

## Concurrency rules

At most three implementation workers are active. The tech lead may reserve a slot for an integration/recovery task when necessary. Workers must declare file ownership before starting. Shared-contract files are edited by one worker at a time.

## Branch/PR policy

Every worker works in its own branch. PR title begins with the work item ID. PR body must include:
- intent;
- scope;
- files changed;
- tests;
- security/privacy impact;
- migration impact;
- known limitations;
- dogfood steps.

No worker merges itself.

## Review labels

Recommended GitHub labels:
`lane:A`, `lane:B`, `lane:C`, `milestone:M0` ... `milestone:M13`, `needs-architecture`, `needs-changes`, `ready-for-dogfood`, `blocked`, `security`, `privacy`, `clinical`, `research`, `release-gate`.

## Orchestrator loop

```text
read current state
  ↓
select next work item(s)
  ↓
validate dependencies/contracts
  ↓
dispatch ≤3 workers
  ↓
collect PRs
  ↓
review diffs + tests
  ├─ reject → targeted change request → worker
  └─ approve
       ↓
merge dependency-safe PRs
       ↓
deploy preview/staging
       ↓
run UI dogfood
       ↓
run automated suites
       ↓
update STATUS.md
       ↓
advance milestone
```

## User-mode testing

The orchestrator must prefer the same public interfaces a user sees:
- web browser at preview URL;
- mobile binary through Maestro;
- clinic/research portals through their web routes.

Direct database edits are permitted only for deterministic fixture seeding. Never use direct database edits to prove a user workflow.

## Test data

Use synthetic fixtures tagged `synthetic=true`. Fixture identities must never resemble real patients enough to be confused with actual records. Every automated suite starts from a clean tenant or deterministic reset.

## Change requests

When requesting changes, write the acceptance condition, not implementation instructions, unless the worker explicitly asks for design help. Preserve worker autonomy inside the frozen architecture.

## Approval levels

`COMMENT` = observation, no decision.
`REQUEST_CHANGES` = cannot integrate.
`APPROVE` = technically acceptable; still requires dogfood/release gate.
`MERGE` = only after required checks and approval.

## No silent shortcuts

Do not mark a task green by:
- weakening tests;
- skipping UI checks;
- mocking the feature in a production path;
- disabling auth/consent;
- accepting unvalidated data as clinical truth;
- hiding errors;
- hardcoding provider credentials;
- shipping feature flags permanently off.
