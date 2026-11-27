import { describe, expect, test } from "bun:test";
import { ProbeCapability } from "../../src/harness-kit/ai-sdk/ProbeCapability.ts";
import { ProbeHarness } from "../../src/harness-kit/ai-sdk/ProbeHarness.ts";
import { ProbeTool } from "../../src/harness-kit/ai-sdk/ProbeTool.ts";
import {
  type HarnessClass,
  HarnessWiring,
  PermissionGroupError,
  PermissionGroupSet,
  toolSpec,
  UnmarkedClassError,
  WiringError,
} from "../../src/harness-kit/index.ts";
import { BrokenHarness } from "./BrokenHarness.ts";
import { GrepTestHarness } from "./GrepTestHarness.ts";
import { GroupTestHarness } from "./GroupTestHarness.ts";
import { HollowHarness } from "./HollowHarness.ts";
import { OptionalTestHarness } from "./OptionalTestHarness.ts";
import { TestHarness } from "./TestHarness.ts";
import { TwinHarness } from "./TwinHarness.ts";
import { UnmarkedTool } from "./UnmarkedTool.ts";

const groups = new PermissionGroupSet({ read: ["repo:read"] });

const misspelled = new PermissionGroupSet({ read: ["repo:read", "repo:serach"] });

describe("harness wiring", () => {
  test("a sound wiring has no problems and passes the check", () => {
    const harnesses = [GroupTestHarness, GrepTestHarness, TestHarness, OptionalTestHarness];

    expect(HarnessWiring.problems(harnesses, groups)).toEqual([]);
    expect(() => HarnessWiring.check(harnesses, groups)).not.toThrow();
  });

  test("the check lists every problem of the wiring in one error", () => {
    const harnesses = [GroupTestHarness, BrokenHarness, TwinHarness, TestHarness, UnmarkedTool];

    const problems = [
      "harness broken does not list the permission repo:search, which its tool grep needs",
      "harness broken has two tools named grep",
      "harness broken lists UnmarkedTool, which is not marked with @Tool",
      "tool git_head uses the capability local, which declares no permission",
      "tool unmarked_use uses Unmarked in its field thing, which is not marked with @Capability",
      "harness broken lists the permission repo:write, which none of its tools uses",
      "the harness list holds UnmarkedTool, which is not marked with @Harness",
      "two harnesses are named test",
      "permission group read lists the permission repo:serach, which no harness lists",
    ];

    expect(HarnessWiring.problems(harnesses, misspelled)).toEqual(problems);

    let thrown: unknown;

    try {
      HarnessWiring.check(harnesses, misspelled);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WiringError);
    expect((thrown as WiringError).problems).toEqual(problems);

    expect((thrown as WiringError).message).toBe(
      [
        "the harness wiring is wrong:",
        "- harness broken does not list the permission repo:search, which its tool grep needs",
        "- harness broken has two tools named grep",
        "- harness broken lists UnmarkedTool, which is not marked with @Tool",
        "- tool git_head uses the capability local, which declares no permission",
        "- tool unmarked_use uses Unmarked in its field thing, which is not marked with @Capability",
        "- harness broken lists the permission repo:write, which none of its tools uses",
        "- the harness list holds UnmarkedTool, which is not marked with @Harness",
        "- two harnesses are named test",
        "- permission group read lists the permission repo:serach, which no harness lists",
      ].join("\n"),
    );
  });

  test("the self-check probe passes the startup check and needs its own permission", () => {
    const none = new PermissionGroupSet({});

    expect(toolSpec(ProbeTool).uses).toEqual([{ field: "probe", capability: ProbeCapability, required: true }]);
    expect(HarnessWiring.problems([ProbeHarness], none)).toEqual([]);
    expect(HarnessWiring.required(ProbeHarness)).toEqual(["probe:run"]);
    expect(HarnessWiring.admit([ProbeHarness], none.grant(PermissionGroupSet.ALL))).toEqual([]);
  });

  test("a missing harness or tool entry is a wiring problem, not a crash", () => {
    const harnesses = [GroupTestHarness, undefined as unknown as HarnessClass, HollowHarness];

    const problems = [
      "the harness list holds nothing at entry 2, which is likely an import cycle",
      "harness hollow holds nothing at entry 2 of its tools, which is likely an import cycle",
    ];

    expect(HarnessWiring.problems(harnesses, groups)).toEqual(problems);
    expect(() => HarnessWiring.check(harnesses, groups)).toThrow(WiringError);
  });

  test("a class that is not marked is told apart from other errors", () => {
    expect(() => toolSpec(UnmarkedTool)).toThrow(UnmarkedClassError);
    expect(() => toolSpec(UnmarkedTool)).toThrow("the class is not marked with @Tool");
  });

  test("the required permissions of a harness are those of its tools' required uses", () => {
    expect(HarnessWiring.required(GroupTestHarness)).toEqual(["repo:read", "repo:search"]);
    expect(HarnessWiring.required(GrepTestHarness)).toEqual(["repo:search"]);
    expect(HarnessWiring.required(TestHarness)).toEqual([]);
    expect(HarnessWiring.required(OptionalTestHarness)).toEqual(["repo:read"]);
  });

  test("the given permissions of a harness are those it lists that the grant gives", () => {
    expect(HarnessWiring.given(GroupTestHarness, groups.grant("read"))).toEqual(["repo:read"]);
    expect(HarnessWiring.given(GroupTestHarness, groups.grant("all"))).toEqual(["repo:read", "repo:search"]);
    expect(HarnessWiring.given(TestHarness, groups.grant("all"))).toEqual([]);
  });

  test("a group that misses an optional permission starts the run and names each optional use it does not give", () => {
    expect(HarnessWiring.admit([OptionalTestHarness, TestHarness], groups.grant("read"))).toEqual([
      { harness: "test-optional", tool: "maybe_grep", capability: "search", permission: "repo:search", group: "read" },
    ]);

    expect(HarnessWiring.admit([OptionalTestHarness], groups.grant("all"))).toEqual([]);
  });

  test("a group that misses a required permission cannot start the run", () => {
    const harnesses = [GroupTestHarness, GrepTestHarness, TestHarness];

    expect(() => HarnessWiring.admit(harnesses, groups.grant("read"))).toThrow(PermissionGroupError);

    expect(() => HarnessWiring.admit(harnesses, groups.grant("read"))).toThrow(
      [
        'the permission group "read" cannot start this run:',
        "- harness test-groups needs the permission repo:search",
        "- harness test-with-grep needs the permission repo:search",
      ].join("\n"),
    );

    expect(() => HarnessWiring.admit([TestHarness], groups.grant("read"))).not.toThrow();
    expect(() => HarnessWiring.admit(harnesses, groups.grant("all"))).not.toThrow();

    const paths = new PermissionGroupSet({ paths: ["repo:read", "repo:search"] });

    expect(() => HarnessWiring.admit(harnesses, paths.grant("paths"))).not.toThrow();
  });
});
