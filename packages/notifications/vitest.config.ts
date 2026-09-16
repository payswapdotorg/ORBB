import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/notifications vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/measurement. This package imports
 * @orbb/measurement at runtime (task types, result helpers, deterministic
 * id derivation) and @orbb/domain guards, plus @orbb/testkit doubles
 * (DeterministicClock / DeterministicIdFactory) in tests and the local
 * harness.
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
