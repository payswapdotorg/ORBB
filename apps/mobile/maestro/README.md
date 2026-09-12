# Maestro — ORBB mobile journeys (M4-B copy, extended by M6-A)

This directory is the Lane-B-owned copy of the Maestro journey flows. It
exists because of two constraints at this base:

1. The canonical `maestro/flows/smoke.yaml` at the repository root arrived
   TRANSIT-MANGLED in the M0-B commit (it contains the README's markdown
   instead of a Maestro flow — verified with
   `git show 5c7045e:maestro/flows/smoke.yaml`). The root `maestro/`
   directory is outside this packet's allowed paths (`apps/web/**`,
   `apps/mobile/**`, `tests/e2e/**`), so the flow could not be repaired
   in place.
2. The M4-B packet had to EXTEND the mobile journey with the capture flow
   (and the M6-A packet with the onboarding + intent flows).

**Handoff to the integration station:** promote these four flows to the
root `maestro/flows/` directory (replacing the mangled `smoke.yaml`),
update `maestro/README.md`'s Files section, and delete this copy. The
flows themselves are final.

## Files

- `flows/smoke.yaml` — the restored M0-B synthetic smoke journey (the
  contract documented in the root README): launch the Expo app, assert
  the five tab labels (`Today | Health | DataBox | Services | You`),
  tap `DataBox`, assert the screen title and the `Coming in M6+`
  placeholder notice.
- `flows/capture.yaml` — the M4-B capture journey: launch, tap
  `Health`, drive the full manual capture flow (metric → manual method →
  systolic/diastolic values → review → quality self-assessment →
  submit), assert the visible confirmation with provenance, and assert
  the record appears in the recent-observations history.
- `flows/onboarding.yaml` — the NEW M6-A onboarding journey: launch, drive
  the first-run flow on the Today tab (welcome → persona → metric
  interests → source registration summary → completion), and assert the
  Today placeholder returns once the journey completes.
- `flows/intent.yaml` — the NEW M6-A intent creation + plan review journey
  (the golden journey #1 head on mobile): complete onboarding when
  visible, tap `Health`, drive the guided composer (metric → direction →
  target → cadence → method preference → review), assert the evidence
  pack coverage summary, then review the candidate plan (explainability
  audit trail, burden summary, safety PASS badge, no-source drop audit)
  and approve with a reviewer note through the domain transition.

## Running locally

1. **Install Maestro** (one-time):

   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```

2. Start the Expo dev server:

   ```bash
   pnpm --filter @orbb/mobile dev
   ```

3. Set the app id for the device target (dev build or Expo Go):

   ```bash
   export MAESTRO_APP_ID=org.orbb.mobile   # dev build (Android)
   # or the Expo Go host package id when driving Expo Go
   ```

4. Run the journeys:

   ```bash
   maestro test apps/mobile/maestro/flows/smoke.yaml
   maestro test apps/mobile/maestro/flows/capture.yaml
   maestro test apps/mobile/maestro/flows/onboarding.yaml
   maestro test apps/mobile/maestro/flows/intent.yaml
   ```

## CI status at M6-A

Maestro is NOT run in CI — there is no emulator in the CI environment
(unchanged since M0-B; see the root `maestro/README.md` and
`.github/workflows/ci.yml`). `apps/mobile` is CI-typechecked
(`tsc --noEmit`) and its pure capture + intent models and offline queue
are unit-tested with vitest (`src/lib/capture/*.test.ts`,
`src/lib/intents/*.test.ts`); the Maestro flows become a gate once a dev
build and device/emulator pool exist.

## Content policy

The flows assert synthetic content only: the five architecture tab
labels, the `Coming in M6+` placeholder notice, the M4-B capture
journey's SYNTH-marked strings (`SYNTH-method-*` ids, the
self-tracking provenance line, the quality-state labels), and the M6-A
intent journey's SYNTH-marked strings (the pack hash fixture, the safety
outcome labels, the draft-plan id slugs). No real medical data, no real
credentials, no network mocks of real APIs.
