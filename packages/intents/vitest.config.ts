import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/intents vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/measurement, @orbb/db and @orbb/databox. This
 * package imports @orbb/domain at runtime (guards) and @orbb/testkit at
 * runtime in tests (DeterministicClock / DeterministicIdFactory). It
 * deliberately does NOT depend on @orbb/measurement: the compiler consumes
 * metric/method read-models through thin local ports that
 * @orbb/measurement's in-memory registries satisfy structurally (engine
 * wiring arrives at integration — handoff recorded in src/index.ts).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
