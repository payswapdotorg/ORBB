import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * B10 fence proof: ZERO new runtime dependencies.
 *
 * The work order's delivery contract: `@orbb/adherence` adds no external
 * runtime dependencies, and the platform seam adds none either. This is
 * asserted against the manifests themselves so a smuggled dependency
 * cannot land unnoticed.
 */

function readManifest(relative: string): { dependencies?: Record<string, string> } {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as { dependencies?: Record<string, string> };
}

describe("zero new runtime dependencies", () => {
  it("@orbb/adherence depends only on @orbb workspace packages", () => {
    const manifest = readManifest("../package.json");
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([
      "@orbb/domain",
      "@orbb/measurement",
    ]);
  });

  it("@orbb/adherence pulls no third-party packages transitively at the manifest level", () => {
    const manifest = readManifest("../package.json");
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      expect(name.startsWith("@orbb/"), `${name} must be a workspace package`).toBe(true);
      expect(spec, `${name} must be a workspace link`).toBe("workspace:*");
    }
  });

  it("the platform seam left the platform manifest untouched (domain + observability only)", () => {
    const manifest = readManifest("../../platform/package.json");
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@orbb/domain",
      "@orbb/observability",
    ]);
  });
});
