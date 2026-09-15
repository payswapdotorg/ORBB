# @orbb/notifications

The deterministic reminder/notification engine for ORBB — Milestone 6, work item **B8** (Lane A: Domain/API/Data). Pure package, fully tested, zero runtime dependencies.

## Package contract

`ReminderEngine` exposes two operations over one deterministic core:

| Operation | Purity | Purpose |
| --- | --- | --- |
| `computeSchedule({ tasks, profile })` | Pure, synchronous | Expands measurement-task snapshots + a preference profile into the reminder schedule (ids, payloads, fire instants, channel fan-out, accounted skips). Same inputs ⇒ byte-identical schedule. |
| `dispatchPending({ tasks, profile })` | Idempotent, fail-closed | Recomputes the schedule from the current clock, filters to due reminders, suppresses ledgered ones (exactly-once per reminder identity), resolves recipient pseudonyms, delivers through channels, records every outcome. |

Inputs:

- **Task snapshots** — the REAL `MeasurementTask` / `MeasurementWindow` types, imported types-only from `@orbb/measurement` (the workspace dependency; see the dependency-budget note below).
- **A user preference profile** (`ReminderPreferenceProfile`) — master reminders gate, ordered enabled channels, quiet-hours spec, lead/grace knobs.
- **A channel registry** (`ChannelRegistry`) — the injected set of delivery adapters with capability flags.

Everything else is injected per the `@orbb/measurement` discipline: **clock, id-factory, ledger, recipient directory, label directory** — zero db imports, zero external runtime dependencies (`node:crypto` builtin only).

### The escalation ladder (journey #7)

```
REMIND  ──(open task, window.endsAt <= now, after the grace delay)──▶  REMIND_WITH_FALLBACK_OFFER
```

- `REMIND` — the upcoming-due nudge for an OPEN task with a future window: fires `leadTimeMs` (default 60 min) before the window closes, clamped forward to the window start (a nudge never fires before the window opens).
- `REMIND_WITH_FALLBACK_OFFER` — the missed-window rung: fires `escalationGraceMs` (default 60 min) after the window closes. The payload carries the task's recorded method vocabulary (`methodOrder`, preferred first) as **DATA** — the engine never orders a provider; the person chooses. `enforcementAuthority: "none"` is type-encoded on the offer.
- COMPLETED tasks get no reminders — completing silences the ladder. Reminders nudge; they never assert clinical conclusions, never punish, never gamify.

The tail of golden journey #7 — *"authorized restriction applied only if configured"* — is **B10's** adherence-enforcement abstraction, deliberately out of scope: this package exports no enforcement mechanism of any kind.

### Quiet hours (recorded assumption)

- Default: **no reminders 22:00–07:00 local-of-record**, applied when a profile is silent about quiet hours; `quietHours: null` (or `enabled: false`) disables deferral — quiet hours are preference-gated, never forced.
- **Local-of-record is a fixed UTC offset in minutes** (pure-UTC, DST-free — the same discipline as the A30 scheduler's window math). Resolving a person's IANA timezone (with DST transitions) is an application-boundary concern feeding the profile's offset.
- Reminders due inside the quiet interval are **deferred to the quiet-window end edge (07:00), never dropped silently** — the deferral is recorded on the payload (`defer.from` + `reason: "quiet-hours"`) and the half-open `[start, end)` interval semantics are table-tested across UTC-day edges, week boundaries, and offset extremes.

### Idempotency and reminder identity

Reminder identity is a deterministic function of **(task id, window id, rung, channel, UTC day)** — a domain-separated SHA-256 (`remd_<base64url>`), mirroring the A30 recorded rationale for content-derived ids. **Recorded interpretation:** the UTC day is that of the *effective* (post-deferral) fire instant, which makes identity invariant across computation instants (no midnight double-dispatch) and "at most one reminder per (task, window, rung, channel) per UTC day" explicit and testable.

- Recomputing the schedule over unchanged inputs yields byte-identical reminders — proven twice and across a serialized re-instantiation (canonical JSON with Dates as epoch-ms).
- A **send-attempt ledger** records what was actually dispatched: one row per reminder identity, keyed by reminder id, recording BOTH sent and undeliverable outcomes (a failed dispatch is still a dispatch of record — never a silent drop). A ledgered reminder is never re-sent under the same identity.
- A deliberate **daily re-nudge recurrence is NOT invented** (no requirement specifies it; the safe non-spamming reading wins). Re-nudges emerge from the measurement scheduler's window roll-forward: a rolled task has a NEW window identity ⇒ new reminders.

### Delivery channels (provider portability)

`NotificationChannel` is the fail-closed port: typed send results, per-channel capability flags (`canRemind`, `canCarryFallbackOffer`), and an accounted skip when a channel cannot satisfy a rung's requirements. Channels see ONLY the PHI-free payload plus an opaque `recipientRef` pseudonym — never a person id.

Doubles only, in this packet:

- `InMemoryChannel` — the test/impl default, with deterministic fault injection.
- `SyntheticWebPushChannel` / `SyntheticEmailChannel` — **seam-only SYNTH doubles** that shape the provider contract (endpoint directories, subscription-expiry semantics, deterministic receipts) with no network, no SDK, no VAPID/SMTP — the M4-C/M5-C seam pattern. Real adapters arrive behind the same interface.

### PHI discipline (hard requirement)

Reminder payloads reference **task/metric/window ids and human-safe labels ONLY** — never observation values, never evidence content, never person-identifying free text, never concept codes (present on the task snapshot, deliberately stripped). Proven by `not.toContain`-style tests over every payload variant (rung 1, rung 2 with the fallback offer, deferred), the channel-visible delivery requests, provider receipts, ledger rows, and the schedule audit view (`toScheduleAuditView` — the observability projection). `serializeReminderSchedule` (the full-fidelity form including the internal `personId` addressing field) is internal-only and never a logging surface.

## Recorded handoffs (integration boundaries)

1. **Worker wiring (`apps/worker`)** — the Cloudflare Worker consumer that drains the domain-event outbox, loads task snapshots + preference profiles, and calls `dispatchPending` on a periodic tick. `apps/worker` is an M0 no-op shell today; per the B8 scope rule the seam is recorded, not wired.
2. **DB adapters** — `SendAttemptLedger` (async), `RecipientDirectory`, `ChannelRegistry`, `ReminderLabelDirectory` are ports shaped for persistence; Postgres implementations arrive with the db integration packet.
3. **Provider adapters** — real Web Push (VAPID) and email (SMTP/SES) channels behind `NotificationChannel`.
4. **IANA timezones** — offset resolution for the local-of-record happens at the app boundary.
5. **B10 boundary** — adherence enforcement / authorized restrictions are B10's abstraction.
6. **Shared kernel** — `NotificationResult`, canonical JSON, and hashing are local mirrors of the measurement/intents lane helpers (same recorded dependency-budget rationale); a future shared kernel package would let all lanes adopt them mechanically.

## Dependency-budget note

`@orbb/measurement` is imported **types-only** (`import type { MeasurementTask, MeasurementWindow }`), so the built `dist/` has zero runtime imports of it. Local mirrors (`result.ts`, `canonical.ts`, id derivation) keep the package's runtime surface to `@orbb/domain` guards + `node:crypto`. `NotificationResult` is structurally identical to the measurement lane's `EngineResult` and the intents lane's `IntentResult`.

## Scripts

Same as every lane package: `lint` (eslint), `typecheck` (tsc --noEmit), `test` (vitest run), `build` (tsc → `dist/`).
