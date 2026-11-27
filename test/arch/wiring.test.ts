import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PermissionGroups } from "../../src/capability/PermissionGroups.ts";
import { HarnessWiring } from "../../src/harness-kit/index.ts";
import { Harnesses } from "../../src/harnesses/Harnesses.ts";
import { markedHarnesses } from "./arch-utils.ts";

const root = join(import.meta.dir, "..", "..");

describe("project harness wiring", () => {
  test("the harnesses and the permission groups of the project are wired soundly", () => {
    expect(HarnessWiring.problems(Harnesses.ALL, PermissionGroups.SET)).toEqual([]);
    expect(() => HarnessWiring.check(Harnesses.ALL, PermissionGroups.SET)).not.toThrow();
  });

  test("every permission group starts the review harnesses", () => {
    expect(PermissionGroups.SET.names.length).toBeGreaterThan(0);

    for (const group of PermissionGroups.SET.names) {
      expect(() => HarnessWiring.admit(Harnesses.ALL, PermissionGroups.SET.grant(group))).not.toThrow();
    }
  });

  test("the list holds every class of the project marked with @Harness", () => {
    const marked = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })]
      .filter((path) => !path.startsWith("src/harness-kit/"))
      .flatMap((path) => markedHarnesses(readFileSync(join(root, path), "utf8")));

    expect(marked.sort()).toEqual(Harnesses.ALL.map((harness) => harness.name).sort());
  });

  test("the search finds every class marked with @Harness in a file, abstract ones too", () => {
    const source = [
      '@Harness({ name: "one", tools: [], permissions: [] })',
      "export class OneHarness extends HarnessBase<object> {}",
      "",
      "export class Plain {}",
      "",
      '@Harness({ name: "two", tools: [], permissions: [] })',
      "export abstract class TwoHarness extends HarnessBase<object> {}",
    ].join("\n");

    expect(markedHarnesses(source)).toEqual(["OneHarness", "TwoHarness"]);
  });
});
