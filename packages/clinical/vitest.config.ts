import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/clinical vitest configuration.
 *
 * Cross-package imports of @orbb/* source are mapped directly to their
 * TypeScript sources so that tests never depend on a prior `build` of a
 * workspace dependency (turbo's `test` task has no `^build` dependency) —
 * the same pattern as @orbb/adherence, @orbb/measurement, and
 * @orbb/platform.
 *
 * This package imports @orbb/domain at runtime (the REAL kernel
 * AccessGrant / access evaluation / id grammar / provenance actor types —
 * the A45 evaluator is layered on top of the kernel's deny-by-default
 * access evaluation, not a reimplementation of it).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@orbb/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
    },
  },
});
