import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/api vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency)
 * — the same pattern as @orbb/db and @orbb/databox. The full chain is
 * mapped: @orbb/db source imports @orbb/databox and @orbb/contracts,
 * which import @orbb/domain and @orbb/platform.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
      "@orbb/contracts": fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)),
      "@orbb/db": fileURLToPath(new URL("../../packages/db/src/index.ts", import.meta.url)),
      "@orbb/databox": fileURLToPath(new URL("../../packages/databox/src/index.ts", import.meta.url)),
      "@orbb/platform": fileURLToPath(new URL("../../packages/platform/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../../packages/testkit/src/index.ts", import.meta.url)),
    },
  },
  test: {
    testTimeout: 10_000,
  },
});
