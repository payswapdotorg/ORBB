# @orbb/notifications

Deterministic notification/reminder engine for ORBB — work item **M6-B B8**
(Milestone 6, consumer product), Lane A (Domain/API/Data).

Pure TypeScript package, fully tested. **Zero external runtime dependencies,
zero `@orbb/db` imports** — the interface-driven discipline of
`@orbb/measurement`: injected clock, injected send-attempt ledger, injected
channel registry, content-derived identities.

## What it does

From three explicit inputs — **measurement-task snapshots** (the real
`MeasurementTask` / `MeasurementWindow` types imported from
`@orbb/measurement`), a **user preference profile**, and a **channel
registry** — the engine computes, deterministically:

- **Upcoming-due reminders** — a nudge planned for
  `max(windowStart, windowEnd − upcomingLeadMs)` (default lead: 1 hour).
- **Missed-window detection** — the same `REMIND` rung, with the recorded
  reason `missed-window`, once the window has closed while the task is open.
- **A gentle escalation ladder** with exactly two rungs:
  `REMIND → REMIND_WITH_FALLBACK_OFFER`. The offer rung becomes current only
  when the recorded conditions hold: the task is still open,
  `now ≥ windowEnd + escalationAfterMs` (default grace: 24 hours), and the
  task **records fallback vocabulary** (`methodOrder` of length ≥ 2). The
  higher rung supersedes the lower (one rung current per task window — no
  double-nudging), and a task without fallback vocabulary never escalates.
- **Quiet hours** — a preference-gated window with **defer-not-drop**
  semantics (below).
- **Fail-closed dispatch** — every due reminder goes out through a
  `NotificationChannel`; every attempt (delivered / undeliverable / failed /
  channel-errored) is recorded in the send-attempt ledger, never silently
  dropped, and a contract-violating channel that throws can never crash the
  engine's typed result.

## Journey #7 role (golden journey)

> "User misses task → reminder → fallback provider offered → authorized
> restriction applied only if configured."

This engine owns the **reminder** and the **fallback-provider offer** steps.
The offer is **DATA, not a decision**: the `REMIND_WITH_FALLBACK_OFFER`
payload carries the task's recorded fallback vocabulary (`methodOrder` after
the preferred method, in the recorded order, with caller-vetted labels). The
engine never orders a provider, never ranks beyond the recorded chain, and
never applies any restriction — authorized restriction application belongs
to the adherence enforcement lane (`@orbb/adherence`, M6-B B10) and is
applied only where configured. Reminders nudge; they never assert clinical
conclusions, never punish, never gamify (AGENTS.md operating rule).

## Idempotency and determinism

Reminder identity is a deterministic function of
**(task id, window id, rung, channel, UTC day)** — derived by
domain-separated SHA-256 (the `@orbb/measurement` `deriveDeterministicId`
helper, the A30 recorded choice, not a counter factory), so:

- recomputing the schedule over unchanged inputs (including the clock
  instant) yields **byte-identical** reminders — across recomputes, fresh
  engine instances, and serialized re-instantiation;
- the ledger records each dispatch **exactly once per reminder id**;
- the UTC day bucket is the day of the **effective (post-deferral) send
  instant**, giving at most one dispatch per (task, window, rung, channel)
  per UTC day, with later days legitimately materializing the daily gentle
  recap of a still-open task.

The measurement model has no standalone window id, so this package derives
a task-scoped `WindowKey` from (task id, sequence, window bounds) — a
roll-forward re-anchor therefore produces a new window key while the ledger
keeps the old window's dispatch audit trail (recorded assumption).

### Planned send instants

For a task's current rung with nominal instant `N`
(`max(windowStart, windowEnd − lead)` for `REMIND`;
`windowEnd + escalationAfterMs` for the offer rung):

- the **planned send instant** is `deferQuietHours(max(N, now))` —
  future nominals are planned ahead (visible as pending reminders), passed
  nominals are planned "as soon as possible now" (a person rejoining after
  a missed window is reminded immediately);
- a reminder is **due** iff its planned instant `≤ now`;
- if the planned instant falls inside quiet hours it is **deferred to the
  quiet-end edge** — the reminder stays in the schedule with `deferredFrom`
  recorded; it is never dropped.

## Quiet hours (recorded assumption)

Default: **no reminders 22:00–07:00 local-of-record** (`DEFAULT_QUIET_HOURS`
— the packet's default assumption, recorded). The profile can disable or
reshape the window (`QuietHoursSpec`, minutes of local day; wrapping windows
like the default are supported; a degenerate `start === end` is rejected).

Local-of-record time is modeled as a **fixed UTC offset**
(`localUtcOffsetMinutes`, validated to the real-world range
[−720, +840] minutes): deterministic, DST-free, pure UTC millisecond
arithmetic mirroring the scheduler it computes from. A tz-database-aware
offset resolver is a later integration seam (handoff below).

## Delivery channel abstraction

`NotificationChannel` — typed send operations (`ChannelSendRequest` with a
discriminated-union payload), per-channel capability flags
(`deliversReminders`, `deliversFallbackOffers`), and a fail-closed delivery
result model (`delivered | undeliverable | failed`, each non-delivery with a
typed bare-kind reason — never a silent drop, never a thrown crash into the
engine). Channels that cannot carry a rung's payload are **skipped with an
accounted reason** in the schedule outcome.

Shipped doubles:

- `InMemoryChannel` — the test/impl default (scriptable
  deliver/fail/throw behaviors, configurable capabilities);
- `WebPushChannel` / `EmailChannel` — **seam-only SYNTH doubles** over the
  `WebPushProvider` / `EmailProvider` ports (the M4-C/M5-C adapter-seam
  pattern): they shape the provider contract — recipient references,
  notification/message shapes, delivery reports — **without any network
  call and without any provider SDK**.

Recipient routing uses opaque `ChannelRecipient` references resolved to
real addresses inside the provider seam — the engine never sees a raw
address.

## PHI discipline (hard requirement)

Reminder payloads reference **task / metric / window ids and caller-vetted
human-safe labels ONLY** — never observation values, units, quality scores,
evidence content or ids, concept codes, person identifiers, or free text
generated by the engine. `ReminderLabelPack` entries are structural
pass-through; label meaning is the authorized caller's responsibility.
Proven by `phi.test.ts` over every payload variant and every seam
(deny-by-default recursive key allowlists, string-class proofs, sentinel
absence proofs, number-class proofs).

## Public surface

`ReminderEngine` (`computeSchedule` / `dispatchDue`), the preference profile
types and validators, quiet-hours mathematics, `ReminderId`/`WindowKey`
derivation, the channel abstraction + doubles, and the
`ReminderDispatchLedger` port + in-memory double. The local test harness
(`testsupport.ts`) is deliberately NOT exported (the `@orbb/measurement`
precedent).

## Recorded handoffs (not this packet's scope)

- **Worker wiring**: `apps/worker` should, in a later additive packet,
  schedule `dispatchDue` passes (clock + task snapshots + profile + channel
  registry per person) on the Cloudflare Queues/Worker runtime. No worker
  code was touched by B8.
- **Persistence**: the ledger (and future profile store) ports expect the
  `@orbb/db` adapter in a later integration packet; in-memory doubles are
  the reference implementations.
- **Time zones**: a tz-database-aware local-of-record resolver (IANA
  identifiers, DST transitions) should be injected behind the same
  `localUtcOffsetMinutes` seam.
- **Real providers**: Web Push (VAPID) and email bindings implement
  `WebPushProvider` / `EmailProvider`; nothing else changes.
- **Ledger-failure semantics**: a ledger write that fails after a channel
  delivered means the next pass may re-send that reminder (at-least-once);
  the ledger is the exactly-once guard and its failure surfaces as a typed
  `ledger-failure`, never a silent gap (architecture §4: never assume
  exactly-once delivery).
- **Escalation beyond two rungs**: deliberately none — gentle by design;
  anything stronger is the adherence lane's authorized, configured concern.

## Tests (definition of done)

`pnpm test` in this package covers: determinism (twice + serialized
re-instantiation), table-driven window math (due/missed boundaries, UTC day
edges, week boundaries, roll-forward tracking), escalation conditions and
fallback-vocabulary payloads, quiet-hours defer-not-drop (including stable
identity across an overnight deferral), idempotency (recompute adds
nothing; ledger exactly-once; rehydrated ledger), fail-closed channels
(throwing/undeliverable/failing), capability gating with accounted reasons,
and no-PHI proofs over every payload variant.
