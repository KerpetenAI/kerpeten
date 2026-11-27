import { describe, expect, test } from "bun:test";
import {
  PermissionGroupError,
  type PermissionGroupMap,
  PermissionGroupSet,
  type Run,
} from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";
import { GroupTestHarness } from "./GroupTestHarness.ts";
import { bodies, buildingRun, resetRecords } from "./harness-kit-utils.ts";
import { Reader } from "./Reader.ts";
import { SearchCapability } from "./SearchCapability.ts";

const groups = new PermissionGroupSet({ read: ["repo:read"] });

function capabilities(group: string): Promise<Run> {
  return buildingRun(groups.grant(group), [Reader, SearchCapability]);
}

describe("permission groups", () => {
  test("a capability outside the chosen group is never built, though its tool is offered", async () => {
    resetRecords();

    const run = await capabilities("read");

    const toolbox = new GroupTestHarness().toolbox(run);

    expect(toolbox.specs.map((spec) => spec.name)).toEqual(["list", "grep"]);
    expect(Builds.made).toEqual([]);

    expect(await toolbox.execute("list", { path: "src" })).toEqual({
      ok: true,
      output: { entries: "entries of src" },
    });

    expect(await toolbox.execute("grep", { pattern: "x" })).toEqual({
      ok: false,
      error:
        'grep failed: FakeGrepTool.searcher needs the capability search, which the permission group "read" does not give',
    });

    expect(bodies.map((body) => body.name)).toEqual(["list", "grep"]);
    expect(Builds.made).toEqual(["reader"]);
  });

  test("an unknown group is refused with the known names, and all cannot be redefined", () => {
    for (const name of ["write", "toString", "", "ALL"]) {
      expect(() => groups.check(name)).toThrow(PermissionGroupError);

      expect(() => groups.grant(name)).toThrow(
        `unknown permission group ${JSON.stringify(name)}; known groups: all, read`,
      );
    }

    const redefined = { all: ["repo:read"] } as unknown as PermissionGroupMap;

    expect(() => new PermissionGroupSet(redefined)).toThrow('the permission group "all" is built in');
  });

  test("a grant names its group and gives the group's permissions, or every permission for all", () => {
    expect(groups.grant("read")).toEqual({ group: "read", every: false, permissions: ["repo:read"] });
    expect(groups.grant("all")).toEqual({ group: "all", every: true });
    expect(groups.names).toEqual(["all", "read"]);
    expect(groups.declared).toEqual([["read", ["repo:read"]]]);
    expect(new PermissionGroupSet({}).declared).toEqual([]);
    expect(() => groups.check("all")).not.toThrow();
  });

  test("all builds every capability a tool reads, each once", async () => {
    resetRecords();

    const run = await capabilities("all");

    const toolbox = new GroupTestHarness().toolbox(run);

    await toolbox.execute("grep", { pattern: "x" });
    await toolbox.execute("list", { path: "a" });
    await toolbox.execute("grep", { pattern: "y" });

    expect(Builds.made).toEqual(["search", "reader"]);
  });
});
