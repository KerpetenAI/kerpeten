import type { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { bodies } from "./harness-kit-utils.ts";
import { SearchCapability } from "./SearchCapability.ts";
import { grepInput } from "./schemas/fake-schema.ts";

@Tool({ name: "grep", description: "search the files", input: grepInput })
export class FakeGrepTool {
  @Use(SearchCapability)
  private readonly searcher!: SearchCapability;

  public execute(input: z.infer<typeof grepInput>): unknown {
    bodies.push({ name: "grep", input });

    return { matches: this.searcher.search(input.pattern) };
  }
}
