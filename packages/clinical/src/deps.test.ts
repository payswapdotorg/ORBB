import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A44/A45 fence proof: ZERO new (external) runtime dependencies.
 *
 * The work order's delivery contract: `@orbb/clinical` adds no external
 * runtime dependencies — the ONLY dependency is the REAL kernel
 * `@orbb/domain` workspace link (whose lockfile lines this packet
 * commits). This is asserted against the manifest itself so a smuggled
 * dependency cannot land unnoticed (the @orbb/adherence deps-test
 * pattern).
 */
function readManifest(relative: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

describe("zero new runtime dependencies", () => {
  it("@orbb/clinical depends on exactly the kernel workspace package", () => {
    const manifest = readManifest("../package.json");
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["@orbb/domain"]);
  });

  it("the kernel dependency is a workspace link (lockfile-committed)", () => {
    const manifest = readManifest("../package.json");
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      expect(name.startsWith("@orbb/"), `${name} must be a workspace package`).toBe(true);
      expect(spec, `${name} must be a workspace link`).toBe("workspace:*");
    }
  });

  it("devDependencies are the shared toolchain only (no runtime smuggles)", () => {
    const manifest = readManifest("../package.json");
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual([
      "@eslint/js",
      "eslint",
      "typescript",
      "typescript-eslint",
      "vitest",
    ]);
  });
});
