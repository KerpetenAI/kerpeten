import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Launcher } from "./types/launcher.ts";

const LAUNCHER = join(import.meta.dir, "..", "..", "npm", "kerpeten.cjs");
const launcher = createRequire(import.meta.url)(LAUNCHER) as Launcher;

const NAMES = [
  "@kerpetensh/kerpeten-linux-x64",
  "@kerpetensh/kerpeten-linux-arm64",
  "@kerpetensh/kerpeten-darwin-arm64",
];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function missing(): never {
  throw new Error("Cannot find module");
}

function installed(script: string): string {
  const root = mkdtempSync(join(tmpdir(), "kerpeten-launcher-"));
  const name = `@kerpetensh/kerpeten-${process.platform}-${process.arch}`;
  const main = join(root, "node_modules", "kerpeten");
  const platform = join(root, "node_modules", name);

  dirs.push(root);
  mkdirSync(join(main, "bin"), { recursive: true });
  mkdirSync(join(platform, "bin"), { recursive: true });

  writeFileSync(
    join(main, "package.json"),
    JSON.stringify({ name: "kerpeten", optionalDependencies: { [name]: "1.0.0" } }),
  );

  writeFileSync(join(platform, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  copyFileSync(LAUNCHER, join(main, "bin", "kerpeten.cjs"));
  writeFileSync(join(platform, "bin", "kerpeten"), script);
  chmodSync(join(platform, "bin", "kerpeten"), 0o755);

  return join(main, "bin", "kerpeten.cjs");
}

describe("npm launcher", () => {
  test("finds the binary in the package of the platform", () => {
    const asked: string[] = [];

    const found = launcher.resolveBinary(NAMES, "linux", "arm64", false, (id) => {
      asked.push(id);

      return "/somewhere/kerpeten";
    });

    expect(found).toEqual({ ok: true, path: "/somewhere/kerpeten" });
    expect(asked).toEqual(["@kerpetensh/kerpeten-linux-arm64/bin/kerpeten"]);
  });

  test("a platform without a build is an error that names the builds", () => {
    expect(launcher.resolveBinary(NAMES, "win32", "x64", false, missing)).toEqual({
      ok: false,
      error: "there is no build for win32-x64; the builds are linux-x64, linux-arm64, darwin-arm64",
    });
  });

  test("musl is an error, even when the package is installed", () => {
    expect(launcher.resolveBinary(NAMES, "linux", "x64", true, () => "/somewhere/kerpeten")).toEqual({
      ok: false,
      error: "this Linux uses musl libc, as Alpine does; the builds need glibc",
    });
  });

  test("a platform package that is not installed is an error that says how to get it", () => {
    expect(launcher.resolveBinary(NAMES, "darwin", "arm64", false, missing)).toEqual({
      ok: false,
      error:
        "the package @kerpetensh/kerpeten-darwin-arm64 is not installed; it is an optional dependency, so install kerpeten again without --omit=optional",
    });
  });

  test("only a Linux without a glibc version in its report uses musl", () => {
    const glibc = () => ({ header: { glibcVersionRuntime: "2.39" } });
    const musl = () => ({ header: {} });

    expect(launcher.usesMusl("linux", glibc)).toBe(false);
    expect(launcher.usesMusl("linux", musl)).toBe(true);
    expect(launcher.usesMusl("darwin", missing)).toBe(false);
  });

  test("runs the binary with the arguments and stdin and ends with its exit code", () => {
    const script = installed('#!/bin/sh\necho "args: $*"\ncat\nexit 7\n');

    const result = Bun.spawnSync(["node", script, "review", "--dry-run"], {
      stdin: new TextEncoder().encode("from stdin\n"),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stdout.toString()).toBe("args: review --dry-run\nfrom stdin\n");
    expect(result.exitCode).toBe(7);
  });
});
