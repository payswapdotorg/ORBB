# Maestro — ORBB mobile journeys (M4-B copy)

This directory is the Lane-B-owned copy of the Maestro journey flows. It
exists because of two constraints at this base:

1. The canonical `maestro/flows/smoke.yaml` at the repository root arrived
   TRANSIT-MANGLED in the M0-B commit (it contains the README's markdown
   instead of a Maestro flow — verified with
   `git show 5c7045e:maestro/flows/smoke.yaml`). The root `maestro/`
   directory is outside this packet's allowed paths (`apps/web/**`,
   `apps/mobile/**`, `tests/e2e/**`), so the flow could not be repaired
   in place.
2. This packet must EXTEND the mobile journey with the M4-B capture flow.

**Handoff to the integration station:** promote these two flows to the
root `maestro/flows/` directory (replacing the mangled `smoke.yaml`),
update `maestro/README.md`'s Files section, and delete this copy. The
flows themselves are final.

## Files

- `flows/smoke.yaml` — the restored M0-B synthetic smoke journey (the
  contract documented in the root README): launch the Expo app, assert
  the five tab labels (`Today | Health | DataBox | Services | You`),
  tap `DataBox`, assert the screen title and the `Coming in M6+`
  placeholder notice.
- `flows/capture.yaml` — the NEW M4-B capture journey: launch, tap
  `Health`, drive the full manual capture flow (metric → manual method →
  systolic/diastolic values → review → quality self-assessment →
  submit), assert the visible confirmation with provenance, and assert
  the record appears in the recent-observations history.

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
   ```

## CI status at M4-B

Maestro is NOT run in CI — there is no emulator in the CI environment
(unchanged since M0-B; see the root `maestro/README.md` and
`.github/workflows/ci.yml`). `apps/mobile` is CI-typechecked
(`tsc --noEmit`) and its pure capture model + offline queue are
unit-tested with vitest (`src/lib/capture/*.test.ts`); the Maestro flows
become a gate once a dev build and device/emulator pool exist.

## Content policy

The flows assert synthetic content only: the five architecture tab
labels, the `Coming in M6+` placeholder notice, and the M4-B capture
journey's SYNTH-marked strings (`SYNTH-method-*` ids, the
self-tracking provenance line, the quality-state labels). No real
medical data, no real credentials, no network mocks of real APIs.
