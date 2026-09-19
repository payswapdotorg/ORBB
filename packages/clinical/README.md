# @orbb/clinical

Clinical organization/clinic/practitioner domain with patient linking and
care-team permissions for ORBB — **M7-A A44 + A45, Lane A
(Domain/API/Data)**. Milestone 7 exit direction (owned across lanes):
*“clinician can request authorized data and reason over a longitudinal
patient timeline.”*

A pure package: injected clock (the evaluation instant is a request
field), zero database imports, zero external runtime dependencies — the
only dependency is the REAL kernel `@orbb/domain` workspace link, whose
lockfile lines this packet commits.

**SAFETY POSTURE (binding, AGENTS.md):** clinical features require
jurisdiction-specific governance before real-world use. Everything in
this package is boundary-shaped, non-authoritative, and SYNTH-fixtured.
Nothing here verifies credentials, licenses, or identity — the
verification vocabulary is SYNTH-only labels, and the permission
evaluator is deny-by-default with **no allow-by-default path anywhere**.

## The entity model (A44)

| Aggregate | State machine (kernel transition-table discipline) |
| --- | --- |
| `Organization` | `active -> suspended -> active \| dissolved`; `active -> dissolved`; `dissolved` terminal |
| `Clinic` | mirrors the organization grammar exactly; tied to its owning organization by `organizationId` |
| `Practitioner` | `unverified -> verified`; `verified \| reverified -> suspended-from-verified`; `suspended-from-verified -> reverified`; no terminal state |
| `PatientLink` (A45) | `requested -> confirmed \| declined`; `confirmed -> revoked`; `declined`/`revoked` terminal |
| `CareTeam` (A45) | `forming -> active \| dissolved`; `active -> dissolved`; `dissolved` terminal |

Membership aggregates (composite identity, no separate id kinds):
`PractitionerOrganizationMembership` and `PractitionerClinicAffiliation`,
each with the frozen role vocabulary `member | admin | owner` and an
`active` flag (kernel `Relationship` snapshot discipline).

Canonical identities are clinical-local branded ids mirroring the frozen
kernel grammar letter-for-letter (`ID_BODY_PATTERN` is imported from the
kernel so the grammars can never drift): `OrganizationId` (`org_`),
`ClinicId` (`clin_`), `PractitionerId` (`pract_`). Cross-kind assignment
is a compile-time error (branded nominal types) and a runtime guard
rejection.

## The verification discipline (A44)

**Verification is an explicit, auditable step, never implied.**

- `newPractitioner` mints practitioners ONLY in `unverified`.
- The only way to reach `verified` or `reverified` is
  `verifyPractitioner(practitioner, verification)`, which records WHO
  verified (`verifiedBy`) and WHAT evidence label was used (`evidence`)
  — both SYNTH-only opaque labels, never documents, never PHI — plus
  `at`, and applies the legal transition.
- An `unverified` practitioner is denied by the evaluator exactly like a
  suspended one (distinct typed reasons `unverified-practitioner` /
  `suspended-practitioner`): fail closed.

Recorded assumptions (SYNTH-only vocabulary): the verifying authority is
an opaque label (e.g. a synthetic credentialing-authority label);
evidence is an opaque category label; a failed verification simply leaves
the practitioner `unverified` (no declined state); permanent debarment
is jurisdictional governance, out of scope.

## Patient linking (A45)

`PatientLink(personId, practitionerId, state, requestedBy)` is
consent-shaped:

- Either side may REQUEST (`requestedBy: person | practitioner`), but
  only the person side — directly (`person`) or through an explicit
  invitation flow proxying the person (`invitation`) — can CONFIRM,
  DECLINE, or REVOKE. The confirmation vocabulary
  (`PATIENT_LINK_CONFIRMATION_SOURCES`) contains no practitioner word,
  and no exported function confirms a link on practitioner authority:
  **a practitioner can request but never self-confirm**, proven by
  construction and by test.
- `declined` and `revoked` are terminal; a revoked link requires a
  fresh, re-consented request.
- **Fail-closed: an unconfirmed link confers NOTHING.** The evaluator
  treats `requested`, `declined`, `revoked`, and mismatched-pair links
  identically: deny `unconfirmed-patient-link`.

## The care team (A45)

`CareTeam(personId, state, entries)` is an ORDERED composition of
`CareTeamEntry { practitionerId, role? }` with the frozen role label
vocabulary `primary-care | origin | consulting`.

**Care-team changes are additive events with audit records — never
silent mutation.** Every change is an explicit `CareTeamChange` value
(a discriminated union: `practitioner-added | practitioner-removed |
role-labeled | care-team-dissolved`, each carrying `personId`, the
practitioner, `at`, and an opaque `actor` label). That value IS the
additive event and the audit record. The only way to evolve a team is
`applyCareTeamChange(team, change)` — a pure fold that never mutates its
inputs, preserves entry order, activates a `forming` team on the first
addition, and throws on every illegal application (dissolved team,
duplicate add, unknown removal/label, cross-person change).

## Care-team permission evaluation (A45)

`evaluateCareTeamAccess(request, snapshot)` is a PURE, deny-by-default
evaluator layered **on top of** the kernel's deny-by-default access
evaluation:

- It imports the REAL kernel `AccessGrant` type and delegates the
  grant-side verdict to the REAL kernel `evaluateAccess` (single grant,
  no policies, no emergency). The kernel's opaque `recipientId` —
  documented there as opaque “until the consent lane models them as
  entities” — is resolved here: a recipient is known iff the grant's
  `recipientId` equals the requesting practitioner's canonical id.
  **The clinical lane is what makes recipients entities.**
- Every failure mode denies with a DISTINCT TYPED reason from the frozen
  `CARE_TEAM_DENY_REASONS` vocabulary — `unknown-recipient`,
  `unconfirmed-patient-link`, `suspended-practitioner`,
  `dissolved-organization`, `expired-grant`, `missing-scope`, plus
  `subject-mismatch`, `revoked-grant`, `purpose-mismatch`,
  `unverified-practitioner`, `suspended-organization`,
  `dissolved-clinic`, `suspended-clinic`, `inactive-membership`,
  `inactive-affiliation`, `inactive-care-team`, `not-on-care-team`,
  `unknown-scope-permission`.
- Evaluation order is recorded semantics (vocabulary → recipient →
  subject → kernel grant verdict → link → team → practitioner →
  organization → membership → clinic → affiliation); the first failure
  wins deterministically.
- The evaluation instant is `request.at` — the calling layer owns the
  clock (injected at the boundary; tests drive a deterministic clock
  fixture, never wall-clock). Expiry follows the kernel rule: a grant is
  valid strictly BEFORE its expiry instant.
- Malformed inputs throw `DomainInvariantError` (data-integrity
  failures — kernel discipline); malformed authorization always denies.
- Every decision — ALLOW and DENY alike — carries a
  `ClinicalAccessAuditRecord` (who/what/when/decision/reason) shaped for
  the append-only `access_audits` table.

The scope vocabulary extends the kernel grant-scope pattern with frozen
READ-ONLY permissions: `observations:read`, `timeline:read`,
`intent:read`. There is no word for a write scope, so the evaluator
cannot express one — requests for write scopes deny as
`unknown-scope-permission`. RECORDED ASSUMPTION: write-scope vocabulary
arrives with the M7-B workflow items under explicit tech-lead review.

## Audit + events discipline

- **Audit records** (`audit.ts`): the `ClinicalAccessAuditRecord` shape
  (who/what/when/decision/reason). DB-INTEGRATION HANDOFF (recorded,
  out of this packet's fence): the persistence lane maps it onto
  `access_audits` — `actor`→actor, `subjectId`→subject_id,
  `decision`→decision (the check-constraint vocabulary), `at`→at;
  `permission`/`reason` ride in `requestDigest` (kernel
  `digestAccessRequest` precedent) or a promotion migration adds
  explicit columns; `id`/`decisionId` are persistence-assigned.
- **Clinical events** (`events.ts`): `CLINICAL_EVENT_TYPES` (16 frozen
  types, one per legal state change plus `CARE_TEAM_CHANGED` and
  `CARE_TEAM_ACCESS_EVALUATED`) and the `ClinicalEventEnvelope` — the
  architecture §11 field list exactly, importing the REAL kernel
  `ProvenanceActor`/`PersonId` types. CONTRACTS-PROMOTION HANDOFF
  (recorded): promoting the vocabulary into
  `packages/contracts/src/eventTypes.ts` `DOMAIN_EVENT_TYPES` reduces the
  envelope to a re-export of `DomainEventEnvelope`; the clinical event id
  (`cevt_`) rebrands to the contracts `evt_`. Names are
  promotion-stable.

## Recorded kernel-promotion handoffs (the M6-A catalog-mirror pattern)

1. **Id kinds**: `organization`/`clinic`/`practitioner` should move into
   the kernel `CanonicalIdTypes` + `ID_PREFIXES` (`packages/domain/src/
   ids.ts`); this package then reduces `ids.ts` to a re-export. The
   prefixes (`org`, `clin`, `pract`) collide with no kernel prefix, so
   promotion rebrands nothing.
2. **Event types**: see the contracts handoff above.
3. **Transition-table engine**: `stateMachine.ts` is the clinical-local
   mirror of the kernel's internal engine (the kernel's stays
   non-exported); promotion may unify them behind the kernel barrel.
4. **Relationship entities**: the kernel `Relationship` type can
   eventually be satisfied by `PatientLink`/care-team membership
   snapshots; until then the evaluator keeps its own typed inputs.

## Every recorded assumption (summary)

- SYNTH-only, non-authoritative: organization/clinic/practitioner
  display names are labels; verification authority + evidence are opaque
  SYNTH labels; no jurisdictional registries exist here.
- Clinic state machine mirrors the organization grammar but is NOT
  coupled to the organization's state — the evaluator checks both
  independently.
- No `created`/`pending` state for organizations/clinics (born `active`);
  registration workflows are M7-B.
- Practitioner: `unverified` only moves to `verified`; suspension only
  from `verified`/`reverified`; no terminal state (debarment is
  jurisdictional). Same role ladder (`member|admin|owner`) for
  organization membership and clinic affiliation; finer-grained clinical
  roles are M7-B. Membership `active` flags are snapshot concerns.
- PatientLink: composite identity (person, practitioner); `invitation`
  proxies the person only (token authenticity is the boundary lane's
  job — recorded handoff); only person-side sources act after the
  request; no link expiry (consent-lane refinement); practitioner
  departure is a care-team change, never link revocation.
- CareTeam: `forming` = created, no composition yet (activates on first
  add); roles are optional labels; the fold does not require a confirmed
  link at composition time (the evaluator enforces it at decision
  time); removing the last practitioner leaves the team `active`.
- Evaluator: pure with `request.at` as the injected evaluation instant;
  recipient resolution = exact `grant.recipientId === practitionerId`
  match (richer recipient directories are a consent-lane promotion);
  organization + membership are REQUIRED snapshot inputs;
  clinic + affiliation optional but, when present, must be healthy;
  no emergency/break-glass path at this layer (a clinical-layer bypass
  would be an allow-by-default path); purpose-of-use is matched by the
  kernel delegation.
- Write-scope vocabulary arrives with M7-B; the frozen read-only scope
  set is exactly the three permissions named in the work order.

## Tests (definition of done)

`src/*.test.ts` — table-driven legal-transition matrices for all five
aggregates (illegal transitions throw; terminal states have no
successors), exhaustive deny-by-default proofs (every typed reason
reachable, one cause each, plus failure-mode variants and
order-pinning), allow paths only when ALL conditions hold, expired-grant
denial via an injected clock fixture (deny at the expiry instant, allow
one millisecond before), id-grammar proofs including compile-level
cross-kind rejection (`@ts-expect-error`) and runtime guard rejection,
frozen-vocabulary proofs (never-self-confirm, read-only scopes), audit
and envelope structural guards, and the zero-external-dependency fence
proof against the manifest.
