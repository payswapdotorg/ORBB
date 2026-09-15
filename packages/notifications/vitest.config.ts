import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/notifications vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/measurement, @orbb/intents, @orbb/db and
 * @orbb/databox. This package imports @orbb/domain at runtime (canonical
 * id guards) and @orbb/testkit at runtime in tests (DeterministicClock /
 * DeterministicIdFactory). @orbb/measurement is imported TYPES-ONLY (the
 * real MeasurementTask/MeasurementWindow snapshot shapes) — its alias is
 * registered for uniformity and future integration wiring; type-only
 * imports are erased, so no measurement code executes in these tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
      "@orbb/measurement": fileURLToPath(
        new URL("../measurement/src/index.ts", import.meta.url),
      ),
    },
  },
});
