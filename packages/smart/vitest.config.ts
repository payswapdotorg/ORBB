import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/smart vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/auth, @orbb/databox, and @orbb/db.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
      // @orbb/testkit's source re-exports fixtures built on @orbb/domain
      // types, so the domain source must be mapped the same way.
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
    },
  },
});
