# @orbb/notifications

Deterministic notification/reminder engine for ORBB — **Milestone 6, Lane A,
work item B8**. Pure package, fully tested: injected clock, injected
id-factory, injected send-attempt ledger, injected event sink, injected
channel registry. **Zero `@orbb/db` imports, zero external runtime
dependencies, no provider SDKs** (the `@orbb/measurement` A30/A31
interface-driven discipline).

Workspace dependencies: `@orbb/domain` (canonical id guards/types),
`@orbb/measurement` (the REAL `MeasurementTask`/`MeasurementWindow` types +
the shared deterministic-id derivation), `@orbb/contracts` (the §11
`DomainEventEnvelope` used for `TASK_DUE` emission). `@orbb/testkit`
(Clock/IdFactory) is a dev-only seam.

## Package contract

### 1. Reminder computation — `ReminderEngine.computeSchedule(input)`

Pure, deterministic projection of (measurement-task snapshots, preference
profile, channel registry, vocabulary labels, clock-now) onto a
`ReminderSchedule`:

- **Upcoming-due rung `REMIND`** — an OPEN task whose window's due instant
  (`window.endsAt`, half-open `[startsAt, endsAt)`) is strictly in the
  future gets one reminder per eligible channel, nominally sent
  `leadMinutes` (default 60) before the due instant. A computation inside
  the lead window yields an immediately dispatchable (late) reminder.
- **Missed-window detection + gentle escalation ladder**
  `REMIND → REMIND_WITH_FALLBACK_OFFER` — an OPEN task whose window has
  closed (`now ≥ window.endsAt`) has missed it; the rung advances exactly
  on the recorded conditions — (a) the window closed, (b) the task is
  still open — and the escalation fires `escalationDelayMinutes`
  (default 30) after the window edge.
- Completed tasks produce nothing — reminders nudge, they never punish
  and never gamify (AGENTS.md operating rules).

The schedule also records every **accounted skip** (a channel disabled by
preference, or lacking the rung's capability flag) with a typed reason —
never a silent drop.

### 2. Quiet hours (preference-gated, defer — never drop)

**Recorded assumption (default):** no reminders are sent **22:00–07:00
local-of-record** when no narrower preference exists. A nominal send
instant inside quiet hours is **deferred forward to the closing edge (the
next 07:00 local)** — never dropped silently, and reminder identity is
derived from the *nominal* instant so deferral never changes identity.
"Local-of-record" is a **fixed UTC offset** in minutes ([-720, +840]):
pure UTC millisecond arithmetic, DST-free by construction (the A30
scheduler precedent). DST-aware IANA zones are a deployment/presentation
concern (handoff recorded). A degenerate zero-length quiet window is
treated as disabled.

### 3. Idempotency

Reminder identity is a deterministic function of
**(task id, window id [the window's `sequence`], rung, channel, UTC day of
the nominal send instant)**, derived with the shared domain-separated
SHA-256 helper (`rem_<43-char base64url>`). Recomputing the schedule over
unchanged inputs yields **byte-identical** reminders (see
`serializeReminderSchedule` canonical JSON). The **send-attempt ledger**
(`ReminderDispatchLedger` port, in-memory double included) keys dispatch
records by reminder id: a delivered reminder is dispatched **exactly
once, ever**; a failed attempt is recorded with its classified reason and
stays retryable until `maxDispatchAttempts` (default 3 — recorded
assumption), after which the reminder is skipped with
`retries-exhausted` (fail-closed, recorded).

### 4. Delivery channels (fail-closed)

`NotificationChannel` exposes **typed send operations** (`sendReminder`,
`sendFallbackOffer` — one per ladder rung) plus per-rung capability flags
(`supportsRemind`, `supportsFallbackOffer`; absent flags are falsy —
deny-by-default). Delivery results are a **fail-closed union**:
`delivered | undelivered + typed reason` from the closed vocabulary
`channel-error | provider-rejected | no-delivery-address | rate-limited`.
The engine additionally converts channel **throws** and malformed channel
returns into recorded `channel-error` failures — a rogue provider can
never crash dispatch and an undeliverable reminder is never silently
dropped.

Doubles shipped:

- `InMemoryChannel` — the test/implementation default (programmable
  failure modes, defensive copies, injected clock).
- `WebPushChannel` / `EmailChannel` — **seam-only SYNTH doubles** (the
  M4-C/M5-C pattern): they shape the provider contracts
  (`WebPushSubscriptionProvider`, `EmailAddressProvider` ports) without
  any network call or SDK. Addresses/tokens are resolved INSIDE the
  provider adapter by person id — the engine never sees them.

### 5. PHI discipline (hard requirement)

Reminder payloads reference **task/metric/window ids and human-safe
vocabulary labels ONLY** — never observation values, never evidence
content, never person ids, never concept codes, never person-identifying
free text. `dueAt` is schedule metadata (the plan cadence's window edge).
Labels are caller-supplied vocabulary passed through verbatim under a
hard cap (≤ 80 chars, no control characters) — label *content* is the
caller's responsibility (vocabulary display names, not person data).
Proven with `not.toContain`-style proofs over every payload shape in
`src/phi.test.ts` (the `@orbb/observability` PHI-proof pattern), plus
structural key-allowlist checks. The only person-carrying planes are the
routing envelope (`ChannelSendRequest.personId` — channels must address
their own targets) and the frozen §11 envelope `subject`.

## Journey #7 role (M6 exit criterion)

> "User misses task → reminder → fallback provider offered → authorized
> restriction applied only if configured."

This package is the **engine head** of that journey:

1. **Misses task** — missed-window detection (`now ≥ window.endsAt`,
   task still open).
2. **Reminder** — the pre-due `REMIND` dispatch, then the missed-window
   escalation.
3. **Fallback provider offered** — the `REMIND_WITH_FALLBACK_OFFER`
   payload carries the task's **recorded fallback vocabulary**
   (`methodOrder` after the preferred method) **verbatim and in order**.
   The offer is **DATA, not a decision**: the engine never ranks, filters,
   or orders providers, and carries no selection field of its own.
4. **Authorized restriction applied only if configured** — **NOT this
   package**. That is B10 (adherence-enforcement abstraction,
   Lane C) — the engine deliberately ships no enforcement vocabulary.

`escalation.test.ts` walks the full engine-side journey end-to-end.

## Events

Every successful dispatch emits one **`TASK_DUE`** event through the
injected `ReminderEventSink` — the frozen contracts §11 envelope
(`eventId` from the injected id-factory, `version: 1`,
`payloadSchemaVersion: "1.0.0"`, `causationId` = the reminder id, payload
= canonical JSON of `{ reminderId, channelId, reminder }`). **Recorded
actor assumption:** the subject person is recorded as the actor
(time-driven events have no initiating person/device/source; a dedicated
service-account actor kind is reserved for tech-lead review per
`@orbb/domain` `provenance.ts`).

## Recorded assumptions & handoffs

| # | Assumption / handoff |
|---|---|
| 1 | Quiet hours default 22:00–07:00 local-of-record (work order); local-of-record = fixed UTC offset (DST is a deployment concern). |
| 2 | `leadMinutes` default 60; `escalationDelayMinutes` default 30; `maxDispatchAttempts` default 3. |
| 3 | Missed window with no fallback vocabulary (single recorded method) stays on the `REMIND` rung (gentle nudge) — the engine never invents vocabulary. |
| 4 | Unlisted channels default to enabled; `remindersEnabled: false` is the master off-gate. |
| 5 | `TASK_DUE` used for dispatched reminders (frozen vocabulary — no REMINDER_DISPATCHED type exists; adding one is a tech-lead decision). |
| 6 | Actor = subject person on TASK_DUE envelopes (service-account actor needs tech-lead review). |
| 7 | **Handoff:** db adapters for the ledger + event sink (the transactional-outbox coupling — ledger write and outbox write in one transaction — arrives with the `@orbb/db` integration packet; `event-sink-failure` after a recorded delivery is the documented at-least-once window). |
| 8 | **Handoff:** worker wiring (`apps/worker`) — a tick loop calling `dispatchDue` over task snapshots; deliberately NOT added in this work item (deployment concern, additive module allowed by the work order but not required). |
| 9 | **Handoff:** real Web Push (VAPID) and transactional-email provider adapters implement the provider ports; OS-level adherence enforcement is B10 (Lane C). |

## Scripts

`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` — same as every
`@orbb/*` package (turbo-driven from the repo root).
