# UI/UX Architecture

## Product surfaces

ORBB is one system with role-specific experiences, not separate products with duplicate data models.

`Person` gets: Home, Intent, Today's plan, Measurements, DataBox, Insights, Sharing, Services, Marketplace, Settings.

`Clinician` gets: Worklist, Patients, Patient timeline, Measurement plans, Tasks/orders, Alerts, Care programs, Shared data, Team.

`CHW` gets: Assigned visits, Route/tasks, Measurement capture, Quality checklist, Compensation, Offline queue.

`Researcher` gets: Studies, Cohorts, Protocols, Recruitment, Data requests, Study dashboard, Exports/queries.

`Developer` gets: Developer console, Extension manifest, Sandbox test data, Capability permissions, Runs, Validation, Marketplace listing, Revenue.

`Clinic/Admin` gets: Staff, rooms/equipment, scheduling, programs, inventory, service orders, billing.

## Navigation model

Mobile uses a five-destination shell:
`Today | Health | DataBox | Services | You`

The Today surface is intent-driven, not dashboard-driven. It answers:
1. What am I trying to accomplish?
2. What matters today?
3. What measurement is due?
4. Why is it due?
5. What is the easiest valid way to complete it?

Web uses:
`Overview | Intents | Measurements | DataBox | Care | Research | Marketplace | Settings` with role-dependent additions.

## First-run experience

Do not begin by asking for dozens of health fields or permissions.

Flow:
`Welcome → choose intent → explain measurement philosophy → choose available devices/resources → choose acceptable effort → proposed plan → review/edit → permission setup → first measurement → explain provenance → home`.

Permission prompts occur immediately before the capability that needs them. HealthKit explicitly recommends context-specific, fine-grained permissions rather than requesting everything at launch. citeturn647822search2turn647822search4

## Intent UX

The user chooses an outcome in natural language or guided categories. The UI immediately distinguishes:
- what can be measured now;
- what may need a device/service;
- what is experimental;
- what requires a clinician.

Never present a model's conjecture as a diagnosis.

## Measurement task UX

Every task is a card with:
`metric | due window | reason | acceptable methods | estimated effort | privacy impact | fallback`.

Example:
`Blood pressure — due by 09:00 — supports your monitoring plan — 2 methods available — ~3 min — private — clinic/CHW fallback`.

When multiple sources exist, show the least-burden valid option first, not the most technologically impressive one.

## Provenance UX

Every observation has a user-readable provenance drawer:
`Captured by → Method → Device/Person → Time → Quality → Validation → Transformations → Original evidence`.

The product must teach users that “measured” and “estimated from an image” are different states.

## DataBox UX

Use a timeline plus collections. Default presentation is human-readable; advanced users can inspect raw evidence, metadata, provenance, model versions and exports.

The UI supports:
- search;
- time filtering;
- concept filtering;
- source filtering;
- confidence/quality filtering;
- export;
- share;
- revoke access;
- view access history.

## Sharing UX

Sharing is a reviewable contract, not a one-click “share data” toggle.

Present:
`Recipient → Purpose → Exact data → Time window → Derived data allowed? → Re-sharing? → Expiry → Compensation → Revoke`.

Support “answer only” requests such as:
`Does this person have at least 90 days of qualifying observations?` without exposing the underlying records when the protocol allows it.

## Clinician UX

Prioritize longitudinal reasoning, not giant dashboards.

Patient overview:
`reason for attention → active intents → recent changes → measurement coverage → clinically relevant observations → unresolved tasks → shared evidence → alerts`.

The clinician should be able to generate a measurement plan, assign services, request data, annotate an observation, and create a care task without leaving the patient context.

## Research UX

A researcher defines the protocol and the system shows the operational consequences:
`target population → required observations → measurement burden → reachable participants → equipment gaps → CHW capacity → expected completeness → compensation budget`.

## Accessibility

WCAG 2.2 AA for web. Native platform accessibility APIs for mobile. No health status communicated by color alone. Large touch targets. Screen-reader labels for measurement tasks, graphs, consent controls, and alerts.

## Design system

Use a token-based package in `packages/ui`: typography, spacing, semantic colors, elevation, motion, forms, charts, disclosure panels, cards, tables, timeline, consent sheets, measurement capture controls.

Keep clinical states visually conservative. Avoid gamifying risk, abnormality, disease, or adherence.

## Dogfooding requirements

Every feature must have at least one complete user journey beginning at a rendered screen and ending at a rendered result. API-only tests are insufficient.

Web journey testing: Playwright across Chromium, WebKit, and Firefox. Playwright officially supports all three plus emulated devices. citeturn338507search1turn338507search9

Mobile journey testing: Maestro against the final Android/iOS binaries. Maestro supports React Native and Expo/EAS and operates at the accessibility layer without application instrumentation. citeturn338507search5

## Golden user journeys

1. Create an intent → receive measurement plan → complete measurement → see provenance → see progress.
2. Import device observation → reconcile duplicate sources → inspect provenance.
3. Capture a thermometer photo → obtain an `ESTIMATED` value → compare against known ground truth → see uncertainty.
4. Create a scoped data share → recipient accesses authorized subset → user sees audit log → revoke access.
5. Clinic requests data → user consents → clinician opens patient timeline.
6. Researcher defines study → participant qualifies → study task is issued → measurement is captured → compensation is recorded.
7. User misses task → reminder → fallback provider offered → authorized restriction applied only if configured.
8. Install extension → review permissions → grant only requested capability → extension operates in sandbox.
