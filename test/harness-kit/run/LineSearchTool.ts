import type { z } from "zod";
import { Tool, Use } from "../../../src/harness-kit/index.ts";
import { grepInput } from "../schemas/fake-schema.ts";
import { LineSearch } from "./LineSearch.ts";

@Tool({ name: "line_search", description: "Finds a line.", input: grepInput })
export class LineSearchTool {
  @Use(LineSearch)
  private readonly search!: LineSearch;

  public execute(input: z.infer<typeof grepInput>): unknown {
    return this.search.find(input.pattern);
  }
}
