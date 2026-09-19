import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/fhir vitest configuration.
 *
 * The shipped package (src/) imports ONLY TYPES from @orbb/domain and
 * @orbb/measurement (type-only imports are erased at compile time), so
 * the built dist has zero workspace runtime dependencies. The TESTS,
 * however, import @orbb/domain runtime constants (the frozen-vocabulary
 * drift guards), @orbb/measurement runtime constants (the measurement-
 * lane drift guards), and @orbb/testkit fixtures (the synthetic-fixture
 * interop proofs) — the same cross-package source-aliasing pattern as
 * @orbb/measurement, @orbb/db, and @orbb/databox, so tests never depend
 * on a prior `build` of a workspace dependency (turbo's `test` task has
 * no `^build` dependency).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/measurement": fileURLToPath(new URL("../measurement/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
