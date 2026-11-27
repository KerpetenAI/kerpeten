import type { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { ReadingTool } from "./ReadingTool.ts";
import { SearchCapability } from "./SearchCapability.ts";
import { grepInput } from "./schemas/fake-schema.ts";

@Tool({ name: "maybe_grep", description: "Lists the root and searches when it may.", input: grepInput })
export class OptionalSearchTool extends ReadingTool {
  @Use(SearchCapability, { required: false })
  private readonly searcher: SearchCapability | undefined;

  public execute(input: z.infer<typeof grepInput>): unknown {
    return { entries: this.reader.read("."), matches: this.searcher?.search(input.pattern) ?? null };
  }
}
