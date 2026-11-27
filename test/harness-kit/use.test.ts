import { describe, expect, test } from "bun:test";
import {
  Capability,
  capabilitySpec,
  type PermissionGrant,
  PermissionGroupSet,
  Run,
  Toolbox,
  type ToolHandler,
  toolSpec,
  Use,
} from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";
import { FakeSkills } from "./FakeSkills.ts";
import { buildingRun } from "./harness-kit-utils.ts";
import { LocalSkills } from "./LocalSkills.ts";
import { Marker } from "./Marker.ts";
import { OpenSkills } from "./OpenSkills.ts";
import { OptionalSearchTool } from "./OptionalSearchTool.ts";
import { Reader } from "./Reader.ts";
import { RemoteSkills } from "./RemoteSkills.ts";
import { SearchCapability } from "./SearchCapability.ts";
import { SkillSource } from "./SkillSource.ts";
import { SkillTool } from "./SkillTool.ts";
import { SlowTool } from "./SlowTool.ts";

const groups = new PermissionGroupSet({
  read: ["repo:read"],
  search: ["repo:read", "repo:search"],
  marked: ["marker:read"],
  skills: ["skills:read"],
});

async function counted(grant: PermissionGrant) {
  const capabilities = await buildingRun(grant, [Reader, SearchCapability]);

  return { made: Builds.made, capabilities };
}

function toolbox(tool: ToolHandler, capabilities: Run): Toolbox {
  return new Toolbox([{ spec: toolSpec(tool.constructor), handler: tool }], capabilities);
}

describe("@Use", () => {
  test("records the capabilities a tool uses, the fields of its base class first", () => {
    expect(toolSpec(OptionalSearchTool).uses).toEqual([
      { field: "reader", capability: Reader, required: true },
      { field: "searcher", capability: SearchCapability, required: false },
    ]);

    expect(toolSpec(SlowTool).uses).toEqual([{ field: "marker", capability: Marker, required: true }]);
  });

  test("a field gives the run's capability inside a tool call and throws outside one", async () => {
    const tool = new SlowTool();
    const marker = new Marker(7);
    const capabilities = new Run(groups.grant("marked")).give(Marker, marker);

    expect(await toolbox(tool, capabilities).execute("slow", { waitMs: 0, file: import.meta.path })).toEqual({
      ok: true,
      output: [7, 7, 7, 7],
    });

    expect(() => tool.peek()).toThrow("SlowTool.marker was read outside a run");
  });

  test("an optional field is the capability when the group gives it, and undefined and never built when it does not", async () => {
    const given = await counted(groups.grant("search"));

    expect(await toolbox(new OptionalSearchTool(), given.capabilities).execute("maybe_grep", { pattern: "x" })).toEqual(
      { ok: true, output: { entries: "entries of .", matches: ["x"] } },
    );

    expect(given.made).toEqual(["reader", "search"]);

    const missing = await counted(groups.grant("read"));

    expect(
      await toolbox(new OptionalSearchTool(), missing.capabilities).execute("maybe_grep", { pattern: "x" }),
    ).toEqual({ ok: true, output: { entries: "entries of .", matches: null } });

    expect(missing.made).toEqual(["reader"]);
  });

  test("a required capability the group does not give is never built and its read fails the call", async () => {
    const { made, capabilities } = await counted(new PermissionGroupSet({ none: [] }).grant("none"));

    expect(await toolbox(new OptionalSearchTool(), capabilities).execute("maybe_grep", { pattern: "x" })).toEqual({
      ok: false,
      error:
        'maybe_grep failed: OptionalSearchTool.reader needs the capability reader, which the permission group "none" does not give',
    });

    expect(made).toEqual([]);
  });

  test("a capability is built once per run, however often it is read", async () => {
    const { made, capabilities } = await counted(groups.grant("search"));
    const box = toolbox(new OptionalSearchTool(), capabilities);

    await box.execute("maybe_grep", { pattern: "a" });
    await box.execute("maybe_grep", { pattern: "b" });

    expect(made).toEqual(["reader", "search"]);
  });

  test("40 interleaved calls through one tool object each read only their own capability across a timer, a file stream and a process", async () => {
    const tool = new SlowTool();

    const runs = Array.from({ length: 40 }, (_, index) => {
      const capabilities = new Run(groups.grant("marked")).give(Marker, new Marker(index));

      return toolbox(tool, capabilities).execute("slow", { waitMs: (40 - index) % 7, file: import.meta.path });
    });

    const outcomes = await Promise.all(runs);

    expect(outcomes).toEqual(
      Array.from({ length: 40 }, (_, index) => ({ ok: true, output: [index, index, index, index] })),
    );
  });

  test("one abstract capability serves its implementations and a test double through the same field", async () => {
    expect(capabilitySpec(LocalSkills)).toMatchObject({ name: "local-skills", permission: "skills:read" });
    expect(capabilitySpec(FakeSkills)).toMatchObject({ name: "skills", permission: "skills:read" });
    expect(new FakeSkills().capabilityName).toBe("skills");

    for (const [make, expected] of [
      [() => new LocalSkills(), ["local"]],
      [() => new RemoteSkills(), ["remote"]],
      [() => new FakeSkills(), ["fake"]],
    ] as const) {
      const capabilities = new Run(groups.grant("skills")).give(SkillSource, make());

      expect(await toolbox(new SkillTool(), capabilities).execute("skills", {})).toEqual({
        ok: true,
        output: expected,
      });
    }
  });

  test("a capability that extends another and declares a different permission is refused when it is defined", () => {
    expect(() =>
      Capability({ name: "skills-open", description: "Skills anyone may change.", permission: "skills:write" })(
        OpenSkills,
      ),
    ).toThrow(
      "capability skills-open extends skills and must declare the same permission (skills:read), not skills:write",
    );
  });

  test("a @Use without a class, as an import cycle leaves it, is refused when the class is defined", () => {
    expect(() => Use(undefined as unknown as typeof Reader)({}, "jail")).toThrow(
      "@Use on the field jail got no class; an import cycle leaves the class undefined",
    );
  });
});
