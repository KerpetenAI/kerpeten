import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

const ENV =
  /\bBun\s*\.\s*env\b|\bprocess\s*\[\s*["'`]env["'`]\s*\]|\bfrom\s*["'](?:node:)?process["']|\bimport\s*\(\s*["'](?:node:)?process["']\s*\)/;

test("only the CLI reads the environment", () => {
  const files = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })].filter((path) => !path.startsWith("src/cli/"));

  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((path) => ENV.test(readFileSync(join(root, path), "utf8"))).sort()).toEqual([]);
});
