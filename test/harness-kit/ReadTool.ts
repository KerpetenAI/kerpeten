import type { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { FileReader } from "./FileReader.ts";
import { bodies } from "./harness-kit-utils.ts";
import { readInput } from "./schemas/toolbox-schema.ts";

@Tool({ name: "read", description: "Read a file", input: readInput })
export class ReadTool {
  @Use(FileReader)
  private readonly reader!: FileReader;

  public execute(input: z.infer<typeof readInput>): unknown {
    bodies.push({ name: "read", input });

    return { content: this.reader.read(input.path) };
  }
}
