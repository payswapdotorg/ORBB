import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/platform vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/measurement, @orbb/db, and @orbb/databox.
 * Since the M4-C health seam, this package imports @orbb/domain and
 * @orbb/observability at runtime, and the tests use @orbb/testkit
 * (DeterministicClock / DeterministicIdFactory).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/observability": fileURLToPath(
        new URL("../observability/src/index.ts", import.meta.url),
      ),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
