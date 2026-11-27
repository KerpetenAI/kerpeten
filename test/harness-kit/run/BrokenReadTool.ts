import type { z } from "zod";
import { Tool, Use } from "../../../src/harness-kit/index.ts";
import { listInput } from "../schemas/fake-schema.ts";
import { BrokenSource } from "./BrokenSource.ts";

@Tool({ name: "broken_read", description: "Reads from the broken source.", input: listInput })
export class BrokenReadTool {
  @Use(BrokenSource)
  private readonly source!: BrokenSource;

  public execute(input: z.infer<typeof listInput>): unknown {
    return this.source.read(input.path);
  }
}
