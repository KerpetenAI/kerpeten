import type { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { CommandRunner } from "./CommandRunner.ts";
import { FileReader } from "./FileReader.ts";
import { bodies } from "./harness-kit-utils.ts";
import { runInput } from "./schemas/toolbox-schema.ts";

@Tool({ name: "run", description: "Run a command", input: runInput })
export class RunTool {
  @Use(FileReader)
  private readonly reader!: FileReader;

  @Use(CommandRunner)
  private readonly runner!: CommandRunner;

  public execute(input: z.infer<typeof runInput>): unknown {
    bodies.push({ name: "run", input });

    return { output: this.runner.run(input.command), log: this.reader.read("log") };
  }
}
