import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @orbb/web vitest configuration.
 *
 * Component render tests run in jsdom (web-only; Playwright owns the
 * user-mode journeys). `@orbb/ui` resolves to its TypeScript source so unit
 * tests never require a prior build of workspace dependencies.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@orbb/ui": fileURLToPath(
        new URL("../../packages/ui/src/index.ts", import.meta.url),
      ),
    },
  },
});
