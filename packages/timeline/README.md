# @orbb/timeline — the patient timeline API

A pure, deterministic, care-team-authorized longitudinal assembly of a person's
health record into an ordered, paginated, provenance-preserving timeline
(M7-B work item **A49**, Lane A). This is the M7 exit-criterion surface:
*"clinician can request authorized data and reason over a longitudinal patient
timeline."*

The package is **interface-driven** (injected store ports, clock, and id
factory), has **ZERO `@orbb/db` imports**, and **zero external runtime
dependencies** — the only runtime dependencies are the workspace links
`@orbb/clinical` (the REAL care-team evaluator) and `@orbb/domain` (the
kernel). `@orbb/measurement` and `@orbb/testkit` are **TYPE-ONLY** imports
(erased at compile time; the `deps.test.ts` fence proves it against the source
text and the lockfile).

**Safety posture (binding, AGENTS.md):** clinical features require
jurisdiction-specific governance before real-world use — everything here is
boundary-shaped, non-authoritative, and SYNTH-fixtured. Tests never touch real
medical data.

## The entry model (frozen union)

A `TimelineEntry` is one assembled record of the SUBJECT person's timeline — a
frozen discriminated union over the three longitudinal record kinds:

| Kind | Assembled from | The domain timestamp (`occurredAt`) |
| --- | --- | --- |
| `observation` | a canonical same-metric observation set | `effectiveAt` (invariant: equal to `occurredAt`) |
| `task` | a `MeasurementTask` window/state summary | the CURRENT window's due instant (`window.endsAt`) |
| `intent` | a `HealthIntent` state summary | `createdAt` |

Every entry carries: the domain `id` (`obs_` / `task_` / `intent_`), `personId`
(the SUBJECT), `occurredAt`, the entry-kind tag, and a **provenance summary**
(`sourceId`/`methodId` where applicable — observations carry the canonical
source and method; tasks and intents carry neither).

### The observation entry — the ReconciliationService doctrine mirror

Same-metric observation sets present **ONE canonical entry** with per-source
provenance, mirroring the `@orbb/measurement` doctrine exactly: two same-metric
observations from different methods/sources reconcile into one canonical view;
**data is never discarded — superseded sources stay visible as provenance.**
The entry carries:

- the canonical value shape: `conceptCode`, typed `value`, `unit`,
  `effectiveAt`, `methodId`, `validationState`, `evidenceLabel`, `quality?`;
- a **supersession summary**: `{ supersedesId?, supersededIds, supersededCount }`
  — the correction chain that produced the current value;
- **per-source provenance** for EVERY original in the set:
  `{ observationId, sourceId, methodId, evidenceLabel, quality?, provenanceId,
  role }` with `role` of `canonical-source` (exactly one, first) or
  `superseded-source` (the originals the current value superseded, ordered by
  observation id ascending).

The structural guard (`assertTimelineEntry`) enforces the cross-field
invariants: `occurredAt === effectiveAt` (observations), `occurredAt ===
window.endsAt` (tasks), exactly one `canonical-source` first, no duplicate
observation ids, the supersession count equals the superseded sources, and the
direct `supersedesId` is among the superseded ids.

### PHI discipline (hard requirement)

**NO free-text content beyond typed bounded labels; NO PHI beyond typed
shapes.** The domain `HealthIntent.objective` (free text) is deliberately NOT
mapped — an intent entry is a typed state summary only. Observation values are
the kernel's primitive union (`string | number | boolean`). Every test fixture
is SYNTH-marked, and `privacy.test.ts` plants decoy free-text/identity strings
in every record field that could carry them and proves they never appear in any
serialized outcome surface (page, summary, denial, audit, event, cursor) — and
that typed error messages never echo received values.

### The page

`TimelinePage` = `{ entries, nextCursor?, truncated }`. The `truncated` flag is
**honest**: it is true exactly when a `(limit+1)`-th entry existed in the
requested stream — the timeline is never silently truncated — and `nextCursor`
is present exactly when `truncated` is true.

## The assembly service

`PatientTimelineService.assembleTimeline(subject, query, practitionerContext)`
is a pure, deterministic assembly over three injected store ports:

- `ObservationTimelineStore` — canonical same-metric observation sets,
- `TaskTimelineStore` — measurement tasks,
- `IntentTimelineStore` — health intents.

Deterministic given `(subject, query, context, store contents, clock,
id-factory)`: every timestamp comes from the domain records or the injected
clock; every id from the domain records or the injected factory.

### Ordering law

`(occurredAt DESC, domain id ASC)` — a **total order**, hence stable under any
permutation of the input stream (the permutation-invariance tests shuffle
insertion order and demand byte-identical pages).

### Windowing

`query.from` / `query.to` are **inclusive** UTC-millisecond bounds on an
entry's `occurredAt` (both ends boundary-proven by tests). A window with `from`
after `to` fails closed with the typed `invalid-window` error. The service
re-asserts the window even when a port pre-filters — the port bound is an
optimization seam for the future db adapter; the service filter is
authoritative.

### The observation port is canonical-view-shaped (recorded assumption)

The observation port returns the timeline-local `CanonicalObservationRecord`:
the canonical head observation of a same-metric set PLUS the per-source
provenance of every original in the set. This is exactly the output shape of
the measurement `ReconciliationService` (winner + loser + canonical
replacement, per-source provenance records, nothing discarded) — the timeline
**consumes reconciliation outputs instead of re-deriving set membership from
observation content**, which would be an invented, fragile heuristic. The db
adapter (recorded handoff) reconstructs the sets from the persisted
supersession graph; `reconciliation.test.ts` proves the mapping by feeding the
output of the REAL `ReconciliationService` into the timeline port.

## The cursor law

The timeline-local mirror of the `@orbb/db` cursor law, specialized to the
timeline's total order:

- The cursor is an **opaque base64url** envelope over the versioned anchor
  tuple `{ v, o, i }` (occurredAt ISO-8601 + the opaque domain id). Because
  every ORBB domain id IS the opaque public identifier, the anchor can never
  leak a raw database row id — there is none.
- **Page-stable (position anchoring, never offsets):** a cursor returns the
  same page regardless of newer insertions before it — entries that sort
  strictly before the anchor position can never shift it.
- **Forward-only:** the next page is always the entries strictly AFTER the
  anchor under the total order; there is no previous-page grammar at all.
- **Fail-closed:** malformed cursors (not base64url, not JSON, wrong version,
  missing/corrupt anchors) throw the typed `TimelineError("invalid-cursor")`
  — never a silent default, and the offending value is never echoed.
- Page limits: default 50, hard max 200, strict validation (mirroring the db
  `clampPageLimit` discipline — silent clamping hides caller bugs).

## The authorization gate (the exit-criterion gate)

The timeline is the SUBJECT person's data; a clinician reads it **only**
through `@orbb/clinical`'s REAL `evaluateCareTeamAccess` with the frozen
read-only scope **`timeline:read`** (a runtime workspace dependency — the A45
layering, not a reimplementation; the `satisfies CareTeamScopePermission`
clause on `TIMELINE_READ_PERMISSION` is a compile-time drift lock, and
`deps.test.ts` pins the lockfile lines).

**Deny-by-default is ABSOLUTE:**

- every clinical deny reason maps to a **typed timeline denial** — a total,
  compile-forced `Record<CareTeamDenyReason, TimelineDenyReason>` table
  (identity labels: the clinical reason IS why the timeline read failed),
  drift-locked by a test over the REAL runtime vocabulary;
- the denial is **all-or-nothing**: a denied request returns `{ kind:
  "denied", reason, evaluatedAt, audit, event }` and **never a partial
  timeline** — the store ports are not even read (spy-store proof);
- no grant, no timeline; no confirmed link, no timeline;
  suspended/dissolved/unverified anything — no timeline;
- the evaluation instant comes from the **injected clock** (`request.at`) —
  expiry tests advance the clock, never wall-clock time;
- query semantics (window order, limit range, cursor decoding) are validated
  **after** authorization — a denied clinician never triggers cursor work.

Every decision — ALLOW and DENY alike — carries:

- a `TimelineAccessAudit` record (WHO: the practitioner; WHAT: the subject +
  the `timeline:read` permission label; WHEN; DECISION; REASON) shaped for the
  append-only `access_audits` table (db handoff recorded — the same mapping
  discipline as the clinical lane: labels and ids only, never data values);
- a `TIMELINE_READ` **event** (`TimelineEventEnvelope`, the §11 field list:
  eventId, type, version, occurredAt, actor, subject, correlationId?,
  causationId?, payloadSchemaVersion) with the practitioner as actor and an id
  minted from the injected id factory.

**Self-serve is a recorded future surface, NOT shipped here:** a person
reading their OWN timeline through a person-context seam has no code path in
this package (the event actor union admits `PersonId` so the promotion is
additive, but nothing constructs it).

## timelineSummary — honest counts

`timelineSummary(entries)` is a pure derivation: counts by kind (and total)
over the entries the caller supplies — a page, a window, or an accumulated
page walk. **No aggregation beyond what the entries themselves state**: no
inference, no trend claims, no baselines or episodes — M12 (doctor-grade
intelligence) owns interpretation.

## Error surface

Two disciplines side by side (both recorded):

- `TimelineError` with a typed frozen code — the REQUEST side
  (`invalid-request`, `invalid-window`, `invalid-limit`, `invalid-cursor`),
  mirroring the `@orbb/db` `PersistenceError("invalid-request")` law for
  cursor pagination. Fail-closed; values never echoed.
- `DomainInvariantError` (kernel) — the STRUCTURAL side: malformed store
  records (a superseded-head canonical record, a malformed task/intent) and
  malformed clinical snapshots are data-integrity failures and throw.

Authorization never throws and never allows by default: semantic failures are
typed DENY outcomes.

## Tests (definition of done)

136 tests across 9 files, all green:

- **assembly** — deterministic ordering (permutation-invariance across four
  insertion permutations), the kind timestamp invariants, inclusive window
  bounds (exact-boundary proofs), the service re-asserting the window over an
  over-returning port, person isolation, page-size limits, cursor walking,
  page stability under newer insertions, fail-closed malformed inputs.
- **authorization** — the exhaustive deny-by-default proof (every REAL
  clinical deny reason → the typed timeline denial; the reachable ones deny
  the read; spy stores prove ZERO port reads on deny; positive control proves
  the spies count on allow), all-or-nothing denial surfaces, the allow path
  (clinic-scoped and org-level), expired-grant via the injected clock
  (exactly-at, after, and strictly-before the expiry instant), audit + event
  shape on every outcome.
- **reconciliation** — the doctrine mirror: one canonical entry per
  same-metric set, per-source provenance visible, the amendment chain, the
  liberal-port/normalizing-assembly contract, the port guards, and the REAL
  `ReconciliationService` integration (the measurement service output maps
  into the timeline port and assembles to one canonical entry).
- **cursor** — the grammar (round-trip, opacity, fail-closed malformed
  cursors), the total order, page stability under insertions before the
  anchor, forward-only walking (disjoint, ordered, complete coverage), the
  honest truncated flag at the page-size boundary +1, strict limit clamping.
- **entries** — the frozen vocabularies, structural guards, cross-field
  invariants, the no-smuggle key-set proofs (exact frozen field lists; the
  intent entry has no `objective`).
- **privacy** — decoy-planting `not.toContain` over every serialized surface
  (granted page, denial, audit, event, summary, decoded cursor) and the
  never-echo discipline of typed errors.
- **events** — the tevt_ id grammar, the frozen vocabulary, the §11 envelope
  guards, the actor union, the factory-minted event ids.
- **summary** — honest counts, permutation determinism, purity, the
  counts-only shape.
- **deps** — zero new runtime dependencies, the workspace links, the lockfile
  lines, the source fences (no `@orbb/db`, no `@orbb/fhir`, type-only
  measurement/testkit imports, runtime imports exactly clinical + domain).

## Recorded handoffs (NOT performed in this packet)

- **db adapters** — Postgres implementations of the three store ports
  (`@orbb/db`), pushing the inclusive window bounds into the query and
  reconstructing canonical same-metric observation sets from the persisted
  supersession graph. The in-memory reference stores are the deterministic
  doubles for tests and the future Lane-C harness.
- **`access_audits` persistence** — appending the `TimelineAccessAudit`
  record (the same three-level append-only discipline the clinical lane
  recorded).
- **outbox/event persistence** — persisting the `TIMELINE_READ` envelope
  (payloads are not modeled; the persistence lane attaches the outbox
  payload).
- **contracts promotion** — `TIMELINE_READ` into the frozen contracts
  `DOMAIN_EVENT_TYPES`; the `tevt_` id rebrands to `evt_`. The names are
  promotion-stable.
- **FHIR composition context** — the timeline feeds FHIR boundary mapping
  later (A46 composition); this package deliberately imports NOTHING from
  `@orbb/fhir` (type-only at most was allowed; zero is safest).
- **A48 `@orbb/worklist`** — sibling lane in flight; NOT depended on. The
  task entries summarize `MeasurementTask` shapes only.
- **self-serve seam** — a person reading their own timeline through a
  person-context surface.
- **kernel promotions** — nothing here wants a kernel change; where a shared
  helper would ideally live in the kernel (the base64url envelope codec, the
  strict page-limit clamp), the timeline-local equivalent is defined
  in-package (`cursor.ts`) and recorded here for promotion review.

## Every recorded assumption (summary)

1. **Domain timestamps per kind:** observations use `effectiveAt`; tasks use
   the CURRENT window's due instant (`window.endsAt` — the moment the
   measurement is due is the task's place on a longitudinal timeline);
   intents use `createdAt`. All are pinned by invariants/tests.
2. **The observation port is canonical-view-shaped** (see above) — the
   timeline consumes reconciliation outputs; the db adapter reconstructs set
   membership from the supersession graph.
3. **Window filtering is on the canonical head's `occurredAt`:** a set whose
   head falls outside the window is outside the window as a whole (the
   superseded originals are provenance inside an entry, never standalone
   entries).
4. **Timeline deny reasons are identity-mapped** from the clinical
   vocabulary (relabeling would hide the A45 semantics); `unknown-scope-
   permission` is unreachable through the timeline (the gate hard-codes the
   frozen `timeline:read`) but still mapped — totality is the point.
5. **The allow-side audit reason is the timeline-local label**
   `timeline-read-granted` (the clinical record says `care-team-access-
   granted`; this surface is the timeline read); deny reasons carry the typed
   clinical label unchanged.
6. **The TIMELINE_READ actor union is `PractitionerId | PersonId`** (the
   kernel `ProvenanceActor` union has no word for practitioners); the person
   arm is the recorded future self-serve seam — nothing constructs it.
7. **Event payloads are not modeled** (mirroring the clinical lane):
   `payloadSchemaVersion` ("1.0.0") versions the payload the persistence lane
   attaches.
8. **Page-size constants mirror `@orbb/db`** (default 50, max 200, strict
   clamping) without importing it.
9. **Unbounded queries are legal** (absent `from`/`to` = the whole timeline,
   newest first) — the clinician overview surface paginates; the B12 UI lane
   owns choosing windows.
10. **`timelineSummary` is a pure derivation over caller-supplied entries** —
    "entries in the window" means the entries the caller assembled for that
    window (a page-walk accumulation); the package offers no whole-window
    aggregation pass of its own.
11. **Task `methodOrder` may be empty** in a port record (the guard requires
    non-empty entries, not a non-empty list) — the scheduler always compiles
    at least one method, but the port stays liberal.
12. **Observation entries include the canonical's `evidenceLabel` and
    `quality`** — typed, bounded, and part of the honest observation
    description (the UI provenance drawer and the FHIR mapper consume both).
