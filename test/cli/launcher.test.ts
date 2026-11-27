import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("the development launcher", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kerpeten-launcher-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("runs the CLI from source in a directory without the project's tsconfig.json", () => {
    const result = Bun.spawnSync([process.execPath, join(root, "scripts", "kerpeten.ts"), "self-check"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toContain("self-check: model SDK round trip passed");
    expect(result.exitCode).toBe(0);
  });

  test("passes the exit code of the CLI on", () => {
    const result = Bun.spawnSync([process.execPath, join(root, "scripts", "kerpeten.ts"), "deploy"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stderr.toString()).toStartWith('kerpeten: unknown command "deploy"');
    expect(result.exitCode).toBe(2);
  });
});
