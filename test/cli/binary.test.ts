import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { buildBinary } from "../../scripts/build/build-utils.ts";

const root = join(import.meta.dir, "..", "..");

const SDK_LINE = "self-check: model SDK round trip passed: tool call, tool result and structured output";
const native = process.platform === "linux" && process.arch === "x64";

describe.skipIf(!native)("compiled linux-x64 binary", () => {
  let dir: string;
  let binary: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kerpeten-binary-"));
    binary = join(dir, "kerpeten");
    buildBinary(root, "linux-x64", binary);
  }, 120_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("passes self-check from a directory outside the repository", () => {
    const result = Bun.spawnSync([binary, "self-check"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toMatch(/self-check: reviewer prompt v2 embedded, sha256 [0-9a-f]{64}/);
    expect(result.stdout.toString()).toContain(SDK_LINE);
  });

  test("refuses review --dry-run outside a repository without calling a model", () => {
    const result = Bun.spawnSync([binary, "review", "--dry-run", "--base", "main"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", GIT_CEILING_DIRECTORIES: dir },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("not inside a git work tree");
  });

  test("reports its version and refuses bad arguments with exit 2", () => {
    const version = Bun.spawnSync([binary, "--version"], { cwd: dir, stdout: "pipe" });

    expect(version.stdout.toString().trim()).toBe(pkg.version);

    expect(
      Bun.spawnSync([binary, "review", "--all", "--read"], { cwd: dir, stdout: "pipe", stderr: "pipe" }).exitCode,
    ).toBe(2);
  });
});
