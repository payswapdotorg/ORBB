import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/auth vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/databox and @orbb/db.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/observability": fileURLToPath(
        new URL("../observability/src/index.ts", import.meta.url),
      ),
      "@orbb/platform": fileURLToPath(new URL("../platform/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
