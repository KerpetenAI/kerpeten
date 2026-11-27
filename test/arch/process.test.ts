import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const SPAWNER = "src/harness-kit/capability/ProcessCapability.ts";
const PROCESS = /\bBun\s*\.\s*(spawn|spawnSync|\$)|child_process|\bfrom\s*["']bun["']|\bimport\s*\(\s*["']bun["']\s*\)/;

test("only ProcessCapability starts processes", () => {
  const files = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })].sort();

  expect(files).toContain(SPAWNER);
  expect(files.filter((path) => PROCESS.test(readFileSync(join(root, path), "utf8")))).toEqual([SPAWNER]);
});
