import type { z } from "zod";
import { Tool, Use } from "../../../src/harness-kit/index.ts";
import { listInput } from "../schemas/fake-schema.ts";
import { LineReader } from "./LineReader.ts";

@Tool({ name: "line_read", description: "Reads a line.", input: listInput })
export class LineReadTool {
  @Use(LineReader)
  private readonly reader!: LineReader;

  public execute(input: z.infer<typeof listInput>): unknown {
    return this.reader.read(input.path);
  }
}
