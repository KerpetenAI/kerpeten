import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const root = join(import.meta.dir, "..", "..");
const LIBRARY = "src/harness-kit/";
const ENTRIES = ["src/harness-kit/index.ts", "src/harness-kit/ai-sdk/index.ts"];
const SPECIFIER = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;

test("the harness library imports nothing of the project and is entered only through its index files", () => {
  const problems: string[] = [];

  for (const file of [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })].sort()) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(SPECIFIER)) {
      const path = match[1] ?? match[2] ?? match[3] ?? "";

      if (!path.startsWith(".")) continue;

      const target = normalize(join(dirname(file), path));
      const fromLibrary = file.startsWith(LIBRARY);
      const toLibrary = target.startsWith(LIBRARY);

      if (fromLibrary && !toLibrary) problems.push(`${file} leaves the library: ${path}`);
      if (!fromLibrary && toLibrary && !ENTRIES.includes(target)) problems.push(`${file} reaches inside: ${path}`);
    }
  }

  expect(problems).toEqual([]);
});

test("the harness library tests import nothing of the project", () => {
  const problems: string[] = [];

  for (const file of [...new Bun.Glob("test/harness-kit/**/*.ts").scanSync({ cwd: root })].sort()) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(SPECIFIER)) {
      const path = match[1] ?? match[2] ?? match[3] ?? "";

      if (!path.startsWith(".")) continue;

      const target = normalize(join(dirname(file), path));

      if (!target.startsWith(LIBRARY) && !target.startsWith("test/harness-kit/"))
        problems.push(`${file} imports ${path}`);
    }
  }

  expect(problems).toEqual([]);
});
