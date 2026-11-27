import { describe, expect, test } from "bun:test";
import {
  type BoundTool,
  PermissionGroupSet,
  type Run,
  Toolbox,
  type ToolClass,
  toolSpec,
} from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";
import { CommandRunner } from "./CommandRunner.ts";
import { FileReader } from "./FileReader.ts";
import { bodies, buildingRun, resetRecords } from "./harness-kit-utils.ts";
import { ReadTool } from "./ReadTool.ts";
import { RunTool } from "./RunTool.ts";
import { UnmarkedTool } from "./UnmarkedTool.ts";

const groups = new PermissionGroupSet({ read: ["files:read"] });

function capabilities(group: string): Promise<Run> {
  return buildingRun(groups.grant(group), [FileReader, CommandRunner]);
}

function bound(...tools: readonly ToolClass[]): readonly BoundTool[] {
  return tools.map((tool) => ({ spec: toolSpec(tool), handler: new tool() }));
}

describe("@Tool", () => {
  test("records the spec and the capabilities the tool uses on the class", () => {
    expect(toolSpec(RunTool)).toMatchObject({
      name: "run",
      uses: [
        { field: "reader", capability: FileReader, required: true },
        { field: "runner", capability: CommandRunner, required: true },
      ],
    });

    expect(() => toolSpec(UnmarkedTool)).toThrow("the class is not marked with @Tool");
  });

  test("invalid input never reaches the body", async () => {
    resetRecords();

    const toolbox = new Toolbox(bound(ReadTool), await capabilities("read"));

    for (const input of [{}, { path: "" }, { path: 1 }, { path: "a", extra: true }, null, "a"]) {
      const outcome = await toolbox.execute("read", input);

      expect(outcome.ok).toBe(false);

      if (!outcome.ok) expect(outcome.error).toStartWith("invalid input for read: ");
    }

    expect(bodies).toEqual([]);
    expect(await toolbox.execute("read", { path: "a" })).toEqual({ ok: true, output: { content: "contents of a" } });
    expect(bodies).toEqual([{ name: "read", input: { path: "a" } }]);
  });
});

describe("Toolbox", () => {
  test("lists every tool it is given and answers an unknown tool with the available ones", async () => {
    resetRecords();

    const toolbox = new Toolbox(bound(ReadTool, RunTool), await capabilities("all"));

    expect(toolbox.specs.map((spec) => spec.name)).toEqual(["read", "run"]);

    expect(await toolbox.execute("run", { command: "id" })).toEqual({
      ok: true,
      output: { output: "ran id", log: "contents of log" },
    });

    expect(await toolbox.execute("nope", {})).toEqual({
      ok: false,
      error: 'unknown tool "nope"; available: read, run',
    });
  });

  test("a call that reads a capability the group does not give fails without building it", async () => {
    resetRecords();

    const toolbox = new Toolbox(bound(RunTool), await capabilities("read"));

    expect(await toolbox.execute("run", { command: "id" })).toEqual({
      ok: false,
      error:
        'run failed: RunTool.runner needs the capability command-runner, which the permission group "read" does not give',
    });

    expect(Builds.made).not.toContain("command-runner");
  });

  test("refuses two tools with the same name", async () => {
    const run = await capabilities("read");

    expect(() => new Toolbox(bound(ReadTool, ReadTool), run)).toThrow("two tools are named read");
  });
});
