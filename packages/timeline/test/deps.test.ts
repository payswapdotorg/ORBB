import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A49 fence proofs: ZERO new external runtime dependencies, ZERO db
 * imports, TYPE-ONLY measurement/testkit imports, and the lockfile
 * lines for the @orbb/clinical workspace dependency are committed (the
 * @orbb/clinical deps-test pattern, extended with the src-fence scan).
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

function readSrcFiles(): { name: string; text: string }[] {
  const dir = fileURLToPath(new URL("../src", import.meta.url));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(`${dir}/${name}`, "utf8") }));
}

describe("zero new runtime dependencies", () => {
  it("@orbb/timeline depends on exactly the REAL kernel + clinical workspace packages", () => {
    const manifest = readManifest("../package.json");
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@orbb/clinical",
      "@orbb/domain",
    ]);
  });

  it("every runtime dependency is a workspace link (lockfile-committed)", () => {
    const manifest = readManifest("../package.json");
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      expect(name.startsWith("@orbb/"), `${name} must be a workspace package`).toBe(true);
      expect(spec, `${name} must be a workspace link`).toBe("workspace:*");
    }
  });

  it("the lockfile carries the timeline package entry with the workspace link lines", () => {
    const lockfilePath = fileURLToPath(new URL("../../../pnpm-lock.yaml", import.meta.url));
    const lockfile = readFileSync(lockfilePath, "utf8");
    expect(lockfile).toContain("packages/timeline:");
    const section = lockfile.slice(
      lockfile.indexOf("packages/timeline:"),
      lockfile.indexOf("packages/ui:"),
    );
    expect(section).toContain("'@orbb/clinical':");
    expect(section).toContain("link:../clinical");
    expect(section).toContain("'@orbb/domain':");
    expect(section).toContain("link:../domain");
  });

  it("devDependencies are the shared toolchain plus TYPE-ONLY workspace imports", () => {
    const manifest = readManifest("../package.json");
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual([
      "@eslint/js",
      "@orbb/measurement",
      "@orbb/testkit",
      "@types/node",
      "eslint",
      "typescript",
      "typescript-eslint",
      "vitest",
    ]);
  });
});

describe("the source fence (ZERO db imports; type-only measurement/testkit; no fhir)", () => {
  it("no src file imports @orbb/db", () => {
    for (const file of readSrcFiles()) {
      expect(
        file.text.includes('from "@orbb/db"'),
        `${file.name} must not import @orbb/db`,
      ).toBe(false);
    }
  });

  it("no src file imports @orbb/fhir (the composition-context handoff is recorded, not imported)", () => {
    for (const file of readSrcFiles()) {
      expect(
        file.text.includes('from "@orbb/fhir"'),
        `${file.name} must not import @orbb/fhir`,
      ).toBe(false);
    }
  });

  it("every @orbb/measurement and @orbb/testkit import in src is TYPE-ONLY (erased at compile time)", () => {
    for (const file of readSrcFiles()) {
      for (const line of file.text.split("\n")) {
        if (line.includes('from "@orbb/measurement"') || line.includes('from "@orbb/testkit"')) {
          const head = line.trimStart().slice(0, 80);
          expect(
            line.trimStart().startsWith("import type"),
            `${file.name}: <${head}> must be a type-only import`,
          ).toBe(true);
        }
      }
    }
  });

  it("the RUNTIME imports are exactly the clinical + domain kernel packages (type-only excluded)", () => {
    const runtimeModules = new Set<string>();
    for (const file of readSrcFiles()) {
      for (const line of file.text.split("\n")) {
        if (line.trimStart().startsWith("import type")) {
          continue;
        }
        for (const match of line.matchAll(/from "(@orbb\/[a-z-]+)"/g)) {
          runtimeModules.add(match[1] as string);
        }
      }
    }
    expect([...runtimeModules].sort()).toEqual(["@orbb/clinical", "@orbb/domain"]);
  });

  it("zero external (non-@orbb) package imports anywhere in src", () => {
    for (const file of readSrcFiles()) {
      for (const match of file.text.matchAll(/from "([^."][^"]*)"/g)) {
        const specifier = match[1] as string;
        expect(
          specifier.startsWith("@orbb/"),
          `${file.name}: external import <${specifier}> is forbidden`,
        ).toBe(true);
      }
    }
  });
});
