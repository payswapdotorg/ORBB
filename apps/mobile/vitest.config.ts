import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/mobile vitest configuration.
 *
 * Runs pure-node contract tests only (navigation model, tab labels, token
 * consumption) — no React Native runtime, no emulator. User-mode mobile
 * journeys are owned by Maestro (`maestro/flows/smoke.yaml`). `@orbb/ui`
 * subpath imports resolve to TypeScript source.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@orbb/ui/tokens": fileURLToPath(
        new URL("../../packages/ui/src/tokens.ts", import.meta.url),
      ),
      "@orbb/ui": fileURLToPath(
        new URL("../../packages/ui/src/index.ts", import.meta.url),
      ),
    },
  },
});
