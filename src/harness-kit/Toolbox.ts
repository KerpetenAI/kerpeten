import { errorMessage } from "./harness-kit-utils.ts";
import type { Run } from "./run/Run.ts";
import { RunScope } from "./run/RunScope.ts";
import { ToolError } from "./ToolError.ts";
import type { BoundTool, ToolOutcome, ToolSpec } from "./types/tool.ts";

/**
 * The tools of one run. Each call runs inside the run's scope: the run first makes ready what the tool takes with
 * `@Use`, then the tool runs and its fields read those instances. What the tool does, a `ToolError` or any other error
 * it throws and a `PermissionError` of a field it reads included, is the call's outcome. A run that cannot make ready
 * what the tool takes is not: `execute` throws the build's error as it is, and the harness run ends with it.
 */
export class Toolbox {
  private readonly tools = new Map<string, BoundTool>();
  private readonly run: Run;

  public constructor(tools: readonly BoundTool[], run: Run) {
    for (const tool of tools) {
      if (this.tools.has(tool.spec.name)) throw new Error(`two tools are named ${tool.spec.name}`);

      this.tools.set(tool.spec.name, tool);
    }

    this.run = run;
  }

  public get specs(): readonly ToolSpec[] {
    return [...this.tools.values()].map((tool) => tool.spec);
  }

  public async execute(name: string, input: unknown): Promise<ToolOutcome> {
    const tool = this.tools.get(name);

    if (tool === undefined) {
      return {
        ok: false,
        error: `unknown tool ${JSON.stringify(name)}; available: ${[...this.tools.keys()].join(", ")}`,
      };
    }

    const { run } = this;

    await RunScope.enter(run, () => run.prepare(tool.handler));

    try {
      const output = await RunScope.enter(run, () => tool.handler.execute(input));

      return { ok: true, output };
    } catch (error) {
      if (error instanceof ToolError) return { ok: false, error: error.message };

      return { ok: false, error: `${name} failed: ${errorMessage(error)}` };
    }
  }
}
