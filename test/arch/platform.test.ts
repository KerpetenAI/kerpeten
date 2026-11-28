import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CapabilityUses, capabilitySpec, harnessSpec } from "@kerpetensh/harness-kit";
import { GitHubPlatform } from "../../src/capability/platform/GitHubPlatform.ts";
import { GitLabPlatform } from "../../src/capability/platform/GitLabPlatform.ts";
import { OriginProject } from "../../src/capability/platform/OriginProject.ts";
import { PlatformChoice } from "../../src/capability/platform/PlatformChoice.ts";
import { RepoJail } from "../../src/capability/repo/RepoJail.ts";
import { Harnesses } from "../../src/harnesses/Harnesses.ts";
import { MergeRequestStep } from "../../src/workflow/review/step/MergeRequestStep.ts";
import { WrittenCommentStep } from "../../src/workflow/review/step/WrittenCommentStep.ts";

const root = join(import.meta.dir, "..", "..");
const PLATFORM = "src/capability/platform/";

const IMPORT =
  /\b(?:import|export)\b[^;]*from\s*["'][^"']*capability\/platform\/[^"']*["']|\bimport\s*\(\s*["'][^"']*capability\/platform\//;

const READERS = ["src/app/KerpetenApp.ts", "src/workflow/review/", "src/workflow/review-command/"];

const PLATFORMS = [
  { capability: GitHubPlatform, file: "GitHubPlatform.ts" },
  { capability: GitLabPlatform, file: "GitLabPlatform.ts" },
];

const CONCRETE = /\bfrom\s*["'][^"']*capability\/platform\/Git(?:Hub|Lab)Platform\.ts["']/;

test("only the review workflows and the composition root import the platform capability, its types included", () => {
  const importing = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })]
    .filter((path) => !path.startsWith(PLATFORM))
    .filter((path) => IMPORT.test(readFileSync(join(root, path), "utf8")))
    .sort();

  expect(importing).toContain("src/app/KerpetenApp.ts");
  expect(importing).toContain("src/workflow/review/step/MergeRequestStep.ts");
  expect(importing).toContain("src/workflow/review/step/WrittenCommentStep.ts");
  expect(importing.filter((path) => !READERS.some((reader) => path.startsWith(reader)))).toEqual([]);
});

test("no workflow names a platform capability: the flow steps take the platform from the run's platform choice", () => {
  const naming = [...new Bun.Glob("src/workflow/**/*.ts").scanSync({ cwd: root })]
    .filter((path) => CONCRETE.test(readFileSync(join(root, path), "utf8")))
    .sort();

  expect(naming).toEqual([]);

  expect(CapabilityUses.of(PlatformChoice).map((use) => use.capability)).toEqual(
    expect.arrayContaining(PLATFORMS.map((platform) => platform.capability)),
  );

  expect(CapabilityUses.of(MergeRequestStep).map((use) => use.capability)).toEqual([PlatformChoice]);
  expect(CapabilityUses.of(WrittenCommentStep).map((use) => use.capability)).toEqual([PlatformChoice]);
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

test("the platform capabilities declare no permission, so no tool can take them, and no tool of a harness reaches them or the platform choice", () => {
  const reached = reachedByTools();

  expect(reached).toContain(RepoJail);
  expect(reached).not.toContain(PlatformChoice);
  expect(reached).not.toContain(OriginProject);

  for (const { capability } of PLATFORMS) {
    expect(capabilitySpec(capability).permission).toBeUndefined();
    expect(reached).not.toContain(capability);
  }
});

for (const { capability, file } of PLATFORMS) {
  test(`every public method of ${capability.name} is one of its typed reads`, () => {
    const own = Object.getOwnPropertyNames(capability.prototype).filter((name) => name !== "constructor");
    const source = readFileSync(join(root, PLATFORM, file), "utf8");
    const published = own.filter((name) => new RegExp(`^  public (?:async )?${name}\\(`, "m").test(source));

    expect(published.sort()).toEqual(["comments", "mergeRequest"]);
    expect(source).not.toMatch(/^ {2}public (?:async )?\w+\([^)]*(?:args|string\[\])/m);
  });
}

test("both platform capabilities and the platform choice take the project from the origin remote, and only the origin project reads the URL of a remote", () => {
  for (const user of [...PLATFORMS.map((platform) => platform.capability), PlatformChoice]) {
    expect(CapabilityUses.of(user).map((use) => use.capability)).toContain(OriginProject);
  }

  const reading = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })]
    .filter((path) => /originUrl\(|RemoteProject\.parse\(/.test(readFileSync(join(root, path), "utf8")))
    .sort();

  expect(reading).toEqual(["src/capability/git/Git.ts", "src/capability/platform/OriginProject.ts"]);

  for (const { file } of PLATFORMS) {
    const source = readFileSync(join(root, PLATFORM, file), "utf8");

    expect(source).not.toMatch(/\{owner\}\/\{repo\}|:fullpath/);
    expect(source).toContain('"--hostname", project.host');
  }
});
