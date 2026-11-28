import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GitHubPlatform } from "../../src/capability/platform/GitHubPlatform.ts";
import { RepoJail } from "../../src/capability/repo/RepoJail.ts";
import { CapabilityUses, capabilitySpec, harnessSpec } from "../../src/harness-kit/index.ts";
import { Harnesses } from "../../src/harnesses/Harnesses.ts";

const root = join(import.meta.dir, "..", "..");
const PLATFORM = "src/capability/platform/";

const IMPORT =
  /\b(?:import|export)\b[^;]*from\s*["'][^"']*capability\/platform\/[^"']*["']|\bimport\s*\(\s*["'][^"']*capability\/platform\//;

const READERS = ["src/app/KerpetenApp.ts", "src/workflow/review/", "src/workflow/review-command/"];

test("only the review workflows and the composition root import the platform capability, its types included", () => {
  const importing = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })]
    .filter((path) => !path.startsWith(PLATFORM))
    .filter((path) => IMPORT.test(readFileSync(join(root, path), "utf8")))
    .sort();

  expect(importing).toContain("src/app/KerpetenApp.ts");
  expect(importing).toContain("src/workflow/review/step/MergeRequestStep.ts");
  expect(importing.filter((path) => !READERS.some((reader) => path.startsWith(reader)))).toEqual([]);
});

/** Every class the tools of the harnesses take with `@Use`, and what those take in turn. */
function reachedByTools(): Set<object> {
  const reached = new Set<object>();
  const open: object[] = Harnesses.ALL.flatMap((harness) => [...harnessSpec(harness).tools]);

  for (let target = open.pop(); target !== undefined; target = open.pop()) {
    for (const use of CapabilityUses.of(target)) {
      if (reached.has(use.capability)) continue;

      reached.add(use.capability);
      open.push(use.capability);
    }
  }

  return reached;
}

test("the platform capability declares no permission, so no tool can take it, and no tool of a harness reaches it", () => {
  const reached = reachedByTools();

  expect(capabilitySpec(GitHubPlatform).permission).toBeUndefined();
  expect(reached).toContain(RepoJail);
  expect(reached).not.toContain(GitHubPlatform);
});

test("every public method of the platform capability is one of its typed reads", () => {
  const own = Object.getOwnPropertyNames(GitHubPlatform.prototype).filter((name) => name !== "constructor");
  const source = readFileSync(join(root, PLATFORM, "GitHubPlatform.ts"), "utf8");
  const published = own.filter((name) => new RegExp(`^  public (?:async )?${name}\\(`, "m").test(source));

  expect(published.sort()).toEqual(["comments", "mergeRequest"]);
  expect(source).not.toMatch(/^ {2}public (?:async )?\w+\([^)]*(?:args|string\[\])/m);
});
