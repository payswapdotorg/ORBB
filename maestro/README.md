# Maestro — ORBB mobile journeys

Maestro drives the ORBB mobile shell at the accessibility layer (no app
instrumentation). This directory holds the M0-B smoke journey that the tech
lead will extend as real surfaces land.

## Files

- `flows/smoke.yaml` — the M0-B synthetic smoke journey: launch the Expo app,
  assert the five tab labels (`Today | Health | DataBox | Services | You`),
  tap `DataBox`, assert the screen title and the `Coming in M6+` placeholder
  notice.

## Running locally

1. **Install Maestro** (one-time):

   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```

2. Start the Expo dev server:

   ```bash
   pnpm --filter @orbb/mobile dev
   ```

3. Run the smoke journey:

   ```bash
   maestro test maestro/flows/smoke.yaml
   ```

## CI status at M0

Maestro is NOT run in CI at M0 — there is no emulator in the CI
environment. apps/mobile is CI-typechecked (tsc --noEmit) and its
navigation contract is unit-tested with vitest
(apps/mobile/src/navigation/tabs.test.ts); the Maestro flow becomes a gate
once a dev build and device/emulator pool exist.

## Content policy

The flow asserts synthetic content only: the five architecture tab labels
and the Coming in M6+ placeholder notice. No real medical data, no real
credentials, no network mocks of real APIs.
