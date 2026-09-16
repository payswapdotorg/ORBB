# @orbb/adherence

Adherence enforcement abstraction for ORBB — **M6-B B10, Lane C (Platform/QA)**.
This package implements golden journey #7's exit direction:

> *User misses task → reminder → fallback provider offered → authorized
> restriction applied only if configured.*

## Safety posture (binding)

**OBSERVE-ONLY BY DEFAULT.** Missing a task window records adherence state and
nothing restrictive happens. Any restriction exists **only** under an explicit,
authorized, configured `AdherencePolicy`; every deviation is explicit,
authorized, configured, and audited.

The binding rule from `docs/UI_UX_ARCHITECTURE.md` (§Design system) governs
this package end to end:

> *"Keep clinical states visually conservative. Avoid gamifying risk,
> abnormality, disease, or adherence."*

Consequences, enforced by construction and by test:

- **No streaks, no scores, no points, no badges, no penalties, no
  third-party escalation.** The policy schema cannot express punitive
  constructs: the complete field-name vocabulary is a closed const
  (`ADHERENCE_POLICY_FIELD_NAMES`) scanned by the vocabulary test, and
  validation rejects every unknown field outright.
- **Recovery is never punished.** `triggerOn` is the literal type
  `"missed"` — the only state that can trigger enforcement. `on-track` and
  `recovered` degrade to no-enforcement.
- **Restrictions are bounded.** `restriction.durationMs` is a positive
  integer capped at 24h (`MAX_RESTRICTION_DURATION_MS`); the minted token
  carries `expiresAtMs = decidedAtMs + durationMs`. There is no permanent
  restriction vocabulary.
- **The capability set is closed.** `ios-focus` and `android-usage-access`
  only; there is no notify-a-clinician/employer capability and no way to
  configure one without a reviewed change to this package.

## Architecture

Three layers, each independently testable:

1. **Evaluation (`evaluation.ts`)** — a pure function from task-window
   outcomes to per-task states `on-track | missed | recovered`, over the
   REAL scheduler types from `@orbb/measurement` (`MeasurementTask`,
   `MeasurementWindow`), with an ordered audit trail and deterministic
   digests. Windows are half-open UTC intervals; elapsed means
   `endsAt <= nowMs`; `recovered` = missed earlier, completed later
   (roll-forward or late completion of a backfill window).
2. **Policy (`policy.ts`)** — the explicit, versioned `AdherencePolicy`
   model (WHICH capability, under WHICH authorization, for WHICH scope,
   for HOW LONG). `resolveAdherencePolicy` validates raw config
   fail-closed: missing/empty/malformed ⇒ **NO-ENFORCEMENT**, mirroring
   the intents SafetyRuleEngine's "ESCALATE-never-publishes" discipline.
   There is no exported function that turns a rejection into an
   enforceable policy.
3. **Engine (`engine.ts`)** — the only place a `RestrictionDecision`
   token can be minted. Fixed evaluation order, every step audited:
   policy resolution → trigger evaluation → scope check → authorization
   gate (injected, consent/access-grant-shaped, evaluated NOW at
   decision time) → capability detection (injected prober) → mint.
   - *Configured but unauthorized* ⇒ a typed **REFUSAL** with an audit
     record (fail-closed: never a silent pass, never a restriction).
   - *Capability unavailable / needs-permission / needs-config* ⇒
     **no-enforcement** with the accounted detection reason (graceful
     degrade to observe-only). Authorization is checked BEFORE
     capability so a broken capability can never mask an authorization
     alarm.
   - Broken injected dependencies (throwing gate/prober, garbage
     reports) ⇒ refusal, never a restriction.

The `RestrictionDecision` token is constructible only by the engine —
this package exports no standalone constructor — and it is the only value
the platform capability adapters accept as authorization to act.

## Authorization model

The gate is an injected predicate shaped on the frozen M1
consent/access-grant domain (`@orbb/domain` `grant.ts` + `access.ts`).
`AccessGrantAdherenceGate` is the reference implementation over
`AccessGrant` snapshots: a request is authorized iff a grant is
structurally valid, subject-owned, `active`, strictly-before-expiry at
the decision instant, and covers one of the requested permissions by
exact scope-entry match. Recorded convention: the restriction permission
vocabulary is `"adherence:restrict"` and
`"adherence:restrict:<capability>"`.

## OS-capability handoffs (platform seam)

`packages/platform/src/adherence/**` (the M4-C seam pattern: TypeScript
seams over native-module interfaces + synthetic native doubles) hosts
the dumb capability surfaces this engine drives:

- `IosFocusAdapter` over `IosFocusNativeModule` — iOS Screen Time /
  FamilyControls-style app shield.
- `AndroidUsageAccessAdapter` over `AndroidUsageAccessNativeModule` —
  Android usage access / app timers.

Detection states: `available | unavailable | needs-permission |
needs-config`. Adapters verify the decision token structurally
(`isRestrictionDecision`, strict field allowlist), re-check detection and
expiry, and resolve every rejection to a typed result — never a throw.

**Recorded handoffs (out of scope for this packet, owned by the
deployment/mobile-integration milestone):**

1. Real native bindings for both `NativeModule` interfaces.
2. The Expo config-plugin surface (iOS Info.plist usage descriptions +
   FamilyControls entitlement; Android manifest queries for usage-stats
   visibility).
3. The reminder (B8 `@orbb/notifications`) and fallback-provider legs of
   journey #7 live upstream of this package; this package owns the
   terminal "authorized restriction applied only if configured" leg.

The platform seam mirrors the `RestrictionDecision` shape structurally
instead of importing this package, keeping the changed-path fence at
exactly: `packages/adherence/**`,
`packages/platform/src/adherence/**`, the platform barrel, and
`pnpm-lock.yaml`. TypeScript structural typing keeps the handoff
type-safe; the cross-package integration test asserts the vocabulary
mirrors stay in lockstep.

## Determinism & replay

Identical inputs produce identical outputs — evaluations, decisions, and
derived ids (canonical JSON + SHA-256 digests) — across calls, engine
instances, and processes. `adherenceEvaluationDigest` and
`enforcementDecisionDigest` are the replay proof tokens used by the
determinism tests.

## Dependencies

Zero external runtime dependencies: `@orbb/domain` and
`@orbb/measurement` (workspace) only, plus Node's `crypto` for
deterministic digests. Proven by `src/deps.test.ts` against the
manifests.
