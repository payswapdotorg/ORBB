import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/timeline vitest configuration.
 *
 * The shipped package (src/) imports @orbb/clinical and @orbb/domain at
 * RUNTIME (the REAL care-team evaluator and the kernel guards — the A49
 * layering) and @orbb/measurement + @orbb/testkit TYPE-ONLY (erased at
 * compile time). The TESTS additionally import @orbb/measurement
 * runtime constants (the measurement-lane drift guards) and
 * @orbb/testkit runtime fixtures (DeterministicClock /
 * DeterministicIdFactory / synthetic fixtures) — the same
 * cross-package source-aliasing pattern as @orbb/measurement,
 * @orbb/db, @orbb/databox, @orbb/clinical, and @orbb/fhir, so tests
 * never depend on a prior `build` of a workspace dependency (turbo's
 * `test` task has no `^build` dependency).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/clinical": fileURLToPath(new URL("../clinical/src/index.ts", import.meta.url)),
      "@orbb/measurement": fileURLToPath(new URL("../measurement/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
