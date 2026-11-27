import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";

const root = join(import.meta.dir, "..", "..");

describe("self-check", () => {
  test("checks the embedded prompts and the model SDK round trip", async () => {
    const lines: string[] = [];
    const problems: string[] = [];

    await KerpetenApp.run({ io: { out: (line) => lines.push(line), err: (line) => problems.push(line) }, env: {} }, [
      "self-check",
    ]);

    expect(problems).toEqual([]);
    expect(lines.join("\n")).toMatch(/self-check: reviewer prompt v4 embedded, sha256 [0-9a-f]{64}/);

    expect(lines).toContain("self-check: model SDK round trip passed: tool call, tool result and structured output");
  });

  test("passes in a process with an empty environment, without a home directory", () => {
    const result = Bun.spawnSync([process.execPath, join(root, "scripts", "kerpeten.ts"), "self-check"], {
      cwd: root,
      env: {},
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toContain("self-check: model SDK round trip passed");
    expect(result.exitCode).toBe(0);
  });
});
