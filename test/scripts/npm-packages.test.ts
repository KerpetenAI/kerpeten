import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Targets } from "../../scripts/build/Targets.ts";
import {
  mainManifest,
  platformManifest,
  platformPackage,
  readMeta,
  tarballName,
  writePackages,
} from "../../scripts/npm/npm-utils.ts";
import type { PackageMeta } from "../../scripts/npm/types/npm.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const meta: PackageMeta = { version: "1.2.3", description: "A CLI.", license: "MIT", author: "Someone" };

function project(manifest: Record<string, unknown> = { ...meta, private: true }): string {
  const dir = mkdtempSync(join(tmpdir(), "kerpeten-npm-"));

  dirs.push(dir);
  mkdirSync(join(dir, "npm"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "README.md"), "# readme\n");
  writeFileSync(join(dir, "LICENSE"), "license\n");
  writeFileSync(join(dir, "npm", "kerpeten.cjs"), "#!/usr/bin/env node\n");

  return dir;
}

function executable(path: string): boolean {
  return (statSync(path).mode & 0o111) === 0o111;
}

describe("npm packages", () => {
  test("the main package pins every platform package to its own version and has the launcher as its command", () => {
    const manifest = mainManifest(meta);

    expect(manifest).toMatchObject({
      name: "kerpeten",
      version: "1.2.3",
      description: "A CLI.",
      license: "MIT",
      bin: { kerpeten: "bin/kerpeten.cjs" },
      files: ["bin"],
      optionalDependencies: {
        "@kerpetensh/kerpeten-linux-x64": "1.2.3",
        "@kerpetensh/kerpeten-linux-arm64": "1.2.3",
        "@kerpetensh/kerpeten-darwin-arm64": "1.2.3",
      },
    });

    expect(Object.keys(manifest.optionalDependencies as object)).toEqual(Targets.ALL.map(platformPackage));
    expect(manifest).not.toHaveProperty("private");
    expect(manifest).not.toHaveProperty("dependencies");
  });

  test("a platform package names its os, cpu and libc and is public", () => {
    expect(platformManifest("linux-arm64", meta)).toMatchObject({
      name: "@kerpetensh/kerpeten-linux-arm64",
      version: "1.2.3",
      os: ["linux"],
      cpu: ["arm64"],
      libc: ["glibc"],
      files: ["bin"],
      publishConfig: { access: "public" },
    });

    const darwin = platformManifest("darwin-arm64", meta);

    expect(darwin).toMatchObject({ os: ["darwin"], cpu: ["arm64"] });
    expect(darwin).not.toHaveProperty("libc");
  });

  test("the tarball name of a scoped package has the scope without the at sign", () => {
    expect(tarballName("kerpeten", "1.2.3")).toBe("kerpeten-1.2.3.tgz");
    expect(tarballName("@kerpetensh/kerpeten-linux-x64", "1.2.3")).toBe("kerpetensh-kerpeten-linux-x64-1.2.3.tgz");
  });

  test("a package.json without a needed field is an error", () => {
    expect(readMeta(project())).toEqual(meta);
    expect(() => readMeta(project({ ...meta, description: "" }))).toThrow("package.json has no description");
    expect(() => readMeta(project({ license: "MIT", author: "Someone" }))).toThrow("package.json has no version");
  });

  test("writes the main package and one package per built target, with executable files", () => {
    const root = project();
    const built: string[] = [];

    const dirsWritten = writePackages(root, ["linux-x64"], (_root, target, outfile) => {
      built.push(target);
      writeFileSync(outfile, "binary\n");
    });

    const main = join(root, "dist", "npm", "kerpeten");
    const platform = join(root, "dist", "npm", "kerpeten-linux-x64");

    expect(dirsWritten).toEqual([main, platform]);
    expect(built).toEqual(["linux-x64"]);
    expect(readdirSync(join(root, "dist", "npm")).sort()).toEqual(["kerpeten", "kerpeten-linux-x64"]);
    expect(readdirSync(main).sort()).toEqual(["LICENSE", "README.md", "bin", "package.json"]);
    expect(readdirSync(platform).sort()).toEqual(["LICENSE", "README.md", "bin", "package.json"]);
    expect(readFileSync(join(main, "README.md"), "utf8")).toBe("# readme\n");
    expect(executable(join(main, "bin", "kerpeten.cjs"))).toBe(true);
    expect(executable(join(platform, "bin", "kerpeten"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(main, "package.json"), "utf8")) as Record<string, unknown>;

    expect(Object.keys(manifest.optionalDependencies as object)).toEqual(Targets.ALL.map(platformPackage));

    expect(JSON.parse(readFileSync(join(platform, "package.json"), "utf8"))).toEqual(
      platformManifest("linux-x64", meta),
    );
  });
});
