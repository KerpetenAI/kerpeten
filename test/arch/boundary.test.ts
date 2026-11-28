import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kitImportProblem } from "./arch-utils.ts";

const root = join(import.meta.dir, "..", "..");
const SPECIFIER = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;

test("the kit is the package: the repository holds no copy of it and imports it only through its two entry points", () => {
  const problems: string[] = [];
  const files = [...new Bun.Glob("{src,test,scripts}/**/*.ts").scanSync({ cwd: root })].sort();

  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(SPECIFIER)) {
      const problem = kitImportProblem(file, match[1] ?? match[2] ?? match[3] ?? "");

      if (problem !== undefined) problems.push(problem);
    }
  }

  expect(problems).toEqual([]);
  expect(existsSync(join(root, "src", "harness-kit"))).toBe(false);
  expect(existsSync(join(root, "test", "harness-kit"))).toBe(false);
});

test("the check takes the two entry points and refuses a folder of the repository and a path into the package", () => {
  const kit = "@kerpetensh/harness-kit";

  expect(kitImportProblem("src/app/A.ts", kit)).toBeUndefined();
  expect(kitImportProblem("src/app/A.ts", `${kit}/ai-sdk`)).toBeUndefined();
  expect(kitImportProblem("src/app/A.ts", "@asenajs/ioc")).toBeUndefined();
  expect(kitImportProblem("src/app/A.ts", "../capability/git/Git.ts")).toBeUndefined();

  expect(kitImportProblem("src/app/A.ts", `${kit}/dist/index.js`)).toBe(
    `src/app/A.ts imports a path inside the kit package: ${kit}/dist/index.js`,
  );

  expect(kitImportProblem("src/app/A.ts", `${kit}/ai-sdk/index.js`)).toContain("a path inside the kit package");

  expect(kitImportProblem("src/app/A.ts", "../harness-kit/index.ts")).toBe(
    "src/app/A.ts imports the kit by a file path: ../harness-kit/index.ts",
  );

  expect(kitImportProblem("test/app/a.test.ts", "../../src/harness-kit/ai-sdk/index.ts")).toContain("by a file path");
  expect(kitImportProblem("test/app/a.test.ts", "../harness-kit/harness-kit-utils.ts")).toContain("by a file path");

  expect(kitImportProblem("src/app/A.ts", `../../node_modules/${kit}/dist/index.js`)).toContain("by a file path");
});
