import { describe, expect, test } from "bun:test";
import { HarnessWiring, harnessSpec, PermissionGroupSet } from "@kerpetensh/harness-kit";
import { PermissionGroups } from "../../src/capability/PermissionGroups.ts";
import { JudgeHarness } from "../../src/harnesses/judge/JudgeHarness.ts";
import { ReviewerHarness } from "../../src/harnesses/review/ReviewerHarness.ts";

describe("permission groups", () => {
  test("the project defines read with both repository permissions next to the built-in all", () => {
    expect(PermissionGroups.SET.names).toEqual([PermissionGroupSet.ALL, "read"]);

    expect(PermissionGroups.SET.grant("read")).toEqual({
      group: "read",
      every: false,
      permissions: ["repo:read", "repo:search"],
    });

    for (const group of PermissionGroups.SET.names) {
      expect(HarnessWiring.given(ReviewerHarness, PermissionGroups.SET.grant(group))).toEqual([
        "repo:read",
        "repo:search",
      ]);
    }
  });

  test("no harness declares permission groups; both list the repository permissions", () => {
    for (const harness of [ReviewerHarness, JudgeHarness]) {
      expect(Object.keys(harnessSpec(harness)).sort()).toEqual(["name", "permissions", "tools"]);
      expect(harnessSpec(harness).permissions).toEqual(["repo:read", "repo:search"]);
    }
  });
});
