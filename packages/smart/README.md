# @orbb/smart

SMART-on-FHIR launch boundary for ORBB — **M7-A A47, Lane C
(Platform/Seams/CI)**. This is the EHR→app launch seam: an external
clinical system launches ORBB with narrowly scoped authorization.

Doctrine (docs/BACKEND_ARCHITECTURE.md §10, binding):

> *"SMART on FHIR launches must use narrowly scoped OAuth authorization."*

This package ships **boundary logic, not an OAuth server**. It is pure,
fail-closed, and network-free: zero network calls, zero external runtime
dependencies (`node:crypto` + the `@orbb/testkit` `Clock`/`IdFactory`
seams only). Real EHR integration is a **recorded handoff** (below), and
clinical integrations require jurisdiction-specific governance before
real-world use (AGENTS.md operating rule) — this package is
boundary-shaped with SYNTH doubles only.

## Launch flow (what the boundary does)

```text
EHR (external clinical system)
  |
  | 1. redirect: { iss, launch [, aud ] }
  v
+------------------------------------------------------------------+
| @orbb/smart launch boundary                                       |
|                                                                   |
| 2. parseSmartLaunchContext(raw, { audience })                    |
|    - TOTAL parsing: typed LaunchValidationError, never a crash,    |
|      never a best-effort partial context                          |
|    - iss: https + host (+ SYNTH namespace recorded)              |
|    - launch: present, opaque, well-formed handle                  |
|    - aud (when present): must equal OUR registered client id     |
|    - unknown parameters: ignored, NAMES recorded (values never)   |
|    - every outcome carries a SmartLaunchAuditRecord               |
|                                                                   |
| 3. SmartTokenExchange.exchange({ context, client, scopes })      |
|    - issuer registered? audience ours? client authenticated?      |
|    - launch handle single-use + TTL                               |
|    - granted scopes = requested ∩ registration ∩ handle ceiling   |
|    - opaque token (>= 128 bits), SHA-256 hashed at rest           |
|    - every outcome carries a SmartLaunchAuditRecord              |
|                                                                   |
| 4. evaluateSmartScope(grantedScope, { resourceType, access })     |
|    - deny-by-default Allow | Deny(reason)                        |
|    + effectiveLaunchAccess(launchScopes, standingAccess)          |
|      - intersection with the person's existing grants            |
+------------------------------------------------------------------+
  |
  v
API layer (composition, NOT this package):
  - kernel access evaluation (@orbb/domain evaluateAccess) must ALSO
    allow: a launch alone grants NOTHING
  - PatientLink (M7-A A45) maps the EHR patient id to an ORBB person
  - audit records appended to the access_audits table (@orbb/db)
```

Steps 2–3 are the seam; step 4 and the composition contract are how the
boundary guarantees it never widens (see below).

## The scope grammar (FROZEN)

```text
scope      := context "/" resourceType "." modifier
context     = "patient"                     (the ONLY context)
resourceType in { Patient, Observation, Condition, DocumentReference }
modifier    = "rs"                          (read + search)
```

- **Context prefix `patient/` only.** `user/`, `system/`, `*/`, or any
  other prefix is REJECTED (typed `SCOPE_UNKNOWN_CONTEXT`; a missing
  separator is `SCOPE_MISSING_CONTEXT`). Patient-compartment reads are
  the entire M7 exit surface; broader contexts are doctrine violations.
- **Modifier `rs` = read + search.** The read-shaped SMART v2 compound
  modifier. Write-shaped letters (`c`, `u`, `d`, `s`, or any combination
  containing them) are REJECTED (`SCOPE_UNKNOWN_MODIFIER`): this
  boundary cannot express a write, so nothing downstream can request
  one through it. (M7 exit direction: "clinician can request authorized
  data and reason over a longitudinal patient timeline".)
- **Resource types are an allow-list**: `Patient`, `Observation`,
  `Condition`, `DocumentReference` — exactly the M7-A A46 FHIR mapper
  surface. Unknown types (including `*` and case variants) are REJECTED
  (`SCOPE_UNKNOWN_RESOURCE`).
- **Exact-match grammar, no regex permissiveness**: tokens are split on
  their structural separators and compared for equality against the
  frozen vocabularies. Any deviation lands in exactly one typed class
  (`SCOPE_MALFORMED` for structural surprises).
- **Scope sets are space-delimited strings** (the SMART wire format).
  The **empty set is VALID and grants nothing** — not an error. One
  invalid token rejects the whole set (fail-closed, no partial grants);
  the rejection carries the failing token's INDEX, never its raw text.
- **Mapping**: `rs` covers both `read` and `search`
  (`smartScopeActions`), the only place modifier letters gain meaning.

## The narrowing doctrine (binding invariants)

1. **The boundary NEVER widens.** A launch grants at most the scopes
   explicitly granted by the exchange result: `requested ∩ registration
   ceiling ∩ (handle ceiling, when narrower)`. `scopeNarrowed` reports
   when the granted set is strictly smaller than requested. A
   registration whose ceiling violates the grammar fails double
   construction outright (`SmartInvariantError`).
2. **A launch ALONE grants NOTHING.** `effectiveLaunchAccess(launchScopes,
   standingAccess)` intersects the launch's granted actions with the
   person's existing grants (translated into SMART grammar by the
   composition layer): empty standing access ⇒ empty effective set,
   always, and the result is provably a subset of both inputs.
3. **Composition, not duplication.** Serving data requires BOTH
   `evaluateSmartScope(...)` over the launch's granted set to ALLOW AND
   the kernel access evaluation (`@orbb/domain evaluateAccess`) over the
   person's consent grants to ALLOW. This package deliberately does not
   re-implement consent/purpose/relationship/policy evaluation — the
   kernel is the authority.
4. **Deny-by-default everywhere.** Unknown resource types deny, unknown
   access actions deny, empty grants deny (`NO_GRANTS`), and corrupted
   granted-scope strings (external EHR data) deny with
   `GRANTED_SCOPE_MALFORMED` — a typed denial, never a thrown crash.

## Token discipline (mirrored from @orbb/auth, never weakened)

- Tokens are **opaque**: 32 random bytes, base64url. **Never a JWT** —
  no embedded claims, so no PHI can ride inside a token.
- **Hashed at rest**: only the lowercase-hex SHA-256 digest is stored by
  the doubles; the token is returned exactly once.
- **Verification is typed and deny-by-default**: `INVALID_TOKEN` |
  `EXPIRED` | `REVOKED`; expiry is exclusive (`now >= expiresAt`).
- **Client-secret comparisons are timing-safe** over the SHA-256
  digests (`timingSafeEqual`); secrets are stored as digests only.
- Launch handles are **single-use with a TTL** (default 5 minutes),
  marked consumed before the token is minted so a replay can never win.
  Access-token TTL default: 1 hour.

## No-PHI discipline

Identifiers only — never demographics — on every outbound surface:
audit records carry the issuer HOST (never a full URL, never
credentials, never query strings), typed reason codes, and timestamps;
unknown launch parameters are recorded as NAMES with values dropped;
rejection messages describe shapes and never echo raw input; token
records carry the opaque EHR patient identifier only. All of this is
proven by `not.toContain` tests over tokens, token records, audit
records, error messages, and at-rest store dumps
(`src/zero-phi.test.ts`), following the @orbb/observability pattern.

## The seam and its doubles

`SmartTokenExchange` is the interface: `exchange` / `verify` / `revoke`.
Both implementations in this package are SYNTH DOUBLES:

- **`InMemoryTokenExchange`** (tests) — registrations + `issueLaunchHandle`
  (the EHR-side stand-in for starting a launch; production code never
  mints handles) + the full lifecycle with single-use TTL handles,
  client auth, scope narrowing, and hashed-at-rest opaque tokens.
- **`SynthEhrExchange`** — the documented provider contract (see below)
  with a deterministic, network-free implementation: client
  registrations, keysets, `client_secret` and `private_key_jwt`
  (SHAPE-verified) client authentication, and the same fail-closed
  order as the in-memory double. `simulate.exchangeUnavailable` injects
  the fail-closed `EXCHANGE_UNAVAILABLE` denial.

### Real-integration handoff (recorded — NOT shipped)

A future adapter package owns all of this; `SynthEhrExchange`'s types
are the contract:

- **Client registration** (`SmartEhrClientRegistration`): client id,
  https redirect URI, exactly one client-authentication shape
  (`client_secret` or `private_key_jwt` + keyset), the allowed scope
  ceiling, issuer base URL. Registration is an administrative act;
  dynamic client registration is deliberately not modeled (it widens
  the boundary).
- **Keysets** (`SmartEhrKeyset`): `client_authentication` keysets
  (ORBB's registered public keys) and `ehr_signing` keysets (the EHR's
  published JWKS). A real adapter must fetch the EHR's
  `.well-known/smart-configuration`, verify TLS, fetch and pin the JWKS,
  and verify signatures cryptographically. **This package does none of
  that** — the SYNTH double checks the assertion's SHAPE only
  (`synthkeyset.<keysetId>.<opaque>`).
- **The handshake endpoints** (documented, never called here): the
  authorization endpoint (browser redirect: `response_type=code`,
  `client_id`, `redirect_uri`, `aud=iss`, `launch`, `scope`) and the
  token endpoint (POST: authorization code + client authentication →
  access token + granted `scope` + `patient` context). PKCE for public
  clients, state/nonce CSRF binding.
- **Governance**: jurisdiction-specific review before any real-world
  clinical use.

## Audit shape and the db handoff

`SmartLaunchAuditRecord` (`{ id, stage, decision, reason, issHost, at }`)
is produced for every validation/exchange/verification outcome, allows
and denials alike, stamped through the injected `Clock`/`IdFactory`
seams. It is designed for the @orbb/db `access_audits` table
(append-only; migration 0001 rejects UPDATE/DELETE/TRUNCATE): the
composition layer derives `subjectId` via PatientLink (A45), derives the
`actor`, and appends through the audit repository.

## Recorded assumptions

1. **SYNTH namespace**: hosts `synth.test` and `*.synth.test` (reserved
   `.test` TLD, RFC 6761) are structurally valid issuers, recorded as
   `synth: true`. Structural validation accepts any https host;
   *trusting* an issuer is the exchange layer's job (registration).
2. **`iss` normalization**: scheme + host + port + path, one trailing `/`
   stripped (a root path normalizes to the bare origin, so `https://h`
   and `https://h/` compare equal); query strings and fragments are
   REJECTED (`ISS_QUERY_OR_FRAGMENT`), not stripped — a FHIR base URL
   identity never includes them, and URLs are not a PHI channel here
   (architecture §6). Embedded credentials in `iss` are rejected
   (`ISS_CREDENTIALS_EMBEDDED`). `ISS_NO_HOST` is kept as
   defense-in-depth for future runtimes but is structurally unreachable
   on Node: the WHATWG URL parser always yields a non-empty host for
   https URLs (or throws → `ISS_MALFORMED`), and `https:///x`
   collapses to the valid host `x`.
3. **Handle grammar**: opaque, ≤ 2048 characters, no control characters,
   no whitespace. (SMART does not constrain the handle; these bounds
   bound abuse.)
4. **Audience**: `audience` (our client id) is OUR configuration — a
   malformed one is a programmer error (`SmartInvariantError`), never a
   typed denial; external input always gets typed rejections. An
   EHR-supplied `aud` hint must match it exactly, else
   `AUDIENCE_MISMATCH`.
5. **Corrupted granted scopes** (external EHR data) deny with
   `GRANTED_SCOPE_MALFORMED` rather than throwing — external data gets
   typed denials; internal contract violations throw.
6. **TTLs**: launch handles 5 minutes, access tokens 1 hour by default;
   both configurable per registration. Expiry is exclusive.
7. **Single-use redemption** is marked before token minting (replay-safe
   in single-threaded JS); real adapters must make handle redemption
   atomically server-side.
8. **`issueLaunchHandle` / `beginLaunch` are SYNTH-only** — production
   ORBB never mints launch handles; real EHRs issue their own.
9. **Audit ids** are minted with the `smartaud` prefix via the IdFactory
   seam; the persistence lane may re-key them to the `audit_` grammar on
   write.
10. **The token record's `patient`** is the EHR-side opaque patient
    identifier (a record locator, not demographics); mapping it to an
    ORBB person is the M7-A A45 PatientLink concern, outside this
    package.

## Package facts

- TypeScript, strict, ESM. `main: dist/index.js`, `types: src/index.ts`.
- Scripts: `lint` (eslint), `typecheck` (tsc --noEmit), `test`
  (vitest run), `build` (tsc).
- Dependencies: `@orbb/testkit` (the `Clock`/`IdFactory` seams).
  Dev: eslint/typescript/typescript-eslint/vitest/@types/node. No other
  runtime imports anywhere in `src/` — `node:crypto` and these seams only.
