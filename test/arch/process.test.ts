import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const PROCESS = /\bBun\s*\.\s*(spawn|spawnSync|\$)|child_process|\bfrom\s*["']bun["']|\bimport\s*\(\s*["']bun["']\s*\)/;

test("no file of the project starts a process: only the kit's ProcessCapability does", () => {
  const files = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })].sort();

  const extending = files.filter((path) =>
    /\bextends ProcessCapability\b/.test(readFileSync(join(root, path), "utf8")),
  );

  expect(extending.length).toBeGreaterThan(0);
  expect(files.filter((path) => PROCESS.test(readFileSync(join(root, path), "utf8")))).toEqual([]);
});
