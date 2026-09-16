import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/notifications vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/measurement, @orbb/intents, @orbb/db and
 * @orbb/databox. This package imports @orbb/domain at runtime (id guards),
 * @orbb/measurement at runtime (deterministic id derivation), and
 * @orbb/contracts types at compile time only; @orbb/testkit doubles
 * (DeterministicClock / DeterministicIdFactory) run in tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/contracts": fileURLToPath(new URL("../contracts/src/index.ts", import.meta.url)),
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/measurement": fileURLToPath(new URL("../measurement/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
