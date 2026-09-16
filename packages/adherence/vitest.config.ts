import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/adherence vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/measurement and @orbb/platform.
 *
 * This package imports @orbb/domain and @orbb/measurement at runtime;
 * its tests additionally exercise the platform adherence seams
 * (detection + invocation over synthetic native doubles) and the
 * observability logger those seams use.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/measurement": fileURLToPath(new URL("../measurement/src/index.ts", import.meta.url)),
      "@orbb/platform": fileURLToPath(new URL("../platform/src/index.ts", import.meta.url)),
      "@orbb/observability": fileURLToPath(
        new URL("../observability/src/index.ts", import.meta.url),
      ),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
