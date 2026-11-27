import { describe, expect, test } from "bun:test";
import { Harness, harnessSpec } from "../../src/harness-kit/index.ts";
import { GrepTestHarness } from "./GrepTestHarness.ts";
import { GroupTestHarness } from "./GroupTestHarness.ts";
import { TestHarness } from "./TestHarness.ts";

describe("@Harness", () => {
  test("records the permissions a harness lists", () => {
    expect(harnessSpec(GroupTestHarness).permissions).toEqual(["repo:read", "repo:search"]);
    expect(harnessSpec(GrepTestHarness).permissions).toEqual(["repo:search"]);
    expect(harnessSpec(TestHarness).permissions).toEqual([]);
  });

  test("refuses a permission that is not lowercase words joined by colons", () => {
    for (const permission of ["", "repo read", "Repo:read", "repo:", ":read", "repo::read", "all\n"]) {
      expect(() => Harness({ name: "bad", tools: [], permissions: [permission] })).toThrow(
        `harness bad lists the permission ${JSON.stringify(permission)}; a permission is lowercase words joined by colons, like repo:read`,
      );
    }

    const wrongType = { name: "bad", tools: [], permissions: [1] } as unknown as Parameters<typeof Harness>[0];

    expect(() => Harness(wrongType)).toThrow("harness bad lists the permission 1;");
  });

  test("refuses a permission listed twice and a missing list", () => {
    expect(() => Harness({ name: "bad", tools: [], permissions: ["repo:read", "repo:search", "repo:read"] })).toThrow(
      "harness bad lists the permission repo:read twice",
    );

    const missing = { name: "bad", tools: [] } as unknown as Parameters<typeof Harness>[0];

    expect(() => Harness(missing)).toThrow("harness bad needs a permissions list");

    expect(() => Harness({ name: "good", tools: [], permissions: ["repo:read", "repo:search"] })).not.toThrow();
  });
});
