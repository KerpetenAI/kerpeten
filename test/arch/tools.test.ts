import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const BYPASS = /\bBun\s*\.\s*(spawn|spawnSync|write|\$)|\bfetch\s*\(|child_process/;

test("tools reach processes and the network only through their capabilities", () => {
  const files = [...new Bun.Glob("src/tools/**/*Tool.ts").scanSync({ cwd: root })].sort();

  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((path) => BYPASS.test(readFileSync(join(root, path), "utf8")))).toEqual([]);
});
