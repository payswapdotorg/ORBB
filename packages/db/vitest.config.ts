import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/db vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/databox.
 *
 * The PGlite harness (real in-process Postgres, WASM) is slower to boot
 * than a pure unit suite, so the per-test timeout is raised generously.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@orbb/contracts": fileURLToPath(new URL("../contracts/src/index.ts", import.meta.url)),
      "@orbb/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One PGlite instance (WASM Postgres) per test file is memory-heavy;
    // serialize files so at most one is booted at a time.
    fileParallelism: false,
  },
});
