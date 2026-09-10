import { defineConfig } from "vitest/config";

/**
 * @orbb/ui vitest configuration.
 *
 * - Token tests run in the default node environment (pure values).
 * - Component tests opt into jsdom via the `// @vitest-environment jsdom`
 *   docblock comment, so no component ever needs a real browser.
 * - `esbuild.jsx: "automatic"` compiles TSX test files without pulling in a
 *   React plugin (keeps the devDependency footprint small).
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
